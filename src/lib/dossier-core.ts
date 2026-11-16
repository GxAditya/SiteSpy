// Pure, browser-safe dossier types and rules (no I/O). Covered by src/test/dossier-core.test.ts.

export type SectionKey = "permits" | "zoning" | "tax" | "flood" | "violations" | "schools";

export type SectionStatus = "found" | "not_found" | "unavailable" | "no_source" | "pending";

export interface DossierRecord {
  record_id: string;
  title: string;
  date: string;
  details: string;
  source_url: string;
  retrieved_at: string;
  /** TinyFish Fetch re-read source_url and found this record's id/value there (undefined = not checkable). */
  verified?: boolean | undefined;
}

export interface AgentStep {
  id: string;
  action: string;
  at: string;
}

export interface SourceCheck {
  url: string;
  title: string;
  method: "agent" | "fetch" | "search";
  ok: boolean;
  note: string;
}

export interface SectionResult {
  key: SectionKey;
  status: SectionStatus;
  reason: string;
  items: DossierRecord[];
  sources: SourceCheck[];
  runId?: string | undefined;
  streamingUrl?: string | undefined;
  /** What the agent for this section is doing right now, and on which portal. */
  agentState?: "starting" | "queued" | "running" | undefined;
  site?: string | undefined;
  /** Latest steps the agent reported (newest last) and how many it has taken. */
  steps?: AgentStep[] | undefined;
  stepCount?: number | undefined;
  // Saved progress so a refreshed page resumes polling the same agent run instead of starting a new one.
  specIndex?: number | undefined;
  notFoundSoFar?: boolean | undefined;
  reachedSoFar?: number | undefined;
}

export interface Place {
  query: string;
  display: string;
  lat: number;
  lon: number;
  countryCode: string; // ISO alpha-2 upper
  country: string;
  state: string;
  stateCode: string; // e.g. "WA"
  county: string;
  city: string;
  postcode: string;
  houseNumber: string;
  road: string;
  osmUrl: string;
  parcel?: string; // parcel / APN typed by the user; the agent must look this up, not the geocoded point
}

// TinyFish output_schema accepts only an allowlist of keywords (no "description"), so field
// guidance lives in the goal text instead. Covered by a keyword-allowlist test.
export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["found", "not_found", "blocked"] },
    reason: { type: "string" },
    items: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        properties: {
          record_id: { type: "string" },
          title: { type: "string" },
          date: { type: "string" },
          details: { type: "string" },
          source_url: { type: "string" },
        },
        required: ["title", "details", "source_url"],
      },
    },
  },
  required: ["status", "items"],
};

export const SCHEMA_KEYWORDS = new Set([
  "anyOf", "enum", "format", "items", "maxItems", "maximum", "minItems", "minimum",
  "nullable", "properties", "propertyOrdering", "required", "type",
]);

export interface Dossier {
  query: string;
  generated_at: string;
  place: Place | null;
  jurisdiction?: string | undefined;
  /** True while agents are still working; a saved running dossier is resumed, not restarted. */
  running?: boolean | undefined;
  sections: Record<SectionKey, SectionResult>;
  /** Legacy free-text brief (older saved dossiers). New briefs are structured in `brief`. */
  summary?: string | undefined;
  brief?: Brief | undefined;
}

export const SECTIONS: { key: SectionKey; label: string; goal: string }[] = [
  {
    key: "permits",
    label: "Building permits",
    goal: "building permits, planning applications or development approvals (permit number, type, status, issue/decision date, description)",
  },
  {
    key: "zoning",
    label: "Zoning & land use",
    goal: "the zoning district / land-use designation and any overlays (zone code, zone name, overlays, height or density limits)",
  },
  {
    key: "tax",
    label: "Tax & assessment history",
    goal: "property tax / assessment / valuation records by year (parcel or account number, year, assessed value, tax amount)",
  },
  {
    key: "flood",
    label: "Flood zone",
    goal: "the official FEMA flood zone (flood zone code, FIRM map panel number, effective date)",
  },
  {
    key: "violations",
    label: "Code violations & complaints",
    goal: "code enforcement cases, building violations, notices or complaints (case number, type, status, opened date)",
  },
  {
    key: "schools",
    label: "Nearby schools",
    goal: "the public schools nearest to this address (school name, grades, distance, official id)",
  },
];

