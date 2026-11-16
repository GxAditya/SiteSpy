import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Radar, Search, RefreshCw, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SECTIONS, diffRecords, hostOf, pageChange, type SectionKey } from "@/lib/dossier-core";
import { locate, runSection } from "@/lib/run-dossier";
import { jurisdictionById } from "@/lib/sources";
import { tfMonitorDelete, tfMonitorRun } from "@/lib/tinyfish.functions";
import { loadSettings, loadWatches, saveWatches, type Watch } from "@/lib/storage";

export const Route = createFileRoute("/monitor")({
  head: () => ({
    meta: [
      { title: "Monitor | SiteSpy" },
      { name: "description", content: "Watch properties for new permits, violations and zoning changes on official sites." },
      { property: "og:title", content: "Monitor | SiteSpy" },
      { property: "og:description", content: "Change alerts for watched properties, powered by TinyFish Monitor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MonitorPage,
});

const RECHECK: SectionKey[] = ["permits", "violations"];
const label = (k: SectionKey) => SECTIONS.find((s) => s.key === k)?.label ?? k;

function MonitorPage() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setWatches(loadWatches()), []);

  const persist = (w: Watch[]) => { setWatches(w); saveWatches(w); };

  const recheck = async (w: Watch) => {
    const key = loadSettings().tinyfishKey;
    if (!key) { toast.error("Add your TinyFish key in Settings"); return; }
    setBusy(w.id);
    const now = new Date().toISOString();
    const next: Watch = { ...w, changes: [...w.changes], pageChanges: [...w.pageChanges], snapshot: { ...w.snapshot }, monitors: w.monitors.map((m) => ({ ...m })) };
    try {
      for (const m of next.monitors) {
        try {
          const r = await tfMonitorRun({ data: { key, id: m.monitorId } });
          if (r.error && !r.text) throw new Error(r.error);
          const local = pageChange(m.lastText, r.text);
          next.pageChanges.unshift({ at: now, url: m.url, outcome: r.outcome || local.outcome, diff: r.diff || local.diff });
          m.lastText = r.text;
        } catch (e) {
          next.pageChanges.unshift({ at: now, url: m.url, outcome: "error", diff: (e as Error).message });
        }
      }
      // Re-read permits and violations with the agent and diff them against the saved snapshot.
      const located = w.place && w.jurisdiction ? { place: w.place, jurisdiction: jurisdictionById(w.jurisdiction) } : await locate(w.query);
      const { place, jurisdiction: j } = located;
      if (place && j) {
        for (const k of RECHECK) {
          const res = await runSection(key, place, j, k, () => {});
          if (res.status === "found" || res.status === "not_found") {
            const ch = diffRecords(k, w.snapshot[k] ?? [], res.items);
            next.changes.unshift(...ch.map((c) => ({ ...c, at: now })));
            next.snapshot[k] = res.items;
          }
        }
      }
      next.lastChecked = now;
      persist(watches.map((x) => (x.id === w.id ? next : x)));
      toast.success("Re-check complete");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (w: Watch) => {
    const key = loadSettings().tinyfishKey;
    for (const m of w.monitors) if (key) await tfMonitorDelete({ data: { key, id: m.monitorId } }).catch(() => {});
    persist(watches.filter((x) => x.id !== w.id));
  };

  return (
    <main className="workspace">
      <header className="page-heading flex flex-wrap items-end justify-between gap-5">
        <div><span className="stamp text-emerald">Stay informed</span><h1 className="mt-3">Property monitor</h1><p className="mt-3 text-muted-foreground">Changes at the source, kept in view.</p></div>
        <span className="rounded-full bg-emerald-soft px-4 py-2 text-sm font-medium text-emerald">{watches.length} watched {watches.length === 1 ? "property" : "properties"}</span>
      </header>
      {watches.length === 0 && (
        <div className="empty-state">
          <span className="section-icon"><Radar size={30} /></span>
          <h2 className="text-2xl font-medium">No properties on your watchlist</h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">New permits and property changes will appear here once you watch an address.</p>
          <Button asChild className="mt-6"><Link to="/"><Search /> Find a property</Link></Button>
        </div>
      )}

      <div className="mt-8 space-y-6">
        {watches.map((w) => (
          <section key={w.id} className="surface border border-border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-6">
              <div>
                <Link to="/dossier" search={{ q: w.query, area: undefined }} className="font-display text-xl font-semibold underline-offset-4 hover:underline">{w.display}</Link>
                <p className="stamp mt-1 text-muted-foreground">
                  {w.monitors.length} monitors · last checked {new Date(w.lastChecked).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => recheck(w)} disabled={busy !== null}><RefreshCw className={busy === w.id ? "animate-spin" : ""} />{busy === w.id ? "Checking…" : "Re-check now"}</Button>
                <Button variant="outline" onClick={() => remove(w)} disabled={busy !== null}><BellOff /> Stop watching</Button>
              </div>
            </header>
            <div className="grid gap-px bg-border md:grid-cols-2">
              <div className="min-w-0 bg-card p-6">
                <p className="stamp text-primary">Record changes</p>
                {w.changes.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No record changes detected yet.</p> : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {w.changes.slice(0, 30).map((c, i) => (
                      <li key={i}>
                        <span className={`stamp mr-2 ${c.kind === "added" ? "text-success" : c.kind === "removed" ? "text-destructive" : "text-warning"}`}>{c.kind}</span>
                        {label(c.section)}: <a className="underline" href={c.record.source_url} target="_blank" rel="noreferrer">{c.record.record_id || c.record.title}</a>
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground">{new Date(c.at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="min-w-0 bg-card p-6">
                <p className="stamp text-primary">Source page checks (TinyFish Monitor)</p>
                {w.monitors.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No pages could be monitored for this address.</p>}
                <ul className="mt-2 space-y-2 text-sm">
                  {w.pageChanges.slice(0, 12).map((p, i) => (
                    <li key={i}>
                      <span className="stamp mr-2">{p.outcome}</span>
                      <a className="font-mono text-xs underline" href={p.url} target="_blank" rel="noreferrer">{hostOf(p.url)}</a>
                      {p.diff && <pre className="mt-1 max-h-32 overflow-auto bg-muted p-2 text-[10px]">{p.diff}</pre>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
