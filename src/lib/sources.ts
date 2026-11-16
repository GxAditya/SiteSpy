// Supported jurisdictions and the official portals the TinyFish agent works on, with step-by-step
// navigation researched from each site's own help pages. Pure data + URL builders (tested).
import type { Place, SectionKey } from "./dossier-core";

export type Authority = "city" | "county" | "state" | "national";

export interface SourceSpec {
  title: string;
  authority: Authority;
  url: (p: Place) => string;
  /** Numbered navigation steps for the agent on this site. */
  steps: (p: Place) => string[];
  /** The site can search by this jurisdiction's parcel id; otherwise parcel lookups resolve the address first. */
  acceptsParcel?: boolean;
  /** Holds a different record set than the sources before it, so it is still checked after a "not found". */
  complements?: boolean;
}

export interface Jurisdiction {
  id: "seattle" | "san-francisco" | "nyc";
  name: string;
  region: string;
  parcelLabel: string;
  parcelExample: string;
  demo: string;
  match: (p: Pick<Place, "countryCode" | "state" | "city" | "county">) => boolean;
  /** Official page that shows the site address for a parcel id. */
  parcelPage: (parcel: string) => string;
  sources: Record<SectionKey, SourceSpec[]>;
}

const enc = encodeURIComponent;
const digits = (s = "") => s.replace(/\D/g, "");
const hasStreet = (p: Place) => Boolean(p.houseNumber && p.road);
/** Street address in words; in parcel mode it refers to the address the agent read on the parcel page. */
export const streetLine = (p: Place) => (hasStreet(p) ? `${p.houseNumber} ${p.road}` : "the street address you noted for the parcel");
const fullAddress = (p: Place) => (hasStreet(p) ? `${p.houseNumber} ${p.road}, ${p.city}, ${p.stateCode} ${p.postcode}`.trim() : streetLine(p));

// ---------- National sources (every supported US city) ----------

const FEMA: SourceSpec[] = [
  {
    title: "FEMA Flood Map Service Center",
    authority: "national",
    url: (p) => `https://msc.fema.gov/portal/search${hasStreet(p) ? `?AddressQuery=${enc(fullAddress(p))}` : ""}`,
    steps: (p) => [
      `If the search box is empty or shows a different place, type ${hasStreet(p) ? `"${fullAddress(p)}"` : "the full street address you noted, with city and ZIP,"} into "Enter an address, place, or coordinates" and click Search.`,
      "Wait up to 60 seconds for the results; the page says it can take a minute to build the dynamic FIRMette.",
      'Read the sentence "The flood map for the selected area is number ..., effective on ...". Record the FIRM panel number as record_id and the effective date as date.',
      "In the Dynamic Map, read the flood zone label shown at the location pin (for example AE, X, VE). Only report a zone if it is clearly labelled at the pin; otherwise write that the zone label was not readable.",
      "List any Letters of Map Change shown under 'Changes to this FIRM' as separate items.",
    ],
  },
  {
    title: "FEMA National Flood Hazard Layer Viewer",
    authority: "national",
    url: () => "https://hazards-fema.maps.arcgis.com/apps/webappviewer/index.html?id=8b0adb51996444d4879338b5529aa9cd",
    steps: (p) => [
      "Close the splash/disclaimer dialog if it appears.",
      `Use the address search box at the top left to search ${hasStreet(p) ? `"${fullAddress(p)}"` : "the full street address you noted"} and pick the first match.`,
      "Wait for the flood layers to load (they only draw when zoomed in), then click once on the map exactly at the located point.",
      "In the popup, read the Flood Hazard Zones entry (FLD_ZONE / zone subtype), plus the FIRM panel number and effective date if shown. Use the panel number as record_id.",
    ],
  },
];

