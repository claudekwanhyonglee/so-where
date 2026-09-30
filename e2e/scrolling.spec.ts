import { expect, test, type Page } from '@playwright/test';
import { placeLink, uniqueName } from './helpers.ts';
import { DESKTOPS, PORTRAIT, openOn, personNamed, pickingSession, settled } from './screens.ts';

test.describe.configure({ timeout: 120_000 });

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

/** Marks what's under the middle of the window (the nearest `selector` around it) so a click doesn't have to scroll to it. */
const markMiddle = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2)!.closest(sel)!;
    el.setAttribute('data-test-middle', '');
  }, selector);

/** A touch swipe (finger moving up, so the content would scroll down) at a point, as a phone would send it. */
async function swipeUp(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: -300, gestureSourceType: 'touch', speed: 2000 });
  await cdp.detach();
}

async function placesWithASet(browser: import('@playwright/test').Browser, count: number) {
  const me = await personNamed(browser, uniqueName('Scroller'));
  const placeIds: number[] = [];
  for (let i = 0; i < count; i++) placeIds.push((await (await me.request.post('/api/places', { data: { url: placeLink(uniqueName('Invented Stop ')) } })).json()).place.id);
  const { id: setId } = await (await me.request.post('/api/sets', { data: { name: uniqueName('Scrolls ') } })).json();
  await me.request.put(`/api/sets/${setId}/places/${placeIds[0]}`);
  const close = async () => {
    await me.request.delete(`/api/sets/${setId}`);
    for (const id of placeIds) await me.request.delete(`/api/places/${id}`);
    await me.close();
  };
  return { me, setId: setId as number, close };
}

test('#64 AC1: while a sheet is open, scrolling outside it leaves the page where it was, and a long sheet scrolls inside itself', async ({ browser }) => {
  const { me, setId, close } = await placesWithASet(browser, 16);
  for (const s of [PORTRAIT[2], DESKTOPS[3]]) {
    const { page, context } = await openOn(browser, s, me.state);
    await page.goto('/places/all');
    await expect(page.getByRole('list', { name: 'Places in All places' }).getByRole('listitem').nth(15)).toBeAttached();
    await page.evaluate(() => scrollTo(0, 400));
    await expect.poll(() => scrollY(page)).toBe(400);

    await markMiddle(page, 'li');
    await page.locator('[data-test-middle]').getByRole('button', { name: /^More for/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await settled(page);
    await page.mouse.move(5, 5); // on the dimmed overlay
    await page.mouse.wheel(0, 600);
    if (s.mobile) await swipeUp(page, s.width / 2, 40);
    await page.waitForTimeout(300);
    expect(await scrollY(page), `${s.name}: page moved under the sheet`).toBe(400);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(await scrollY(page), `${s.name}: page after the sheet closed`).toBe(400);

    await page.goto(`/places/${setId}`);
    await page.getByRole('button', { name: 'Add to set' }).click();
    await expect(sheet).toBeVisible();
    await settled(page);
    expect(await sheet.evaluate((el) => el.scrollHeight > el.clientHeight), `${s.name}: sheet content is long`).toBe(true);
    const box = (await sheet.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => sheet.evaluate((el) => el.scrollTop), `${s.name}: sheet scrolls`).toBeGreaterThan(0);
    await context.close();
  }
  await close();
});

test('#64 AC2: an in-app link opens the next page at the top; Back and Forward put each page back where it was', async ({ browser }) => {
  const { me, close } = await placesWithASet(browser, 30);
  const s = PORTRAIT[2];
  const { page, context } = await openOn(browser, s, me.state);
  await page.goto('/places/all');
  const rows = page.getByRole('list', { name: 'Places in All places' }).getByRole('listitem');
  await expect(rows.nth(29)).toBeAttached();
  await page.evaluate(() => scrollTo(0, 900));
  await expect.poll(() => scrollY(page)).toBe(900);

  await page.getByRole('link', { name: 'Places', exact: true }).click(); // the tab bar: to the list of sets
  await expect(page.getByRole('list', { name: 'Sets' })).toBeVisible();
  expect(await scrollY(page), 'new page opens at the top').toBe(0);
  await page.evaluate(() => scrollTo(0, 120));
  await expect.poll(() => scrollY(page)).toBe(120);

  await page.goBack();
  await expect(rows.nth(29)).toBeAttached();
  await expect.poll(() => scrollY(page), 'Back restores the scroll').toBe(900);
  await page.goForward();
  await expect(page.getByRole('list', { name: 'Sets' })).toBeVisible();
  await expect.poll(() => scrollY(page), 'Forward restores the scroll').toBe(Math.min(120, await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)));
  await context.close();
  await close();
});

test('#64 AC3: when someone else rules a place out, the chips already there stay put and the new one goes at the end', async ({ browser }) => {
  const session = await pickingSession(browser, { places: ['Embla', 'Tipo 00', 'Shujinko', 'Chin Chin', 'Hochi Mama'], friends: 1, home: true });
  const [best, ...rest] = session.placeIds;
  for (const other of rest) await session.me.request.post(`/api/sessions/${session.sessionId}/picks`, { data: { a: best, b: other, winner: best } });
  const friend = session.others[0];
  const { page, context } = await openOn(browser, PORTRAIT[2], session.me.state);
  await page.goto(session.path);
  const chips = page.getByRole('region', { name: 'Absolutely not' }).getByTestId('nope-chip');

  await session.veto(rest[3], friend);
  await session.veto(rest[2], friend);
  await expect(chips).toHaveCount(2, { timeout: 5_000 });
  await settled(page);
  const before = await chips.evaluateAll((els) => els.map((el) => ({ text: el.textContent, box: JSON.stringify(el.getBoundingClientRect()) })));

  await session.veto(best, friend); // the best-ranked place: the board lists it above the others
  await expect(chips).toHaveCount(3, { timeout: 5_000 });
  await settled(page);
  const after = await chips.evaluateAll((els) => els.map((el) => ({ text: el.textContent, box: JSON.stringify(el.getBoundingClientRect()) })));
  expect(after.slice(0, 2)).toEqual(before);
  expect(after[2].text).toContain('Embla');
  await context.close();
  await session.close();
});
