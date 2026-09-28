import { startTransition, useEffect, useState } from 'react';

/**
 * Calls `load` now and every `ms` while mounted; calls it afresh whenever `load` changes.
 * Only results that differ from the last one are kept, and they land in a transition,
 * so <ViewTransition>s animate what changed (and nothing runs when nothing did).
 */
export function usePolling<T>(load: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    let last = '';
    const tick = () =>
      load().then(
        (d) => {
          const json = JSON.stringify(d);
          if (!alive || json === last) return;
          last = json;
          startTransition(() => setData(d));
        },
        () => undefined,
      );
    tick();
    const timer = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load, ms]);
  return data;
}
