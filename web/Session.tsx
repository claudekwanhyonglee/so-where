import { Ban, ChevronLeft, Copy, Map as MapIcon, Share2, TramFront } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from './api.ts';
import { Leaderboard, type Board } from './Leaderboard.tsx';
import { RuledOut, vetoesIn, type RuledOutPlace } from './RuledOut.tsx';
import type { Me } from './App.tsx';
import { HomeSheet } from './HomeSheet.tsx';
import { googleMapsUrl, plural, swatch, transitDirectionsUrl, transitPill, type TransitAnswer } from './model.ts';
import { Link } from './router.tsx';
import { joinedNews, vetoNews } from './session-news.ts';
import { Avatar, Button, Card, DESKTOP_QUERY, Eyebrow, Notice, notify, Sheet, inputBox, useIsDesktop } from './ui.tsx';
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
  useSessionNews(info, board, meId);
  const [view, setView] = useState<'pick' | 'board'>('pick');
  const [sharing, setSharing] = useState(false);
  const [picks, setPicks] = useState<number | null>(null);
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
  const shownOnPhone = (v: typeof view) => `min-h-0 min-w-0 ${view === v ? '' : 'hidden desk:block'}`;

  return (
    <>
      <SessionHeader info={info} picks={picks} onShare={share}>
        <ViewToggle view={view} onChange={setView} />
      </SessionHeader>
      {info.members.length === 1 && <SoloBanner onShare={share} />}
      {/* The screen never scrolls: each column scrolls inside itself. */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-5 desk:grid-cols-[minmax(0,1fr)_340px]">
        <div className={shownOnPhone('pick')}>
          <Picker sessionId={id} home={home} meId={meId} board={board} call={call} onChanged={() => setVersion((v) => v + 1)} onPicks={setPicks} />
        </div>
        {/* Padded so the top card's stamp and rings aren't clipped by the scrolling. */}
        <div className={`relative -mx-2 overflow-y-auto px-2 ${shownOnPhone('board')}`}>
          <Leaderboard board={board} />
        </div>
      </div>
      {sharing && <ShareSheet link={link} members={info.members} board={board} meId={meId} onClose={() => setSharing(false)} />}
    </>
  );
}

/** Toasts for who joins, and what others rule out or bring back, while you're here (not for what was so before). */
function useSessionNews(info: SessionInfo | null, board: Board | null, meId: number) {
  const members = useRef<Member[] | null>(null);
  const rows = useRef<Board['combined'] | null>(null);
  useEffect(() => {
    if (!info) return;
    joinedNews(members.current, info.members, meId).forEach((news) => notify(news));
    members.current = info.members;
  }, [info, meId]);
  useEffect(() => {
    if (!board) return;
    vetoNews(rows.current, board.combined, board.people, meId).forEach((news) => notify(news));
    rows.current = board.combined;
  }, [board, meId]);
}

/** Upright phones show this many faces in the header, then "+N", so the set name keeps its room. */
const FACES_ON_PORTRAIT = 3;

/**
 * The set being picked from, who's here and Share. On phones it also holds the Pick/Leaderboard toggle (`children`)
 * and your pick count; desktops show the count above the cards instead. Upright, the name shares the top row only
 * with Back and Share, the count sits on the "Picking from" line, and the toggle and faces go on a second row.
 * Sideways, it's all one row, with the count next to the name.
 */
