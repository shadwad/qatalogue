import React, { useEffect, useRef, useState } from 'react';

/**
 * A switch that shows its new value at once and applies it after the next paint.
 * The view behind it can show its loading message while `switching`, so a slow render never holds the switch back.
 */
export function usePendingSwitch<T>(current: T, apply: (next: T) => void) {
  const [pending, setPending] = useState<T | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (pending === null) return;
    if (pending === current) { setPending(null); return; }
    // Two frames: the first paints the switch and the loading message, the second starts the slower work.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => React.startTransition(() => applyRef.current(pending)));
    });
    return () => cancelAnimationFrame(frame);
  }, [pending, current]);

  const shown = pending ?? current;
  return {
    shown,
    switching: pending !== null && pending !== current,
    select: (next: T) => { if (next !== shown) setPending(next); },
  };
}
