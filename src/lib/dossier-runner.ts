// Runs live outside the page component: leaving the dossier page and coming back re-attaches to the
// same run, and after a refresh the saved state resumes polling the same TinyFish agent runs.
import { SECTIONS, emptySections, type Dossier, type SectionKey } from "./dossier-core";
import { RunControl, locate, runSection } from "./run-dossier";
import { jurisdictionById } from "./sources";
import { lockHeldElsewhere, releaseLock, saveDossier, takeLock } from "./storage";

export interface JobState {
  dossier: Dossier | null;
  phase: string;
  running: boolean;
  stopping: boolean;
  unsupported: { found: boolean; where: string } | null;
}

interface Job {
  state: JobState;
  ctl: RunControl;
  listeners: Set<(s: JobState) => void>;
}

const jobs = new Map<string, Job>();

export const jobState = (cacheKey: string): JobState | null => jobs.get(cacheKey)?.state ?? null;

export function subscribe(cacheKey: string, fn: (s: JobState) => void): () => void {
  const job = jobs.get(cacheKey);
  if (!job) return () => {};
  job.listeners.add(fn);
  fn(job.state);
  return () => job.listeners.delete(fn);
}

export async function stopJob(cacheKey: string) {
  const job = jobs.get(cacheKey);
  if (!job) return;
  set(job, { stopping: true });
  await job.ctl.stop();
}

/** Another tab owns this dossier's run; this tab should only display the saved state. */
export const runningElsewhere = (cacheKey: string) => !jobs.has(cacheKey) && lockHeldElsewhere(cacheKey);

function set(job: Job, patch: Partial<JobState>) {
  job.state = { ...job.state, ...patch };
  for (const l of job.listeners) l(job.state);
}

/**
 * Start a dossier, or resume a saved one that was still running. Returns false (and starts nothing)
 * if a run for it is already active in this tab or owned by another tab.
 */
export function startJob(cacheKey: string, q: string, area: string | undefined, apiKey: string, saved?: Dossier | null): boolean {
  if (jobs.has(cacheKey) || lockHeldElsewhere(cacheKey)) return false;
  const job: Job = {
    state: { dossier: saved ?? null, phase: "", running: true, stopping: false, unsupported: null },
    ctl: new RunControl(),
    listeners: new Set(),
  };
  jobs.set(cacheKey, job);
  takeLock(cacheKey);
  const heartbeat = setInterval(() => takeLock(cacheKey), 15_000);

  const update = (fn: (d: Dossier) => Dossier) => {
    if (!job.state.dossier) return;
    const next = fn(job.state.dossier);
    saveDossier(next); // persisted on every change so a refresh can pick up from here
    set(job, { dossier: next });
  };

  void (async () => {
    try {
      let dossier = saved?.running ? saved : null;
      let place = dossier?.place ?? null;
      let j = dossier?.jurisdiction ? jurisdictionById(dossier.jurisdiction) : null;
      if (!dossier || !place || !j) {
        set(job, { phase: "Locating the address…" });
        const loc = await locate(q, area);
        if (!loc.place || !loc.jurisdiction) {
          const where = loc.place ? [loc.place.city, loc.place.state, loc.place.country].filter(Boolean).join(", ") : "";
          set(job, { unsupported: { found: Boolean(loc.place), where } });
          return;
        }
        place = loc.place;
        j = loc.jurisdiction;
        if (!apiKey) return; // supported area; the page explains that a key is needed
        dossier = { query: cacheKey, generated_at: new Date().toISOString(), place, jurisdiction: j.id, running: true, sections: emptySections() };
        saveDossier(dossier);
        set(job, { dossier });
      }
      const jur = j!;
      const where = place!;
      set(job, { phase: `TinyFish agents are working on ${jur.name}'s official record portals…` });
      // Only sections still pending run; a resumed one re-attaches to its saved agent run.
      const queue = SECTIONS.map((s) => s.key).filter((k) => dossier!.sections[k].status === "pending");
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          for (let k: SectionKey | undefined = queue.shift(); k; k = queue.shift()) {
            const key = k;
            const resume = dossier!.sections[key];
            try {
              await runSection(
                apiKey,
                where,
                jur,
                key,
                (patch) => update((x) => ({ ...x, sections: { ...x.sections, [key]: { ...x.sections[key], ...patch } } })),
                job.ctl,
                resume.specIndex !== undefined || resume.runId ? resume : undefined,
              );
            } catch (e) {
              update((x) => ({ ...x, sections: { ...x.sections, [key]: { ...x.sections[key], status: "unavailable", reason: (e as Error).message } } }));
            }
          }
        }),
      );
      update((x) => ({ ...x, running: false, generated_at: new Date().toISOString() }));
    } catch (e) {
      update((x) => ({ ...x, running: false }));
      set(job, { phase: `Error: ${(e as Error).message}` });
    } finally {
      clearInterval(heartbeat);
      releaseLock(cacheKey);
      set(job, { running: false, stopping: false, phase: job.state.phase.startsWith("Error") ? job.state.phase : "" });
      jobs.delete(cacheKey);
    }
  })();
  return true;
}
