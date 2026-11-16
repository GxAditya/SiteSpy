import { AlertTriangle, CheckCircle2, CircleSlash, Clock, FileCheck2, GraduationCap, Layers3, Loader2, MonitorPlay, ReceiptText, TriangleAlert, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SECTIONS, type SectionKey, type SectionResult } from "@/lib/dossier-core";
import { StepTicker } from "./StepTicker";

export type BoardState = "waiting" | "starting" | "queued" | "working" | "found" | "not_found" | "unavailable";

export function boardState(r: SectionResult): BoardState {
  if (r.status === "found" || r.status === "not_found") return r.status;
  if (r.status === "unavailable" || r.status === "no_source") return "unavailable";
  if (r.agentState === "running") return "working";
  return r.agentState ?? "waiting";
}

const ICONS: Record<SectionKey, typeof FileCheck2> = {
  permits: FileCheck2,
  zoning: Layers3,
  tax: ReceiptText,
  flood: Waves,
  violations: TriangleAlert,
  schools: GraduationCap,
};

const CHIP: Record<BoardState, { label: (r: SectionResult) => string; cls: string; Icon: typeof Clock | null }> = {
  waiting: { label: () => "Up next", cls: "text-muted-foreground", Icon: Clock },
  starting: { label: () => "Starting", cls: "text-primary", Icon: Loader2 },
  queued: { label: () => "Queued", cls: "text-muted-foreground", Icon: Clock },
  working: { label: (r) => (r.stepCount ? `Working, step ${r.stepCount}` : "Working"), cls: "text-primary", Icon: null },
  found: { label: (r) => `${r.items.length} record${r.items.length === 1 ? "" : "s"}`, cls: "text-success", Icon: CheckCircle2 },
  not_found: { label: () => "No records at source", cls: "text-muted-foreground", Icon: CircleSlash },
  unavailable: { label: () => "Source unavailable", cls: "text-warning", Icon: AlertTriangle },
};

/** What to show under the record type: the agent's live step while it works, the outcome once done. */
function activity(r: SectionResult, s: BoardState): { id: string; text: string } {
  const last = r.steps?.at(-1);
  if (s === "working" && last) return { id: last.id, text: last.action };
  if (s === "working") return { id: "working", text: `Opening ${r.site ?? "the official portal"}…` };
  if (s === "queued") return { id: "queued", text: "Waiting for a free TinyFish browser. Your plan runs a few agents at once." };
  if (s === "starting") return { id: "starting", text: `Starting an agent on ${r.site ?? "the official portal"}…` };
  if (s === "waiting") return { id: "waiting", text: "Starts when an agent frees up." };
  if (s === "found") return { id: "found", text: r.items[0]?.title ?? "" };
  return { id: s, text: r.reason };
}

export function RunBoard({
  sections,
  running,
  watching,
  onWatch,
  onJump,
}: {
  sections: SectionResult[];
  running: boolean;
  watching: SectionKey | null;
  onWatch: (k: SectionKey) => void;
  onJump: (k: SectionKey) => void;
}) {
  const states = sections.map(boardState);
  const done = states.filter((s) => s === "found" || s === "not_found" || s === "unavailable").length;
  const found = states.filter((s) => s === "found").length;

  return (
    <section className="surface no-print" aria-label="Record checks">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 pb-4 pt-5">
        <div>
          <h2 className="text-xl font-medium">{running ? "Checking official records" : "At a glance"}</h2>
          <p className="tabular mt-1 text-sm text-muted-foreground">
            {running ? `${done} of ${sections.length} record types done` : `${found} of ${sections.length} record types have records`}
          </p>
        </div>
        <div className="run-meter w-full sm:w-56" role="img" aria-label={`${done} of ${sections.length} checks finished`}>
          {states.map((s, i) => (
            <span key={i} data-state={s === "starting" || s === "queued" ? "working" : s} />
          ))}
        </div>
      </header>
      <ol>
        {sections.map((r, i) => {
          const s = states[i]!;
          const meta = SECTIONS.find((x) => x.key === r.key)!;
          const Icon = ICONS[r.key];
          const chip = CHIP[s];
          const line = activity(r, s);
          const live = s === "working" && Boolean(r.streamingUrl);
          const active = s === "working" || s === "queued" || s === "starting";
          return (
            <li key={r.key} className="run-row" data-state={s === "starting" || s === "queued" ? "working" : s} data-live={watching === r.key}>
              <span className="run-icon" aria-hidden="true">
                <Icon size={19} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <h3 className="font-sans text-[15px] font-semibold">{meta.label}</h3>
                  <span className={`tabular inline-flex items-center gap-1.5 text-xs font-medium ${chip.cls}`}>
                    {s === "working" ? <span className="live-dot" aria-hidden="true" /> : chip.Icon && <chip.Icon size={13} className={s === "starting" ? "animate-spin" : ""} aria-hidden="true" />}
                    {chip.label(r)}
                  </span>
                </div>
                {active && r.site && <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.site}</p>}
                {line.text && (
                  <StepTicker
                    id={`${r.key}:${line.id}`}
                    text={line.text}
                    className={`mt-1 text-sm ${s === "working" ? "text-foreground" : "text-muted-foreground"}`}
                  />
                )}
              </div>
              <div className="run-action">
                {live ? (
                  <Button
                    size="sm"
                    variant={watching === r.key ? "secondary" : "outline"}
                    className="press"
                    aria-pressed={watching === r.key}
                    onClick={() => onWatch(r.key)}
                  >
                    <MonitorPlay /> {watching === r.key ? "Watching" : "Watch live"}
                  </Button>
                ) : !active && s !== "waiting" ? (
                  <Button size="sm" variant="ghost" className="press" onClick={() => onJump(r.key)}>
                    {s === "found" ? "View records" : "Details"}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
