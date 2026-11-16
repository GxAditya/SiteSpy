import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, ExternalLink, MonitorPlay, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SectionKey } from "@/lib/dossier-core";
import { StepTicker } from "./StepTicker";

export interface LiveStream {
  key: SectionKey;
  label: string;
  site: string;
  url: string;
  step?: { id: string; action: string } | undefined;
}

/**
 * Picture-in-picture view of the TinyFish agent's browser, in this tab. It collapses to its header
 * (the iframe stays mounted, so expanding again doesn't reconnect) and switches between running agents.
 */
export function LiveDock({
  streams,
  active,
  onSelect,
  onClose,
}: {
  streams: LiveStream[];
  active: SectionKey;
  onSelect: (k: SectionKey) => void;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  const stream = streams.find((s) => s.key === active);
  const [lastLabel, setLastLabel] = useState(stream?.label ?? "");

  useEffect(() => {
    if (stream) setLastLabel(stream.label);
    // The watched agent finished: follow another running one if there is one.
    else if (streams[0]) onSelect(streams[0].key);
  }, [stream, streams, onSelect]);

  // Portaled to <body>: the page wrapper's entrance transform would otherwise anchor `position: fixed` to it.
  return createPortal(
    <aside className="live-dock no-print" aria-label="Live agent browser">
      <header className="flex items-center gap-3 px-4 py-3">
        {stream ? <span className="live-dot" aria-hidden="true" /> : <MonitorPlay size={16} className="text-muted-foreground" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{stream ? `Live: ${stream.label}` : `${lastLabel} finished`}</p>
          {stream?.step ? (
            <StepTicker id={stream.key + stream.step.id} text={stream.step.action} className="text-xs text-muted-foreground" />
          ) : (
            <p className="truncate text-xs text-muted-foreground">{stream ? stream.site : "Its records are in the report below."}</p>
          )}
        </div>
        {stream && (
          <Button asChild size="icon" variant="ghost" className="press size-8" title="Open the live view in a new tab">
            <a href={stream.url} target="_blank" rel="noreferrer" aria-label="Open the live view in a new tab">
              <ExternalLink />
            </a>
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="press size-8"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand live view" : "Collapse live view"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </Button>
        <Button size="icon" variant="ghost" className="press size-8" onClick={onClose} aria-label="Close live view" title="Close">
          <X />
        </Button>
      </header>
      <div className="dock-body" data-collapsed={collapsed}>
        <div>
          {streams.length > 1 && (
            <div className="flex gap-1 overflow-x-auto px-3 pb-2" role="tablist" aria-label="Running agents">
              {streams.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={s.key === active}
                  onClick={() => onSelect(s.key)}
                  className={`press shrink-0 rounded-full px-3 py-1 text-xs font-medium ${s.key === active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="dock-screen">
            {stream ? (
              <>
                {loaded !== stream.url && (
                  <p className="absolute inset-0 grid place-items-center text-sm text-paper/80">Connecting to the agent's browser…</p>
                )}
                <iframe
                  key={stream.url}
                  src={stream.url}
                  title={`TinyFish agent browser: ${stream.label}`}
                  data-loaded={loaded === stream.url}
                  onLoad={() => setLoaded(stream.url)}
                  referrerPolicy="no-referrer"
                />
              </>
            ) : (
              <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-paper/80">No agent is running right now.</p>
            )}
          </div>
        </div>
      </div>
    </aside>,
    document.body,
  );
}