function SessionHeader({ info, picks, onShare, children }: { info: SessionInfo; picks: number | null; onShare: () => void; children: ReactNode }) {
  const desktop = useIsDesktop();
  const count = picks === null || desktop ? null : plural(picks, 'pick');
  const hiddenOnPortrait = info.members.length - FACES_ON_PORTRAIT;
  return (
    <header className="flex items-center gap-2.5 port:flex-wrap port:gap-y-0">
      <span aria-hidden="true" className="order-1 hidden h-2.5 basis-full port:block" />
      <Link to="/" aria-label="Back" className="grid size-[38px] flex-none place-items-center rounded-full bg-white ring-1 ring-edge desk:hidden land:size-[34px]">
        <ChevronLeft size={18} aria-hidden="true" />
      </Link>
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,max-content)_1fr] items-baseline gap-x-1.5 [grid-template-areas:'eyebrow_count'_'name_name'] land:gap-x-2 land:[grid-template-areas:'eyebrow_eyebrow'_'name_count']">
        <span className="whitespace-nowrap [grid-area:eyebrow]">
          <Eyebrow>Picking from</Eyebrow>
        </span>
        <h1 className="truncate font-display text-2xl/tight [grid-area:name] desk:text-3xl/tight land:text-xl/tight">{info.setName}</h1>
        {count && (
          <small className="text-[11px] font-bold tracking-[.07em] whitespace-nowrap text-muted uppercase tabular-nums [grid-area:count] before:content-['·_'] land:text-xs land:tracking-normal land:normal-case land:before:content-none">
            {count}
          </small>
        )}
      </div>
      {children}
      <ul aria-label="Who's here" className="flex flex-none port:order-3 [&>*+*]:-ml-2">
        {info.members.map((m, i) => (
          <li key={m.id} className={hiddenOnPortrait > 0 && i >= FACES_ON_PORTRAIT ? 'port:sr-only' : ''}>
            <Avatar person={m} />
            <span className="sr-only">{m.name}</span>
          </li>
        ))}
        {hiddenOnPortrait > 0 && (
          <li aria-hidden="true" className="hidden port:block">
            <span className="grid size-7 place-items-center rounded-full bg-soft text-xs font-bold text-muted ring-2 ring-peach">+{hiddenOnPortrait}</span>
          </li>
        )}
      </ul>
      <Button aria-label="Share" onClick={onShare} className="size-[38px] flex-none !p-0 desk:size-auto desk:!px-[18px] desk:!py-[11px] land:size-[34px]">
        <Share2 size={18} aria-hidden="true" />
        <span className="hidden desk:inline">Share link</span>
      </Button>
    </header>
  );
}

/** Phones only: picking or the leaderboard, in the session header. */
function ViewToggle({ view, onChange }: { view: 'pick' | 'board'; onChange: (view: 'pick' | 'board') => void }) {
  return (
    <div role="group" aria-label="Session view" className="flex gap-0.5 rounded-full bg-soft p-[3px] desk:hidden port:order-2 port:flex-1">
      {(['pick', 'board'] as const).map((v) => (
        <button
          key={v}
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className="flex-1 rounded-full px-2.5 py-[7px] text-[13px] font-semibold text-muted aria-pressed:bg-white aria-pressed:text-ink aria-pressed:shadow-[0_2px_6px_-2px_rgba(42,23,18,.25)] land:px-3 land:py-[5px] land:text-[12.5px]"
        >
          {v === 'pick' ? 'Pick' : 'Leaderboard'}
        </button>
      ))}
    </div>
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
        notify('Link copied');
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
      <ul aria-label="Here now" className="flex flex-col divide-y divide-divider rounded-[22px] bg-white ring-1 ring-edge">
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
const PICK_FEEDBACK_MS = 700; // long enough for the stamp and confetti to land
const TIE_FEEDBACK_MS = 120;

type Outcome = { kind: 'pick'; placeId: number } | { kind: 'tie' } | { kind: 'veto'; placeId: number };
type CardState = 'idle' | 'chosen' | 'lost' | 'vetoed';
const MILESTONES: Record<number, string> = { 10: '10 picks! Your top 3 is taking shape.', 25: '25 picks. You really care about dinner.' };

/**
 * Everyone's vetoes from the board, less your own that you've just brought back (until the board catches up).
 * `hide` a place you brought back; `unhide` one you rule out again.
 */
function useRuledOut(board: Board | null, meId: number) {
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    // Forget what the board no longer has, so ruling it out again shows it.
    const stillOut = new Set(vetoesIn(board).filter((v) => v.by.id === meId).map((v) => v.placeId));
    setHidden((was) => ([...was].every((id) => stillOut.has(id)) ? was : new Set([...was].filter((id) => stillOut.has(id)))));
  }, [board, meId]);
  return {
    vetoes: vetoesIn(board).filter((v) => !(v.by.id === meId && hidden.has(v.placeId))),
    hide: (placeId: number) => setHidden((was) => new Set([...was, placeId])),
    unhide: (placeId: number) => setHidden((was) => new Set([...was].filter((id) => id !== placeId))),
  };
}

const CHIP_LEAVE_MS = 380;

