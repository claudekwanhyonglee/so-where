import { MapPin, Rows2, UserRound, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { api, ApiError } from './api.ts';
import { Home } from './Home.tsx';
import { Places } from './Places.tsx';
import { SessionPage } from './Session.tsx';
import { Profile } from './Profile.tsx';
import { SetPage, Sets } from './Sets.tsx';
import { Link, usePath } from './router.tsx';
import { SignIn } from './SignIn.tsx';
import { Avatar } from './ui.tsx';

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

  return (
    <>
      {me === null && <SignIn onSignedIn={refresh} />}
      {me && (
        <Shell me={me}>
          <Page path={path} me={me} refresh={refresh} />
        </Shell>
      )}
      <Toaster position="bottom-center" offset={{ bottom: 'calc(var(--tabbar-h) + 16px)' }} mobileOffset={{ bottom: 'calc(var(--tabbar-h) + 16px)' }} />
    </>
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

type NavItem = { to: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { to: '/', label: 'Pick', icon: Rows2 },
  { to: '/places', label: 'Places', icon: MapPin },
  { to: '/you', label: 'You', icon: UserRound },
];

/** The nav item a route belongs to: sessions under Pick, sets under Places. */
function activeNav(path: string) {
  if (path.startsWith('/places') || path.startsWith('/sets')) return '/places';
  if (path === '/you') return '/you';
  return '/';
}

function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const active = activeNav(usePath());
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <TopNav me={me} active={active} />
      <main className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-4 px-[18px] pt-[18px] pb-[calc(var(--tabbar-h)+28px)] desk:gap-5 desk:px-8 desk:pt-7 desk:pb-10">
        {children}
      </main>
      <TabBar active={active} />
    </div>
  );
}

function TopNav({ me, active }: { me: Me; active: string }) {
  return (
    <header className="hidden items-center gap-6 border-b border-divider px-7 py-3.5 desk:flex">
      <Link to="/" className="font-display text-[26px]/none text-tomato">
        So Where?
      </Link>
      <nav aria-label="Main" className="flex gap-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            aria-current={active === to ? 'page' : undefined}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 font-semibold text-muted hover:bg-soft hover:text-ink aria-[current=page]:bg-blush aria-[current=page]:text-tomato-deep"
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <span className="ml-auto flex items-center gap-2 font-semibold">
        <Avatar person={me} />
        <span>{me.name}</span>
      </span>
    </header>
  );
}

function TabBar({ active }: { active: string }) {
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-divider bg-white px-2.5 pt-2 pb-[calc(14px+env(safe-area-inset-bottom,0px))] desk:hidden"
    >
      {NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          aria-current={active === to ? 'page' : undefined}
          className="group flex flex-col items-center gap-[3px] text-[11px] font-semibold text-muted aria-[current=page]:text-ink"
        >
          <span className="grid place-items-center rounded-full px-[18px] py-1 group-aria-[current=page]:bg-blush group-aria-[current=page]:text-tomato-deep">
            <Icon size={22} aria-hidden="true" />
          </span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
