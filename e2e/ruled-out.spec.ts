import { expect, test, type Page } from '@playwright/test';
import { addPlaceViaApi, newPerson, signUp, uniqueName } from './helpers.ts';

const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 360, height: 740 };
const DESKTOP = { width: 1280, height: 800 };

/** A session over `count` fresh places, opened by `page`'s new person, with a friend in it too (so no "Just you" banner). */
async function openSession(page: Page, browser: import('@playwright/test').Browser, count = 6) {
  const me = uniqueName('Nope');
  await signUp(page, me);
  const places: { id: number; name: string }[] = [];
  for (let i = 0; i < count; i++) places.push(await addPlaceViaApi(page, uniqueName('Invented Bistro ')));
  const { id: setId } = await (await page.request.post('/api/sets', { data: { name: uniqueName('Nopes ') } })).json();
  for (const p of places) await page.request.put(`/api/sets/${setId}/places/${p.id}`);
  const { id } = await (await page.request.post('/api/sessions', { data: { setId } })).json();
  const friend = await newPerson(browser, 'Jo', `/s/${id}`);
  await page.goto(`/s/${id}`);
  await expect(cards(page)).toHaveCount(2);
  const veto = (placeId: number, who: Page = page) => who.request.post(`/api/sessions/${id}/vetoes`, { data: { placeId } });
  return { me, places, friend, sessionId: id as string, veto };
}

const pickRegion = (page: Page) => page.getByRole('region', { name: 'Pick', exact: true });
const cards = (page: Page) => pickRegion(page).getByRole('article');
const section = (page: Page) => page.getByRole('region', { name: 'Absolutely not' });
const chips = (page: Page) => section(page).getByTestId('nope-chip');
const pageScrolls = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1 || document.body.scrollHeight > innerHeight + 1);

test('#57 AC1 + AC2 + AC3: no section until something is ruled out; then it opens under "Too close to call" with a straight counted stamp, and each place is a struck-through chip saying who', async ({ page, browser }) => {
  const { places, friend, veto } = await openSession(page, browser);
  await expect(section(page)).toHaveCount(0);

  await veto(places[0].id, friend.page);
  await expect(section(page)).toBeVisible({ timeout: 5_000 });
  const stamp = section(page).getByTestId('nope-count');
  await expect(stamp).toHaveText('Absolutely not · 1');
  expect(await stamp.evaluate((el) => getComputedStyle(el).transform)).toBe('none'); // not tilted
  const tie = await page.getByRole('button', { name: 'Too close to call' }).boundingBox();
  expect((await section(page).boundingBox())!.y).toBeGreaterThan(tie!.y + tie!.height - 1);

  const theirs = chips(page).filter({ hasText: places[0].name });
  await expect(theirs).toContainText(friend.name);
  expect(await theirs.locator('s').innerText()).toBe(places[0].name);

  await veto(places[1].id);
  await expect(stamp).toHaveText('Absolutely not · 2', { timeout: 5_000 });
  const mine = chips(page).filter({ hasText: places[1].name });
  await expect(mine).toContainText('You');
  await expect(mine).toHaveClass(/chip-in/);
});

test("#57 AC4 + AC5: your own chips bring the place back (with a toast and Undo); others' can't be tapped; the last one closes the section", async ({ page, browser }) => {
  const { places, friend, sessionId, veto } = await openSession(page, browser);
  await veto(places[0].id, friend.page);
  await veto(places[1].id);
  await expect(chips(page)).toHaveCount(2, { timeout: 5_000 });

  const theirs = chips(page).filter({ hasText: places[0].name });
  await expect(theirs.getByRole('button')).toHaveCount(0);
  expect(await theirs.evaluate((el) => el.tagName)).not.toBe('BUTTON');

  const mine = section(page).getByRole('button', { name: `Bring ${places[1].name} back` });
  await expect(mine).toContainText('↺');
  const brought = page.waitForRequest((r) => r.method() === 'DELETE' && r.url().endsWith(`/vetoes/${places[1].id}`));
  await mine.click();
  await brought;
  await expect(page.getByText(`${places[1].name} is back in`)).toBeVisible();
  await expect(chips(page).filter({ hasText: places[1].name })).toHaveCount(0);

  // Undo rules it out again.
  const again = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/vetoes'));
  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await again).postDataJSON()).toEqual({ placeId: places[1].id });
  await expect(chips(page).filter({ hasText: places[1].name })).toHaveCount(1, { timeout: 5_000 });

  // Once only the friend's is left and they bring it back, the section closes.
  await section(page).getByRole('button', { name: `Bring ${places[1].name} back` }).click();
  await expect(chips(page)).toHaveCount(1, { timeout: 5_000 });
  await friend.page.request.delete(`/api/sessions/${sessionId}/vetoes/${places[0].id}`);
  await expect(section(page)).toHaveCount(0, { timeout: 5_000 });
});

