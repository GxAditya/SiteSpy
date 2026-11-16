import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place, SectionResult } from "@/lib/dossier-core";

// TinyFish is mocked: these tests cover run control (resume / cancel / stop), not the sites.
const tf = vi.hoisted(() => ({
  tfAgentStart: vi.fn(),
  tfRunGet: vi.fn(),
  tfRunCancel: vi.fn(async () => ({ ok: true })),
  tfFetch: vi.fn(async () => ({ results: [], errors: [] })),
  geocode: vi.fn(),
}));
vi.mock("@/lib/tinyfish.functions", () => tf);

const { RunControl, runSection } = await import("@/lib/run-dossier");
const { startJob, jobState } = await import("@/lib/dossier-runner");
const { emptySections } = await import("@/lib/dossier-core");
const { jurisdictionById } = await import("@/lib/sources");

const nyc = jurisdictionById("nyc")!; // violations: DOB BIS, then HPD
const place: Place = {
  query: "", display: "", lat: 0, lon: 0, countryCode: "US", country: "United States", state: "New York", stateCode: "NY",
  county: "New York County", city: "New York", postcode: "10018", houseNumber: "208", road: "West 41st Street", osmUrl: "",
};
const done = (items: unknown[] = []) => ({
  status: "COMPLETED", error: "", streamingUrl: "",
  resultJson: JSON.stringify({ status: items.length ? "found" : "not_found", items }),
});
const record = { record_id: "V123", title: "DOB violation", date: "01/02/2024", details: "Open", source_url: "https://a810-bisweb.nyc.gov/x" };

async function settle<T>(p: Promise<T>): Promise<T> {
  for (let i = 0; i < 50; i++) await vi.advanceTimersByTimeAsync(5000);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const f of Object.values(tf)) f.mockClear();
  tf.tfAgentStart.mockImplementation(async () => ({ runId: `new-${tf.tfAgentStart.mock.calls.length}` }));
});
afterEach(() => vi.useRealTimers());

describe("runSection run control", () => {
  it("after a refresh, re-attaches to the saved agent run instead of starting a new one", async () => {
    tf.tfRunGet.mockResolvedValue(done([record]));
    const saved = { key: "violations", status: "pending", reason: "", items: [], sources: [], specIndex: 0, runId: "run-before-refresh" } as SectionResult;
    const r = await settle(runSection("k", place, nyc, "violations", () => {}, new RunControl(), saved));
    expect(tf.tfAgentStart).not.toHaveBeenCalled();
    expect(tf.tfRunGet).toHaveBeenCalledWith({ data: { key: "k", runId: "run-before-refresh" } });
    expect(r.status).toBe("found");
  });

  it("a run cancelled from outside stops the section instead of starting the backup source", async () => {
    tf.tfRunGet.mockResolvedValue({ ...done(), status: "CANCELLED" });
    const r = await settle(runSection("k", place, nyc, "violations", () => {}));
    expect(tf.tfAgentStart).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("unavailable");
    expect(r.reason).toMatch(/cancelled/);
  });

  it("Stop cancels the queued run at TinyFish and starts nothing else", async () => {
    tf.tfRunGet.mockResolvedValue({ ...done(), status: "PENDING" });
    const updates: Partial<SectionResult>[] = [];
    const ctl = new RunControl();
    const p = runSection("k", place, nyc, "violations", (u) => updates.push(u), ctl);
    await vi.advanceTimersByTimeAsync(6000);
    expect(updates.some((u) => /Queued at TinyFish/.test(u.reason ?? ""))).toBe(true); // why there's no live view yet
    await ctl.stop();
    const r = await settle(p);
    expect(tf.tfRunCancel).toHaveBeenCalledWith({ data: { key: "k", runId: "new-1" } });
    expect(tf.tfAgentStart).toHaveBeenCalledTimes(1);
    expect(r.reason).toMatch(/Stopped/);
  });

  it("a refreshed page resumes only unfinished sections, and a second start is refused (no duplicate runs)", async () => {
    tf.tfRunGet.mockResolvedValue(done([record]));
    const sections = emptySections();
    for (const k of ["permits", "zoning", "tax", "flood", "schools"] as const) sections[k] = { ...sections[k], status: "not_found", reason: "done" };
    sections.violations = { ...sections.violations, specIndex: 0, runId: "in-flight" };
    const saved = { query: "q1", generated_at: "", place, jurisdiction: "nyc", running: true, sections };
    expect(startJob("q1", "208 West 41st Street", undefined, "k", saved)).toBe(true);
    expect(startJob("q1", "208 West 41st Street", undefined, "k", saved)).toBe(false);
    for (let i = 0; i < 50 && jobState("q1"); i++) await vi.advanceTimersByTimeAsync(5000);
    expect(tf.tfAgentStart).not.toHaveBeenCalled(); // only re-attached to "in-flight"
    expect(tf.tfRunGet).toHaveBeenCalledWith({ data: { key: "k", runId: "in-flight" } });
    const stored = JSON.parse(localStorage.getItem("sitespy.dossiers")!)["q1"];
    expect(stored.running).toBe(false);
    expect(stored.sections.violations.status).toBe("found");
  });

  it("saves its position so a resumed section continues with the next source", async () => {
    tf.tfRunGet.mockResolvedValue(done([record]));
    const saved = { key: "violations", status: "pending", reason: "", items: [], sources: [], specIndex: 1 } as SectionResult;
    await settle(runSection("k", place, nyc, "violations", () => {}, new RunControl(), saved));
    expect(tf.tfAgentStart).toHaveBeenCalledTimes(1);
    expect(tf.tfAgentStart.mock.calls[0]![0].data.url).toBe("https://hpdonline.nyc.gov/hpdonline/");
  });
});
