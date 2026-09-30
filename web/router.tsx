import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

/** The current path, with old /sets and /sets/<id> URLs rewritten in place to their Places equivalents. */
function currentPath() {
  const legacy = location.pathname.match(/^\/sets(\/[^/]+)?\/?$/);
  if (legacy) history.replaceState(history.state, '', `/places${legacy[1] ?? ''}${location.search}`);
  return location.pathname;
}

// Scrolling: a new page opens at the top, and Back and Forward put each page back where it was. The browser can't do
// the second itself, as a page's content loads after it's shown: each history entry gets a key, and its scroll
// position is remembered under that key.
history.scrollRestoration = 'manual';
const newKey = () => Math.random().toString(36).slice(2);
const entryKey = (): string => {
  const key = (history.state as { key?: string } | null)?.key;
  if (key) return key;
  history.replaceState({ ...history.state, key: newKey() }, '');
  return entryKey();
};
const scrolledTo = new Map<string, number>();
addEventListener('scroll', () => scrolledTo.set(entryKey(), scrollY), { passive: true });
addEventListener('popstate', (e) => {
  if (e.isTrusted) restoreScroll(scrolledTo.get(entryKey()) ?? 0); // Back or Forward, not `navigate`
});

/** Scrolls to `y`, trying again each frame (for up to a second) while the page is still too short to get there. */
function restoreScroll(y: number) {
  const giveUpAt = performance.now() + 1000;
  const attempt = () => {
    scrollTo(0, y);
    if (Math.abs(scrollY - y) > 1 && performance.now() < giveUpAt) requestAnimationFrame(attempt);
  };
  attempt();
}

export function usePath() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    addEventListener('popstate', onChange);
    return () => removeEventListener('popstate', onChange);
  }, []);
  return path;
}

export function navigate(to: string) {
  history.pushState({ key: newKey() }, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
  scrollTo(0, 0);
}

export function Link({ to, ...props }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      {...props}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}
