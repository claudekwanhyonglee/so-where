import { Ban, ChevronLeft, Copy, Map as MapIcon, Share2, TramFront } from 'lucide-react';
import { startTransition, useCallback, useEffect, useRef, useState, ViewTransition } from 'react';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from './api.ts';
import { Leaderboard, type Board } from './Leaderboard.tsx';
import type { Me } from './App.tsx';
import { HomeSheet } from './HomeSheet.tsx';
import { googleMapsUrl, plural, swatch, transitDirectionsUrl, transitPill, type TransitAnswer } from './model.ts';
import { Link } from './router.tsx';
import { Avatar, Button, Card, DESKTOP_QUERY, Eyebrow, Notice, Sheet, inputBox } from './ui.tsx';
import { usePolling } from './usePolling.ts';

export type CardPlace = { id: number; name: string; suburb: string | null; note: string; key: string; lat: number | null; lng: number | null };
type Member = { id: number; name: string };
type SessionInfo = { id: string; setName: string; members: Member[]; sharePath: string };
type PairResponse = { pair: CardPlace[] | null; picks: number };

const INFO_POLL_MS = 3000;
const BOARD_POLL_MS = 2000;


/** `api` for calls about this session: a 404 means someone deleted it. */
type SessionApi = <T>(path: string, init?: Parameters<typeof api>[1]) => Promise<T>;

export function SessionPage({ id, me, onHomeSaved, askForHome }: { id: string; me: Me; onHomeSaved: () => void; askForHome: boolean }) {
  const [deleted, setDeleted] = useState(false);
  // Asked once per visit: "Not now" (or saving) closes it until they open a session again.
  const [askingForHome, setAskingForHome] = useState(askForHome);
  const call = useCallback(
    <T,>(path: string, init?: Parameters<typeof api>[1]) =>
      api<T>(path, init).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) setDeleted(true);
        throw err;
      }),
    [],
  );
  if (deleted) return <SessionDeleted />;
  return (
    <>
      <LiveSession id={id} meId={me.id} home={me.home} call={call} />
      {askingForHome && <HomeSheet me={me} onSaved={onHomeSaved} close={() => setAskingForHome(false)} offerNotNow />}
    </>
  );
}

function SessionDeleted() {
  return (
    <Card className="flex flex-col items-center gap-2.5 py-8 text-center">
      <b>This session was deleted</b>
      <span className="text-muted">Start a new one to keep picking.</span>
      <Link to="/" className="font-bold text-tomato underline">
        Back to Home
      </Link>
    </Card>
  );
}

function LiveSession({ id, meId, home, call }: { id: string; meId: number; home: Me['home']; call: SessionApi }) {
  const info = usePolling(useCallback(() => call<SessionInfo>(`/sessions/${id}`), [id, call]), INFO_POLL_MS);
  // `version` changes whenever this device picks, so the board refreshes straight away too.
  const [version, setVersion] = useState(0);
  const board = usePolling(useCallback(() => call<Board>(`/sessions/${id}/leaderboard?v=${version}`), [id, version, call]), BOARD_POLL_MS);
  const [view, setView] = useState<'pick' | 'board'>('pick');
  const [sharing, setSharing] = useState(false);
  if (!info) return null;

  const link = `${location.origin}${info.sharePath}`;
  const share = async () => {
    if (navigator.share) {
      try {
        return await navigator.share({ title: 'So Where?', text: `Help pick where we eat from ${info.setName}`, url: link });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return; // they closed the share sheet
      }
    }
    setSharing(true);
  };
  const shownOnPhone = (v: typeof view) => `min-w-0 ${view === v ? '' : 'hidden desk:block'}`;

  return (
    <>
      <SessionHeader info={info} onShare={share} />
      <div role="group" aria-label="Session view" className="flex gap-0.5 rounded-full bg-soft p-[3px] desk:hidden">
        {(['pick', 'board'] as const).map((v) => (
          <button
            key={v}
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className="flex-1 rounded-full px-2.5 py-[7px] text-[13px] font-semibold text-muted aria-pressed:bg-white aria-pressed:text-ink aria-pressed:shadow-[0_2px_6px_-2px_rgba(42,23,18,.25)]"
          >
            {v === 'pick' ? 'Pick' : 'Leaderboard'}
          </button>
        ))}
      </div>
      {info.members.length === 1 && <SoloBanner onShare={share} />}
      <div className="grid gap-5 desk:grid-cols-[minmax(0,1fr)_340px] desk:items-start">
        <div className={shownOnPhone('pick')}>
          <Picker sessionId={id} home={home} call={call} onChanged={() => setVersion((v) => v + 1)} />
        </div>
        <div className={`desk:sticky desk:top-4 ${shownOnPhone('board')}`}>
          <Leaderboard board={board} />
        </div>
      </div>
      {sharing && <ShareSheet link={link} members={info.members} board={board} meId={meId} onClose={() => setSharing(false)} />}
    </>
  );
}

