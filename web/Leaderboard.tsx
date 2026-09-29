import { Crown } from 'lucide-react';
import { startTransition, useEffect, useRef, useState, ViewTransition, type ReactNode } from 'react';
import { medal, ordinal, rankChanges, rankSnapshot } from './medals.ts';
import { plural } from './model.ts';
import { Eyebrow, Stamp } from './ui.tsx';

type Person = { id: number; name: string; picks: number; ranking: { placeId: number; name: string; vetoed: boolean }[] };
type Row = { placeId: number; name: string; suburb: string | null; positions: Record<string, number>; vetoedBy: number[] };
export type Board = { people: Person[]; combined: Row[]; prettySure: boolean };

export function Leaderboard({ board }: { board: Board | null }) {
  const [tab, setTab] = useState<'together' | number>('together');
  const risers = useRisers(board?.combined);
  const nudges = useRankNudges(board?.combined);
  if (!board) return null;

  const solo = board.people.length < 2;
  const person = solo || tab === 'together' ? undefined : board.people.find((p) => p.id === tab);
  return (
    <section aria-label="Leaderboard" className="flex flex-col gap-3">
      <span className="hidden desk:block">
        <Eyebrow>Live leaderboard</Eyebrow>
      </span>
      {!solo && <Tabs people={board.people} selected={person?.id ?? 'together'} onSelect={(t) => startTransition(() => setTab(t))} />}
      {person ? <PersonRanking person={person} board={board} /> : <Together board={board} risers={risers} nudges={nudges} />}
    </section>
  );
}

/** Places whose combined position improved between the last two polls. */
function useRisers(rows?: Row[]) {
  const previous = useRef<Map<number, number> | null>(null);
  const [risers, setRisers] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    if (!rows) return;
    const before = previous.current;
    previous.current = new Map(rows.map((r, i) => [r.placeId, i]));
    if (before) setRisers(new Set(rows.filter((r, i) => (before.get(r.placeId) ?? i) > i).map((r) => r.placeId)));
  }, [rows]);
  return risers;
}

const NUDGE_MS = 1500;
type Nudges = ReadonlyMap<string, 'better' | 'worse'>;

/** The chips ("placeId:personId") whose rank changed at a poll, each for NUDGE_MS. */
function useRankNudges(rows?: Row[]) {
  const previous = useRef<ReturnType<typeof rankSnapshot> | null>(null);
  const [nudges, setNudges] = useState<Nudges>(new Map());
  useEffect(() => {
    if (!rows) return;
    const changes = rankChanges(previous.current, rows);
    previous.current = rankSnapshot(rows);
    if (!changes.size) return;
    setNudges((was) => new Map([...was, ...changes]));
    // Not cancelled by the next poll, so every batch of badges gets its full time.
    setTimeout(() => setNudges((was) => new Map([...was].filter(([key, how]) => changes.get(key) !== how))), NUDGE_MS);
  }, [rows]);
  return nudges;
}

