import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, MapPin, FileCheck2, Layers3, ReceiptText, Waves, TriangleAlert, GraduationCap, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SECTIONS } from "@/lib/dossier-core";
import { JURISDICTIONS } from "@/lib/sources";
import neighborhood from "@/assets/neighborhood.jpg";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "SiteSpy | Official property records, one clear dossier" },
    { name: "description", content: "Search any address in Seattle, San Francisco or New York City for a sourced property dossier of permits, zoning, tax history, flood zone, violations and schools." },
    { property: "og:title", content: "SiteSpy | Official property records, one clear dossier" },
    { property: "og:description", content: "Know the property beyond the listing. Search official sources with SiteSpy." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

const icons = [FileCheck2, Layers3, ReceiptText, Waves, TriangleAlert, GraduationCap];
const descriptions = ["Building approvals & permit history", "Land use & planning restrictions", "Assessments & historical tax records", "Official flood maps & risk records", "Reported code & property violations", "Nearby schools & official registers"];

function Index() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [area, setArea] = useState<string>(JURISDICTIONS[0]!.id);
  const parcelCity = JURISDICTIONS.find((j) => j.id === area) ?? JURISDICTIONS[0]!;
  const [mode, setMode] = useState<"address" | "parcel">("address");
  const go = (query: string, hint = "") => {
    if (!query.trim()) return;
    void navigate({ to: "/dossier", search: { q: query.trim(), area: hint.trim() || undefined } });
  };
  return (
    <main>
      <section className="landing-hero relative isolate overflow-hidden">
        <img src={neighborhood} alt="Contemporary homes on a leafy residential street" width={1600} height={1008} fetchPriority="high" className="hero-photo absolute inset-0 -z-20 h-full w-full object-cover" />
        <div className="hero-wash absolute inset-0 -z-10" />
        <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
          <div className="hero-enter max-w-3xl">
            <h1 className="max-w-2xl text-5xl font-bold leading-[1.05] md:text-6xl">Know the property.<br /><span className="text-emerald">Before you sign.</span></h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">Look beyond the listing with live official records on permits, zoning, taxes and more.</p>
          </div>
          <form className="hero-enter mt-8 max-w-xl" onSubmit={(event) => { event.preventDefault(); go(q, mode === "parcel" ? area : ""); }}>
            <div className="mb-3 flex gap-1" role="group" aria-label="Search type">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("address")} aria-pressed={mode === "address"} className={mode === "address" ? "bg-accent text-primary" : "text-muted-foreground"}><MapPin /> Address</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("parcel")} aria-pressed={mode === "parcel"} className={mode === "parcel" ? "bg-accent text-primary" : "text-muted-foreground"}><Layers3 /> Parcel number</Button>
            </div>
            <label htmlFor="q" className="sr-only">{mode === "address" ? "Property address" : "Parcel number"}</label>
            <div className="search-shell flex flex-col gap-2 rounded-lg border border-border bg-card p-2 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2 pl-2"><Search className="size-5 shrink-0 text-primary" /><Input id="q" required value={q} onChange={(event) => setQ(event.target.value)} placeholder={mode === "address" ? "Street address in Seattle, San Francisco or New York City" : `${parcelCity.parcelLabel}, e.g. ${parcelCity.parcelExample}`} className="h-12 min-w-0 border-0 bg-transparent text-base shadow-none focus-visible:ring-0 focus:placeholder:text-transparent" /></div>
              <Button type="submit" className="h-12 shrink-0 px-5">Build dossier <ArrowRight /></Button>
            </div>
            {mode === "parcel" && (
              <div className="mt-3">
                <label htmlFor="area" className="text-sm font-medium">City</label>
                <select id="area" value={area} onChange={(event) => setArea(event.target.value)} className="mt-1 block h-11 w-full rounded-md border border-border bg-card px-3 text-sm">
                  {JURISDICTIONS.map((j) => <option key={j.id} value={j.id}>{j.name} ({j.parcelLabel})</option>)}
                </select>
              </div>
            )}
            <p className="mt-3 text-sm text-muted-foreground">Supported: {JURISDICTIONS.map((j) => `${j.name} (${j.region})`).join(" · ")}</p>
          </form>
        </div>
      </section>
      <section className="border-t border-border bg-background">
        <div className="mx-auto max-w-6xl px-5 py-10 md:px-8 md:py-12">
          <div className="mb-10 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border pb-6"><span className="text-sm text-muted-foreground">Explore an address</span>{JURISDICTIONS.map((j) => <Button key={j.id} type="button" variant="link" size="sm" className="px-0" onClick={() => go(j.demo)}>{j.name}<ArrowUpRight /></Button>)}</div>
          <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="stamp text-emerald">Beyond the listing</p><h2 className="mt-2 text-3xl">One property. Six perspectives.</h2></div><Button asChild variant="link" className="px-0 normal-case"><Link to="/about">Our source policy <ArrowUpRight /></Link></Button></div>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{SECTIONS.map((section, index) => { const Icon = icons[index] ?? FileCheck2; return <li key={section.key} className="record-item flex items-start gap-4 border-t border-border pt-5"><span className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${index % 2 === 0 ? "bg-emerald-soft text-emerald" : "bg-accent text-primary"}`}><Icon size={22} /></span><div><h3 className="font-medium">{section.label}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{descriptions[index]}</p></div></li>; })}</ul>
        </div>
      </section>
      <footer className="border-t border-border bg-card"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-muted-foreground md:px-8"><span className="font-medium text-foreground">SiteSpy · Due diligence, before you sign.</span><span>Powered by TinyFish · Your keys. Your browser.</span></div></footer>
    </main>
  );
}