// Official-domain rule: government TLD patterns, plus national services we know are official.
const OFFICIAL_PATTERNS: RegExp[] = [
  /\.gov$/,
  /\.gov\.[a-z]{2}$/,
  /\.gob\.[a-z]{2}$/,
  /\.gouv\.[a-z]{2}$/,
  /\.gouv\.fr$/,
  /\.govt\.nz$/,
  /\.go\.[a-z]{2}$/,
  /\.gc\.ca$/,
  /\.gv\.at$/,
  /\.admin\.ch$/,
  /\.bund\.de$/,
  /\.europa\.eu$/,
  /\.nic\.in$/,
  /\.mil$/,
  /\.(state|ci|co|city|town)\.[a-z]{2}\.us$/,
  /\.[a-z]{2}\.us$/,
];

// Official agency sites outside .gov used by the supported cities.
const KNOWN_OFFICIAL = new Set([
  "sfgov.org",
  "sfplanning.org",
  "sfplanninggis.org",
  "sftreasurer.org",
  "kingcounty.com",
  "seattle.gov",
  "nyc.gov",
  "hazards-fema.maps.arcgis.com",
]);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isOfficialDomain(url: string, place?: Pick<Place, "city" | "countryCode"> | null): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (KNOWN_OFFICIAL.has(host) || [...KNOWN_OFFICIAL].some((d) => host.endsWith("." + d))) return true;
  if (OFFICIAL_PATTERNS.some((re) => re.test(host))) return true;
  // Municipal sites on a country TLD named after the city (e.g. toronto.ca, cityofsydney.nsw...).
  if (place?.city && place.countryCode) {
    const slug = place.city.toLowerCase().replace(/[^a-z]/g, "");
    const tld = place.countryCode.toLowerCase();
    if (slug.length > 3) {
      const re = new RegExp(`(^|\\.)(cityof)?${slug}\\.${tld}$`);
      if (re.test(host)) return true;
    }
  }
  return false;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Cross-check one record against the text of its source page (read with TinyFish Fetch): its official
 * id, or else its largest figure, must appear there. undefined when there's nothing distinctive to check
 * or the page text is empty (e.g. a map rendered only in the browser).
 */
export function seenOnPage(r: Pick<DossierRecord, "record_id" | "details">, pageText: string): boolean | undefined {
  const page = norm(pageText);
  if (page.length < 200) return undefined;
  const id = norm(r.record_id);
  const figure = (r.details.match(/\d[\d,.]{3,}\d/g) ?? []).map(norm).sort((a, b) => b.length - a.length)[0];
  const needle = id.length >= 3 ? id : figure;
  return needle ? page.includes(needle) : undefined;
}

/** Decide a section's final status from what actually happened. Never invents records. */
export function finalizeStatus(input: {
  sourcesFound: number;
  sourcesReachable: number;
  items: DossierRecord[];
  agentSaidNotFound: boolean;
}): { status: SectionStatus; reason: string } {
  if (input.items.length > 0) return { status: "found", reason: "" };
  if (input.sourcesFound === 0)
    return { status: "no_source", reason: "No official source for this record type was located for this area." };
  if (input.sourcesReachable === 0)
    return { status: "unavailable", reason: "Official source could not be reached or blocked automated access." };
  if (input.agentSaidNotFound)
    return { status: "not_found", reason: "The official source was searched and returned no records for this address." };
  return { status: "unavailable", reason: "The source was reached but records could not be extracted reliably." };
}

/** Keep only records that cite an http(s) source; drop anything the agent couldn't attribute. */
export function cleanRecords(raw: unknown, fallbackUrl: string, retrievedAt: string): DossierRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: DossierRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as { title?: unknown; details?: unknown; source_url?: unknown; record_id?: unknown; date?: unknown };
    const title = String(o.title ?? "").trim();
    const details = String(o.details ?? "").trim();
    if (!title && !details) continue;
    const src = String(o.source_url ?? "").trim();
    out.push({
      record_id: String(o.record_id ?? "").trim(),
      title: title || details.slice(0, 80),
      date: String(o.date ?? "").trim(),
      details,
      source_url: /^https?:\/\//.test(src) ? src : fallbackUrl,
      retrieved_at: retrievedAt,
    });
  }
  return out;
}

