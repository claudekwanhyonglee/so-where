import { Card } from './ui.tsx';

export type Board = {
  people: { id: number; name: string; picks: number; ranking: { placeId: number; name: string; vetoed: boolean }[] }[];
  combined: { placeId: number; name: string; suburb: string | null; positions: Record<string, number>; bottomThirdFor: number[]; vetoedBy: number[] }[];
};

export function Leaderboard({ board }: { board: Board | null }) {
  if (!board) return null;

  return (
    <section aria-label="Leaderboard" className="flex flex-col gap-4">
      <h2 className="px-1 text-lg font-bold">Leaderboard</h2>
      <Together board={board} />
      <h3 className="px-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Each person</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {board.people.map((person) => (
          <Card key={person.id} className="!p-4">
            <h4 className="mb-2 font-bold">
              {person.name} · {person.picks === 1 ? '1 pick' : `${person.picks} picks`}
            </h4>
            <ol aria-label={`${person.name}'s ranking`} className="flex max-h-80 flex-col gap-1 overflow-y-auto text-sm">
              {person.ranking.map((r, i) => (
                <li key={r.placeId} className={`flex items-center gap-2 ${r.vetoed ? 'text-stone-400' : ''}`}>
                  <span className="w-6 text-right tabular-nums text-stone-400">{i + 1}</span>
                  <span className={r.vetoed ? 'line-through' : 'font-medium'}>{r.name}</span>
                  {r.vetoed && <NopeStamp />}
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Together({ board }: { board: Board }) {
  const nameOf = new Map(board.people.map((p) => [p.id, p.name]));
  return (
    <Card className="!p-0">
      <h3 className="px-4 pt-4 font-bold">Together</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2 font-semibold">#</th>
              <th className="py-2 pr-4 font-semibold">Place</th>
              {board.people.map((p) => (
                <th key={p.id} className="px-2 py-2 text-center font-semibold">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.combined.map((row, i) => (
              <tr key={row.placeId} className={`border-t border-stone-100 ${row.vetoedBy.length ? 'bg-rose-50/60' : i === 0 ? 'bg-orange-50' : ''}`}>
                <td className="px-4 py-2.5 align-top font-black tabular-nums text-stone-400">{i + 1}</td>
                <td className="py-2.5 pr-4 align-top">
                  <div className="font-semibold">{row.name}</div>
                  {row.suburb && <div className="text-xs text-stone-500">{row.suburb}</div>}
                  {row.vetoedBy.length > 0 && (
                    <div className="mt-1">
                      <NopeStamp who={row.vetoedBy.map((id) => nameOf.get(id)).join(', ')} />
                    </div>
                  )}
                </td>
                {board.people.map((p) => (
                  <td key={p.id} className="px-2 py-2.5 text-center align-top">
                    <Position position={row.positions[p.id]} lowFor={row.bottomThirdFor.includes(p.id) ? p.name : undefined} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-stone-500">Ordered by everyone's average. ↓ marks a place in that person's bottom third.</p>
    </Card>
  );
}

function Position({ position, lowFor }: { position: number; lowFor?: string }) {
  if (!lowFor) return <span className="inline-block min-w-7 rounded-full bg-stone-100 px-2 py-0.5 tabular-nums">{position}</span>;
  return (
    <span title={`In ${lowFor}'s bottom third`} className="inline-block min-w-7 rounded-full bg-amber-100 px-2 py-0.5 font-semibold tabular-nums text-amber-800">
      {position}↓<span className="sr-only"> (bottom third for {lowFor})</span>
    </span>
  );
}

/** The "Absolutely not" mark: a rubber stamp. */
export function NopeStamp({ who }: { who?: string }) {
  return (
    <span className="inline-block -rotate-3 whitespace-nowrap rounded-md border-2 border-rose-600 px-1.5 py-px text-[10px] font-black uppercase leading-tight tracking-widest text-rose-600 opacity-90 shadow-[inset_0_0_0_1px_rgba(225,29,72,0.25)]">
      Absolutely not{who ? ` · ${who}` : ''}
    </span>
  );
}
