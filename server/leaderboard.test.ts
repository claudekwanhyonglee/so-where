import { describe, expect, it } from 'vitest';
import { fakeFetch, fakeNominatim, signedInDevice, testApp } from './test-helpers.ts';

const placeLink = (hex: string, name: string) =>
  `https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@-37.8,144.96,17z/data=!4m6!3m5!1s0x1:0x${hex}!8m2!3d-37.8!4d144.96`;

type Board = {
  people: { id: number; name: string; picks: number; ranking: { placeId: number; name: string; vetoed: boolean }[] }[];
  combined: { placeId: number; name: string; positions: Record<string, number>; bottomThirdFor: number[]; vetoedBy: number[] }[];
};

// Six places so "bottom third" is two places.
const NAMES = ['Invented A', 'Invented B', 'Invented C', 'Invented D', 'Invented E', 'Invented F'];

async function setup() {
  const ctx = testApp({ fetch: fakeFetch(fakeNominatim()) });
  const alex = await signedInDevice(ctx.app, 'Alex');
  const jo = await signedInDevice(ctx.app, 'Jo');
  const ids: number[] = [];
  for (const [i, name] of [...NAMES, 'Not In Set'].entries()) ids.push((await (await alex.post('/api/places', { url: placeLink(`b${i}`, name) })).json()).place.id);
  const setId = (await (await alex.post('/api/sets', { name: 'Six' })).json()).id;
  for (const id of ids.slice(0, 6)) await alex.put(`/api/sets/${setId}/places/${id}`);
  const sessionId = (await (await alex.post('/api/sessions', { setId })).json()).id as string;
  await jo.post(`/api/sessions/${sessionId}/join`);
  const board = async () => (await (await alex.get(`/api/sessions/${sessionId}/leaderboard`)).json()) as Board;
  /** Makes `who` prefer places in the given order, by picking each adjacent pair a few times. */
  const prefer = async (who: typeof alex, order: number[]) => {
    for (let round = 0; round < 2; round++)
      for (let i = 0; i + 1 < order.length; i++) await who.post(`/api/sessions/${sessionId}/picks`, { a: order[i], b: order[i + 1], winner: order[i] });
  };
  const idOf = (name: string) => ids[NAMES.indexOf(name)];
  return { ...ctx, alex, jo, ids, sessionId, board, prefer, idOf };
}

describe("#9 AC1: each person's ranking", () => {
  it('is shown for everyone in the session, in the order their picks say', async () => {
    const { alex, jo, board, prefer, ids } = await setup();
    await prefer(alex, ids.slice(0, 6));
    await prefer(jo, ids.slice(0, 6).reverse());
    const { people } = await board();
    expect(people.map((p) => p.name)).toEqual(['Alex', 'Jo']);
    expect(people[0].ranking.map((r) => r.placeId)).toEqual(ids.slice(0, 6));
    expect(people[1].ranking.map((r) => r.placeId)).toEqual(ids.slice(0, 6).reverse());
    expect(people[0].picks).toBe(10);
  });
});

describe('#9 AC2: combined ranking', () => {
  it("orders by the average of everyone's scores, and each row shows every person's position", async () => {
    const { alex, jo, board, prefer, idOf } = await setup();
    // Both love C; Alex then likes A, Jo then likes B.
    await prefer(alex, ['Invented C', 'Invented A', 'Invented B', 'Invented D', 'Invented E', 'Invented F'].map(idOf));
    await prefer(jo, ['Invented C', 'Invented B', 'Invented A', 'Invented D', 'Invented E', 'Invented F'].map(idOf));
    const { combined, people } = await board();
    expect(combined[0].name).toBe('Invented C');
    expect(combined.at(-1)!.name).toBe('Invented F');
    const [alexId, joId] = people.map((p) => p.id);
    const a = combined.find((r) => r.name === 'Invented A')!;
    expect(a.positions).toEqual({ [alexId]: 2, [joId]: 3 });
    for (const row of combined) expect(Object.keys(row.positions)).toHaveLength(2);
  });
});

describe('#9 AC3: flags', () => {
  it("flags a place in someone's bottom third, and marks \"Absolutely not\" for everyone", async () => {
    const { alex, jo, board, prefer, ids, sessionId, idOf } = await setup();
    await prefer(alex, ids.slice(0, 6));
    await prefer(jo, ids.slice(0, 6));
    await jo.post(`/api/sessions/${sessionId}/vetoes`, { placeId: idOf('Invented A') });

    const { combined, people } = await board();
    const [alexId, joId] = people.map((p) => p.id);
    const row = (name: string) => combined.find((r) => r.name === name)!;
    expect(row('Invented F').bottomThirdFor.sort()).toEqual([alexId, joId].sort());
    expect(row('Invented E').bottomThirdFor).toContain(alexId);
    expect(row('Invented B').bottomThirdFor).toEqual([]);

    expect(row('Invented A').vetoedBy).toEqual([joId]);
    expect(people[1].ranking.at(-1)).toMatchObject({ placeId: idOf('Invented A'), vetoed: true });
    expect(row('Invented A').positions[joId]).toBe(6);
    // Alex's favourite, but out for Jo: it sinks in the combined ranking.
    expect(combined[0].name).not.toBe('Invented A');
  });
});

describe('#9 AC5: only the session\'s set', () => {
  it('shows only places in the set', async () => {
    const { board, ids } = await setup();
    const { combined, people } = await board();
    expect(combined.map((r) => r.placeId).sort()).toEqual(ids.slice(0, 6).sort());
    for (const p of people) expect(p.ranking.map((r) => r.placeId)).not.toContain(ids[6]);
  });
});
