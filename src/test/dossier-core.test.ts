import { describe, expect, it } from "vitest";
import {
  OUTPUT_SCHEMA,
  SCHEMA_KEYWORDS,
  briefLines,
  briefParts,
  cleanRecords,
  emptySections,
  parseBrief,
  diffRecords,
  finalizeStatus,
  isOfficialDomain,
  pageChange,
  seenOnPage,
  type DossierRecord,
} from "@/lib/dossier-core";

describe("pageChange", () => {
  it("reports baseline, unchanged and the changed lines of a monitored page", () => {
    expect(pageChange(undefined, "a").outcome).toBe("baseline");
    expect(pageChange("a\nb", "a\nb").outcome).toBe("unchanged");
    expect(pageChange("Permit 1\nPermit 2", "Permit 1\nPermit 2\nPermit 3")).toEqual({ outcome: "changed", diff: "+ Permit 3" });
  });
});

describe("briefLines", () => {
  it("splits the brief into lines and whole sentences without breaking abbreviations or URLs", () => {
    const text = "- Zoning is SM-UP 95 (M) [https://maps.seattle.gov/x]. No overlays shown.\n\n- Tax e.g. 2026 total 72,153,700. Verify flood zone manually!";
    expect(briefLines(text)).toEqual([
      ["- Zoning is SM-UP 95 (M) [https://maps.seattle.gov/x].", "No overlays shown."],
      ["- Tax e.g. 2026 total 72,153,700.", "Verify flood zone manually!"],
    ]);
  });
});

describe("parseBrief", () => {
  const sections = emptySections();
  sections.tax = { ...sections.tax, status: "found", items: [rec("T1")] };
  sections.flood = { ...sections.flood, status: "not_found", reason: "none" };
  const reply = (o: unknown) => "Here you go:\n```json\n" + JSON.stringify(o) + "\n```";

  it("keeps known record types in report order and only URLs that are in the dossier", () => {
    const b = parseBrief(
      reply({
        headline: "Taxes rose — check flood.",
        items: [
          { section: "flood", finding: "No flood record was found.", sources: ["https://made-up.example/x"] },
          { section: "tax", finding: "Assessed value is listed.", sources: ["https://dbiweb.sfgov.org/p", "https://evil.example"] },
          { section: "bogus", finding: "x", sources: [] },
        ],
        verify: ["Check the FEMA map by hand."],
      }),
      sections,
    )!;
    expect(b.headline).toBe("Taxes rose, check flood.");
    expect(b.items.map((i) => i.section)).toEqual(["tax", "flood"]);
    expect(b.items[0]!.sources).toEqual(["https://dbiweb.sfgov.org/p"]);
    expect(b.items[1]!.sources).toEqual([]);
    expect(b.verify).toEqual(["Check the FEMA map by hand."]);
  });
  it("falls back to a section's own record pages when the AI cites none", () => {
    const b = parseBrief(reply({ headline: "", items: [{ section: "tax", finding: "Values listed.", sources: [] }], verify: [] }), sections)!;
    expect(b.items[0]!.sources).toEqual(["https://dbiweb.sfgov.org/p"]);
  });
  it("returns null for a reply that isn't the requested JSON", () => {
    expect(parseBrief("- Permits: none found.", sections)).toBeNull();
  });
});

describe("briefParts", () => {
  it("turns bracketed and bare source URLs into site-name links in place", () => {
    expect(briefParts("Zone SM-UP 95 [https://maps.seattle.gov/sdcipermithistory/search?address=400]. Tax at https://blue.kingcounty.com/x.")).toEqual([
      { text: "Zone SM-UP 95 " },
      { url: "https://maps.seattle.gov/sdcipermithistory/search?address=400", label: "maps.seattle.gov" },
      { text: ". Tax at " },
      { url: "https://blue.kingcounty.com/x", label: "blue.kingcounty.com" },
      { text: "." },
    ]);
  });
  it("drops the old written-by sign-off line", () => {
    expect(briefLines("- A point.\n\nWritten by gpt-4o-mini from the records above only")).toEqual([["- A point."]]);
  });
});