function Tabs({ people, selected, onSelect }: { people: Person[]; selected: 'together' | number; onSelect: (tab: 'together' | number) => void }) {
  const tabs = [{ id: 'together' as const, label: 'Together' }, ...people.map((p) => ({ id: p.id, label: p.name }))];
  return (
    <div role="tablist" aria-label="Whose ranking" className="flex gap-0.5 overflow-x-auto rounded-full bg-soft p-[3px]">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={selected === t.id}
          onClick={() => onSelect(t.id)}
          className="flex-1 truncate rounded-full px-2.5 py-[7px] text-[13px] font-semibold whitespace-nowrap text-muted aria-selected:bg-white aria-selected:text-ink aria-selected:shadow-[0_2px_6px_-2px_rgba(42,23,18,.25)]"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const listStyle = 'flex flex-col divide-y divide-divider overflow-hidden rounded-[22px] bg-white ring-1 ring-edge';

function Together({ board, risers, nudges }: { board: Board; risers: ReadonlySet<number>; nudges: Nudges }) {
  const showChips = board.people.length > 1;
  const nameOf = (id: number) => board.people.find((p) => p.id === id)?.name ?? '?';
  const [top, ...rest] = board.combined; // when every place is vetoed, the top pick is one with the fewest vetoes
  const chips = (row: Row, onGold = false) => showChips && <Chips row={row} people={board.people} nudges={nudges} onGold={onGold} />;
  const sure = board.prettySure;

  return (
    <>
      {top && (
        <ViewTransition name="top-pick">
          <div className={`relative isolate ${sure ? 'mt-16' : ''}`}>
            {sure && <Fire />}
            <section aria-label="Top pick" className={`relative z-[1] flex flex-col gap-[5px] rounded-[24px] bg-mustard px-[18px] py-4 ${sure ? 'on-fire' : ''}`}>
              {sure && <PrettySureStamp />}
              <span className={`flex items-center gap-1.5 text-[11px] font-extrabold tracking-[.08em] uppercase ${sure ? 'pr-[150px]' : ''}`}>
                <Crown size={16} aria-hidden="true" /> Top pick
              </span>
              <TopName name={top.name} roomForStamp={sure} />
              {top.vetoedBy.length > 0 && <NopeStamp who={top.vetoedBy.map(nameOf).join(', ')} />}
              <span className="text-[13px]">{top.suburb}</span>
              {chips(top, true)}
            </section>
          </div>
        </ViewTransition>
      )}
      {rest.length > 0 && (
        <ol aria-label="Together" className={listStyle}>
          {rest.map((row, i) => {
            const vetoed = row.vetoedBy.length > 0;
            return (
              <ViewTransition key={row.placeId} name={`place-${row.placeId}`}>
                <li className="flex items-start gap-2.5 px-3 pt-[9px] pb-[11px]">
                  <Position position={vetoed ? null : i + (top ? 2 : 1)} />
                  <span className="mt-1 w-3 flex-none text-center text-[10px] text-up">
                    {risers.has(row.placeId) && (
                      <>
                        ▲<span className="sr-only"> moved up</span>
                      </>
                    )}
                  </span>
                  <PlaceName name={row.name} suburb={row.suburb} vetoedBy={vetoed ? row.vetoedBy.map(nameOf).join(', ') : undefined}>
                    {chips(row)}
                  </PlaceName>
                </li>
              </ViewTransition>
            );
          })}
        </ol>
      )}
    </>
  );
}

const NAME_SWAP_MS = 450;

/** The top pick's name. When it changes, the old one moves up and out as the new one moves in (a plain swap with reduced motion). */
function TopName({ name, roomForStamp }: { name: string; roomForStamp: boolean }) {
  const [shown, setShown] = useState(name);
  const [leaving, setLeaving] = useState<string | null>(null);
  if (name !== shown) {
    setLeaving(shown);
    setShown(name);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), NAME_SWAP_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  const heading = `[grid-area:1/1] font-display text-2xl/[1.08] ${roomForStamp ? 'pr-[150px]' : ''}`;
  return (
    <span className="grid overflow-hidden">
      {leaving && (
        <span aria-hidden="true" className={`name-out motion-reduce:hidden ${heading}`}>
          {leaving}
        </span>
      )}
      <h3 key={shown} className={`${leaving ? 'name-in' : ''} ${heading}`}>
        {shown}
      </h3>
    </span>
  );
}

/** "Statistically / Pretty sure": a big rubber stamp over the top card's corner. */
const PrettySureStamp = () => (
  <span
    data-testid="pretty-sure"
    className="absolute -top-2.5 -right-2 z-[3] rotate-6 rounded-[9px] border-4 border-current bg-peach px-[13px] pt-[5px] pb-[7px] text-center text-[23px]/none font-black tracking-[.06em] text-tomato-deep uppercase shadow-[inset_0_0_0_2px_var(--color-peach),inset_0_0_0_3.5px_rgba(194,50,29,.5),0_6px_14px_-6px_rgba(42,23,18,.45)]"
  >
    <small className="mb-[3px] block text-[11px] font-black tracking-[.24em]">Statistically</small>
    Pretty sure
  </span>
);

// The fire behind a "Pretty sure" top card: blobs rise and merge (the goo filter) into tongues licking past its top
// edge. An outer tomato layer, an orange one inside it and a short mustard core. Rolled once, so polls don't restart it.
// ponytail: 144 blurred blobs; halve the counts if it stutters on older phones.
const FIRE_LAYERS = [
  { count: 64, colour: 'var(--color-tomato)', size: [34, 54], height: [0.75, 1], duration: [1.3, 2] },
  { count: 48, colour: '#ff7a3d', size: [26, 42], height: [0.5, 0.75], duration: [1.1, 1.7] },
  { count: 32, colour: 'var(--color-mustard)', size: [18, 30], height: [0.3, 0.5], duration: [1, 1.4] },
] as const;
const FIRE_RISE_PX = 120; // the blaze box (from 74px above the card to 36px below its top) and a little more
const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
const FIRE = FIRE_LAYERS.map((layer) =>
  Array.from({ length: layer.count }, (_, i) => {
    const duration = between(layer.duration);
    return {
      left: `${((i + Math.random()) / layer.count) * 100}%`,
      '--s': `${between(layer.size)}px`,
      '--c': layer.colour,
      '--d': `${duration}s`,
      '--delay': `-${Math.random() * duration}s`, // start mid-blaze
      '--h': `${FIRE_RISE_PX * between(layer.height)}px`,
    };
  }),
);

function Fire() {
  return (
    <span data-testid="fire" aria-hidden="true" className="blaze">
      <svg width="0" height="0" className="absolute">
        <filter id="goo">
          <feGaussianBlur stdDeviation="7" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" />
        </filter>
      </svg>
      {FIRE.map((blobs, i) => (
        <span key={i} className="absolute inset-0 [filter:url(#goo)]">
          {blobs.map((style, j) => (
            <i key={j} style={style} />
          ))}
        </span>
      ))}
    </span>
  );
}

function PersonRanking({ person, board }: { person: Person; board: Board }) {
  const suburbOf = new Map(board.combined.map((r) => [r.placeId, r.suburb]));
  let position = 0;
  return (
    <>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-muted">{person.name}'s ranking</span>
        <span className="font-semibold tabular-nums">{plural(person.picks, 'pick')}</span>
      </div>
      <ol aria-label={`${person.name}'s ranking`} className={listStyle}>
        {person.ranking.map((r) => (
          <ViewTransition key={r.placeId} name={`place-${r.placeId}`}>
            <li className="flex items-center gap-2.5 px-3 py-[9px]">
              <Position position={r.vetoed ? null : ++position} />
              <PlaceName name={r.name} suburb={suburbOf.get(r.placeId) ?? null} vetoedBy={r.vetoed ? person.name : undefined} />
            </li>
          </ViewTransition>
        ))}
      </ol>
    </>
  );
}

const positionStyle: Record<number, string> = { 1: 'bg-mustard text-ink', 2: 'bg-silver text-ink', 3: 'bg-bronze text-ink' };

/** A place's position, or a dash for one that's out. */
const Position = ({ position }: { position: number | null }) => (
  <span className={`grid size-6 flex-none place-items-center rounded-full text-xs font-extrabold text-muted tabular-nums ${position ? (positionStyle[position] ?? '') : ''}`}>
    {position ?? <span aria-hidden="true">–</span>}
  </span>
);

function PlaceName({ name, suburb, vetoedBy, children }: { name: string; suburb: string | null; vetoedBy?: string; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <b className={`block truncate font-bold ${vetoedBy ? 'line-through opacity-55' : ''}`}>{name}</b>
      {vetoedBy ? <NopeStamp who={vetoedBy} /> : <small className="block truncate text-[13px] text-muted">{suburb}</small>}
      {children}
    </span>
  );
}

const medalStyle = { gold: 'bg-mustard', silver: 'bg-silver', bronze: 'bg-bronze', grey: 'bg-grey text-grey-ink' };

/** Each member's rank for the place by name ("Alex 1st") in its medal colour, 1st with a flame; a badge when it just changed. */
function Chips({ row, people, nudges, onGold }: { row: Row; people: Person[]; nudges: Nudges; onGold: boolean }) {
  return (
    <span className="flex flex-wrap gap-[5px] pt-[3px]">
      {people.map((p) => {
        const rank = row.positions[p.id];
        const nudge = nudges.get(`${row.placeId}:${p.id}`);
        return (
          <span
            key={p.id}
            className={`relative inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-[11.5px] font-bold whitespace-nowrap transition-colors duration-350 ${medalStyle[medal(rank)]} ${onGold ? 'shadow-[0_0_0_1.5px_rgba(255,255,255,.85)]' : ''}`}
          >
            {rank === 1 && <Flame className={`h-[13px] w-[11px] ${nudge === 'better' ? 'flame-in' : ''}`} />}
            {p.name} <b className="font-extrabold tabular-nums">{ordinal(rank)}</b>
            {nudge && <RankBadge better={nudge === 'better'} />}
          </span>
        );
      })}
    </span>
  );
}

/** A small ▲/▼ circle popped onto a chip's corner, outside its box so the chip keeps its width. */
const RankBadge = ({ better }: { better: boolean }) => (
  <span
    data-testid="rank-badge"
    aria-hidden="true"
    className={`rank-badge pointer-events-none absolute -top-[7px] -right-[7px] grid size-[15px] place-items-center rounded-full text-[7.5px] text-white shadow-[0_0_0_1.5px_#fff] ${better ? 'bg-up' : 'bg-[#c9482a]'}`}
  >
    {better ? '▲' : '▼'}
  </span>
);

/** A flickering Poster-style flame: tomato with an ink outline, a mustard core. */
const Flame = ({ className }: { className: string }) => (
  <svg viewBox="0 0 20 24" className={`flex-none overflow-visible ${className}`} aria-hidden="true" data-testid="flame">
    <path
      className="flame"
      d="M10 1C12 6 18 9 18 15A8 8 0 0 1 2 15C2 11 5 9 6 5C7 8 8 9 9 9C9 6 9 4 10 1Z"
      fill="var(--color-tomato)"
      stroke="var(--color-ink)"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path className="flame-core" d="M10 10C11 13 14 14 14 17.5A4 4 0 0 1 6 17.5C6 15.5 8 14 10 10Z" fill="var(--color-mustard)" />
  </svg>
);

/** The "Absolutely not" mark: a rubber stamp. */
export function NopeStamp({ who }: { who: string }) {
  return <Stamp className="mt-[3px] self-start text-stamp">Absolutely not · {who}</Stamp>;
}
