// Client-side orchestration: for a supported jurisdiction, send the TinyFish Agent to each curated official
// portal section by section, then cross-check the extracted records on their source pages with TinyFish Fetch.
import {
  OUTPUT_SCHEMA,
  SECTIONS,
  cleanRecords,
  finalizeStatus,
  hostOf,
  seenOnPage,
  type AgentStep,
  type DossierRecord,
  type Place,
  type SectionKey,
  type SectionResult,
  type SourceCheck,
} from "./dossier-core";
import { agentPlan, findJurisdiction, jurisdictionById, type Jurisdiction } from "./sources";
import { geocode, tfAgentStart, tfFetch, tfRunCancel, tfRunGet } from "./tinyfish.functions";

/**
 * Resolve the input to a place in a supported jurisdiction. Free (OpenStreetMap only), so unsupported
 * addresses are rejected before any TinyFish credit is spent. `area` is a jurisdiction id in parcel mode.
 */
export async function locate(q: string, area?: string): Promise<{ place: Place | null; jurisdiction: Jurisdiction | null }> {
  const j = area ? jurisdictionById(area) : null;
  if (area) {
    if (!j) return { place: null, jurisdiction: null };
    const city = await geocode({ data: { q: `${j.name}, ${j.region}, USA` } });
    if (!city) return { place: null, jurisdiction: j };
    // The parcel, not the city-centre point, identifies the property; drop street fields the agent must not use.
    return { place: { ...city, query: q, display: `${j.parcelLabel} ${q}, ${j.name}`, parcel: q, houseNumber: "", road: "", postcode: "" }, jurisdiction: j };
  }
  const place = await geocode({ data: { q } });
  return { place, jurisdiction: place ? findJurisdiction(place) : null };
}

const RUN_MS = 10 * 60_000; // observed real runs on county portals take up to ~7 minutes
const QUEUE_PLUS_RUN_MS = 25 * 60_000;

const RULES = [
  "Copy values EXACTLY as shown on the page. Never guess, infer or fill in values that are not displayed.",
  'If the site has no records of this kind for the property, return status "not_found" with an empty items list and say in reason what you searched.',
  'If a captcha, login wall, access-denied or error page stops you, return status "blocked" and describe it in reason.',
  "Each item's source_url must be the exact URL of the page where that record is displayed. Return at most 15 items.",
  "Do not submit complaints, applications or payments, and do not sign in.",
].join(" ");

const OUTPUT_GUIDE =
  'Return JSON like {"status":"found","reason":"","items":[{"record_id":"6522041","title":"Building permit – reroofing","date":"03/14/2024","details":"Status: COMPLETE; Description: ...","source_url":"https://..."}]}. ' +
  "record_id is the official id/number as shown (or empty); date is exactly as shown (or empty); details holds the key fields copied verbatim.";

// Merged into a finished section so no stale live state (agent badge, stream) survives the patch merge.
const IDLE = { agentState: undefined, streamingUrl: undefined, runId: undefined, site: undefined } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildGoal(j: Jurisdiction, place: Place, sectionKey: SectionKey, steps: string[], title: string): string {
  const section = SECTIONS.find((s) => s.key === sectionKey)!;
  const subject = place.parcel
    ? `${j.parcelLabel} ${place.parcel} in ${j.name}`
    : `the property at ${place.houseNumber} ${place.road}, ${place.city}, ${place.stateCode} ${place.postcode}`;
  return [
    `Find ${section.goal} for ${subject}, using the official ${title} website.`,
    "Steps:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    `${steps.length + 1}. Stop once the records are copied, after 3 result pages, or as soon as you are blocked.`,
    RULES,
    OUTPUT_GUIDE,
  ].join("\n");
}

/** Shared by every section of one dossier run: Stop cancels all in-flight agent runs and starts no new ones. */
export class RunControl {
  stopped = false;
  private readonly live = new Map<string, string>(); // runId -> api key
  track(runId: string, key: string) {
    this.live.set(runId, key);
  }
  done(runId: string) {
    this.live.delete(runId);
  }
  async stop() {
    this.stopped = true;
    await Promise.all([...this.live].map(([runId, key]) => tfRunCancel({ data: { key, runId } }).catch(() => {})));
    this.live.clear();
  }
}