function SessionHeader({ info, onShare }: { info: SessionInfo; onShare: () => void }) {
  return (
    <header className="flex items-center gap-2.5">
      <Link to="/" aria-label="Back" className="grid size-[38px] flex-none place-items-center rounded-full bg-white ring-1 ring-edge desk:hidden">
        <ChevronLeft size={18} aria-hidden="true" />
      </Link>
      <div className="min-w-0 flex-1">
        <Eyebrow>Picking from</Eyebrow>
        <h1 className="truncate font-display text-2xl/tight desk:text-3xl/tight">{info.setName}</h1>
      </div>
      <ul aria-label="Who's here" className="flex [&>*+*]:-ml-2">
        {info.members.map((m) => (
          <li key={m.id}>
            <Avatar person={m} />
            <span className="sr-only">{m.name}</span>
          </li>
        ))}
      </ul>
      <Button aria-label="Share" onClick={onShare} className="size-[38px] !p-0 desk:size-auto desk:!px-[18px] desk:!py-[11px]">
        <Share2 size={18} aria-hidden="true" />
        <span className="hidden desk:inline">Share link</span>
      </Button>
    </header>
  );
}

function SoloBanner({ onShare }: { onShare: () => void }) {
  return (
    <section aria-label="Just you so far" className="flex items-center gap-3 rounded-[18px] bg-white px-3.5 py-3 text-sm ring-1 ring-edge">
      <Share2 size={18} className="flex-none" aria-hidden="true" />
      <span className="flex-1">Just you so far. Share the link so friends can pick too.</span>
      <button onClick={onShare} className="rounded-xl bg-soft px-3 py-2 text-[13px] font-bold">
        Share
      </button>
    </section>
  );
}

