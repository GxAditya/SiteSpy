import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Thin proxies: the user's own TinyFish / AI keys arrive per request and are never stored.
const AGENT = "https://agent.tinyfish.ai";

async function tf(url: string, key: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { "X-API-Key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`TinyFish ${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const keyed = z.object({ key: z.string().min(5) });

export const geocode = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ q: z.string().min(2).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(data.q)}`;
    const res = await fetch(url, { headers: { "User-Agent": "SiteSpy/1.0 (property dossier demo)", "Accept-Language": "en" } });
    if (!res.ok) throw new Error(`Geocoder ${res.status}`);
    const arr = (await res.json()) as any[];
    if (!arr.length) return null;
    const r: any = arr[0];
    const a = r.address ?? {};
    return {
      query: data.q,
      display: String(r.display_name ?? data.q),
      lat: Number(r.lat),
      lon: Number(r.lon),
      countryCode: String(a.country_code ?? "").toUpperCase(),
      country: String(a.country ?? ""),
      state: String(a.state ?? a.region ?? a.province ?? ""),
      stateCode: String(a["ISO3166-2-lvl4"] ?? "").split("-")[1] ?? "",
      county: String(a.county ?? a.state_district ?? a.district ?? ""),
      city: String(a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb ?? ""),
      postcode: String(a.postcode ?? ""),
      houseNumber: String(a.house_number ?? ""),
      road: String(a.road ?? ""),
      osmUrl: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
    };
  });

export const tfFetch = createServerFn({ method: "POST" })
  .inputValidator((d) => keyed.extend({ urls: z.array(z.string().url()).min(1).max(10), purpose: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    const j = await tf("https://api.fetch.tinyfish.ai", data.key, {
      method: "POST",
      body: JSON.stringify({ urls: data.urls, format: "markdown", ttl: 0, per_url_timeout_ms: 45000, purpose: data.purpose }),
    });
    return {
      results: ((j.results ?? []) as any[]).map((r) => ({
        url: String(r.url),
        final_url: String(r.final_url ?? r.url),
        title: String(r.title ?? ""),
        text: String(r.text ?? "").slice(0, 30000),
      })),
      errors: ((j.errors ?? []) as any[]).map((e) => ({ url: String(e.url ?? ""), error: String(e.error ?? e.message ?? "error") })),
    };
  });

export const tfAgentStart = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    keyed.extend({ url: z.string().url(), goal: z.string(), schema: z.any(), country: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const body: Record<string, unknown> = {
      url: data.url,
      goal: data.goal,
      output_schema: data.schema,
      browser_profile: "stealth",
      agent_config: { max_duration_seconds: 240 },
    };
    if (data.country && /^[A-Z]{2}$/.test(data.country)) body['proxy_config'] = { enabled: true, country_code: data.country };
    const j = await tf(`${AGENT}/v1/automation/run-async`, data.key, { method: "POST", body: JSON.stringify(body) });
    if (!j.run_id) throw new Error(`TinyFish did not start a run: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    return { runId: String(j.run_id) };
  });

export const tfRunGet = createServerFn({ method: "POST" })
  .inputValidator((d) => keyed.extend({ runId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const j = await tf(`${AGENT}/v1/runs/${encodeURIComponent(data.runId)}?screenshots=none&html=none`, data.key, { method: "GET" });
    return {
      status: String(j.status ?? "PENDING"),
      resultJson: JSON.stringify(j.result ?? j.result_json ?? null),
      error: j.error ? `${j.error.code ?? ""} ${j.error.message ?? ""}`.trim() : "",
      streamingUrl: String(j.streaming_url ?? j.streamingUrl ?? ""),
      stepCount: Number(j.num_of_steps ?? (j.steps ?? []).length ?? 0),
      // The agent's own description of each step, e.g. "Extract school data from search results page".
      steps: ((j.steps ?? []) as any[])
        .filter((s) => s?.action)
        .slice(-4)
        .map((s) => ({ id: String(s.id ?? s.timestamp), action: String(s.action).slice(0, 200), at: String(s.timestamp ?? "") })),
    };
  });

export const tfRunCancel = createServerFn({ method: "POST" })
  .inputValidator((d) => keyed.extend({ runId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await tf(`${AGENT}/v1/runs/${encodeURIComponent(data.runId)}/cancel`, data.key, { method: "POST" });
    return { ok: true };
  });

export const tfMonitorCreate = createServerFn({ method: "POST" })
  .inputValidator((d) => keyed.extend({ url: z.string().url(), name: z.string(), purpose: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const j = await tf(`${AGENT}/v1/monitors`, data.key, {
      method: "POST",
      body: JSON.stringify({
        type: "fetch",
        name: data.name.slice(0, 120),
        config: { url: data.url, format: "markdown" },
        schedule_cron: "0 8 * * *",
        purpose: data.purpose.slice(0, 500),
      }),
    });
    return { id: String(j.monitor?.id ?? ""), text: monitorText(j.run) };
  });

// Run-now responses carry page content but no outcome/diff (those come only via scheduled webhooks),
// so the client compares this text with the previous snapshot.
const monitorText = (run: any) => String(run?.results?.[0]?.text ?? "").slice(0, 20000);

export const tfMonitorRun = createServerFn({ method: "POST" })
  .inputValidator((d) => keyed.extend({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const j = await tf(`${AGENT}/v1/monitors/${encodeURIComponent(data.id)}/runs`, data.key, { method: "POST" });
    const run = j.run ?? {};
    return {
      outcome: String(run.outcome ?? ""),
      diff: String(run.diff ?? "").slice(0, 3000),
      text: monitorText(run),
      error: String(run.errors?.[0]?.error ?? ""),
    };
  });

export const tfMonitorDelete = createServerFn({ method: "POST" })
  .inputValidator((d) => keyed.extend({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await tf(`${AGENT}/v1/monitors/${encodeURIComponent(data.id)}`, data.key, { method: "DELETE" });
    return { ok: true };
  });

const BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  grok: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export const aiSummarize = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        provider: z.enum(["openai", "gemini", "grok", "groq", "openrouter"]),
        key: z.string().min(5),
        model: z.string().min(1),
        records: z.string().max(60000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const res = await fetch(`${BASES[data.provider]}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.key}`, "Content-Type": "application/json", "X-Title": "SiteSpy" },
      body: JSON.stringify({
        model: data.model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              "You write a due-diligence brief for a property buyer. Use ONLY the JSON records given. Never add facts, numbers or dates that are not in the records.",
              "Reply with ONLY a JSON object, no prose and no code fences, in exactly this shape:",
              '{"headline":"One sentence on what matters most for this property.","items":[{"section":"permits","finding":"One or two plain sentences about what the records show.","sources":["https://exact source_url from the records"]}],"verify":["A short instruction for something the buyer must check by hand."]}',
              'Rules: one item per section in the records, using the section keys exactly (permits, zoning, tax, flood, violations, schools). For a section with status not_found or unavailable, say plainly that no record was found or the source could not be read, give an empty sources list, and add a matching verify entry. Every URL in sources must be copied exactly from a record\'s source_url. Do not put URLs or status labels inside finding. At most 140 words in total. Do not use em dashes.',
            ].join("\n"),
          },
          { role: "user", content: data.records },
        ],
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`AI provider ${res.status}: ${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    return { text: String(j.choices?.[0]?.message?.content ?? ""), model: String(j.model ?? data.model) };
  });
