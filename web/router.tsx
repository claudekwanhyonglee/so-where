import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

/** The current path, with old /sets and /sets/<id> URLs rewritten in place to their Places equivalents. */
function currentPath() {
  const legacy = location.pathname.match(/^\/sets(\/[^/]+)?\/?$/);
  if (legacy) history.replaceState(history.state, '', `/places${legacy[1] ?? ''}${location.search}`);
  return location.pathname;
}

// Scrolling: a new page opens at the top, and Back and Forward put each page back where it was. The browser can't do
// the second itself, as a page's content loads after it's shown: each history entry gets a key, and the scroll
// position is remembered under the page's key as it's left.
history.scrollRestoration = 'manual';
const newKey = () => Math.random().toString(36).slice(2);
const entryKey = (): string => {
  const key = (history.state as { key?: string } | null)?.key;
  if (key) return key;
  history.replaceState({ ...history.state, key: newKey() }, '');
  return entryKey();
};
const scrolledTo = new Map<string, number>();
let shownKey = entryKey();
/** Remembers where the page being left was scrolled to, and makes `key` the page shown. */
function leaveFor(key: string) {
  scrolledTo.set(shownKey, scrollY);
  shownKey = key;
  restoring++; // stop putting back the page being left
}
addEventListener('popstate', (e) => {
  if (!e.isTrusted) return; // `navigate`'s own
  leaveFor(entryKey()); // Back or Forward: the browser hasn't scrolled, so scrollY is still the page being left's
  restoreScroll(scrolledTo.get(shownKey) ?? 0);
});

let restoring = 0;
/**
 * Scrolls to `y` once the page has changed over, and keeps it there for a few frames while the new page settles,
 * trying again each frame (for up to a second) while the page is still too short to get there.
 */
function restoreScroll(y: number) {
  const run = ++restoring;
  const giveUpAt = performance.now() + 1000;
  let framesThere = 0;
  const attempt = () => {
    if (run !== restoring) return;
    scrollTo(0, y);
    framesThere = Math.abs(scrollY - y) <= 1 ? framesThere + 1 : 0;
    if (framesThere < 3 && performance.now() < giveUpAt) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
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
  const key = newKey();
  leaveFor(key);
  history.pushState({ key }, '', to);
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
