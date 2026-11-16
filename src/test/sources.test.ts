import { describe, expect, it } from "vitest";
import { SECTIONS, hostOf, isOfficialDomain, type Place } from "@/lib/dossier-core";
import { buildGoal } from "@/lib/run-dossier";
import { JURISDICTIONS, agentPlan, bisStreet, bisUrl, dbiStreet, findJurisdiction, jurisdictionById, ncesUrl, sfDbiUrl, splitBbl } from "@/lib/sources";

const place = (o: Partial<Place>): Place => ({
  query: "", display: "", lat: 0, lon: 0, countryCode: "US", country: "United States", state: "", stateCode: "",
  county: "", city: "", postcode: "", houseNumber: "", road: "", osmUrl: "", ...o,
});
// Shapes exactly as OpenStreetMap returned them for these addresses.
const SEATTLE = place({ state: "Washington", stateCode: "WA", county: "King County", city: "Seattle", postcode: "98109", houseNumber: "400", road: "Broad Street" });
const SF = place({ state: "California", stateCode: "CA", city: "San Francisco", postcode: "94102", houseNumber: "1", road: "Dr. Carlton B. Goodlett Place" });
const BROOKLYN = place({ state: "New York", stateCode: "NY", county: "Kings County", city: "New York", postcode: "11215", houseNumber: "350", road: "5th Avenue" });
const MANHATTAN = place({ state: "New York", stateCode: "NY", county: "New York County", city: "New York", postcode: "10018", houseNumber: "208", road: "West 41st Street" });

describe("findJurisdiction", () => {
  it("supports any address in Seattle, San Francisco and all NYC boroughs", () => {
    expect(findJurisdiction(SEATTLE)?.id).toBe("seattle");
    expect(findJurisdiction(SF)?.id).toBe("san-francisco");
    expect(findJurisdiction(BROOKLYN)?.id).toBe("nyc");
    expect(findJurisdiction(MANHATTAN)?.id).toBe("nyc");
  });
  it("rejects everything else, including neighbouring cities and same-named places", () => {
    expect(findJurisdiction(place({ state: "Washington", county: "King County", city: "Bellevue" }))).toBeNull();
    expect(findJurisdiction(place({ state: "Oregon", city: "Portland" }))).toBeNull();
    expect(findJurisdiction(place({ countryCode: "GB", state: "England", city: "London" }))).toBeNull();
    expect(findJurisdiction(place({ state: "California", city: "South San Francisco" }))).toBeNull();
  });
});

describe("registry", () => {
  for (const j of JURISDICTIONS) {
    const sample = { seattle: SEATTLE, "san-francisco": SF, nyc: MANHATTAN }[j.id];
    it(`${j.name}: every record type has an official source, and records span at least 3 official sites`, () => {
      for (const s of SECTIONS) expect(j.sources[s.key].length, s.key).toBeGreaterThan(0);
      const urls = Object.values(j.sources).flat().map((s) => s.url(sample));
      for (const u of urls) expect(isOfficialDomain(u), u).toBe(true);
      expect(new Set(urls.map(hostOf)).size).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("URL builders", () => {
  it("opens NYC BIS directly on the property profile", () => {
    expect(bisStreet("West 41st Street")).toBe("WEST 41 STREET");
    expect(bisUrl(MANHATTAN)).toBe("https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=1&houseno=208&street=WEST%2041%20STREET");
    expect(bisUrl(BROOKLYN)).toContain("boro=3");
    expect(splitBbl("1010120038")).toEqual({ boro: "1", block: "1012", lot: "38" });
    expect(bisUrl(place({ ...MANHATTAN, parcel: "3-1864-14" }))).toContain("boro=3&block=1864&lot=14");
  });
  it("opens SF DBI on the address match list using the name format DBI accepts (verified live)", () => {
    expect(dbiStreet("Dr. Carlton B. Goodlett Place")).toBe("DR CARLTON B GOODLETT");
    expect(dbiStreet("24th Street")).toBe("24TH");
    expect(sfDbiUrl(SF)).toContain("StreetNumber=1&StreetName=DR%20CARLTON%20B%20GOODLETT&");
    expect(sfDbiUrl(place({ ...SF, parcel: "6522/041" }))).toContain("Block=6522&Lot=041");
  });
  it("lists NCES schools by ZIP, or by city when only a parcel is known", () => {
    expect(ncesUrl(SEATTLE)).toContain("Zip=98109&Miles=2");
    expect(ncesUrl(place({ ...SF, postcode: "" }))).toContain("City=San%20Francisco&State=06");
  });
  it("pre-fills the FEMA and Seattle searches with the address", () => {
    const j = jurisdictionById("seattle")!;
    expect(j.sources.flood[0]!.url(SEATTLE)).toBe("https://msc.fema.gov/portal/search?AddressQuery=400%20Broad%20Street%2C%20Seattle%2C%20WA%2098109");
    expect(j.sources.permits[0]!.url(SEATTLE)).toContain("address=400%20BROAD%20STREET%2C%20SEATTLE%2C%20WA%2C%2098109");
  });
});

describe("agent goals", () => {
  it("gives the agent numbered site steps, a stop condition and the no-guessing rules", () => {
    const j = jurisdictionById("nyc")!;
    const spec = j.sources.violations[0]!;
    const g = buildGoal(j, MANHATTAN, "violations", spec.steps(MANHATTAN), spec.title);
    expect(g).toContain("208 West 41st Street, New York, NY 10018");
    expect(g).toMatch(/\n1\. This is the NYC DOB BIS Property Profile/);
    expect(g).toContain('"Violations-DOB"');
    expect(g).toMatch(/Never guess/);
    expect(g).toMatch(/Stop once the records are copied/);
  });
  it("parcel lookups on address-only sites read the address on the official parcel page first", () => {
    const j = jurisdictionById("seattle")!;
    const p = place({ ...SEATTLE, parcel: "1985200495", houseNumber: "", road: "", postcode: "" });
    const plan = agentPlan(j, j.sources.permits[0]!, p);
    expect(plan.url).toBe("https://blue.kingcounty.com/Assessor/eRealProperty/Dashboard.aspx?ParcelNbr=1985200495");
    expect(plan.steps[0]).toMatch(/Read and remember the property's street address/);
    expect(plan.steps[1]).toContain("maps.seattle.gov/sdcipermithistory");
    // The assessor accepts the parcel directly, so no detour.
    expect(agentPlan(j, j.sources.tax[0]!, p).url).toContain("ParcelNbr=1985200495");
  });
});
