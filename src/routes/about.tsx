import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash } from "lucide-react";
import { SECTIONS, hostOf, type Place } from "@/lib/dossier-core";
import { JURISDICTIONS, type Jurisdiction, type SourceSpec } from "@/lib/sources";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "How SiteSpy works: TinyFish Agent, Fetch and Monitor" },
      { name: "description", content: "How SiteSpy uses TinyFish to pull property records live from official sites with no API, which sites it uses, and how missing data is flagged." },
      { property: "og:title", content: "How SiteSpy works" },
      { property: "og:description", content: "The official sources and the TinyFish Agent, Fetch and Monitor behind every property dossier." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: About,
});

const STEPS: [string, string][] = [
  ["Locate the property", "The address, or a parcel number and its city, is located with OpenStreetMap. Only Seattle, San Francisco and New York City are supported, because every record type there has an official online portal we have mapped. Anything else is turned away before a TinyFish credit is spent."],
  ["Send an agent to each official portal", "For each record type, a TinyFish Agent opens the official site in a real browser and follows step-by-step instructions written from that site's own help pages. It types the address or parcel into the site's search form, picks the matching property, opens the right tab, filters and pages through the list, and returns each record with the exact page it came from."],
  ["Fall back only when a site is blocked", "If a portal blocks the agent or fails, the next official source for that record type is tried. A source holding different records, like NYC HPD next to the Department of Buildings, is also checked when the first one has nothing."],
  ["Cross-check with TinyFish Fetch", "Fetch re-reads each record's source page without a browser and looks for the record's official id or main figure on it. Records it finds are marked \"Matched on page\". Pages that only work in a browser stay unmarked rather than being guessed at."],
  ["Keep watching with TinyFish Monitor", "\"Watch for new permits & changes\" puts daily TinyFish Monitors on the pages the records came from. A re-check shows what changed on those pages and sends the agent back to the permit and violation portals to list each record that was added, changed or removed."],
];

const STATUSES = [
  { Icon: CheckCircle2, cls: "text-success", label: "Records found", body: "The agent read records from the official site. Each one links to its page." },
  { Icon: CircleSlash, cls: "text-muted-foreground", label: "No records at source", body: "The site was searched for this property and had nothing of this kind." },
  { Icon: AlertTriangle, cls: "text-warning", label: "Source unavailable", body: "The site blocked the agent, showed an error or timed out. Check it yourself before relying on the gap." },
];

const AUTHORITY: Record<SourceSpec["authority"], string> = { city: "City", county: "County", state: "State", national: "Federal" };

// A representative address per city, only to print each source's real host in the table.
const SAMPLE: Record<Jurisdiction["id"], Place> = Object.fromEntries(
  JURISDICTIONS.map((j) => [
    j.id,
    { query: j.demo, display: j.demo, lat: 0, lon: 0, countryCode: "US", country: "United States", state: "", stateCode: "", county: "", city: j.name, postcode: "", houseNumber: "1", road: "Main Street", osmUrl: "" },
  ]),
) as Record<Jurisdiction["id"], Place>;

function SourceList({ j, specs }: { j: Jurisdiction; specs: SourceSpec[] }) {
  return (
    <ul className="space-y-3">
      {specs.map((s, i) => (
        <li key={s.title}>
          {i > 0 && <span className="mb-0.5 block text-xs font-medium text-muted-foreground">{s.complements ? "Also checked" : "Backup"}</span>}
          <span className="block font-medium leading-snug">{s.title.replace(/ \(.*\)$/, "")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {AUTHORITY[s.authority]}: {hostOf(s.url(SAMPLE[j.id]))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function About() {
  const [city, setCity] = useState<Jurisdiction["id"]>(JURISDICTIONS[0]!.id);
  const cityJ = JURISDICTIONS.find((j) => j.id === city)!;
  return (
    <main className="workspace">
      <header className="page-heading">
        <h1>How SiteSpy builds a dossier</h1>
        <p>Every record comes live from an official government website, is linked to the page it was read from, and is flagged plainly when it can't be found.</p>
      </header>

      <section aria-labelledby="how">
        <h2 id="how" className="text-2xl font-medium">How it works</h2>
        <ol className="mt-2 max-w-3xl">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="method-step">
              <span className="section-icon tabular font-mono text-base">{i + 1}</span>
              <div>
                <h3 className="text-xl font-medium">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="sources" className="mt-16">
        <h2 id="sources" className="text-2xl font-medium">Where the records come from</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          The official sites the agent uses for each record type, in the order it tries them. These are the same lists the app runs on.
        </p>
        {/* Small screens: one city at a time. */}
        <div className="mt-6 md:hidden">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="City">
            {JURISDICTIONS.map((j) => (
              <button
                key={j.id}
                role="tab"
                aria-selected={city === j.id}
                onClick={() => setCity(j.id)}
                className={`press shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${city === j.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {j.name}
              </button>
            ))}
          </div>
          <dl className="surface mt-4">
            {SECTIONS.map((s) => (
              <div key={s.key} className="border-t border-border px-5 py-4 first:border-t-0">
                <dt className="text-xs font-medium text-muted-foreground">{s.label}</dt>
                <dd className="mt-2 text-sm">
                  <SourceList j={cityJ} specs={cityJ.sources[s.key]} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="surface mt-6 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-muted text-xs text-muted-foreground">
                <th scope="col" className="sticky left-0 z-10 w-44 bg-muted px-5 py-3 font-medium">Record type</th>
                {JURISDICTIONS.map((j) => (
                  <th key={j.id} scope="col" className="px-5 py-3 font-medium">
                    <span className="block font-display text-base font-medium text-foreground">{j.name}</span>
                    <span className="block">{j.region}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((s) => (
                <tr key={s.key} className="border-t border-border align-top">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-5 py-4 font-semibold">{s.label}</th>
                  {JURISDICTIONS.map((j) => (
                    <td key={j.id} className="px-5 py-4">
                      <SourceList j={j} specs={j.sources[s.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="policy" className="mt-16 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 id="policy" className="text-2xl font-medium">Source policy</h2>
          <ul className="mt-4 max-w-xl list-disc space-y-3 pl-5 text-[15px] leading-relaxed text-muted-foreground marker:text-primary">
            <li>Only official government sites and the agencies' own portals are used. No listing sites, aggregators or data brokers.</li>
            <li>Values are copied exactly as the site shows them. The agent is told never to guess or fill in anything that isn't displayed.</li>
            <li>Every record carries the URL of the page it was read from and the time it was read.</li>
            <li>AI never adds records. The optional brief may only summarise records already found, and cites them.</li>
            <li>A gap is reported as a gap, with the reason, so you know what still needs checking by hand.</li>
          </ul>
        </div>
        <div>
          <h2 className="text-2xl font-medium">What each result means</h2>
          <dl className="mt-4 space-y-4">
            {STATUSES.map(({ Icon, cls, label, body }) => (
              <div key={label} className="flex gap-3">
                <Icon size={18} className={`mt-0.5 shrink-0 ${cls}`} aria-hidden="true" />
                <div>
                  <dt className="font-semibold">{label}</dt>
                  <dd className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">{body}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="dossier" className="mt-16 border-t border-border pt-10">
        <h2 id="dossier" className="text-2xl font-medium">Your dossier</h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          The readable report is the main output. Export it as JSON, with each section's status and reason, every record's source URL, read time and cross-check, and every site checked, or as a PDF. The optional AI brief uses your own OpenAI, Gemini, Grok, Groq or OpenRouter key.
        </p>
      </section>
    </main>
  );
}