function Picker({
  sessionId,
  home,
  meId,
  board,
  call,
  onChanged,
  onPicks,
}: {
  sessionId: string;
  home: Me['home'];
  meId: number;
  board: Board | null;
  call: SessionApi;
  onChanged: () => void;
  onPicks: (picks: number) => void;
}) {
  const [state, setState] = useState<PairResponse | null>(null);
  const picks = state?.picks;
  useEffect(() => {
    if (picks !== undefined) onPicks(picks);
  }, [picks, onPicks]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const base = `/sessions/${sessionId}`;

  useEffect(() => {
    call<PairResponse>(`${base}/pair`).then(setState, (err) => setError(errorMessage(err)));
  }, [base, call]);

  /** Swaps in the next pair, which is dealt in. */
  const show = (next: PairResponse) => {
    setState(next);
    setOutcome(null);
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
      setOutcome(null);
      return null;
    } finally {
      busy.current = false;
    }
  };

  const pair = state?.pair;
  const choose = async (winner: number | null) => {
    if (!pair || busy.current) return;
    setOutcome(winner === null ? { kind: 'tie' } : { kind: 'pick', placeId: winner });
    const next = await answer(() => call<PairResponse>(`${base}/picks`, { body: { a: pair[0].id, b: pair[1].id, winner } }), winner === null ? TIE_FEEDBACK_MS : PICK_FEEDBACK_MS);
    if (next && MILESTONES[next.picks]) notify(MILESTONES[next.picks]);
  };
  const ruledOut = useRuledOut(board, meId);
  const desktop = useIsDesktop();
  const undoVeto = (place: CardPlace) => call<PairResponse>(`${base}/vetoes/${place.id}`, { method: 'DELETE' }).then(show, (err) => setError(errorMessage(err)));
  const ruleOutAgain = (place: RuledOutPlace) => {
    ruledOut.unhide(place.placeId);
    return call<PairResponse>(`${base}/vetoes`, { body: { placeId: place.placeId } }).then(show, (err) => setError(errorMessage(err)));
  };
  /** From the "Absolutely not" section: back into your picking, once its chip has had time to leave. */
  const bringBack = async (place: RuledOutPlace) => {
    try {
      const [next] = await Promise.all([call<PairResponse>(`${base}/vetoes/${place.placeId}`, { method: 'DELETE' }), wait(CHIP_LEAVE_MS)]);
      ruledOut.hide(place.placeId);
      show(next);
      notify(`${place.name} is back in`, { action: { label: 'Undo', onClick: () => void ruleOutAgain(place) } });
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const veto = async (place: CardPlace) => {
    if (busy.current) return;
    ruledOut.unhide(place.id);
    setOutcome({ kind: 'veto', placeId: place.id });
    const next = await answer(() => call<PairResponse>(`${base}/vetoes`, { body: { placeId: place.id } }), PICK_FEEDBACK_MS);
    if (next) notify(`${place.name} is out for tonight`, { action: { label: 'Undo', onClick: () => void undoVeto(place) } });
  };

  useDesktopPickKeys(pair ? { left: () => choose(pair[0].id), right: () => choose(pair[1].id), tie: () => choose(null) } : null);

  if (!state) return null;
  const cardState = (id: number): CardState => {
    if (!outcome) return 'idle';
    if (outcome.kind === 'tie') return 'lost';
    if (outcome.kind === 'veto') return outcome.placeId === id ? 'vetoed' : 'idle';
    return outcome.placeId === id ? 'chosen' : 'lost';
  };

  return (
    <section aria-label="Pick" className="flex h-full min-h-0 flex-col gap-3.5 phone:gap-2.5 land:gap-2">
      {/* Phones show the count in the header instead, to leave the cards the room. */}
      {desktop && (
        <div className="flex flex-none items-center justify-between text-[13px]">
          <span className="text-muted">Click the one you'd rather</span>
          <span className="font-semibold tabular-nums">{plural(state.picks, 'pick')}</span>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {pair ? (
        <>
          <div
            key={`${pair[0].id}-${pair[1].id}-${state.picks}`}
            className={`pick-pair relative grid min-h-0 flex-1 grid-rows-2 gap-2.5 desk:max-h-[440px] desk:grid-cols-2 desk:grid-rows-1 desk:gap-3.5 land:grid-cols-2 land:grid-rows-1 ${outcome ? 'busy' : ''} ${ruledOut.vetoes.length ? 'squeezed' : ''}`}
          >
            <PlaceCard sessionId={sessionId} home={home} place={pair[0]} position="first" state={cardState(pair[0].id)} onPick={() => choose(pair[0].id)} onVeto={() => veto(pair[0])} />
            <span
              data-testid="or"
              aria-hidden="true"
              className="pick-or pointer-events-none absolute inset-0 z-[2] m-auto grid size-11 place-items-center rounded-full bg-ink text-[13px] font-extrabold tracking-[.04em] text-mustard ring-[5px] ring-peach"
            >
              OR
            </span>
            <PlaceCard sessionId={sessionId} home={home} place={pair[1]} position="second" state={cardState(pair[1].id)} onPick={() => choose(pair[1].id)} onVeto={() => veto(pair[1])} />
          </div>
          <Button variant="secondary" onClick={() => choose(null)} className="self-center phone:py-2 phone:text-sm">
            Too close to call
          </Button>
        </>
      ) : (
        <Card className="flex flex-col items-center gap-2.5 py-8 text-center">
          <span aria-hidden="true" className="grid size-[76px] -rotate-6 place-items-center rounded-[26px] bg-mustard font-display text-[34px]">
            ?
          </span>
          <b>Not enough places left to compare</b>
          <span className="text-muted">Add places to this set, or bring one back from "Absolutely not" below.</span>
        </Card>
      )}
      <RuledOut vetoes={ruledOut.vetoes} meId={meId} onBringBack={bringBack} />
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

const CONFETTI_COLOURS = ['var(--color-tomato)', 'var(--color-mustard)', 'var(--color-leaf)', '#2f5d9e', '#ff8a5b', 'var(--color-peach)'];

/** 20 pieces flung out from the middle of a picked card. */
function Confetti() {
  const [pieces] = useState(() =>
    Array.from({ length: 20 }, (_, i) => {
      const angle = (i / 20) * Math.PI * 2;
      const distance = 100 + Math.random() * 70;
      return { '--c': CONFETTI_COLOURS[i % CONFETTI_COLOURS.length], '--x': `${Math.cos(angle) * distance}px`, '--y': `${Math.sin(angle) * distance}px`, '--r': `${Math.random() * 540}deg` };
    }),
  );
  return (
    <span data-testid="confetti" aria-hidden="true" className="confetti">
      {pieces.map((style, i) => (
        <i key={i} style={style as CSSProperties} />
      ))}
    </span>
  );
}

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
  state: CardState;
  onPick: () => void;
  onVeto: () => void;
}) {
  const transit = useTransitTime(sessionId, place.id, home ? `${home.lat},${home.lng}` : ''); // looked up again when home changes
  const shown = transitPill(transit);
  const directions = transitDirectionsUrl(place, home?.address);
  const { bg, fg } = swatch(place.id);
  const pill = fg === '#2a1712' ? 'bg-ink/10 hover:bg-ink/20' : 'bg-white/20 hover:bg-white/30';
  // The OR badge sits on the seam (below the first card on upright phones, beside it otherwise): the cards make room.
  const seam = position === 'first' ? 'pb-8 desk:pb-7 land:pr-[30px] land:pb-3' : 'pt-7 desk:pt-7 land:pt-3 land:pl-[30px]';

  return (
    <article
      style={{ background: bg, color: fg, ['--card' as string]: bg }}
      className={`pick-card relative flex min-h-0 min-w-0 flex-col rounded-[28px] p-[18px] desk:rounded-[34px] desk:p-7 land:rounded-[22px] land:px-4 land:py-3 ${seam} ${state}`}
    >
      {state === 'chosen' && (
        <>
          <span className="pick-stamp">Yes please</span>
          <Confetti />
        </>
      )}
      {state === 'vetoed' && <span className="pick-stamp nope">Absolutely not</span>}
      <button aria-label={`Pick ${place.name}`} onClick={onPick} className="absolute inset-0 rounded-[inherit]" />
      <button aria-label="Absolutely not" title="Absolutely not" onClick={onVeto} className={`absolute top-3.5 right-3.5 z-10 grid size-9 place-items-center rounded-full ${pill}`}>
        <Ban size={18} aria-hidden="true" />
      </button>
      {/* Every card is the same size whatever it says: long titles and notes are cut short, and the note gives way first. */}
      <div className="pick-body pointer-events-none relative flex min-h-0 flex-1 flex-col gap-[5px] overflow-clip [overflow-clip-margin:8px]">
        <h3 className="line-clamp-2 flex-none pr-10 font-display text-[25px]/[1.08] wrap-anywhere desk:text-[40px]/[1.08] land:text-[22px]/[1.08]">{place.name}</h3>
        <span className="pick-suburb flex-none truncate opacity-80">{place.suburb ?? 'Suburb unknown'}</span>
        {place.note && <span className="pick-note line-clamp-2 min-h-0 text-sm italic opacity-90">“{place.note}”</span>}
        <div className="pick-pills mt-auto flex flex-none flex-wrap gap-1.5 pt-2 [&>*]:inline-flex [&>*]:items-center [&>*]:gap-[5px] [&>*]:rounded-full [&>*]:px-[11px] [&>*]:py-[5px] [&>*]:text-[13px] [&>*]:font-bold [&>a]:pointer-events-auto land:[&>*]:py-[3px] land:[&>*]:text-xs">
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
