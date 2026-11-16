import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Sparkles, Save, ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_MODELS, PROVIDER_LABELS, effectiveModel, loadSettings, saveSettings, type Provider, type Settings } from "@/lib/storage";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings | SiteSpy" },
      { name: "description", content: "Add your TinyFish key and optionally an AI provider key. Keys stay in your browser." },
      { property: "og:title", content: "Settings | SiteSpy" },
      { property: "og:description", content: "Bring your own TinyFish and AI keys." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

const PROVIDERS: (Provider | "none")[] = ["none", "openai", "gemini", "grok", "groq", "openrouter"];

function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => setS(loadSettings()), []);
  if (!s) return null;
  const set = (p: Partial<Settings>) => setS({ ...s, ...p });

  return (
    <main className="workspace">
      <header className="page-heading"><span className="stamp text-emerald">Your workspace</span><h1 className="mt-3">API settings</h1><p>Your keys. Your browser. No account required.</p></header>

      <section className="settings-row">
        <div><span className="section-icon"><KeyRound size={22} /></span><h2 className="mt-4 text-xl font-medium">TinyFish</h2><p className="mt-2 text-sm text-muted-foreground">Required for live property records.</p></div><div>
        <p className="mt-1 text-sm text-muted-foreground">
          Get a key at <a className="inline-flex items-center gap-1 text-primary underline underline-offset-4" href="https://agent.tinyfish.ai/api-keys" target="_blank" rel="noreferrer">TinyFish <ExternalLink size={13} /></a>.
        </p>
        <label htmlFor="tinyfish-key" className="mt-5 block text-sm font-medium">API key</label><Input id="tinyfish-key" type="password" className="mt-2 h-12 font-mono" value={s.tinyfishKey} onChange={(e) => set({ tinyfishKey: e.target.value.trim() })} placeholder="sk-tinyfish-…" /><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={14} /> Saved only in this browser.</p></div>
      </section>

      <section className="settings-row">
        <div><span className="section-icon bg-accent text-primary"><Sparkles size={22} /></span><h2 className="mt-4 text-xl font-medium">AI summary</h2><p className="mt-2 text-sm text-muted-foreground">Optional · Bring your own provider.</p></div><div>
        <p className="mt-1 text-sm text-muted-foreground">Writes a short brief from the records already found. It never adds records.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <Button type="button" variant="outline" key={p} aria-pressed={s.provider === p} onClick={() => set({ provider: p, model: "" })}
              className={`rounded-full border px-4 py-1.5 text-sm ${s.provider === p ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent"}`}>
              {p === "none" ? "Off" : PROVIDER_LABELS[p]}
            </Button>
          ))}
        </div>
        {s.provider !== "none" && (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium" htmlFor="ai-key">Provider API key</label><Input id="ai-key" type="password" className="h-12 font-mono" value={s.aiKey} onChange={(e) => set({ aiKey: e.target.value.trim() })} placeholder={`${PROVIDER_LABELS[s.provider]} API key`} />
            {s.provider === "openrouter" && (
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={s.openrouterFree} onCheckedChange={(v) => set({ openrouterFree: v })} />
                Free models only. OpenRouter picks an available free model automatically
              </label>
            )}
            {!(s.provider === "openrouter" && s.openrouterFree) && (
              <Input aria-label="AI model" className="h-12 font-mono" value={s.model} onChange={(e) => set({ model: e.target.value })} placeholder={`Model (default ${DEFAULT_MODELS[s.provider]})`} />
            )}
            <p className="stamp text-muted-foreground">Model used: {effectiveModel(s)}</p>
          </div>
        )}
      </div></section>

      <Button className="mt-8" size="lg" onClick={() => { saveSettings(s); toast.success("Saved in this browser"); }}><Save /> Save settings</Button>
    </main>
  );
}
