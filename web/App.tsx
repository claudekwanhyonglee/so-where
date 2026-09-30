import { MapPin, Rows2, UserRound, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api.ts';
import { Home } from './Home.tsx';
import { Places } from './Places.tsx';
import { SessionPage } from './Session.tsx';
import { Profile } from './Profile.tsx';
import { Link, usePath } from './router.tsx';
import { SignIn, type SignedIn } from './SignIn.tsx';
import { Avatar, Toasts } from './ui.tsx';

export type Me = { id: number; name: string; home: { address: string; lat: number; lng: number; country: string | null } | null; homeSkipped: boolean; guideClosed: boolean };

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
  const homeSkippedOn = useHomeSkippedOn(path);
  const signedIn: SignedIn = (how) => {
    if (how?.skippedHome) homeSkippedOn.set(path);
    refresh();
  };

  return (
    <>
      {me === null && <SignIn onSignedIn={signedIn} />}
      {me && (
        <Shell me={me} fit={path.startsWith('/s/')}>
          <Page path={path} me={me} refresh={refresh} homeJustSkipped={homeSkippedOn.path === path} />
        </Shell>
      )}
      <Toasts />
    </>
  );
}

/**
 * The page someone was on when they skipped the home step at sign-up (a session, if they came from a share link),
 * so that session doesn't ask for a home again straight away. Forgotten as soon as they go elsewhere.
 */
function useHomeSkippedOn(path: string) {
  const [skippedOn, set] = useState<string | null>(null);
  useEffect(() => {
    if (skippedOn !== null && skippedOn !== path) set(null);
  }, [path, skippedOn]);
  return { path: skippedOn, set };
}

function Page({ path, me, refresh, homeJustSkipped }: { path: string; me: Me; refresh: () => void; homeJustSkipped: boolean }) {
  if (path === '/you') return <Profile me={me} onChanged={refresh} onSignedOut={refresh} />;
  const places = path.match(/^\/places(?:\/([^/]+))?$/);
  if (places) return <Places setId={places[1]} />;
  const sessionId = path.match(/^\/s\/([\w-]+)$/)?.[1];
  if (sessionId) return <SessionPage key={sessionId} id={sessionId} me={me} onHomeSaved={refresh} askForHome={me.home === null && !homeJustSkipped} />;
  return <Home me={me} onMeChanged={refresh} />;
}

type NavItem = { to: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { to: '/', label: 'Pick', icon: Rows2 },
  { to: '/places', label: 'Places', icon: MapPin },
  { to: '/you', label: 'You', icon: UserRound },
];

/** The nav item a route belongs to: sessions under Pick, sets under Places. */
function activeNav(path: string) {
  if (path.startsWith('/places')) return '/places';
  if (path === '/you') return '/you';
  return '/';
}

/** The app's frame. `fit`: exactly the screen's height, for a page that scrolls inside itself (the picking screen). */
function Shell({ me, fit, children }: { me: Me; fit: boolean; children: ReactNode }) {
  const active = activeNav(usePath());
  return (
    <div className={`flex flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] ${fit ? 'h-dvh' : 'min-h-dvh'}`}>
      <TopNav me={me} active={active} />
      <main
        className={`mx-auto flex min-h-0 w-full max-w-[1080px] flex-1 flex-col px-[18px] desk:gap-5 desk:px-8 desk:pt-7 desk:pb-10 ${fit ? 'gap-2.5 pt-3 pb-[calc(var(--tabbar-h)+10px)] land:gap-2 land:pt-2.5 land:pb-[calc(var(--tabbar-h)+8px)]' : 'gap-4 pt-[18px] pb-[calc(var(--tabbar-h)+28px)]'}`}
      >
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
      className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-divider bg-white px-2.5 pt-2 pb-[calc(14px+env(safe-area-inset-bottom,0px))] desk:hidden land:h-(--tabbar-h) land:pt-0 land:pb-[env(safe-area-inset-bottom,0px)]"
    >
      {NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          aria-current={active === to ? 'page' : undefined}
          className="group flex flex-col items-center gap-[3px] text-[11px] font-semibold text-muted aria-[current=page]:text-ink land:flex-row land:justify-center land:gap-1.5 land:text-[12.5px]"
        >
          <span className="grid place-items-center rounded-full px-[18px] py-1 group-aria-[current=page]:bg-blush group-aria-[current=page]:text-tomato-deep land:px-2.5 land:py-0.5">
            <Icon size={22} aria-hidden="true" className="land:size-[18px]" />
          </span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
