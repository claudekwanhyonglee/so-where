import { expect, test, type Page } from '@playwright/test';
import { addPlaceViaApi, newPerson, signUp, uniqueName } from './helpers.ts';

type BoardData = {
  people: { id: number; name: string; picks: number; ranking: { placeId: number; name: string; vetoed: boolean }[] }[];
  combined: { placeId: number; name: string; vetoedBy: number[]; bottomThirdFor: number[] }[];
};

/** Signs `page` up and opens a session for a fresh set of `count` new places. */
async function hostSession(page: Page, count: number) {
  const name = uniqueName('Host');
  await signUp(page, name);
  const places: { id: number; name: string }[] = [];
  for (let i = 0; i < count; i++) places.push(await addPlaceViaApi(page, uniqueName('Invented Venue ')));
  const { id: setId } = await (await page.request.post('/api/sets', { data: { name: uniqueName('Board ') } })).json();
  for (const p of places) await page.request.put(`/api/sets/${setId}/places/${p.id}`);
  const { id } = await (await page.request.post('/api/sessions', { data: { setId } })).json();
  await page.goto(`/s/${id}`);
  const data = async () => (await (await page.request.get(`/api/sessions/${id}/leaderboard`)).json()) as BoardData;
  const pick = (winner: number, loser: number, who = page) => who.request.post(`/api/sessions/${id}/picks`, { data: { a: winner, b: loser, winner } });
  return { name, sessionId: id as string, path: `/s/${id}`, places, data, pick };
}

const board = (page: Page) => page.getByRole('region', { name: 'Leaderboard' });
const topPick = (page: Page) => board(page).getByRole('region', { name: 'Top pick' });
const together = (page: Page) => board(page).getByRole('list', { name: 'Together' });
const rowFor = (page: Page, name: string) => together(page).getByRole('listitem').filter({ hasText: name });

test('#9 AC1–AC5: the leaderboard updates live across devices', async ({ page, browser }) => {
  const host = await hostSession(page, 3);
  const friend = await newPerson(browser, 'Friend', host.path);
  const f = friend.page;
  await expect(f.getByRole('region', { name: 'Pick', exact: true }).getByRole('article')).toHaveCount(2);
  await expect(board(page).getByRole('tab', { name: friend.name })).toBeVisible({ timeout: 5_000 });

  // The friend picks; the host sees it within 5 seconds without reloading.
  const winner = (await f.getByRole('article').first().getByRole('heading').innerText()).trim();
  await f.getByRole('article').first().getByRole('button', { name: /^pick /i }).click();
  await board(page).getByRole('tab', { name: friend.name }).click();
  const friendRanking = board(page).getByRole('list', { name: `${friend.name}'s ranking` });
  await expect(friendRanking.getByRole('listitem').first()).toContainText(winner, { timeout: 5_000 });
  await expect(board(page).getByText('1 pick', { exact: true })).toBeVisible({ timeout: 5_000 });

  // "Absolutely not" is clearly marked for everyone.
  await board(page).getByRole('tab', { name: 'Together' }).click();
  const vetoed = (await f.getByRole('article').first().getByRole('heading').innerText()).trim();
  await f.getByRole('article').first().getByRole('button', { name: 'Absolutely not' }).click();
  await expect(rowFor(page, vetoed)).toContainText(`Absolutely not · ${friend.name}`, { timeout: 5_000 });

  // Only the set's places are listed.
  await expect(together(page).getByRole('listitem')).toHaveCount(host.places.length - 1); // + the top pick card
});

test('#18 AC1: Together by default, a tab per member, and no tabs when alone', async ({ page, browser }) => {
  const host = await hostSession(page, 3);
  await expect(board(page).getByRole('tablist')).toHaveCount(0);
  await expect(topPick(page)).toBeVisible();

  const friend = await newPerson(browser, 'Tabby', host.path);
  const tabs = board(page).getByRole('tablist', { name: 'Whose ranking' }).getByRole('tab');
  await expect(tabs).toHaveText(['Together', host.name, friend.name], { timeout: 5_000 });
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

  const [a, b, c] = host.places.map((p) => p.id);
  await host.pick(c, a, friend.page);
  await host.pick(c, b, friend.page);
  await host.pick(b, a, friend.page);
  const data = await host.data();
  const combinedOrder = data.combined.map((r) => r.name);
  await expect(topPick(page)).toContainText(combinedOrder[0], { timeout: 5_000 });
  await expect(together(page).getByRole('listitem')).toHaveText(combinedOrder.slice(1).map((n) => new RegExp(n)));

  await tabs.filter({ hasText: friend.name }).click();
  const theirs = data.people.find((p) => p.name === friend.name)!;
  await expect(board(page).getByText('3 picks', { exact: true })).toBeVisible();
  await expect(board(page).getByRole('list', { name: `${friend.name}'s ranking` }).getByRole('listitem')).toHaveText(theirs.ranking.map((r) => new RegExp(r.name)));
});