export function recordKey(r: Pick<DossierRecord, "record_id" | "title" | "source_url">): string {
  const id = r.record_id || r.title;
  return `${hostOf(r.source_url)}::${id.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export interface RecordChange {
  section: SectionKey;
  kind: "added" | "changed" | "removed";
  record: DossierRecord;
  before?: DossierRecord;
}

/** Compare a stored snapshot to a fresh check. Identical records produce no change. */
export function diffRecords(
  section: SectionKey,
  before: DossierRecord[],
  after: DossierRecord[],
): RecordChange[] {
  const prev = new Map(before.map((r) => [recordKey(r), r]));
  const next = new Map(after.map((r) => [recordKey(r), r]));
  const changes: RecordChange[] = [];
  for (const [k, r] of next) {
    const old = prev.get(k);
    if (!old) changes.push({ section, kind: "added", record: r });
    else if (old.date !== r.date || old.details !== r.details)
      changes.push({ section, kind: "changed", record: r, before: old });
  }
  for (const [k, r] of prev) if (!next.has(k)) changes.push({ section, kind: "removed", record: r });
  return changes;
}

/** Compare a monitored page's text with its previous snapshot: outcome plus the changed lines. */
export function pageChange(before: string | undefined, after: string): { outcome: "baseline" | "changed" | "unchanged"; diff: string } {
  if (before === undefined) return { outcome: "baseline", diff: "" };
  if (before === after) return { outcome: "unchanged", diff: "" };
  const a = new Set(before.split("\n"));
  const b = new Set(after.split("\n"));
  const diff = [...[...a].filter((l) => !b.has(l)).map((l) => `- ${l}`), ...[...b].filter((l) => !a.has(l)).map((l) => `+ ${l}`)];
  return { outcome: "changed", diff: diff.join("\n").slice(0, 3000) };
}

/**
 * Split the AI brief into lines, and each line into sentences, so print can keep every sentence whole
 * and only break a page after a full stop. A sentence ends at . ! or ? followed by a space and a capital,
 * digit, bracket or quote, and not after a common abbreviation, so "e.g. 2026", "No. 5" and URLs stay intact.
 */
export function briefLines(text: string): string[][] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    // Older saved briefs ended with a "written by <model>" sign-off; it's no longer shown.
    .filter((l) => l && !/^[—-]?\s*written by .+ from the records (above|below) only\.?$/i.test(l))
    .map((l) => l.split(/(?<=[.!?])(?<!\b(?:e\.g|i\.e|etc|vs|approx|No|no|St|Ave|Dr|Inc|Co|Jr)\.)\s+(?=[A-Z0-9("[\-•])/).filter(Boolean));
}

export interface BriefItem {
  section: SectionKey;
  finding: string;
  sources: string[];
}
export interface Brief {
  headline: string;
  items: BriefItem[];
  verify: string[];
}

const plain = (s: unknown) => String(s ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim();

/**
 * Parse the AI's JSON brief and hold it to the dossier: only known record types, in report order, and
 * only source URLs that are really in the dossier (the AI can't introduce a link). A record type with
 * records but no valid citation falls back to its own record pages. null if the reply isn't usable JSON.
 */
export function parseBrief(text: string, sections: Record<SectionKey, SectionResult>): Brief | null {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: { headline?: unknown; items?: unknown; verify?: unknown };
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || !Array.isArray(raw.items)) return null;
  const byKey = new Map<SectionKey, BriefItem>();
  for (const it of raw.items as { section?: unknown; finding?: unknown; sources?: unknown }[]) {
    const key = String(it?.section ?? "") as SectionKey;
    const sec = sections[key];
    if (!sec || byKey.has(key)) continue;
    const known = new Set([...sec.items.map((r) => r.source_url), ...sec.sources.map((s) => s.url)].filter(Boolean));
    let sources = (Array.isArray(it.sources) ? it.sources : []).map(String).filter((u) => known.has(u));
    if (!sources.length && sec.items.length) sources = [...new Set(sec.items.map((r) => r.source_url))].slice(0, 2);
    const finding = plain(it.finding);
    if (finding) byKey.set(key, { section: key, finding, sources: [...new Set(sources)] });
  }
  const items = SECTIONS.map((s) => byKey.get(s.key)).filter((x): x is BriefItem => Boolean(x));
  if (!items.length) return null;
  return {
    headline: plain(raw.headline),
    items,
    verify: (Array.isArray(raw.verify) ? raw.verify : []).map(plain).filter(Boolean).slice(0, 6),
  };
}

export type BriefPart = { text: string } | { url: string; label: string };

/**
 * Split brief text into plain text and source links. A cited URL, bracketed ("[https://…]") or bare,
 * becomes a link labelled with its site name instead of the whole address.
 */
export function briefParts(text: string): BriefPart[] {
  const parts: BriefPart[] = [];
  const re = /\[?(https?:\/\/[^\s\]]+?)[.,;:)]*\]|\[?(https?:\/\/[^\s\]]+[^\s\].,;:)])/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const url = (m[1] ?? m[2])!;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ url, label: hostOf(url) || url });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function emptySections(): Record<SectionKey, SectionResult> {
  return Object.fromEntries(
    SECTIONS.map((s) => [s.key, { key: s.key, status: "pending", reason: "", items: [], sources: [] }]),
  ) as unknown as Record<SectionKey, SectionResult>;
}
