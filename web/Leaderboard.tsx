import { Crown } from 'lucide-react';
import { startTransition, useEffect, useRef, useState, ViewTransition } from 'react';
import { plural } from './model.ts';
import { Eyebrow, Stamp } from './ui.tsx';

type Person = { id: number; name: string; picks: number; ranking: { placeId: number; name: string; vetoed: boolean }[] };
type Row = { placeId: number; name: string; suburb: string | null; positions: Record<string, number>; bottomThirdFor: number[]; vetoedBy: number[] };
export type Board = { people: Person[]; combined: Row[]; prettySure: boolean };

const initial = (name: string) => name[0]?.toUpperCase() ?? '';

export function Leaderboard({ board }: { board: Board | null }) {
  const [tab, setTab] = useState<'together' | number>('together');
  const risers = useRisers(board?.combined);
  if (!board) return null;

  const solo = board.people.length < 2;
  const person = solo || tab === 'together' ? undefined : board.people.find((p) => p.id === tab);
  return (
    <section aria-label="Leaderboard" className="flex flex-col gap-3">
      <span className="hidden desk:block">
        <Eyebrow>Live leaderboard</Eyebrow>
      </span>
      {!solo && <Tabs people={board.people} selected={person?.id ?? 'together'} onSelect={(t) => startTransition(() => setTab(t))} />}
      {person ? <PersonRanking person={person} board={board} /> : <Together board={board} risers={risers} />}
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

function Together({ board, risers }: { board: Board; risers: ReadonlySet<number> }) {
  const showChips = board.people.length > 1;
  const nameOf = (id: number) => board.people.find((p) => p.id === id)?.name ?? '?';
  const [top, ...rest] = board.combined; // when every place is vetoed, the top pick is one with the fewest vetoes
  const marked = showChips && board.combined.some((r) => r.bottomThirdFor.length > 0);

  return (
    <>
      {top && (
        <ViewTransition name={`place-${top.placeId}`}>
          <section aria-label="Top pick" className="flex flex-col gap-[5px] rounded-[24px] bg-mustard px-[18px] py-4">
            <span className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[.08em] uppercase">
              <Crown size={16} aria-hidden="true" /> Top pick
            </span>
            <h3 className="font-display text-2xl/[1.08]">{top.name}</h3>
            {top.vetoedBy.length > 0 && <NopeStamp who={top.vetoedBy.map(nameOf).join(', ')} />}
            {board.prettySure && <PrettySure />}
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span>{top.suburb}</span>
              {showChips && <Chips row={top} people={board.people} onMustard />}
            </div>
          </section>
        </ViewTransition>
      )}
      {rest.length > 0 && (
        <ol aria-label="Together" className={listStyle}>
          {rest.map((row, i) => {
            const vetoed = row.vetoedBy.length > 0;
            return (
              <ViewTransition key={row.placeId} name={`place-${row.placeId}`}>
                <li className="flex items-center gap-2.5 px-3 py-[9px]">
                  <Position position={vetoed ? null : i + (top ? 2 : 1)} />
                  <span className="w-3 flex-none text-center text-[10px] text-up">
                    {risers.has(row.placeId) && (
                      <>
                        ▲<span className="sr-only"> moved up</span>
                      </>
                    )}
                  </span>
                  <PlaceName name={row.name} suburb={row.suburb} vetoedBy={vetoed ? row.vetoedBy.map(nameOf).join(', ') : undefined} />
                  {showChips && <Chips row={row} people={board.people} />}
                </li>
              </ViewTransition>
            );
          })}
        </ol>
      )}
      {marked && (
        <p role="note" className="flex items-center gap-2 text-xs text-muted">
          <span aria-hidden="true" className={`${chipStyle} bg-low text-low-ink`}>
            {initial(board.people[0].name)}
          </span>
          means it's in that person's bottom third
        </p>
      )}
    </>
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

const positionStyle: Record<number, string> = { 1: 'bg-mustard text-ink', 2: 'bg-[#ececec] text-ink', 3: 'bg-[#f6d2b4] text-ink' };

/** A place's position, or a dash for one that's out. */
const Position = ({ position }: { position: number | null }) => (
  <span className={`grid size-6 flex-none place-items-center rounded-full text-xs font-extrabold text-muted tabular-nums ${position ? (positionStyle[position] ?? '') : ''}`}>
    {position ?? <span aria-hidden="true">–</span>}
  </span>
);

function PlaceName({ name, suburb, vetoedBy }: { name: string; suburb: string | null; vetoedBy?: string }) {
  return (
    <span className="min-w-0 flex-1">
      <b className={`block truncate font-bold ${vetoedBy ? 'line-through opacity-55' : ''}`}>{name}</b>
      {vetoedBy ? <NopeStamp who={vetoedBy} /> : <small className="block truncate text-[13px] text-muted">{suburb}</small>}
    </span>
  );
}

const chipStyle = 'grid h-[21px] min-w-6 place-items-center rounded-[7px] px-[5px] text-[11px] font-bold tabular-nums';

/** Each member's initial and rank for the place, marked when it's in their bottom third. */
function Chips({ row, people, onMustard = false }: { row: Row; people: Person[]; onMustard?: boolean }) {
  return (
    <span className="flex flex-none gap-[3px]">
      {people.map((p) => {
        const low = row.bottomThirdFor.includes(p.id);
        const rank = row.positions[p.id];
        return (
          <span key={p.id} title={`${p.name}: #${rank}`} className={`${chipStyle} ${low ? 'bg-low text-low-ink' : onMustard ? 'bg-white/55' : 'bg-[#f6ebe3]'}`}>
            {initial(p.name)}
            {rank}
            {low && <span className="sr-only"> (bottom third for {p.name})</span>}
          </span>
        );
      })}
    </span>
  );
}

/** Shown once the app is confident of the group's pick. */
function PrettySure() {
  return (
    <p className="flex items-center gap-1.5 text-[13px] font-extrabold">
      <Flame />
      {'Statistically "Pretty sure"'}
    </p>
  );
}

/** A flickering Poster-style flame: tomato with an ink outline, a mustard core. */
const Flame = () => (
  <svg viewBox="0 0 20 24" className="h-6 w-5 flex-none overflow-visible" aria-hidden="true" data-testid="flame">
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
  return (
    <Stamp className="mt-[3px] text-stamp">Absolutely not · {who}</Stamp>
  );
}
