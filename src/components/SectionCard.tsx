import { AlertTriangle, CheckCircle2, CircleSlash, FileCheck2, GraduationCap, Layers3, ReceiptText, TriangleAlert, Waves } from "lucide-react";
import type { SectionKey, SectionResult } from "@/lib/dossier-core";
import { SECTIONS, hostOf } from "@/lib/dossier-core";

const ICONS: Record<SectionKey, typeof FileCheck2> = {
  permits: FileCheck2,
  zoning: Layers3,
  tax: ReceiptText,
  flood: Waves,
  violations: TriangleAlert,
  schools: GraduationCap,
};

const STATUS: Record<Exclude<SectionResult["status"], "pending">, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  found: { label: "Records found", cls: "text-success", Icon: CheckCircle2 },
  not_found: { label: "No records at source", cls: "text-muted-foreground", Icon: CircleSlash },
  unavailable: { label: "Source unavailable", cls: "text-warning", Icon: AlertTriangle },
  no_source: { label: "No official source", cls: "text-destructive", Icon: AlertTriangle },
};

/** The report for one record type, shown once its check has finished. */
export function SectionCard({ r }: { r: SectionResult }) {
  const meta = SECTIONS.find((s) => s.key === r.key);
  if (!meta || r.status === "pending") return null;
  const Icon = ICONS[r.key];
  const st = STATUS[r.status];
  return (
    <section id={`section-${r.key}`} className="section-card surface scroll-mt-28">
      <header className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
        <h2 className="flex items-center gap-3 text-xl font-medium">
          <span className="section-icon size-10"><Icon size={19} /></span>
          {meta.label}
        </h2>
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${st.cls}`}>
          <st.Icon size={15} aria-hidden="true" /> {st.label}
        </span>
      </header>

      {r.reason && <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">{r.reason}</p>}

      {r.items.length > 0 && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-2 font-medium">ID</th>
                <th className="px-4 py-2 font-medium">Record</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-5 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((it, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="tabular px-5 py-3 font-mono text-xs">{it.record_id || <span className="text-muted-foreground">None</span>}</td>
                  <td className="max-w-[46ch] px-4 py-3">
                    <p className="font-semibold">{it.title}</p>
                    {it.details && it.details !== it.title && <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{it.details}</p>}
                  </td>
                  <td className="tabular whitespace-nowrap px-4 py-3 font-mono text-xs">{it.date || <span className="text-muted-foreground">Not shown</span>}</td>
                  <td className="px-5 py-3">
                    <a href={it.source_url} target="_blank" rel="noreferrer" className="break-all text-xs font-medium text-primary underline underline-offset-2">
                      {hostOf(it.source_url)}
                    </a>
                    <p className="tabular mt-0.5 text-[11px] text-muted-foreground">Read {new Date(it.retrieved_at).toLocaleString()}</p>
                    {it.verified !== undefined && (
                      <p
                        className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium ${it.verified ? "text-success" : "text-warning"}`}
                        title="TinyFish Fetch re-read the source page and looked for this record's id or figure"
                      >
                        {it.verified ? <CheckCircle2 size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
                        {it.verified ? "Matched on page" : "Not matched on page, check the source"}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(r.sources.length > 0 || (r.steps?.length ?? 0) > 0) && (
        <details className="border-t border-border px-5 py-3 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">How this was checked</summary>
          {r.steps && r.steps.length > 0 && (
            <div className="mt-3">
              <p className="font-medium">Agent's last steps{r.stepCount ? ` (of ${r.stepCount})` : ""}</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
                {r.steps.map((s) => <li key={s.id}>{s.action}</li>)}
              </ol>
            </div>
          )}
          <ul className="mt-3 space-y-1">
            {r.sources.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className={`w-12 shrink-0 font-medium capitalize ${s.ok ? "text-success" : "text-destructive"}`}>{s.method}</span>
                <span className="min-w-0">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2">{s.title || s.url}</a>
                  ) : (
                    s.title
                  )}
                  {s.note && <span className="text-muted-foreground">: {s.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