test('#18 AC2 + AC3: top pick card, positions, a chip per member, and the bottom-third legend', async ({ page, browser }) => {
  const host = await hostSession(page, 3);
  // Alone: positions but no chips, so no legend.
  await expect(together(page).getByRole('listitem').first()).toContainText('2');
  await expect(board(page).getByRole('note')).toHaveCount(0);

  const friend = await newPerson(browser, 'Chippy', host.path);
  await expect(board(page).getByRole('tab', { name: friend.name })).toBeVisible({ timeout: 5_000 });
  const data = await host.data();
  const [me, them] = [host.name, friend.name].map((n) => data.people.find((p) => p.name === n)!);
  const rows = together(page).getByRole('listitem');
  for (const [i, row] of data.combined.slice(1).entries()) {
    const item = rows.nth(i);
    await expect(item).toContainText(String(i + 2));
    for (const person of [me, them]) {
      const rank = person.ranking.findIndex((r) => r.placeId === row.placeId) + 1;
      await expect(item.getByTitle(`${person.name}: #${rank}`)).toContainText(`${person.name[0].toUpperCase()}${rank}`);
    }
  }
  await expect(topPick(page)).toContainText(data.combined[0].name);

  // With three places, each person's #3 is in their bottom third: that chip is marked, and the legend explains it.
  const last = data.combined.at(-1)!;
  for (const id of last.bottomThirdFor) {
    const who = data.people.find((p) => p.id === id)!;
    await expect(rowFor(page, last.name).getByTitle(`${who.name}: #3`)).toContainText(`bottom third for ${who.name}`);
  }
  await expect(board(page).getByRole('note')).toContainText("bottom third");
});

test('#18 AC4: vetoed places sink below the rest, stamped, without a position', async ({ page }) => {
  const host = await hostSession(page, 3);
  const [a, b, c] = host.places;
  await host.pick(a.id, b.id);
  await host.pick(a.id, c.id);
  await page.request.post(`/api/sessions/${host.sessionId}/vetoes`, { data: { placeId: a.id } });

  const rows = together(page).getByRole('listitem');
  await expect(rows.last()).toContainText(a.name, { timeout: 5_000 });
  await expect(rows.last()).toContainText(`Absolutely not · ${host.name}`);
  expect((await rows.last().innerText()).split(a.name)[0]).not.toMatch(/\d/); // no position before the name
  await expect(topPick(page)).not.toContainText(a.name);
});

test('#18 AC5: a place that moved up since the last poll gets ▲', async ({ page }) => {
  const host = await hostSession(page, 4);
  const [a, b, c, d] = host.places;
  for (const [winner, loser] of [[a, b], [a, c], [a, d], [b, c], [b, d], [c, d]]) await host.pick(winner.id, loser.id);
  await expect(together(page).getByRole('listitem').last()).toContainText(d.name, { timeout: 5_000 });
  await expect(together(page)).not.toContainText('▲');

  // d beats c until it overtakes it (but not a or b, which have more wins).
  const position = async (name: string) => (await host.data()).combined.findIndex((r) => r.name === name);
  while ((await position(d.name)) > (await position(c.name))) await host.pick(d.id, c.id);
  expect(await position(d.name)).toBe(2);

  await expect(rowFor(page, d.name)).toContainText('▲', { timeout: 5_000 });
  await expect(rowFor(page, c.name)).not.toContainText('▲');
});

/** Records, for each view transition, how many ::view-transition animations ran. */
const countViewTransitionAnimations = () => {
  const counts: number[] = [];
  (window as unknown as { vtAnimations: number[] }).vtAnimations = counts;
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = ((arg: Parameters<typeof start>[0]) => {
    const transition = start(arg);
    transition.ready
      .then(() => counts.push(document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition')).length))
      .catch(() => undefined);
    return transition;
  }) as typeof start;
};

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`#18 AC6: reordering ${motion === 'reduce' ? 'is instant with reduced motion' : 'animates otherwise'}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.addInitScript(countViewTransitionAnimations);
    const host = await hostSession(page, 3);
    const data = await host.data();
    const bottom = data.combined.at(-1)!;
    await expect(together(page).getByRole('listitem').last()).toContainText(bottom.name); // the board is up, in its first order
    for (const other of data.combined.slice(0, -1)) await host.pick(bottom.placeId, other.placeId);
    await expect(topPick(page)).toContainText(bottom.name, { timeout: 5_000 });

    const counts = await page.evaluate(() => (window as unknown as { vtAnimations: number[] }).vtAnimations);
    expect(counts.length).toBeGreaterThan(0); // the reorder went through a view transition
    if (motion === 'reduce') expect(counts.every((n) => n === 0)).toBe(true);
    else expect(counts.some((n) => n > 0)).toBe(true);
  });
}
