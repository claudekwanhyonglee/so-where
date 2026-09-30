// What other people did in a session between two checks, as toast messages. `before` is null on the first check,
// which is news to nobody. Your own doings are left out: they have toasts of their own.

type Person = { id: number; name: string };
type VetoRow = { placeId: number; name: string; vetoedBy: number[] };

/** "Sam joined", for each person who's new since the last check. */
export function joinedNews(before: Person[] | null, members: Person[], meId: number): string[] {
  if (!before) return [];
  const known = new Set(before.map((p) => p.id));
  return members.filter((p) => p.id !== meId && !known.has(p.id)).map((p) => `${p.name} joined`);
}

/** "Jo ruled out Pretend Diner" / "Jo brought Pretend Diner back", for each change since the last check. */
export function vetoNews(before: VetoRow[] | null, rows: VetoRow[], people: Person[], meId: number): string[] {
  if (!before) return [];
  const nameOf = (id: number) => people.find((p) => p.id === id)?.name ?? 'Someone';
  const wasOut = new Map(before.map((r) => [r.placeId, r.vetoedBy]));
  return rows.flatMap(({ placeId, name, vetoedBy }) => {
    const was = wasOut.get(placeId);
    if (!was) return [];
    const ruledOut = vetoedBy.filter((id) => id !== meId && !was.includes(id)).map((id) => `${nameOf(id)} ruled out ${name}`);
    const broughtBack = was.filter((id) => id !== meId && !vetoedBy.includes(id)).map((id) => `${nameOf(id)} brought ${name} back`);
    return [...ruledOut, ...broughtBack];
  });
}
