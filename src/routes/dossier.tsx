import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Search, MapPin, RefreshCw, Download, Printer, Radar, Sparkles, KeyRound, ArrowLeft, ChevronDown, FileJson, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SectionCard } from "@/components/SectionCard";
import { BriefSection, type BriefJob } from "@/components/BriefSection";
import { RunBoard } from "@/components/RunBoard";
import { LiveDock, type LiveStream } from "@/components/LiveDock";
import { SECTIONS, hostOf, parseBrief, type Dossier, type SectionKey, type SectionResult } from "@/lib/dossier-core";
import { jobState, runningElsewhere, startJob, stopJob, subscribe, type JobState } from "@/lib/dossier-runner";
import { JURISDICTIONS, jurisdictionById } from "@/lib/sources";
import { aiSummarize, tfMonitorCreate } from "@/lib/tinyfish.functions";
import { PROVIDER_LABELS, effectiveModel, loadDossier, loadSettings, loadWatches, saveDossier, saveWatches, type Settings, type Watch } from "@/lib/storage";

export const Route = createFileRoute("/dossier")({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s['q'] === "string" ? s['q'] : "",
    area: typeof s['area'] === "string" && s['area'] ? s['area'] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Property dossier | SiteSpy" },
      { name: "description", content: "Sourced permits, zoning, tax history, flood zone, violations and nearby schools for this address." },
      { property: "og:title", content: "Property dossier | SiteSpy" },
      { property: "og:description", content: "Official records for this address, each linked to its source." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DossierPage,
});

function DossierPage() {
  const { q, area } = Route.useSearch();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [saved, setSaved] = useState<Dossier | null>(null);
  const [elsewhere, setElsewhere] = useState(false);
  const [briefJob, setBriefJob] = useState<BriefJob | null>(null);
  const briefToken = useRef(0);
  const summarizing = briefJob?.status === "writing";
  const [watching, setWatching] = useState(false);
  const [dockKey, setDockKey] = useState<SectionKey | null>(null);
  const unsubRef = useRef<() => void>(() => {});
  const cacheKey = area ? `${area}:${q}` : q;
  const running = Boolean(job?.running);
  const d = running ? job!.dossier : (saved ?? job?.dossier ?? null);
  const phase = job?.phase ?? "";
  const unsupported = job?.unsupported ?? null;
  const jurisdiction = d?.jurisdiction ? jurisdictionById(d.jurisdiction) : null;

  // Leaving the page only unsubscribes: the run keeps going and is shown again on return.
  const attach = useCallback(() => {
    unsubRef.current();
    unsubRef.current = subscribe(cacheKey, (s) => {
      setJob(s);
      if (!s.running && s.dossier) setSaved(s.dossier);
    });
  }, [cacheKey]);

  const begin = useCallback(
    (s: Settings, from: Dossier | null) => {
      if (startJob(cacheKey, q, area, s.tinyfishKey, from)) attach();
    },
    [cacheKey, q, area, attach],
  );

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setJob(null);
    setSaved(null);
    setElsewhere(false);
    if (!q) return;
    if (jobState(cacheKey)) {
      attach(); // came back to a run that is still going in this tab
      return () => unsubRef.current();
    }
    const cached = loadDossier(cacheKey);
    if (cached && !cached.running) {
      setSaved(cached);
      return;
    }
    if (cached?.running && runningElsewhere(cacheKey)) {
      // Another tab owns this run: mirror its saved progress, and take over if that tab goes away.
      setSaved(cached);
      setElsewhere(true);
      const t = setInterval(() => {
        const c = loadDossier(cacheKey);
        setSaved(c);
        if (!c?.running) {
          setElsewhere(false);
          clearInterval(t);
        } else if (!runningElsewhere(cacheKey)) {
          setElsewhere(false);
          clearInterval(t);
          begin(s, c);
        }
      }, 4000);
      return () => {
        clearInterval(t);
        unsubRef.current();
      };
    }
    // New search, or a saved run interrupted by a refresh: resume re-attaches to its agent runs.
    begin(s, cached);
    return () => unsubRef.current();
  }, [q, cacheKey, attach, begin]);

  const stop = () => void stopJob(cacheKey);
  const rerun = () => {
    if (!settings) return;
    setSaved(null);
    begin(settings, null);
  };

  const summarize = async () => {
    if (!settings || !d || settings.provider === "none") return;
    const token = ++briefToken.current;
    const model = effectiveModel(settings);
    setBriefJob({ status: "writing", provider: PROVIDER_LABELS[settings.provider], model, startedAt: Date.now() });
    // Bring the brief into view so the writing state is seen, not just a grey button.
    requestAnimationFrame(() => document.getElementById("brief-title")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    try {
      const compact = { address: d.place?.display ?? d.query, sections: Object.values(d.sections).map((s) => ({ section: s.key, status: s.status, reason: s.reason, items: s.items })) };
      const r = await aiSummarize({ data: { provider: settings.provider, key: settings.aiKey, model, records: JSON.stringify(compact).slice(0, 59000) } });
      if (token !== briefToken.current) return; // cancelled or superseded
      const brief = parseBrief(r.text, d.sections);
      // A reply that isn't the requested JSON is kept as free text rather than lost.
      const next = brief ? { ...d, brief, summary: undefined } : { ...d, brief: undefined, summary: r.text };
      setSaved(next);
      saveDossier(next);
      setBriefJob(null);
    } catch (e) {
      if (token !== briefToken.current) return;
      setBriefJob((j) => (j ? { ...j, status: "error", error: (e as Error).message } : j));
    }
  };
  const cancelBrief = () => {
    briefToken.current++;
    setBriefJob(null);
  };

  // Print after the Export menu has closed, so the menu isn't captured in the PDF.
  const printReport = () => setTimeout(() => window.print(), 200);

  const exportJson = () => {
    if (!d) return;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sitespy-${(d.place?.display ?? d.query).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    a.click();
  };

  const watch = async () => {
    if (!d || !settings?.tinyfishKey) return;
    setWatching(true);
    try {
      const targets: { section: SectionKey; url: string }[] = [];
      for (const k of ["permits", "violations", "zoning", "tax"] as SectionKey[]) {
        // Prefer the page the records were read from; fall back to the portal the agent searched.
        const url = d.sections[k].items[0]?.source_url ?? d.sections[k].sources.find((s) => s.method === "agent" && s.ok && s.url)?.url;
        if (url) targets.push({ section: k, url });
      }
      const monitors: Watch["monitors"] = [];
      for (const t of targets) {
        try {
          const m = await tfMonitorCreate({ data: { key: settings.tinyfishKey, url: t.url, name: `SiteSpy ${t.section}: ${d.query}`, purpose: `New or changed ${t.section} records for ${d.place?.display ?? d.query}` } });
          if (m.id) monitors.push({ ...t, monitorId: m.id, lastText: m.text });
        } catch (e) {
          toast.error(`Monitor for ${t.section}: ${(e as Error).message}`);
        }
      }
      const all = loadWatches().filter((w) => w.query.toLowerCase() !== d.query.toLowerCase());
      all.push({
        id: crypto.randomUUID(),
        query: d.query,
        display: d.place?.display ?? d.query,
        place: d.place ?? undefined,
        jurisdiction: d.jurisdiction,
        createdAt: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
        monitors,
        snapshot: Object.fromEntries(Object.values(d.sections).map((s) => [s.key, s.items])),
        changes: [],
        pageChanges: [],
      });
      saveWatches(all);
      toast.success(`Watching this address with ${monitors.length} TinyFish monitor(s)`);
    } finally {
      setWatching(false);
    }
  };

  if (!q) return <main className="workspace"><header className="page-heading"><span className="stamp text-emerald">Property records</span><h1 className="mt-3">Property dossier</h1></header><div className="empty-state"><span className="section-icon"><MapPin size={30} /></span><h2 className="text-2xl font-medium">Start with an address</h2><p className="mt-3 text-sm text-muted-foreground">Your property records will appear here.</p><Button asChild className="mt-6"><Link to="/"><Search /> Find a property</Link></Button></div></main>;

  if (unsupported)
    return (
      <main className="workspace">
        <Button asChild variant="link" className="mb-5 h-auto px-0"><Link to="/"><ArrowLeft /> New search</Link></Button>
        <div className="empty-state">
          <span className="section-icon"><MapPin size={30} /></span>
          <h2 className="text-2xl font-medium">{unsupported.found ? "This area isn't supported yet" : "We couldn't locate that address"}</h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            {unsupported.found ? `${q} resolves to ${unsupported.where}. ` : `${q} didn't match a known address. `}
            SiteSpy only covers places whose official record portals we have mapped step by step, so results can be trusted. No TinyFish credits were used.
          </p>
          <p className="mt-4 text-sm font-medium">Supported: {JURISDICTIONS.map((j) => `${j.name} (${j.region})`).join(" · ")}</p>
          <Button asChild className="mt-6"><Link to="/"><Search /> Try another address</Link></Button>
        </div>
      </main>
    );

  const sections = d ? SECTIONS.map((s) => d.sections[s.key]) : [];
  const recordHosts = new Set(sections.flatMap((s) => s.items.map((i) => hostOf(i.source_url))));
  const finished = sections.filter((s) => s.status !== "pending");
  const busy = running || elsewhere;
  const streams: LiveStream[] = sections
    .filter((s) => s.status === "pending" && s.agentState === "running" && s.streamingUrl)
    .map((s) => ({ key: s.key, label: SECTIONS.find((x) => x.key === s.key)!.label, site: s.site ?? "", url: s.streamingUrl!, step: s.steps?.at(-1) }));
  const jump = (k: SectionKey) => document.getElementById(`section-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    // While the live dock is open, extra room at the bottom lets every row scroll clear of it.
    <main className="workspace" style={dockKey ? { paddingBottom: 440 } : undefined}>
      <Button asChild variant="link" className="no-print mb-5 h-auto px-0"><Link to="/"><ArrowLeft /> New search</Link></Button>
      <div className="page-heading">
        <h1 className="max-w-4xl">{d?.place?.display ?? q}</h1>
        {d?.place && (
          <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Jurisdiction</dt><dd className="font-medium">{jurisdiction ? `${jurisdiction.name}, ${jurisdiction.region}` : d.place.city || "Unknown"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{d.place.parcel ? "Parcel" : "ZIP"}</dt><dd className="tabular font-medium">{d.place.parcel ?? (d.place.postcode || "Unknown")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Location</dt><dd className="tabular font-medium"><a className="underline underline-offset-2" href={d.place.osmUrl} target="_blank" rel="noreferrer">{d.place.lat.toFixed(5)}, {d.place.lon.toFixed(5)}</a></dd></div>
            {!busy && <div><dt className="text-xs text-muted-foreground">Records from</dt><dd className="font-medium">{recordHosts.size} official source{recordHosts.size === 1 ? "" : "s"}</dd></div>}
            {!busy && <div><dt className="text-xs text-muted-foreground">Generated</dt><dd className="tabular font-medium">{new Date(d.generated_at).toLocaleString()}</dd></div>}
          </dl>
        )}
        <div className="no-print mt-6 flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="destructive" className="press" onClick={stop} disabled={job?.stopping}><Square />{job?.stopping ? "Stopping…" : "Stop and cancel agents"}</Button>
          ) : (
            <Button className="press" onClick={rerun} disabled={elsewhere || !settings?.tinyfishKey}><RefreshCw />Re-run live</Button>
          )}
          {/* Non-modal: the default scroll lock rewrites body padding and makes the page jump. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="press" disabled={!d || busy}><Download /> Export <ChevronDown /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={exportJson}><FileJson /> JSON (structured, with source links)</DropdownMenuItem>
              <DropdownMenuItem onSelect={printReport}><Printer /> PDF (print this report)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" className="press" onClick={watch} disabled={!d || busy || watching}><Radar />{watching ? "Creating monitors…" : "Watch for new permits & changes"}</Button>
          {settings && settings.provider !== "none" && (
            <Button variant="secondary" className="press" onClick={summarize} disabled={!d || busy || summarizing}>
              {summarizing ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {summarizing ? "Writing brief…" : d?.brief || d?.summary ? "Rewrite AI brief" : "Write AI brief"}
            </Button>
          )}
        </div>
        {busy && (
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
            {elsewhere
              ? "This dossier is being built in another tab. Its progress shows here and refreshes every few seconds."
              : "Checks usually take 5 to 15 minutes. You can leave or refresh this page; the agents keep working and their progress is shown here again."}
          </p>
        )}
        {!running && phase.startsWith("Error") && <p className="mt-4 text-sm font-medium text-destructive">{phase}</p>}
        {settings && !settings.tinyfishKey && (
          <p className="no-print mt-6 flex items-center gap-2 rounded-md bg-accent p-4 text-sm"><KeyRound className="shrink-0 text-primary" size={18} /> Add your TinyFish key in <Link to="/settings" className="font-semibold underline">Settings</Link> to run a live lookup.</p>
        )}
      </div>

      {running && !d && <p className="text-sm text-muted-foreground">{phase || "Locating the address…"}</p>}

      {d && (
        <RunBoard
          sections={sections}
          running={busy}
          watching={dockKey && streams.some((s) => s.key === dockKey) ? dockKey : null}
          onWatch={(k) => setDockKey(k)}
          onJump={jump}
        />
      )}

      {d && (briefJob || d.brief || d.summary) && (
        <BriefSection brief={d.brief} legacy={d.summary} sections={d.sections} job={briefJob} onRetry={summarize} onCancel={cancelBrief} />
      )}

      {finished.length > 0 && (
        <div className="mt-10">
          <h2 className="text-2xl font-medium">Report</h2>
          <p className="print-keep-next mt-1 text-sm text-muted-foreground">Every record links to the official page it was read from.</p>
          <div className="report-list mt-5 grid gap-6">
            {finished.map((s) => <SectionCard key={s.key} r={s} />)}
          </div>
        </div>
      )}

      {dockKey && <LiveDock streams={streams} active={dockKey} onSelect={setDockKey} onClose={() => setDockKey(null)} />}
    </main>
  );
}