for (const [label, size] of [
  ['a phone (Pick tab)', PHONE],
  ['a small phone (Pick tab)', SMALL_PHONE],
  ['a desktop', DESKTOP],
] as const) {
  test(`#57 AC6 + AC8: on ${label}, however many are ruled out the screen never scrolls; the section scrolls inside, with a fade, and keeps its scroll to itself`, async ({ page, browser }) => {
    await page.setViewportSize(size);
    const { places, friend, veto } = await openSession(page, browser, 14);
    expect(await pageScrolls(page)).toBe(false);
    const cardHeight = (await cards(page).first().boundingBox())!.height;

    const onScreen = await cards(page).getByRole('heading').allInnerTexts();
    // Yours (so no one else's toasts cover the section), and not the pair on screen, which is still to pick from.
    for (const p of places.filter((p) => !onScreen.includes(p.name))) await veto(p.id);
    await expect(chips(page)).toHaveCount(12, { timeout: 5_000 });
    await page.waitForTimeout(600); // the section and cards finish moving
    expect(await pageScrolls(page)).toBe(false);

    const items = section(page).getByTestId('nope-items');
    expect(await items.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await items.evaluate((el) => getComputedStyle(el).maskImage)).toMatch(/gradient/);
    expect(await items.evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe('contain');
    await items.hover();
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => items.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);

    // The section shows at least 2 rows of chips, all below "Too close to call", and above the tab bar or window edge.
    const [first, sectionBox] = [(await chips(page).first().boundingBox())!, (await section(page).boundingBox())!];
    const itemsBox = (await items.boundingBox())!;
    expect(itemsBox.height).toBeGreaterThanOrEqual(first.height * 2 + 7);
    expect(sectionBox.y + sectionBox.height).toBeLessThanOrEqual(size.height);

    if (size !== DESKTOP) {
      // AC8: the cards got shorter to make room, and their names and buttons are still whole and tappable.
      expect((await cards(page).first().boundingBox())!.height).toBeLessThan(cardHeight);
      for (const card of await cards(page).all()) {
        const box = (await card.boundingBox())!;
        for (const part of [card.getByRole('heading'), card.getByRole('button', { name: 'Absolutely not', exact: true }), card.getByRole('link', { name: 'Open in Google Maps' })]) {
          const b = (await part.boundingBox())!;
          expect(b.y).toBeGreaterThanOrEqual(box.y - 1);
          expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 1);
          expect(b.y + b.height).toBeLessThanOrEqual(size.height);
        }
      }
      await cards(page).first().getByRole('button', { name: /^Pick / }).click();
      await expect(page.getByText('1 pick', { exact: true }).filter({ visible: true })).toBeVisible(); // in the header on a phone (#62)
    }
  });
}

test('#57 AC8: when the section closes, phone cards return to their normal height', async ({ page, browser }) => {
  await page.setViewportSize(PHONE);
  const { places, veto } = await openSession(page, browser);
  const before = (await cards(page).first().boundingBox())!.height;
  await veto(places[5].id);
  await expect(chips(page)).toHaveCount(1, { timeout: 5_000 });
  await section(page).getByRole('button', { name: `Bring ${places[5].name} back` }).click();
  await expect(section(page)).toHaveCount(0, { timeout: 5_000 });
  await page.waitForTimeout(600);
  expect((await cards(page).first().boundingBox())!.height).toBeGreaterThanOrEqual(Math.min(before, 170) - 1); // back to the normal minimum
});

test('#57 AC7: with reduced motion the section and chips appear and go without moving', async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { places, veto } = await openSession(page, browser);
  await veto(places[0].id);
  await expect(chips(page)).toHaveCount(1, { timeout: 5_000 });
  expect(await chips(page).first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  expect(await section(page).evaluate((el) => getComputedStyle(el.parentElement!).transitionDuration)).toBe('0s');
});

test('#57: the empty picking screen points at the section', async ({ page, browser }) => {
  const { places, veto } = await openSession(page, browser, 3);
  await veto(places[0].id);
  await veto(places[1].id);
  await page.reload();
  await expect(pickRegion(page).getByText('Not enough places left to compare')).toBeVisible();
  await expect(pickRegion(page)).toContainText('bring one back from "Absolutely not" below');
  await expect(section(page)).toBeVisible();
});