describe("seenOnPage", () => {
  // Excerpt shape of the real King County eReal Property page for parcel 198520-0495.
  const page = "Tax Roll History | 2026 | 2025 | 11,109,000 | 61,044,700 | 72,153,700 | Parcel 1985200495 ".repeat(5);
  it("matches an id regardless of punctuation", () => {
    expect(seenOnPage({ record_id: "198520-0495", details: "" }, page)).toBe(true);
  });
  it("falls back to the record's largest figure when it has no id", () => {
    expect(seenOnPage({ record_id: "", details: "Appraised total 72,153,700; land 11,109,000" }, page)).toBe(true);
    expect(seenOnPage({ record_id: "", details: "Appraised total 99,999,999" }, page)).toBe(false);
  });
  it("leaves records unmarked when the page text is too thin to check (browser-only maps)", () => {
    expect(seenOnPage({ record_id: "AE", details: "Zone AE" }, "Loading...")).toBeUndefined();
    expect(seenOnPage({ record_id: "", details: "no figures" }, page)).toBeUndefined();
  });
});

describe("OUTPUT_SCHEMA", () => {
  it("uses only keywords TinyFish output_schema accepts", () => {
    const bad: string[] = [];
    const walk = (node: Record<string, unknown>, path: string) => {
      for (const [k, v] of Object.entries(node)) {
        if (!SCHEMA_KEYWORDS.has(k)) bad.push(`${path}.${k}`);
        if (k === "properties") for (const [p, s] of Object.entries(v as object)) walk(s, `${path}.${p}`);
        if (k === "items") walk(v as Record<string, unknown>, `${path}[]`);
      }
    };
    walk(OUTPUT_SCHEMA, "#");
    expect(bad).toEqual([]);
  });
});

const rec = (id: string, date = "2024-01-01", details = "x"): DossierRecord => ({
  record_id: id, title: `Permit ${id}`, date, details, source_url: "https://dbiweb.sfgov.org/p", retrieved_at: "t",
});

describe("diffRecords", () => {
  it("detects a new permit", () => {
    const c = diffRecords("permits", [rec("A1")], [rec("A1"), rec("B2")]);
    expect(c).toHaveLength(1);
    expect(c[0]!.kind).toBe("added");
    expect(c[0]!.record.record_id).toBe("B2");
  });
  it("ignores unchanged records", () => {
    expect(diffRecords("permits", [rec("A1")], [rec("A1")])).toEqual([]);
  });
  it("flags a status/date change", () => {
    expect(diffRecords("permits", [rec("A1")], [rec("A1", "2025-02-02")])[0]!.kind).toBe("changed");
  });
});

describe("finalizeStatus", () => {
  it("reports no_source when no official site was located", () => {
    expect(finalizeStatus({ sourcesFound: 0, sourcesReachable: 0, items: [], agentSaidNotFound: false }).status).toBe("no_source");
  });
  it("reports unavailable when the source blocked access", () => {
    expect(finalizeStatus({ sourcesFound: 2, sourcesReachable: 0, items: [], agentSaidNotFound: false }).status).toBe("unavailable");
  });
  it("reports not_found only when the source was searched and was empty", () => {
    expect(finalizeStatus({ sourcesFound: 1, sourcesReachable: 1, items: [], agentSaidNotFound: true }).status).toBe("not_found");
  });
});

describe("cleanRecords", () => {
  it("falls back to the searched portal when a record lacks a URL", () => {
    const r = cleanRecords([{ title: "Zone RH-1", details: "Residential", source_url: "" }], "https://sfplanning.org/x", "t");
    expect(r[0]!.source_url).toBe("https://sfplanning.org/x");
  });
});

describe("isOfficialDomain", () => {
  it("accepts government domains", () => {
    expect(isOfficialDomain("https://msc.fema.gov/portal")).toBe(true);
    expect(isOfficialDomain("https://www.camden.gov.uk/planning")).toBe(true);
    expect(isOfficialDomain("https://www.co.king.wa.us/assessor")).toBe(true);
  });
  it("accepts a city site on the national domain", () => {
    expect(isOfficialDomain("https://www.toronto.ca/x", { city: "Toronto", countryCode: "CA" })).toBe(true);
  });
  it("rejects commercial listing sites", () => {
    expect(isOfficialDomain("https://www.zillow.com/homedetails/1")).toBe(false);
    expect(isOfficialDomain("https://www.rightmove.co.uk/x")).toBe(false);
  });
});
