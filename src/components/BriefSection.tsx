import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, CircleSlash, ListChecks, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SECTIONS, briefLines, briefParts, hostOf, type Brief, type SectionKey, type SectionResult } from "@/lib/dossier-core";

const STATUS: Record<SectionResult["status"], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  found: { label: "Records found", cls: "text-success", Icon: CheckCircle2 },
  not_found: { label: "No records at source", cls: "text-muted-foreground", Icon: CircleSlash },
  unavailable: { label: "Source unavailable", cls: "text-warning", Icon: AlertTriangle },
  no_source: { label: "No official source", cls: "text-warning", Icon: AlertTriangle },
  pending: { label: "Not checked", cls: "text-muted-foreground", Icon: CircleSlash },
};

function SourceLinks({ urls }: { urls: string[] }) {
  if (!urls.length) return <span className="text-xs text-muted-foreground">No source</span>;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {urls.map((u) => (
        <li key={u}>
          <a href={u} target="_blank" rel="noreferrer" title={u} className="text-xs font-medium text-primary underline underline-offset-2">
            {hostOf(u) || u}
          </a>
        </li>
      ))}
    </ul>
  );
}

export interface BriefJob {
  status: "writing" | "error";
  provider: string;
  model: string;
  startedAt: number;
  error?: string;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular">{Math.max(0, Math.round((now - since) / 1000))}s</span>;
}

/** Placeholder rows with the real record types and statuses, so the layout the brief will fill is visible. */
function WritingRows({ sections }: { sections: Record<SectionKey, SectionResult> }) {
  return (
    <ul className="border-t border-border" aria-hidden="true">
      {SECTIONS.map((s, i) => {
        const st = STATUS[sections[s.key]?.status ?? "pending"];
        return (
          <li key={s.key} className="grid gap-x-6 gap-y-2 border-t border-border px-6 py-4 first:border-t-0 md:grid-cols-[190px_minmax(0,1fr)_200px]">
            <div>
              <p className="text-sm font-semibold">{s.label}</p>
              <p className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${st.cls}`}><st.Icon size={13} /> {st.label}</p>
            </div>
            <div className="space-y-2 pt-1">
              <span className="skeleton block h-3 w-[92%]" style={{ animationDelay: `${i * 90}ms` }} />
              <span className="skeleton block h-3" style={{ width: `${48 + ((i * 17) % 34)}%`, animationDelay: `${i * 90 + 45}ms` }} />
            </div>
            <span className="skeleton mt-1 block h-3 w-24" style={{ animationDelay: `${i * 90}ms` }} />
          </li>
        );
      })}
    </ul>
  );
}

/** The AI brief: a headline, one row per record type (status from the dossier, never the AI), then what to check by hand. */
export function BriefSection({
  brief,
  legacy,
  sections,
  job,
  onRetry,
  onCancel,
}: {
  brief?: Brief | undefined;
  legacy?: string | undefined;
  sections: Record<SectionKey, SectionResult>;
  job?: BriefJob | null;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  const writing = job?.status === "writing";
  // The finished brief eases in once, right after it was written, not on every page load.
  const wasWriting = useRef(false);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (wasWriting.current && !writing && (brief || legacy)) setReveal(true);
    wasWriting.current = writing;
  }, [writing, brief, legacy]);

  return (
    <section className="brief surface mt-8" aria-labelledby="brief-title" aria-busy={writing}>
      <header className="px-6 pb-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="brief-title" className="text-xl font-medium">Brief</h2>
            <p className="print-keep-next mt-0.5 text-xs text-muted-foreground">Written by AI from the records in this report only.</p>
          </div>
          {writing && onCancel && (
            <Button size="sm" variant="ghost" className="press no-print" onClick={onCancel}>
              <X /> Cancel
            </Button>
          )}
        </div>
        {writing && job && (
          <p className="mt-3 flex items-center gap-2 text-sm text-primary" role="status">
            <Sparkles size={16} className="brief-pulse" aria-hidden="true" />
            <span>
              Reading {SECTIONS.length} record types and writing with {job.provider} ({job.model})
            </span>
            <span className="text-muted-foreground"><Elapsed since={job.startedAt} /></span>
          </p>
        )}
        {job?.status === "error" && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-destructive/8 px-4 py-3 text-sm" role="alert">
            <AlertTriangle size={16} className="shrink-0 text-destructive" aria-hidden="true" />
            <p className="min-w-0 flex-1">
              <span className="font-semibold">The brief couldn't be written.</span>{" "}
              <span className="break-words text-muted-foreground">{job.error?.trim().replace(/([^.!?])$/, "$1.")}</span>{" "}
              <span className="text-muted-foreground">Check the provider key and model in <Link to="/settings" className="font-medium text-primary underline underline-offset-2">Settings</Link>.</span>
            </p>
            {onRetry && <Button size="sm" variant="outline" className="press" onClick={onRetry}><RotateCcw /> Try again</Button>}
          </div>
        )}
        {!writing && brief?.headline && <p className={`mt-3 max-w-[70ch] text-[17px] font-medium leading-snug ${reveal ? "brief-reveal" : ""}`}>{brief.headline}</p>}
      </header>

      {writing ? (
        <WritingRows sections={sections} />
      ) : !brief && !legacy ? null : brief ? (
        <div className={reveal ? "brief-reveal" : ""}>
          <ul className="border-t border-border">
            {brief.items.map((it) => {
              const st = STATUS[sections[it.section]?.status ?? "pending"];
              return (
                <li key={it.section} className="brief-row grid gap-x-6 gap-y-1.5 border-t border-border px-6 py-4 first:border-t-0 md:grid-cols-[190px_minmax(0,1fr)_200px]">
                  <div>
                    <p className="text-sm font-semibold">{SECTIONS.find((s) => s.key === it.section)?.label}</p>
                    <p className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${st.cls}`}>
                      <st.Icon size={13} aria-hidden="true" /> {st.label}
                    </p>
                  </div>
                  <p className="max-w-[62ch] text-sm leading-relaxed">{it.finding}</p>
                  <SourceLinks urls={it.sources} />
                </li>
              );
            })}
          </ul>
          {brief.verify.length > 0 && (
            <div className="brief-verify border-t border-border px-6 py-5">
              <h3 className="flex items-center gap-2 font-sans text-sm font-semibold">
                <ListChecks size={16} className="text-primary" aria-hidden="true" /> Check before signing
              </h3>
              <ul className="mt-2 max-w-[70ch] list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary">
                {brief.verify.map((v, i) => <li key={i}>{v}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        // Older saved briefs were free text: shown as before, with cited URLs as site-name links.
        <div className={`max-w-[72ch] space-y-1.5 border-t border-border px-6 py-5 text-sm leading-relaxed ${reveal ? "brief-reveal" : ""}`}>
          {briefLines(legacy ?? "").map((sentences, i) => (
            <p key={i} className={sentences.join(" ").length > 600 ? "brief-long" : "brief-line"}>
              {sentences.map((s, k) => (
                <span key={k} className="brief-sentence">
                  {briefParts(s).map((part, n) =>
                    "url" in part ? (
                      <a key={n} href={part.url} target="_blank" rel="noreferrer" title={part.url} className="font-medium text-primary underline underline-offset-2">{part.label}</a>
                    ) : (
                      part.text
                    ),
                  )}
                  {k < sentences.length - 1 ? " " : ""}
                </span>
              ))}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
