import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

/** The current path, with old /sets and /sets/<id> URLs rewritten in place to their Places equivalents. */
function currentPath() {
  const legacy = location.pathname.match(/^\/sets(\/[^/]+)?\/?$/);
  if (legacy) history.replaceState(null, '', `/places${legacy[1] ?? ''}${location.search}`);
  return location.pathname;
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
  history.pushState(null, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
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