class Stopped extends Error {}

type RunUpdate = { runId: string; streamingUrl?: string; queued: boolean; steps?: AgentStep[]; stepCount?: number };

/** Starts a run, or with `existingRunId` re-attaches to one started before a page refresh. */
async function runAgent(key: string, url: string, goal: string, ctl: RunControl, onRun: (u: RunUpdate) => void, existingRunId?: string) {
  const runId = existingRunId ?? (await tfAgentStart({ data: { key, url, goal, schema: OUTPUT_SCHEMA, country: "US" } })).runId;
  ctl.track(runId, key);
  onRun({ runId, queued: true });
  try {
    // Queue time (PENDING behind the account's concurrency limit) doesn't count toward the run budget.
    const submitted = Date.now();
    let started = 0;
    while (Date.now() - submitted < QUEUE_PLUS_RUN_MS && (!started || Date.now() - started < RUN_MS)) {
      await sleep(5000);
      if (ctl.stopped) {
        // Covers a run that was still starting when Stop was pressed.
        await tfRunCancel({ data: { key, runId } }).catch(() => {});
        throw new Stopped("Stopped");
      }
      const r = await tfRunGet({ data: { key, runId } });
      if (!started && r.status !== "PENDING") started = Date.now();
      onRun({ runId, queued: !started, steps: r.steps, stepCount: r.stepCount, ...(r.streamingUrl ? { streamingUrl: r.streamingUrl } : {}) });
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(r.status)) return r;
    }
    await tfRunCancel({ data: { key, runId } }).catch(() => {}); // stop paying for a run we no longer wait on
    throw new Error(`Timed out ${started ? "while running" : "waiting in the TinyFish queue"}; run cancelled`);
  } finally {
    ctl.done(runId);
  }
}

/** TinyFish Fetch re-reads each record's source page; a record is verified when its id/figure appears there. */
async function crossCheck(key: string, items: DossierRecord[], sources: SourceCheck[]): Promise<DossierRecord[]> {
  const urls = [...new Set(items.map((i) => i.source_url))].slice(0, 5);
  try {
    const f = await tfFetch({ data: { key, urls, purpose: "Re-read official property record pages to verify extracted values" } });
    const text = new Map(f.results.map((r) => [r.url, r.text]));
    const out = items.map((i) => ({ ...i, verified: text.has(i.source_url) ? seenOnPage(i, text.get(i.source_url)!) : undefined }));
    const ok = out.filter((i) => i.verified).length;
    sources.push({ url: urls[0] ?? "", title: "TinyFish Fetch cross-check", method: "fetch", ok: true, note: `${ok}/${out.length} record(s) matched on their source page` });
    return out;
  } catch (e) {
    sources.push({ url: "", title: "TinyFish Fetch cross-check failed", method: "fetch", ok: false, note: (e as Error).message });
    return items;
  }
}

