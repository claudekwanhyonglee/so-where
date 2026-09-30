import { useEffect, useRef, useState } from 'react';
import type { Board } from './Leaderboard.tsx';

export type RuledOutPlace = { placeId: number; name: string };
export type Veto = RuledOutPlace & { key: string; by: { id: number; name: string } };

/** Every veto in the session: one per place and person, in the board's order. */
export const vetoesIn = (board: Board | null): Veto[] =>
  (board?.combined ?? []).flatMap(({ placeId, name, vetoedBy }) =>
    vetoedBy.map((id) => ({ placeId, name, key: `${placeId}:${id}`, by: board!.people.find((p) => p.id === id) ?? { id, name: '?' } })),
  );

/**
 * "Absolutely not": what everyone has ruled out tonight, under the picking cards. Opens when the first place is ruled
 * out and folds away once the last is brought back. Your own chips bring their place back (`onBringBack` settles once
 * the chip has had time to leave). The chips scroll inside it.
 */
export function RuledOut({ vetoes: fromBoard, meId, onBringBack }: { vetoes: Veto[]; meId: number; onBringBack: (place: RuledOutPlace) => Promise<void> }) {
  const vetoes = useArrivalOrder(fromBoard);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const open = vetoes.length > 0;
  // While folding away, the last chips stay (faded) so the section doesn't jump shut.
  const last = useRef(vetoes);
  if (open) last.current = vetoes;
  const chips = open ? vetoes : last.current;
  const isNew = useNewKeys(vetoes.map((v) => v.key));

  const bringBack = (veto: Veto) => {
    setLeaving((was) => new Set([...was, veto.key]));
    void onBringBack(veto)
      .catch(() => undefined)
      .finally(() => setLeaving((was) => new Set([...was].filter((key) => key !== veto.key))));
  };

  return (
    <div data-open={open || undefined} className="nope-wrap">
      {/* Sideways phones have room for one row: the stamp, then the chips scrolling sideways. */}
      <section aria-label="Absolutely not" className="flex min-h-0 flex-col gap-2.5 overflow-hidden pt-1.5 land:flex-row land:items-center land:pt-0">
        <div className="flex flex-none items-center justify-between gap-2.5">
          <span data-testid="nope-count" className="nope-stamp">
            Absolutely not · {vetoes.filter((v) => !leaving.has(v.key)).length}
          </span>
          {chips.some((v) => v.by.id === meId) && <span className="hidden text-xs text-muted desk:inline">Tap yours to bring it back</span>}
        </div>
        <div data-testid="nope-items" className="nope-items relative flex min-h-0 flex-wrap content-start gap-[7px] overflow-y-auto overscroll-contain px-0.5 pt-0.5 pb-4 land:min-w-0 land:flex-1 land:flex-nowrap land:overflow-x-auto land:overflow-y-hidden land:py-0.5 land:pr-7 land:[scrollbar-width:none]">
          {chips.map((veto) => (
            <NopeChip key={veto.key} veto={veto} mine={veto.by.id === meId} fresh={isNew(veto.key)} leaving={leaving.has(veto.key)} onBringBack={() => bringBack(veto)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function NopeChip({ veto, mine, fresh, leaving, onBringBack }: { veto: Veto; mine: boolean; fresh: boolean; leaving: boolean; onBringBack: () => void }) {
  const look = `nope-chip inline-flex max-w-full items-center land:max-w-[190px] land:flex-none gap-[7px] rounded-full bg-white py-1.5 pl-3 text-[13px] font-bold whitespace-nowrap ring-[1.5px] ring-edge ring-inset ${fresh ? 'chip-in' : ''} ${leaving ? 'chip-out' : ''}`;
  const content = (
    <>
      <s className="min-w-0 truncate decoration-stamp decoration-[1.5px]">{veto.name}</s>
      <span className="max-w-[12em] min-w-0 flex-none truncate text-[10px] font-extrabold tracking-[.1em] text-stamp uppercase">{mine ? 'You' : veto.by.name}</span>
    </>
  );
  if (!mine)
    return (
      <span data-testid="nope-chip" className={`${look} pr-3`}>
        {content}
      </span>
    );
  return (
    <button data-testid="nope-chip" aria-label={`Bring ${veto.name} back`} disabled={leaving} onClick={onBringBack} className={`${look} pr-[7px] hover:ring-leaf`}>
      {content}
      <span aria-hidden="true" className="grid size-[22px] flex-none place-items-center rounded-full bg-leaf text-xs font-black text-peach">
        ↺
      </span>
    </button>
  );
}

/** The vetoes in the order they turned up, so chips already showing never move: a new one goes at the end. */
function useArrivalOrder(vetoes: Veto[]) {
  const order = useRef<string[]>([]);
  const now = new Set(vetoes.map((v) => v.key));
  const kept = order.current.filter((key) => now.has(key));
  order.current = [...kept, ...vetoes.map((v) => v.key).filter((key) => !kept.includes(key))];
  return [...vetoes].sort((a, b) => order.current.indexOf(a.key) - order.current.indexOf(b.key));
}

/** Whether a key turned up after the first render (so it pops in), rather than being there from the start. */
function useNewKeys(keys: string[]) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const joined = keys.join(',');
  useEffect(() => {
    const now = joined ? joined.split(',') : [];
    if (seen.current) {
      const added = now.filter((key) => !seen.current!.has(key));
      if (added.length) setFresh(new Set(added));
    }
    seen.current = new Set(now);
  }, [joined]);
  return (key: string) => fresh.has(key);
}