const STATE_FIPS: Record<string, string> = { WA: "53", CA: "06", NY: "36" };
export const ncesUrl = (p: Place) =>
  `https://nces.ed.gov/ccd/schoolsearch/school_list.asp?Search=1&${
    p.postcode ? `Zip=${enc(p.postcode)}&Miles=2` : `City=${enc(p.city)}&State=${STATE_FIPS[p.stateCode] ?? ""}`
  }&SchoolType=1&SpecificSchlTypes=all&IncGrade=-1&LoGrade=-1&HiGrade=-1`;

const NCES: SourceSpec[] = [
  {
    title: "NCES Search for Public Schools",
    authority: "national",
    url: ncesUrl,
    steps: (p) => [
      p.postcode
        ? "This page already lists public schools within 2 miles of the property's ZIP code, nearest first."
        : `Click "Modify Search", enter the ZIP code you noted for the parcel, set Miles to 2, and search.`,
      "For each of the first 10 schools, copy the distance (Mi.), school name, street address, grades and students into details.",
      "Open each school's name link and copy its NCES School ID as record_id, using that detail page URL as source_url. If that is slow, use the list page URL and leave record_id empty.",
    ],
  },
];

// ---------- Seattle / King County, WA ----------

const KC_DASHBOARD = (parcel: string) => `https://blue.kingcounty.com/Assessor/eRealProperty/Dashboard.aspx?ParcelNbr=${enc(digits(parcel))}`;
const seattleTool = (p: Place) =>
  hasStreet(p)
    ? `https://maps.seattle.gov/sdcipermithistory/search?address=${enc(`${p.houseNumber} ${p.road}`.toUpperCase() + `, SEATTLE, WA, ${p.postcode}`)}`
    : "https://maps.seattle.gov/sdcipermithistory/";
const seattleFind = (p: Place) =>
  `The page searches for ${streetLine(p)}. If it says it couldn't find the address, type the street number and name into the search box and pick the matching suggestion.`;

const seattle: Jurisdiction = {
  id: "seattle",
  name: "Seattle",
  region: "King County, Washington",
  parcelLabel: "King County parcel number (10 digits)",
  parcelExample: "1985200495",
  demo: "400 Broad St, Seattle, WA 98109",
  match: (p) => p.countryCode === "US" && p.state === "Washington" && p.city === "Seattle",
  parcelPage: KC_DASHBOARD,
  sources: {
    permits: [
      {
        title: "Seattle SDCI Permit & Site History",
        authority: "city",
        url: seattleTool,
        steps: (p) => [
          seattleFind(p),
          "Note the Development Site number (DV...) and the King County Assessor Parcel Number shown for the site.",
          'Open the "Records 1983-Present" tab. Under Record Type, select "Building & Construction" and "Land Use" only.',
          "Copy each record: record number as record_id, record type, description and status in details, application/issue date as date. Page through up to 3 pages, newest first.",
        ],
      },
    ],
    zoning: [
      {
        title: "Seattle SDCI Permit & Site History (Zone)",
        authority: "city",
        url: seattleTool,
        steps: (p) => [
          seattleFind(p),
          'Read the "Zone:" value shown for the development site (for example "SM-UP 95 (M)") exactly as written and use it as record_id.',
          'Open the "Site Characteristics Report" link if available and copy the zoning overlays and environmentally critical area entries listed for the site as separate items.',
        ],
      },
    ],
    tax: [
      {
        title: "King County Assessor eReal Property",
        authority: "county",
        acceptsParcel: true,
        url: (p) => (p.parcel ? KC_DASHBOARD(p.parcel) : "https://blue.kingcounty.com/Assessor/eRealProperty/default.aspx"),
        steps: (p) => [
          "If a disclaimer about RCW 42.56.070(9) appears, accept it to continue.",
          p.parcel
            ? `The dashboard for parcel ${p.parcel} should load.`
            : `Search by address with the house number and street name from "${streetLine(p)}" (ZIP ${p.postcode}) and open the matching parcel.`,
          'Open the "Property Detail" tab and scroll to "Tax Roll History".',
          "Copy one item per tax year (latest 6 years): tax year as date, parcel number as record_id, and appraised land value, improvements value, appraised total and taxable total in details.",
        ],
      },
    ],
    flood: FEMA,
    violations: [
      {
        title: "Seattle SDCI Permit & Site History (Complaints & Violations)",
        authority: "city",
        url: seattleTool,
        steps: (p) => [
          seattleFind(p),
          'Open the "Records 1983-Present" tab. Under Record Type, select "Complaints & Violations" only.',
          "Copy each record: record number as record_id, type, description and status in details, opened date as date. Page through up to 3 pages, newest first.",
          "If the filtered list is empty, return status not_found.",
        ],
      },
      {
        title: "Seattle Services Portal",
        authority: "city",
        url: () => "https://cosaccela.seattle.gov/portal/welcome.aspx",
        steps: (p) => [
          'Under "Find Existing", choose "Complaints - Building & Property" from "Narrow your search by category".',
          'Set Record Type to "Code Compliance Complaint".',
          `Search by street number and street name from ${streetLine(p)} and click Search.`,
          "Copy each result: Record Number as record_id, type, description and status in details, date as date. Open Related Records to see whether a Notice of Violation or citation followed and note it in details.",
        ],
      },
    ],
    schools: NCES,
  },
};

