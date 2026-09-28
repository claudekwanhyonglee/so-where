import { expect, test, type Page } from '@playwright/test';
import { addPlaceViaApi, newPerson, signUp, uniqueName } from './helpers.ts';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/** A session for a fresh set of `count` new places (the first with a note), opened in `page`. */
async function openSession(page: Page, count: number) {
  const places: { id: number; name: string }[] = [];
  for (let i = 0; i < count; i++) places.push(await addPlaceViaApi(page, uniqueName('Invented Eatery '), i === 0 ? 'Order the special' : ''));
  const { id: setId } = await (await page.request.post('/api/sets', { data: { name: uniqueName('Picking ') } })).json();
  for (const p of places) await page.request.put(`/api/sets/${setId}/places/${p.id}`);
  const { id } = await (await page.request.post('/api/sessions', { data: { setId } })).json();
  await page.goto(`/s/${id}`);
  await expect(cards(page)).toHaveCount(2);
  return { sessionId: id as string, places, idOf: (name: string) => places.find((p) => p.name === name)!.id };
}

const cards = (page: Page) => page.getByRole('region', { name: 'Pick', exact: true }).getByRole('article');
const cardName = async (page: Page, i: number) => (await cards(page).nth(i).getByRole('heading').innerText()).trim();
const pickCount = (page: Page, n: number) => expect(page.getByRole('region', { name: 'Pick', exact: true }).getByText(n === 1 ? '1 pick' : `${n} picks`, { exact: true })).toBeVisible();

test('#17 AC1: cards show name, suburb, note, Maps link and directions; a place keeps its colour', async ({ page }) => {
  await signUp(page, uniqueName('Looker'));
  const { places } = await openSession(page, 2);

  for (const card of await cards(page).all()) {
    await expect(card).toContainText('Carlton');
    await expect(card.getByRole('link', { name: /open in google maps/i })).toHaveAttribute('href', /maps\.google\.com\/\?cid=/);
    await expect(card.getByRole('link', { name: /directions/i })).toHaveAttribute('href', /travelmode=transit/); // no home yet
  }
  await expect(cards(page).filter({ hasText: places[0].name })).toContainText('Order the special');

  const colours = async () =>
    Object.fromEntries(await Promise.all((await cards(page).all()).map(async (c) => [await c.getByRole('heading').innerText(), await c.evaluate((el) => getComputedStyle(el).backgroundColor)])));
  const before = await colours();
  await cards(page).first().getByRole('button', { name: /^pick /i }).click();
  await pickCount(page, 1);
  expect(await colours()).toEqual(before); // the same two places, the same colours
  expect(new Set(Object.values(before)).size).toBe(2);
});

test('#17 AC1: with a home address the card shows transit minutes instead of directions', async ({ page }) => {
  await signUp(page, uniqueName('Homebody'));
  await page.request.put('/api/me/home', { data: { address: '1 Lygon St, Carlton' } });
  await openSession(page, 2);
  for (const card of await cards(page).all()) {
    await expect(card).toContainText('25 min');
    await expect(card.getByRole('link', { name: /directions/i })).toHaveCount(0);
  }
});

test('#17 AC2 + AC3: tapping a card picks it; Too close to call records a tie', async ({ page }) => {
  await signUp(page, uniqueName('Picker'));
  await openSession(page, 3);
  await pickCount(page, 0);
  const picked = page.waitForRequest((r) => r.url().endsWith('/picks'));
  await cards(page).first().click();
  expect((await picked).postDataJSON().winner).not.toBeNull();
  await pickCount(page, 1);
  await expect(cards(page)).toHaveCount(2);

  const tied = page.waitForRequest((r) => r.url().endsWith('/picks'));
  await page.getByRole('button', { name: 'Too close to call' }).click();
  expect((await tied).postDataJSON().winner).toBeNull();
  await pickCount(page, 2);
  await expect(cards(page)).toHaveCount(2);
});

