// Live checks against the real official portals. Skipped unless TINYFISH_API_KEY is set and opted in:
//   Free (TinyFish Fetch only):  LIVE=1 npx vitest run src/test/live-dossier.test.ts
//   Paid (TinyFish Agent, ~6-12 runs for one city, plus one Monitor):
//     LIVE=1 LIVE_AGENT=seattle npx vitest run src/test/live-dossier.test.ts      (or san-francisco / nyc)
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Run server-function handlers in-process instead of over HTTP; everything else is the real code.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return (a: { data: unknown }) => h({ data: validate(a.data) });
      },
    };
    return b;
  },
}));

const { SECTIONS, emptySections, hostOf, pageChange } = await import("@/lib/dossier-core");
const { locate, runSection } = await import("@/lib/run-dossier");
const { JURISDICTIONS, agentPlan, jurisdictionById } = await import("@/lib/sources");
const { tfFetch, tfMonitorCreate, tfMonitorDelete, tfMonitorRun } = await import("@/lib/tinyfish.functions");

const KEY = process.env["TINYFISH_API_KEY"] ?? "";
const LIVE = process.env["LIVE"] === "1" && KEY.length > 5;
const AGENT_CITY = process.env["LIVE_AGENT"] ?? "";
const save = (name: string, v: unknown) => {
  mkdirSync("live-results", { recursive: true });
  writeFileSync(`live-results/${name}.json`, JSON.stringify(v, null, 2));
};

describe.skipIf(!LIVE)("live: mapped portals respond (free)", () => {
  it.each(JURISDICTIONS.map((j) => [j.name, j] as const))("%s", async (_, j) => {
    const { place, jurisdiction } = await locate(j.demo);
    expect(jurisdiction?.id, "demo address resolves to its own jurisdiction").toBe(j.id);
    const urls = [...new Set(SECTIONS.flatMap((s) => j.sources[s.key].map((spec) => agentPlan(j, spec, place!).url)))];
    const f = await tfFetch({ data: { key: KEY, urls: urls.slice(0, 10), purpose: "Check official property portals respond" } });
    const ok = f.results.map((r) => r.url);
    const report = { ok, errors: f.errors };
    save(`portals-${j.id}`, report);
    console.log(`\n${j.name}\n  ok: ${ok.map(hostOf).join(", ")}\n  errors: ${f.errors.map((e) => `${hostOf(e.url)} (${e.error})`).join(", ") || "none"}`);
    expect(new Set(ok.map(hostOf)).size, "at least three official portals reachable").toBeGreaterThanOrEqual(3);
  }, 180_000);
});

describe.skipIf(!LIVE || !AGENT_CITY)("live: full dossier with the TinyFish Agent (paid)", () => {
  it(`builds a sourced dossier for ${AGENT_CITY} and monitors a source page`, async () => {
    const j = jurisdictionById(AGENT_CITY)!;
    const { place } = await locate(j.demo);
    const sections = emptySections();
    const queue = SECTIONS.map((s) => s.key);
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (let k = queue.shift(); k; k = queue.shift()) sections[k] = await runSection(KEY, place!, j, k, () => {});
      }),
    );
    save(`dossier-${j.id}`, { query: j.demo, generated_at: new Date().toISOString(), place, jurisdiction: j.id, sections });

    const all = Object.values(sections);
    const records = all.flatMap((s) => s.items);
    console.log(`\n${all.map((s) => `${s.key}=${s.status}(${s.items.length}, ${s.items.filter((i) => i.verified).length} verified) ${s.reason}`).join("\n")}`);
    for (const s of all) {
      expect(["found", "not_found", "unavailable"]).toContain(s.status); // flagged, never left pending
      if (s.status !== "found") expect(s.reason).not.toBe("");
      for (const src of s.sources) expect(src.note, src.url).not.toMatch(/TinyFish 4\d\d/); // a rejected request is our bug
    }
    for (const r of records) expect(r.source_url).toMatch(/^https?:\/\//);
    const hosts = new Set(records.map((r) => hostOf(r.source_url)));
    console.log(`record hosts: ${[...hosts].join(", ")}`);
    expect(hosts.size, "records from at least three official sources").toBeGreaterThanOrEqual(3);

    // Same target choice as "Watch for new permits & changes": the page a permit/violation record came from.
    const target = (sections.permits.items[0] ?? sections.violations.items[0] ?? records[0]!).source_url;
    const m = await tfMonitorCreate({ data: { key: KEY, url: target, name: "SiteSpy live test", purpose: "New or changed permits" } });
    expect(m.id).not.toBe("");
    try {
      const run = await tfMonitorRun({ data: { key: KEY, id: m.id } });
      console.log(`monitor on ${target}: ${pageChange(m.text, run.text).outcome} (${run.text.length} chars)`);
      expect(["changed", "unchanged"]).toContain(pageChange(m.text, run.text).outcome);
    } finally {
      await tfMonitorDelete({ data: { key: KEY, id: m.id } });
    }
  }, 60 * 60_000);
});