// ---------- San Francisco (city and county), CA ----------

const SF_PIM = "https://sfplanninggis.org/pim/";
const STREET_TYPES = /\s+(STREET|ST|AVENUE|AVE|PLACE|PL|BOULEVARD|BLVD|DRIVE|DR|ROAD|RD|WAY|LANE|LN|COURT|CT|TERRACE|TER|ALLEY|ALY|HIGHWAY|HWY)$/;
/** DBI matches the full name without punctuation or street type: "Dr. Carlton B. Goodlett Place" → "DR CARLTON B GOODLETT". */
export const dbiStreet = (road: string) =>
  road.toUpperCase().replace(/^DOCTOR\b/, "DR").replace(/[.,']/g, "").replace(/\s+/g, " ").trim().replace(STREET_TYPES, "");
const splitBlockLot = (apn: string) => {
  const parts = apn.split(/[^0-9A-Za-z]+/).filter(Boolean);
  return parts.length >= 2 ? { block: parts[0]!, lot: parts[1]! } : { block: apn.slice(0, 4), lot: apn.slice(4) };
};
export const sfDbiUrl = (p: Place) => {
  const q = p.parcel
    ? { StreetNumber: "", StreetName: "", Block: splitBlockLot(p.parcel).block, Lot: splitBlockLot(p.parcel).lot }
    : { StreetNumber: p.houseNumber, StreetName: dbiStreet(p.road), Block: "", Lot: "" };
  return `https://dbiweb02.sfgov.org/dbipts/?page=address&StreetNumber=${enc(q.StreetNumber)}&StreetName=${enc(q.StreetName)}&StreetSuffix=&Unit=&Block=${enc(q.Block)}&Lot=${enc(q.Lot)}`;
};
const pimSteps = (p: Place, tab: string, extract: string[]): string[] => [
  `In the search box, type ${p.parcel ? `the block/lot ${p.parcel}` : `the street address "${streetLine(p)}"`} and pick the matching property from the suggestions.`,
  `Click the "${tab}" tab for the selected property.`,
  ...extract,
];
const dbiSearch = (p: Place) =>
  p.parcel
    ? `This page searched DBI for block/lot ${p.parcel}. If it says no addresses were found, open https://dbiweb02.sfgov.org/dbipts/default.aspx?page=AddressQuery and enter the block and lot in the Block # and Lot # fields.`
    : `This page searched DBI for street number ${p.houseNumber}, street name "${dbiStreet(p.road)}" (DBI wants the full name without its St/Ave/Pl type and no punctuation). If it says no addresses were found, open https://dbiweb02.sfgov.org/dbipts/default.aspx?page=AddressQuery and try the name with the type moved into Street Name.`;

const sanFrancisco: Jurisdiction = {
  id: "san-francisco",
  name: "San Francisco",
  region: "City and County of San Francisco, California",
  parcelLabel: "Block/lot (APN)",
  parcelExample: "0787/001",
  demo: "1 Dr Carlton B Goodlett Pl, San Francisco, CA 94102",
  match: (p) => p.countryCode === "US" && p.state === "California" && p.city === "San Francisco",
  parcelPage: () => SF_PIM,
  sources: {
    permits: [
      {
        title: "SF DBI Permit / Complaint Tracking System",
        authority: "city",
        acceptsParcel: true,
        url: sfDbiUrl,
        steps: (p) => [
          dbiSearch(p),
          'If a list of matching addresses appears, click "Select" on the row that matches the address.',
          "Open the Building Permits list for the address. Copy each permit: permit number as record_id, status, description and cost in details, filed/issued date as date (newest first, up to 15).",
        ],
      },
      {
        title: "SF Property Information Map (Permits)",
        authority: "city",
        acceptsParcel: true,
        url: () => SF_PIM,
        steps: (p) =>
          pimSteps(p, "Permits", [
            "Copy each building permit and planning application listed: number as record_id, description and status in details, date as date.",
          ]),
      },
    ],
    zoning: [
      {
        title: "SF Property Information Map (Zoning)",
        authority: "city",
        acceptsParcel: true,
        url: () => SF_PIM,
        steps: (p) =>
          pimSteps(p, "Zoning Information", [
            "Copy the Zoning District (code and name) as the first item with the code as record_id.",
            "Copy the Height & Bulk District, Special Use Districts and other applicable regulations as separate items.",
          ]),
      },
    ],
    tax: [
      {
        title: "SF Property Information Map (Assessor Report)",
        authority: "county",
        acceptsParcel: true,
        url: () => SF_PIM,
        steps: (p) =>
          pimSteps(p, "Property", [
            "Open the Assessor's Report / assessor summary for the parcel.",
            "Copy the block/lot (APN) as record_id and the assessed land value, improvement value, roll year and use type exactly as shown. Add one item per roll year if a value history is shown.",
          ]),
      },
      {
        title: "SF Treasurer & Tax Collector property tax lookup",
        authority: "county",
        acceptsParcel: true,
        url: () => "https://sftreasurer.org/property-tax-payments",
        steps: (p) => [
          'Click the "Property Tax Payment Portal" button.',
          `Search by ${p.parcel ? `block and lot ${p.parcel}` : `property address "${streetLine(p)}"`} and open the matching parcel.`,
          "Copy each secured property tax bill shown: tax year as date, bill number or block/lot as record_id, amount and paid/unpaid status in details. Do NOT add anything to the cart or pay.",
        ],
      },
    ],
    flood: FEMA,
    violations: [
      {
        title: "SF DBI Permit / Complaint Tracking System (Complaints)",
        authority: "city",
        acceptsParcel: true,
        url: sfDbiUrl,
        steps: (p) => [
          dbiSearch(p),
          'If a list of matching addresses appears, click "Select" on the matching row.',
          "Open the Complaints list for the address. Copy each complaint: complaint number as record_id, description, division and status (including any Notice of Violation) in details, date filed as date.",
        ],
      },
      {
        title: "SF Property Information Map (Complaints)",
        authority: "city",
        acceptsParcel: true,
        url: () => SF_PIM,
        steps: (p) =>
          pimSteps(p, "Complaints", [
            "Copy both Planning Department and Department of Building Inspection complaints: number as record_id, description and status in details, date as date.",
          ]),
      },
    ],
    schools: NCES,
  },
};

// ---------- New York City, NY ----------

const BOROUGHS: Record<string, { code: number; name: string }> = {
  "New York County": { code: 1, name: "Manhattan" },
  "Bronx County": { code: 2, name: "Bronx" },
  "Kings County": { code: 3, name: "Brooklyn" },
  "Queens County": { code: 4, name: "Queens" },
  "Richmond County": { code: 5, name: "Staten Island" },
};
export const nycBorough = (p: Pick<Place, "county" | "parcel">) => {
  const fromBbl = digits(p.parcel)[0];
  return Object.values(BOROUGHS).find((x) => String(x.code) === fromBbl) ?? BOROUGHS[p.county] ?? BOROUGHS["New York County"]!;
};
/** BBL "1010120038" or "1-1012-38" → borough, block, lot. */
export const splitBbl = (bbl: string) => {
  const parts = bbl.split(/[^0-9]+/).filter(Boolean);
  if (parts.length === 3) return { boro: parts[0]!, block: String(Number(parts[1])), lot: String(Number(parts[2])) };
  const d = digits(bbl);
  return { boro: d.slice(0, 1), block: String(Number(d.slice(1, 6))), lot: String(Number(d.slice(6, 10))) };
};
/** BIS wants ordinals as digits: "West 41st Street" → "WEST 41 STREET". */
export const bisStreet = (road: string) => road.replace(/\b(\d+)(st|nd|rd|th)\b/gi, "$1").toUpperCase();
const BIS = "https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet";
export const bisUrl = (p: Place) => {
  if (!p.parcel) return `${BIS}?boro=${nycBorough(p).code}&houseno=${enc(p.houseNumber)}&street=${enc(bisStreet(p.road))}`;
  const b = splitBbl(p.parcel);
  return `${BIS}?boro=${b.boro}&block=${b.block}&lot=${b.lot}&go3=+GO+&requestid=0`;
};
const bblText = (p: Place) => {
  const b = splitBbl(p.parcel ?? "");
  return `borough ${nycBorough(p).name} (${b.boro}), block ${b.block}, lot ${b.lot}`;
};

const bisSteps = (p: Place, link: string, extract: string[]): string[] => [
  p.parcel
    ? `This is the NYC DOB BIS Property Profile for ${bblText(p)}. If it shows the search page instead, use the Borough / Block / Lot search with those values and click GO.`
    : `This is the NYC DOB BIS Property Profile for ${p.houseNumber} ${bisStreet(p.road)}, ${nycBorough(p).name}. If it shows "INVALID ADDRESS", use the address search form with house number ${p.houseNumber}, street "${bisStreet(p.road)}" and borough ${nycBorough(p).name}.`,
  "Note the BIN, Block and Lot shown at the top of the Property Profile.",
  `Click the "${link}" link in the profile's record table.`,
  ...extract,
  "If BIS blocks access or shows an error page, return status blocked.",
];

const nyc: Jurisdiction = {
  id: "nyc",
  name: "New York City",
  region: "All five boroughs, New York",
  parcelLabel: "BBL (borough-block-lot, 10 digits)",
  parcelExample: "1010120038",
  demo: "208 West 41st Street, New York, NY 10036",
  match: (p) => p.countryCode === "US" && p.state === "New York" && (p.city === "New York" || p.county in BOROUGHS),
  parcelPage: (bbl) => `https://zola.planning.nyc.gov/bbl/${digits(bbl).padEnd(10, "0").slice(0, 10)}`,
  sources: {
    permits: [
      {
        title: "NYC DOB Building Information System (BIS)",
        authority: "city",
        acceptsParcel: true,
        url: bisUrl,
        steps: (p) =>
          bisSteps(p, "Jobs/Filings", [
            "Copy each job filing: job number as record_id, job type (NB, A1, A2, DM...), job status and description in details, file date as date. Newest first, up to 15.",
          ]),
      },
      {
        title: "NYC DOB NOW Public Portal",
        authority: "city",
        acceptsParcel: true,
        complements: true,
        url: () => "https://a810-dobnow.nyc.gov/publish/Index.html#!/",
        steps: (p) => [
          p.parcel
            ? `Search the Property Profile by Borough, Block, Lot: ${bblText(p)}.`
            : `Search the Property Profile by address: borough ${nycBorough(p).name}, house number ${p.houseNumber}, street ${p.road}.`,
          "Open the Jobs / Filings list for the property and copy each filing: job number as record_id, work type and status in details, filing date as date (DOB NOW filings are not in BIS).",
        ],
      },
    ],
    zoning: [
      {
        title: "NYC Planning ZoLa",
        authority: "city",
        acceptsParcel: true,
        url: (p) => (p.parcel ? nyc.parcelPage(p.parcel) : "https://zola.planning.nyc.gov/"),
        steps: (p) => [
          "Close the 'new features' popup if it appears.",
          p.parcel ? "The tax lot page for the BBL should open." : `Type "${streetLine(p)}" in "Search the map" and pick the ${nycBorough(p).name} result to open its tax lot.`,
          "Copy each Zoning District listed (e.g. C6-7) as a separate item with the code as record_id; add commercial overlays and special purpose districts the same way.",
          "Add one item with the BBL as record_id and the land use, lot area, year built and building class in details.",
        ],
      },
    ],
    tax: [
      {
        title: "NYC Department of Finance Property Tax Public Access",
        authority: "city",
        acceptsParcel: true,
        url: () => "https://a836-pts-access.nyc.gov/care/search/commonsearch.aspx?mode=address",
        steps: (p) => [
          "If a disclaimer appears, click Agree.",
          p.parcel
            ? `Switch to the BBL search and enter ${bblText(p)}.`
            : `Enter street number ${p.houseNumber} and street name ${p.road}, choose borough ${nycBorough(p).name}, and search. Open the matching property.`,
          "Open the Notices of Property Value / assessments view and copy one item per tax year: tax year as date, BBL as record_id, market value, assessed value, taxable value and tax class in details.",
          "If property tax bills are listed, add the latest bills with their amount due as separate items.",
        ],
      },
    ],
    flood: FEMA,
    violations: [
      {
        title: "NYC DOB Building Information System (Violations)",
        authority: "city",
        acceptsParcel: true,
        url: bisUrl,
        steps: (p) =>
          bisSteps(p, "Violations-DOB", [
            "Copy each DOB violation: violation number as record_id, type, description and status (open/dismissed) in details, issue date as date.",
            'Go back and open "Violations-OATH/ECB"; copy each the same way including penalty and hearing status.',
          ]),
      },
      {
        title: "NYC HPD Online",
        authority: "city",
        acceptsParcel: true,
        complements: true,
        url: () => "https://hpdonline.nyc.gov/hpdonline/",
        steps: (p) => [
          p.parcel
            ? `Use the Borough / Block / Lot search with ${bblText(p)}.`
            : `Search "${streetLine(p)}" in Find Building Information and choose the ${nycBorough(p).name} match.`,
          'Open the "Violations" tab and copy each violation: violation ID as record_id, class (A/B/C), description and status in details, inspection/issue date as date. Up to 15, open ones first.',
        ],
      },
    ],
    schools: NCES,
  },
};

export const JURISDICTIONS: Jurisdiction[] = [seattle, sanFrancisco, nyc];

export function findJurisdiction(p: Pick<Place, "countryCode" | "state" | "city" | "county">): Jurisdiction | null {
  return JURISDICTIONS.find((j) => j.match(p)) ?? null;
}

export const jurisdictionById = (id: string) => JURISDICTIONS.find((j) => j.id === id) ?? null;

/** Where the agent starts and what it does on one source; parcel lookups on address-only sites read the address first. */
export function agentPlan(j: Jurisdiction, spec: SourceSpec, p: Place): { url: string; steps: string[] } {
  if (!p.parcel || spec.acceptsParcel) return { url: spec.url(p), steps: spec.steps(p) };
  return {
    url: j.parcelPage(p.parcel),
    steps: [
      `This official page is for ${j.parcelLabel} ${p.parcel}${j.id === "san-francisco" ? " (search it in the box and select it)" : ""}. Read and remember the property's street address and ZIP code.`,
      `Then go to ${spec.url(p)} and continue:`,
      ...spec.steps(p),
    ],
  };
}