function ShareSheet({ link, members, board, meId, onClose }: { link: string; members: Member[]; board: Board | null; meId: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const copy = () =>
    navigator.clipboard.writeText(link).then(
      () => {
        setCopied(true);
        toast('Link copied');
      },
      () => input.current?.select(), // no clipboard access: select it for a manual copy
    );
  const picksOf = (id: number) => board?.people.find((p) => p.id === id)?.picks ?? 0;

  return (
    <Sheet title="Invite your group" onClose={onClose}>
      <p className="text-muted">Anyone with this link can join and pick on their own phone. Share it only with your group.</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="share-link" className="text-[13px] font-bold">
          Share link
        </label>
        <div className={`flex items-center gap-2 !py-1 !pr-1 focus-within:ring-2 focus-within:ring-tomato ${inputBox}`}>
          <input ref={input} id="share-link" readOnly value={link} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 bg-transparent py-2 outline-none" />
          <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-xl bg-soft px-3 py-2 text-[13px] font-bold whitespace-nowrap">
            <Copy size={16} aria-hidden="true" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <Eyebrow>Here now</Eyebrow>
      <ul className="flex flex-col divide-y divide-divider rounded-[22px] bg-white ring-1 ring-edge">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-3.5 py-3">
            <Avatar person={m} />
            <b className="min-w-0 flex-1 truncate">
              {m.name}
              {m.id === meId && ' (you)'}
            </b>
            <small className="text-muted">{plural(picksOf(m.id), 'pick')}</small>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PICK_FEEDBACK_MS = 280;
const TIE_FEEDBACK_MS = 120;
const MILESTONES: Record<number, string> = { 10: '10 picks! Your top 3 is taking shape.', 25: '25 picks. You really care about dinner.' };

function Picker({ sessionId, home, call, onChanged }: { sessionId: string; home: Me['home']; call: SessionApi; onChanged: () => void }) {
  const [state, setState] = useState<PairResponse | null>(null);
  const [chosen, setChosen] = useState<number | 'tie' | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const base = `/sessions/${sessionId}`;

  useEffect(() => {
    call<PairResponse>(`${base}/pair`).then(setState, (err) => setError(errorMessage(err)));
  }, [base, call]);

  /** Swaps in the next pair as a view transition: the old pair fades, the new one slides in. */
  const show = (next: PairResponse) => {
    startTransition(() => {
      setState(next);
      setChosen(null);
    });
    onChanged();
  };

  /** One answer at a time; `feedbackMs` lets the chosen card linger before the next pair. */
  const answer = async (request: () => Promise<PairResponse>, feedbackMs = 0) => {
    if (busy.current) return null;
    busy.current = true;
    setError('');
    try {
      const [next] = await Promise.all([request(), wait(feedbackMs)]);
      show(next);
      return next;
    } catch (err) {
      setError(errorMessage(err));
      setChosen(null);
      return null;
    } finally {
      busy.current = false;
    }
  };

  const pair = state?.pair;
  const choose = async (winner: number | null) => {
    if (!pair) return;
    setChosen(winner ?? 'tie');
    const next = await answer(() => call<PairResponse>(`${base}/picks`, { body: { a: pair[0].id, b: pair[1].id, winner } }), winner === null ? TIE_FEEDBACK_MS : PICK_FEEDBACK_MS);
    if (next && MILESTONES[next.picks]) toast(MILESTONES[next.picks]);
  };
  const undoVeto = (place: CardPlace) => call<PairResponse>(`${base}/vetoes/${place.id}`, { method: 'DELETE' }).then(show, (err) => setError(errorMessage(err)));
  const veto = async (place: CardPlace) => {
    const next = await answer(() => call<PairResponse>(`${base}/vetoes`, { body: { placeId: place.id } }));
    if (next) toast(`${place.name} is out for tonight`, { action: { label: 'Undo', onClick: () => void undoVeto(place) } });
  };

  useDesktopPickKeys(pair ? { left: () => choose(pair[0].id), right: () => choose(pair[1].id), tie: () => choose(null) } : null);

  if (!state) return null;
  const cardState = (id: number) => (chosen === null ? 'idle' : chosen === id ? 'chosen' : 'lost');

  return (
    <section aria-label="Pick" className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-muted">
          <span className="desk:hidden">Tap</span>
          <span className="hidden desk:inline">Click</span> the one you'd rather
        </span>
        <span className="font-semibold tabular-nums">{plural(state.picks, 'pick')}</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {pair ? (
        <>
          <ViewTransition key={`${pair[0].id}-${pair[1].id}-${state.picks}`} enter="pair-enter" exit="pair-exit">
            <div className="flex flex-col desk:flex-row">
              <PlaceCard sessionId={sessionId} home={home} place={pair[0]} position="first" state={cardState(pair[0].id)} onPick={() => choose(pair[0].id)} onVeto={() => veto(pair[0])} />
              <span aria-hidden="true" className="pointer-events-none relative z-[2] -my-[17px] grid size-11 place-items-center self-center rounded-full bg-ink text-[13px] font-extrabold tracking-[.04em] text-mustard ring-[5px] ring-peach desk:-mx-[17px] desk:my-0">
                OR
              </span>
              <PlaceCard sessionId={sessionId} home={home} place={pair[1]} position="second" state={cardState(pair[1].id)} onPick={() => choose(pair[1].id)} onVeto={() => veto(pair[1])} />
            </div>
          </ViewTransition>
          <Button variant="secondary" onClick={() => choose(null)} className="self-center">
            Too close to call
          </Button>
        </>
      ) : (
        <Card className="flex flex-col items-center gap-2.5 py-8 text-center">
          <span aria-hidden="true" className="grid size-[76px] -rotate-6 place-items-center rounded-[26px] bg-mustard font-display text-[34px]">
            ?
          </span>
          <b>Not enough places left to compare</b>
          <span className="text-muted">Add places to this set, or undo an "Absolutely not".</span>
        </Card>
      )}
    </section>
  );
}

/** ← and → pick the left and right card, ↓ calls a tie: desktops only, and not while typing or in a sheet. */
function useDesktopPickKeys(actions: { left: () => void; right: () => void; tie: () => void } | null) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const act = latest.current;
      if (!act || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !matchMedia(DESKTOP_QUERY).matches) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], dialog')) return;
      if (document.querySelector('dialog[open]')) return;
      const key = { ArrowLeft: act.left, ArrowRight: act.right, ArrowDown: act.tie }[e.key];
      if (!key) return;
      e.preventDefault();
      key();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}

function useTransitTime(sessionId: string, placeId: number, homeKey: string) {
  const [answer, setAnswer] = useState<TransitAnswer | null>(null);
  useEffect(() => {
    let alive = true;
    setAnswer(null);
    api<TransitAnswer>(`/sessions/${sessionId}/transit?place=${placeId}`).then(
      (a) => alive && setAnswer(a),
      () => alive && setAnswer({ minutes: null, reason: 'unavailable' }),
    );
    return () => {
      alive = false;
    };
  }, [sessionId, placeId, homeKey]);
  return answer;
}

const cardMotion = {
  idle: 'hover:-translate-y-0.5',
  chosen: 'scale-[1.03] shadow-[0_0_0_4px_var(--color-peach),0_0_0_7px_var(--card),0_22px_36px_-16px_rgba(0,0,0,.35)]',
  lost: 'scale-[.97] opacity-35',
};

function PlaceCard({
  sessionId,
  home,
  place,
  position,
  state,
  onPick,
  onVeto,
}: {
  sessionId: string;
  home: Me['home'];
  place: CardPlace;
  position: 'first' | 'second';
  state: keyof typeof cardMotion;
  onPick: () => void;
  onVeto: () => void;
}) {
  const transit = useTransitTime(sessionId, place.id, home ? `${home.lat},${home.lng}` : ''); // looked up again when home changes
  const shown = transitPill(transit);
  const directions = transitDirectionsUrl(place, home?.address);
  const { bg, fg } = swatch(place.id);
  const pill = fg === '#2a1712' ? 'bg-ink/10 hover:bg-ink/20' : 'bg-white/20 hover:bg-white/30';
  // On phones the OR badge sits on the seam, so the cards make room for it.
  const seam = position === 'first' ? 'pb-8 desk:pb-7' : 'pt-7 desk:pt-7';

  return (
    <article
      style={{ background: bg, color: fg, ['--card' as string]: bg }}
      className={`relative flex min-h-[170px] flex-1 flex-col rounded-[28px] p-[18px] transition-[transform,opacity,box-shadow] duration-200 desk:min-h-[280px] desk:rounded-[34px] desk:p-7 ${seam} ${cardMotion[state]}`}
    >
      <button aria-label={`Pick ${place.name}`} onClick={onPick} className="absolute inset-0 rounded-[inherit]" />
      <button aria-label="Absolutely not" title="Absolutely not" onClick={onVeto} className={`absolute top-3.5 right-3.5 z-10 grid size-9 place-items-center rounded-full ${pill}`}>
        <Ban size={18} aria-hidden="true" />
      </button>
      <div className="pointer-events-none relative flex flex-1 flex-col gap-[5px]">
        <h3 className="pr-10 font-display text-[25px]/[1.08] desk:text-[40px]/[1.08]">{place.name}</h3>
        <span className="opacity-80">{place.suburb ?? 'Suburb unknown'}</span>
        {place.note && <span className="text-sm italic opacity-90">“{place.note}”</span>}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-2 [&>*]:inline-flex [&>*]:items-center [&>*]:gap-[5px] [&>*]:rounded-full [&>*]:px-[11px] [&>*]:py-[5px] [&>*]:text-[13px] [&>*]:font-bold [&>a]:pointer-events-auto">
          {shown === 'time' && (
            <a href={directions} target="_blank" rel="noreferrer" className={pill} title="By public transport from home, leaving now. Opens directions in Google Maps.">
              <TramFront size={16} aria-hidden="true" /> {transit?.minutes} min
            </a>
          )}
          {shown === 'directions' && (
            <a href={directions} target="_blank" rel="noreferrer" className={pill}>
              <TramFront size={16} aria-hidden="true" /> Directions
            </a>
          )}
          <a href={googleMapsUrl(place)} target="_blank" rel="noreferrer" aria-label="Open in Google Maps" className={pill}>
            <MapIcon size={16} aria-hidden="true" /> Maps
          </a>
        </div>
      </div>
    </article>
  );
}
