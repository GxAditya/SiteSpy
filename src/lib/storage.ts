// Browser-only persistence. Call these from effects or event handlers, never during render.
import type { Dossier, RecordChange, SectionKey, DossierRecord, Place } from "./dossier-core";

export type Provider = "openai" | "gemini" | "grok" | "groq" | "openrouter";

export interface Settings {
  tinyfishKey: string;
  provider: Provider | "none";
  aiKey: string;
  model: string;
  openrouterFree: boolean;
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  grok: "grok-3-mini",
  groq: "llama-3.3-70b-versatile",
  openrouter: "openrouter/auto",
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  grok: "xAI Grok",
  groq: "Groq",
  openrouter: "OpenRouter",
};

const K = { settings: "sitespy.settings", dossiers: "sitespy.dossiers", watches: "sitespy.watches" };

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  localStorage.setItem(k, JSON.stringify(v));
}

export function loadSettings(): Settings {
  return read<Settings>(K.settings, { tinyfishKey: "", provider: "none", aiKey: "", model: "", openrouterFree: true });
}
export function saveSettings(s: Settings) {
  write(K.settings, s);
}

/** The model actually sent to the provider. OpenRouter free switch uses its built-in free router. */
export function effectiveModel(s: Settings): string {
  if (s.provider === "none") return "";
  if (s.provider === "openrouter" && s.openrouterFree) return "openrouter/free";
  return s.model.trim() || DEFAULT_MODELS[s.provider];
}

export function loadDossier(q: string): Dossier | null {
  return read<Record<string, Dossier>>(K.dossiers, {})[q.toLowerCase()] ?? null;
}
export function saveDossier(d: Dossier) {
  const all = read<Record<string, Dossier>>(K.dossiers, {});
  all[d.query.toLowerCase()] = d;
  const keys = Object.keys(all);
  if (keys.length > 15 && keys[0]) delete all[keys[0]];
  write(K.dossiers, all);
}

// Cross-tab lock so two open tabs never run (and pay for) the same dossier twice. Held while its
// heartbeat is fresh; a closed tab's lock expires on its own.
const LOCK_TTL_MS = 45_000;
// Kept in sessionStorage so a refreshed tab is still the same owner and can resume its own run.
const tabId = (() => {
  try {
    const id = sessionStorage.getItem("sitespy.tab") ?? crypto.randomUUID();
    sessionStorage.setItem("sitespy.tab", id);
    return id;
  } catch {
    return String(Math.random());
  }
})();
const lockKey = (k: string) => `sitespy.lock:${k.toLowerCase()}`;
export function lockHeldElsewhere(k: string): boolean {
  const l = read<{ tab: string; at: number } | null>(lockKey(k), null);
  return Boolean(l && l.tab !== tabId && Date.now() - l.at < LOCK_TTL_MS);
}
export function takeLock(k: string) {
  write(lockKey(k), { tab: tabId, at: Date.now() });
}
export function releaseLock(k: string) {
  if (read<{ tab: string } | null>(lockKey(k), null)?.tab === tabId) localStorage.removeItem(lockKey(k));
}

export interface Watch {
  id: string;
  query: string;
  display: string;
  place?: Place | undefined;
  jurisdiction?: string | undefined;
  createdAt: string;
  lastChecked: string;
  monitors: { section: SectionKey; url: string; monitorId: string; lastText?: string | undefined }[];
  snapshot: Partial<Record<SectionKey, DossierRecord[]>>;
  changes: (RecordChange & { at: string })[];
  pageChanges: { at: string; url: string; outcome: string; diff: string }[];
}

export function loadWatches(): Watch[] {
  return read<Watch[]>(K.watches, []);
}
export function saveWatches(w: Watch[]) {
  write(K.watches, w);
}