test('#17 AC4: "Absolutely not" vetoes with an Undo toast', async ({ page }) => {
  await signUp(page, uniqueName('Vetoer'));
  const { sessionId, idOf } = await openSession(page, 3);
  const name = await cardName(page, 0);
  const veto = cards(page).first().getByRole('button', { name: 'Absolutely not', exact: true });
  await expect(veto).toHaveAttribute('title', 'Absolutely not');
  await veto.click();

  const toast = page.getByText(`${name} is out for tonight`);
  await expect(toast).toBeVisible();
  await expect(cards(page).filter({ hasText: name })).toHaveCount(0);
  const vetoedBy = async () => (await (await page.request.get(`/api/sessions/${sessionId}/leaderboard`)).json()).combined.find((r: { placeId: number }) => r.placeId === idOf(name)).vetoedBy;
  expect(await vetoedBy()).toHaveLength(1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(vetoedBy).toHaveLength(0);
});

test('#17 AC5: arrow keys pick on a desktop, and do nothing on a phone', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signUp(page, uniqueName('Keys'));
  const { idOf } = await openSession(page, 3);

  for (const [i, [key, side]] of ([['ArrowLeft', 0], ['ArrowRight', 1], ['ArrowDown', null]] as const).entries()) {
    const expected = side === null ? null : idOf(await cardName(page, side));
    const pick = page.waitForRequest((r) => r.url().endsWith('/picks'));
    await page.keyboard.press(key);
    expect((await pick).postDataJSON().winner).toBe(expected);
    await pickCount(page, i + 1); // the next pair is up
  }

  await page.setViewportSize(PHONE);
  let requests = 0;
  page.on('request', (r) => r.url().endsWith('/picks') && requests++);
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(key);
  await page.waitForTimeout(500);
  expect(requests).toBe(0);
  await pickCount(page, 3);
});

test('#17 AC6: a "Just you so far" banner until a second person joins', async ({ page, browser }) => {
  await signUp(page, uniqueName('Solo'));
  const { sessionId } = await openSession(page, 2);
  const banner = page.getByRole('region', { name: 'Just you so far' });
  await expect(banner).toContainText('Just you so far');
  await expect(banner.getByRole('button', { name: 'Share' })).toBeVisible();

  await newPerson(browser, 'Joiner', `/s/${sessionId}`);
  await expect(banner).toBeHidden({ timeout: 10_000 });
});

test('#17 AC7: Share uses the device share sheet when there is one', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => void ((window as unknown as { shared: ShareData }).shared = data) });
  });
  await signUp(page, uniqueName('Sharer'));
  const { sessionId } = await openSession(page, 2);
  await page.getByRole('button', { name: 'Share' }).first().click();
  const shared = await page.waitForFunction(() => (window as unknown as { shared?: ShareData }).shared);
  expect((await shared.jsonValue())!.url).toMatch(new RegExp(`/s/${sessionId}\\?invite=`));
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('#17 AC7: without one, Share opens a sheet with the link, Copy, and who has picked how much', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  const me = uniqueName('Copier');
  await signUp(page, me);
  const { sessionId } = await openSession(page, 2);
  const friend = await newPerson(browser, 'Mate', `/s/${sessionId}`);
  await expect(friend.page.getByRole('article')).toHaveCount(2);
  await cards(page).first().click();
  await pickCount(page, 1);

  await page.getByRole('button', { name: 'Share' }).first().click();
  const sheet = page.getByRole('dialog');
  const link = await sheet.getByLabel('Share link').inputValue();
  expect(link).toMatch(new RegExp(`/s/${sessionId}\\?invite=`));
  await sheet.getByRole('button', { name: 'Copy' }).click();
  await expect(sheet.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  await expect(sheet.getByRole('listitem').filter({ hasText: me })).toContainText('1 pick');
  await expect(sheet.getByRole('listitem').filter({ hasText: friend.name })).toContainText('0 picks');
});

test('#17 AC8: a Pick / Leaderboard toggle on phones; both side by side on desktops', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signUp(page, uniqueName('Toggler'));
  await openSession(page, 2);
  const toggle = page.getByRole('group', { name: 'Session view' });
  const picker = page.getByRole('region', { name: 'Pick', exact: true });
  const board = page.getByRole('region', { name: 'Leaderboard' });

  await expect(picker).toBeVisible();
  await expect(board).toBeHidden();
  await toggle.getByRole('button', { name: 'Leaderboard' }).click();
  await expect(board).toBeVisible();
  await expect(picker).toBeHidden();
  await toggle.getByRole('button', { name: 'Pick' }).click();
  await expect(picker).toBeVisible();

  await page.setViewportSize(DESKTOP);
  await expect(toggle).toBeHidden();
  await expect(picker).toBeVisible();
  await expect(board).toBeVisible();
  const [p, b] = [(await picker.boundingBox())!, (await board.boundingBox())!];
  expect(b.x).toBeGreaterThanOrEqual(p.x + p.width - 1); // beside, not below
  expect(b.y).toBeLessThan(p.y + p.height);
});
