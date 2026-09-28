import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api.ts';
import { Home } from './Home.tsx';
import { Places } from './Places.tsx';
import { SessionPage } from './Session.tsx';
import { Profile } from './Profile.tsx';
import { SetPage, Sets } from './Sets.tsx';
import { Link, usePath } from './router.tsx';
import { SignIn } from './SignIn.tsx';

export type Me = { id: number; name: string; home: { address: string; lat: number; lng: number } | null };

function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const refresh = useCallback(() => {
    api<Me>('/me').then(setMe, (err) => {
      if (err instanceof ApiError && err.status === 401) setMe(null);
      else throw err;
    });
  }, []);
  useEffect(refresh, [refresh]);
  return { me, refresh };
}

export function App() {
  const { me, refresh } = useMe();
  const path = usePath();

  if (me === undefined) return null;
  if (me === null) return <SignIn onSignedIn={refresh} />;

  return (
    <Shell me={me}>
      <Page path={path} me={me} refresh={refresh} />
    </Shell>
  );
}

function Page({ path, me, refresh }: { path: string; me: Me; refresh: () => void }) {
  if (path === '/you') return <Profile me={me} onChanged={refresh} onSignedOut={refresh} />;
  if (path === '/places') return <Places />;
  if (path === '/sets') return <Sets />;
  const setId = path.match(/^\/sets\/([^/]+)$/)?.[1];
  if (setId) return <SetPage key={setId} id={setId} />;
  const sessionId = path.match(/^\/s\/([\w-]+)$/)?.[1];
  if (sessionId) return <SessionPage key={sessionId} id={sessionId} />;
  return <Home me={me} />;
}

const NAV = [
  { to: '/', label: 'Pick' },
  { to: '/places', label: 'Places' },
  { to: '/sets', label: 'Sets' },
  { to: '/you', label: 'You' },
];

function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const path = usePath();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="text-2xl font-black tracking-tight text-orange-600">
          so-where
        </Link>
        <nav className="flex gap-1 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-stone-200">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${path === item.to ? 'bg-orange-600 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <p className="text-sm text-stone-500">Hi, {me.name}</p>
      <main className="flex flex-col gap-4">{children}</main>
    </div>
  );
}

