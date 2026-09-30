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

const MEDAL_RGB = { gold: 'rgb(255, 201, 60)', silver: 'rgb(228, 228, 232)', bronze: 'rgb(246, 210, 180)', grey: 'rgb(241, 235, 231)' };
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n] ?? 'th'}`; // enough for the handful of places here
const medalOf = (rank: number) => (['gold', 'silver', 'bronze'] as const)[rank - 1] ?? 'grey';
const chip = (scope: import('@playwright/test').Locator, name: string, rank: number) => scope.getByText(`${name} ${ordinal(rank)}`, { exact: true });

test('#18 AC2 + #55 AC1 + AC2: top pick card, positions, and a "<name> <ordinal>" chip per member in medal colours; no bottom-third marker', async ({ page, browser }) => {
  const host = await hostSession(page, 4);
  // Alone: positions but no chips.
  await expect(together(page).getByRole('listitem').first()).toContainText('2');
  await expect(together(page).getByText(`${host.name} 2nd`)).toHaveCount(0);

  const friend = await newPerson(browser, 'Chippy', host.path);
  await expect(board(page).getByRole('tab', { name: friend.name })).toBeVisible({ timeout: 5_000 });
  const data = await host.data();
  const rankOf = (who: string, placeId: number) => data.people.find((p) => p.name === who)!.ranking.findIndex((r) => r.placeId === placeId) + 1;
  const rows = together(page).getByRole('listitem');
  const cards = [topPick(page), ...data.combined.slice(1).map((_, i) => rows.nth(i))];
  for (const [i, row] of data.combined.entries()) {
    if (i > 0) await expect(rows.nth(i - 1)).toContainText(String(i + 1));
    for (const who of [host.name, friend.name]) {
      const rank = rankOf(who, row.placeId);
      const c = chip(cards[i], who, rank);
      await expect(c).toBeVisible();
      await expect(c).toHaveCSS('background-color', MEDAL_RGB[medalOf(rank)]);
      if (rank > 3) await expect(c).toHaveCSS('color', 'rgb(138, 122, 115)'); // grey text #8a7a73
      await expect(c.getByTestId('flame')).toHaveCount(rank === 1 ? 1 : 0);
    }
  }
  await expect(topPick(page)).toContainText(data.combined[0].name);

  // The bottom-third marker and its legend are gone.
  await expect(board(page).getByRole('note')).toHaveCount(0);
  await expect(board(page)).not.toContainText('bottom third');
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
  // A poll mid-setup would rightly show a ▲ for a place the rest of the setup moved up: start from a fresh board.
  await page.reload();
  await expect(together(page).getByRole('listitem').last()).toContainText(d.name, { timeout: 5_000 });
  await expect(together(page)).not.toContainText('▲');

  // d beats c until it overtakes it (but not a or b, which have more wins).
  const position = async (name: string) => (await host.data()).combined.findIndex((r) => r.name === name);
  while ((await position(d.name)) > (await position(c.name))) await host.pick(d.id, c.id);
  expect(await position(d.name)).toBe(2);

  await expect(rowFor(page, d.name)).toContainText('▲', { timeout: 5_000 });
  await expect(rowFor(page, c.name)).not.toContainText('▲');
});

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`#25 AC1–AC4 + AC6 + #55 AC3 + AC4: "Pretty sure" sets the top card on fire (${motion === 'reduce' ? 'still with reduced motion' : 'animated'})`, async ({ page, browser }) => {
    await page.emulateMedia({ reducedMotion: motion });
    const host = await hostSession(page, 6);
    const friend = await newPerson(browser, 'Flame', host.path);
    const ids = host.places.map((p) => p.id);
    const agreeOnce = async (who: Page) => {
      for (let i = 0; i + 1 < ids.length; i++) await host.pick(ids[i], ids[i + 1], who);
    };

    // AC4: before everyone has made 8 picks, no flame and no confidence wording or number anywhere.
    await agreeOnce(page);
    await agreeOnce(friend.page);
    await expect(topPick(page)).toContainText(host.places[0].name, { timeout: 5_000 });
    for (const p of [page, friend.page]) {
      await expect(p.getByText(/pretty sure|confiden|certain|likely/i)).toHaveCount(0);
      await expect(p.getByText(/\d\s*%/)).toHaveCount(0);
    }

    // AC1 + #55 AC3: once everyone has 8+ picks and agrees, the top pick card gets a big "Statistically / Pretty sure"
    // stamp over its top-right corner, warms up, and flames rise from behind it past its top edge.
    for (let round = 0; round < 3; round++) for (const who of [page, friend.page]) await agreeOnce(who);
    const card = topPick(page);
    const stamp = card.getByTestId('pretty-sure');
    await expect(stamp).toBeVisible({ timeout: 5_000 });
    await expect(stamp).toHaveText(/^Statistically\s*Pretty sure$/i);
    const [cardBox, stampBox] = [(await card.boundingBox())!, (await stamp.boundingBox())!];
    expect(stampBox.y).toBeLessThan(cardBox.y + 10); // over the top edge…
    expect(stampBox.x + stampBox.width).toBeGreaterThan(cardBox.x + cardBox.width - 10); // …at the right
    expect(await card.evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(/gradient/);
    const fire = page.getByTestId('fire');
    await expect(fire).toBeAttached();
    expect((await fire.boundingBox())!.y).toBeLessThan(cardBox.y - 30); // rises past the top edge
    expect(await fire.evaluate((el) => getComputedStyle(el).zIndex)).toBe('0'); // behind the card (z 1)

    // #55 AC4: the fire and heat move, except with reduced motion.
    const blobStates = await fire.locator('i').evaluateAll((blobs) => [...new Set(blobs.map((b) => getComputedStyle(b).animationPlayState))]);
    expect(blobStates).toEqual([motion === 'reduce' ? 'paused' : 'running']);
    expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe(motion === 'reduce' ? 'none' : 'heat');

    // AC2: a drawn flame in the palette, not an emoji or icon-font character (now in the 1st chips).
    const flame = card.getByTestId('flame').first();
    await expect(flame).toBeVisible();
    expect(await flame.evaluate((svg) => svg.tagName.toLowerCase())).toBe('svg');
    const fills = await flame.locator('path').evaluateAll((paths) => paths.map((p) => getComputedStyle(p).fill));
    expect(fills).toEqual(['rgb(232, 67, 44)', 'rgb(255, 201, 60)']); // tomato #e8432c, mustard #ffc93c
    expect(await card.innerText()).not.toMatch(/\p{Extended_Pictographic}/u);

    // AC3: it moves, except with reduced motion.
    const animations = await flame.locator('path').evaluateAll((paths) => paths.map((p) => getComputedStyle(p).animationName));
    if (motion === 'reduce') expect(animations).toEqual(['none', 'none']);
    else expect(animations).toEqual(['flicker', 'flicker']);

    // AC6: picking carries on.
    const pick = page.getByRole('region', { name: 'Pick', exact: true });
    await expect(pick.getByRole('article')).toHaveCount(2);
    await pick.getByRole('article').first().getByRole('button', { name: /^pick /i }).click();
    await expect(pick.getByRole('article')).toHaveCount(2);
  });
}

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
  test(`#18 AC6 + #55 AC5 + AC8: reordering ${motion === 'reduce' ? 'is instant with reduced motion' : 'glides otherwise'}`, async ({ page }) => {
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

test('#55 AC6: a changed rank fades to its new medal and gets a ▲/▼ corner badge for about 1.5 s, without the chip changing width', async ({ page, browser }) => {
  const host = await hostSession(page, 4);
  await newPerson(browser, 'Nudger', host.path);
  await expect(board(page).getByRole('tablist')).toBeVisible({ timeout: 5_000 });
  const [a, b, c, d] = host.places;
  for (const [winner, loser] of [[a, b], [a, c], [a, d], [b, c], [b, d], [c, d]]) await host.pick(winner.id, loser.id);
  const hostRank = async (placeId: number) => (await host.data()).people.find((p) => p.name === host.name)!.ranking.findIndex((r) => r.placeId === placeId) + 1;
  await expect.poll(() => hostRank(d.id)).toBe(4);
  await expect(board(page).getByText(`${host.name} 4th`, { exact: true })).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(2_000); // any badges from getting here have gone
  await expect(board(page).getByTestId('rank-badge')).toHaveCount(0);

  // d overtakes c in the host's ranking: 4th → 3rd (better) and c 3rd → 4th (worse).
  while ((await hostRank(d.id)) > 3) await host.pick(d.id, c.id);
  const better = board(page).getByTestId('rank-badge').filter({ hasText: '▲' });
  const worse = board(page).getByTestId('rank-badge').filter({ hasText: '▼' });
  await expect(better).toBeVisible({ timeout: 5_000 });
  await expect(worse).toBeVisible();
  const risen = better.locator('..');
  await expect(risen).toContainText(`${host.name} 3rd`);
  await expect(risen).toHaveCSS('background-color', MEDAL_RGB.bronze);
  const [chipBox, badgeBox] = [(await risen.boundingBox())!, (await better.boundingBox())!];
  expect(badgeBox.x + badgeBox.width).toBeGreaterThan(chipBox.x + chipBox.width); // on the corner, over the edge
  expect(badgeBox.y).toBeLessThan(chipBox.y);
  const withBadge = chipBox.width;

  await expect(board(page).getByTestId('rank-badge')).toHaveCount(0, { timeout: 3_000 });
  const withoutBadge = (await rowFor(page, d.name).getByText(`${host.name} 3rd`, { exact: true }).boundingBox())!.width;
  expect(withBadge).toBeCloseTo(withoutBadge, 1);
});

test('#55 AC7: when the top pick changes, the new name moves onto the gold card and its new 1st chips grow their flame', async ({ page, browser }) => {
  const host = await hostSession(page, 3);
  const friend = await newPerson(browser, 'Swapper', host.path);
  await expect(board(page).getByRole('tablist')).toBeVisible({ timeout: 5_000 });
  const data = await host.data();
  const [oldTop, bottom] = [data.combined[0], data.combined.at(-1)!];
  await page.waitForTimeout(2_000);
  for (const who of [page, friend.page]) for (const other of data.combined.slice(0, -1)) await host.pick(bottom.placeId, other.placeId, who);
  await expect(topPick(page).getByRole('heading', { name: bottom.name })).toBeVisible({ timeout: 5_000 });
  await expect(topPick(page).getByTestId('flame').and(page.locator('.flame-in')).first()).toBeAttached();
  await expect(topPick(page).getByText(oldTop.name)).toHaveCount(0, { timeout: 2_000 }); // it moved out
});
