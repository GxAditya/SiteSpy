import { useEffect, useRef, useState } from "react";

interface Line {
  id: string;
  text: string;
}

/**
 * One line that always shows the agent's latest action. When a new step arrives it slides in from below
 * while the previous one leaves upward, so a change is noticed without reading every poll.
 */
export function StepTicker({ id, text, className = "" }: Line & { className?: string }) {
  const [shown, setShown] = useState<Line>({ id, text });
  const [leaving, setLeaving] = useState<Line | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (id === shown.id) return;
    setLeaving(shown);
    setShown({ id, text });
    first.current = false;
    const t = setTimeout(() => setLeaving(null), 240);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className={`step-ticker ${className}`} aria-live="polite" aria-atomic="true">
      {leaving && (
        <p key={`out-${leaving.id}`} className="step-out line-clamp-2" aria-hidden="true">
          {leaving.text}
        </p>
      )}
      <p key={`in-${shown.id}`} className={`line-clamp-2 ${first.current ? "" : "step-in"}`} title={shown.text}>
        {shown.text}
      </p>
    </div>
  );
}