export async function runSection(
  key: string,
  place: Place,
  j: Jurisdiction,
  sectionKey: SectionKey,
  onUpdate: (r: Partial<SectionResult>) => void,
  ctl: RunControl = new RunControl(),
  resume?: SectionResult,
): Promise<SectionResult> {
  const specs = j.sources[sectionKey];
  // Resuming continues exactly where the saved section left off, re-attaching to its in-flight run.
  const sources: SourceCheck[] = [...(resume?.sources ?? [])];
  let agentSaidNotFound = resume?.notFoundSoFar ?? false;
  let agentReached = resume?.reachedSoFar ?? 0;
  let pendingRunId = resume?.runId;
  let halted = "";
  // Sources are ordered by preference. A fallback runs only if earlier ones were blocked or failed; a
  // source holding a different record set (`complements`) also runs after an empty "not found".
  for (let i = resume?.specIndex ?? 0; i < specs.length; i++) {
    const spec = specs[i]!;
    if (ctl.stopped) halted ||= "Stopped before this record type was checked.";
    if (halted || (agentSaidNotFound && !spec.complements)) break;
    const plan = agentPlan(j, spec, place);
    const goal = buildGoal(j, place, sectionKey, plan.steps, spec.title);
    const where = `${spec.title} (${hostOf(plan.url)})`;
    const progress = { specIndex: i, notFoundSoFar: agentSaidNotFound, reachedSoFar: agentReached };
    onUpdate({
      ...progress,
      agentState: "starting",
      site: spec.title,
      reason: pendingRunId ? `Reconnecting to the TinyFish Agent on ${where}…` : `Starting the TinyFish Agent on ${where}…`,
      ...(pendingRunId ? {} : { steps: undefined, stepCount: undefined }), // a new source starts a fresh trail
    });
    try {
      const existing = pendingRunId;
      pendingRunId = undefined;
      const final = await runAgent(
        key,
        plan.url,
        goal,
        ctl,
        ({ runId, streamingUrl, queued, steps, stepCount }) =>
          onUpdate({
            ...progress,
            runId,
            agentState: queued ? "queued" : "running",
            ...(steps?.length ? { steps, stepCount } : {}),
            ...(streamingUrl ? { streamingUrl } : {}),
            reason: queued
              ? `Queued at TinyFish for ${where}: waiting for a free browser (your plan runs a limited number of agents at once). The live view appears when it starts.`
              : `TinyFish Agent is working on ${where}…`,
          }),
        existing,
      );
      onUpdate({ runId: undefined, streamingUrl: undefined, agentState: undefined });
      // A run cancelled from outside (dashboard, API, another tab's Stop) is a stop, not a blocked site.
      if (final.status === "CANCELLED") {
        sources.push({ url: plan.url, title: spec.title, method: "agent", ok: false, note: "Run was cancelled before it finished" });
        halted = "The agent run was cancelled before it finished; re-run to check this record type.";
        break;
      }
      const res = (JSON.parse(final.resultJson) ?? {}) as { status?: string; reason?: string; items?: unknown };
      const items = cleanRecords(res.items, plan.url, new Date().toISOString());
      const st = String(res.status ?? "").toLowerCase();
      const blocked = final.status !== "COMPLETED" || st.includes("block");
      if (!blocked) agentReached++;
      if (!blocked && !items.length && st.includes("not")) agentSaidNotFound = true;
      sources.push({
        url: plan.url,
        title: spec.title,
        method: "agent",
        ok: !blocked,
        note: blocked ? final.error || res.reason || "Blocked" : `${items.length} record(s)${res.reason ? ". " + res.reason : ""}`,
      });
      onUpdate({ sources: [...sources], specIndex: i + 1, notFoundSoFar: agentSaidNotFound, reachedSoFar: agentReached });
      if (items.length) {
        const checked = await crossCheck(key, items, sources);
        const r: SectionResult = { key: sectionKey, status: "found", reason: "", items: checked, sources, ...IDLE };
        onUpdate(r);
        return r;
      }
    } catch (e) {
      if (e instanceof Stopped) {
        sources.push({ url: plan.url, title: spec.title, method: "agent", ok: false, note: "Stopped by user; run cancelled" });
        halted = "Stopped by user before the agent finished.";
        break;
      }
      sources.push({ url: plan.url, title: spec.title, method: "agent", ok: false, note: (e as Error).message });
      onUpdate({ sources: [...sources], runId: undefined, streamingUrl: undefined, agentState: undefined, specIndex: i + 1 });
    }
  }
  const fin = halted
    ? { status: "unavailable" as const, reason: halted }
    : finalizeStatus({ sourcesFound: specs.length, sourcesReachable: agentReached, items: [], agentSaidNotFound });
  const out: SectionResult = { key: sectionKey, ...fin, items: [], sources, ...IDLE };
  onUpdate(out);
  return out;
}
