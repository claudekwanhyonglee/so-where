import { useEffect, useState } from 'react';

/** Calls `load` now and every `ms` while mounted; calls it afresh whenever `load` changes. */
export function usePolling<T>(load: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => load().then((d) => alive && setData(d), () => undefined);
    tick();
    const timer = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load, ms]);
  return data;
}
