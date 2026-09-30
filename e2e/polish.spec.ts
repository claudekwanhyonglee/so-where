import { expect, test, type Locator } from '@playwright/test';
import { placeLink, uniqueName } from './helpers.ts';
import { DESKTOPS, LONG_PLACE, PORTRAIT, TABLET, endsInEllipsis, expectScreenWide, openOn, personNamed, pickingSession, settled } from './screens.ts';

test.describe.configure({ timeout: 120_000 });

/** The number of lines an element's text runs to. */
const lineCount = (l: Locator) =>
  l.evaluate((el) => {
    const tops = new Set<number>();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
    }
    return tops.size;
  });

test('#65 AC1: phone leaderboard tabs: "Together" in full, tabs as wide as their names (long ones end in …), and only the tab row scrolls', async ({ browser }) => {
  const session = await pickingSession(browser, { places: ['Embla', 'Tipo 00', 'Shujinko'], friends: 4, home: true });
  for (const s of [PORTRAIT[0], PORTRAIT[2]]) {
    const { page, context } = await openOn(browser, s, session.me.state);
    await page.goto(session.path);
    await page.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Leaderboard' }).click();
    const tablist = page.getByRole('tablist', { name: 'Whose ranking' });
    const tabs = tablist.getByRole('tab');
    await expect(tabs).toHaveCount(6);
    await settled(page);

    const together = tabs.filter({ hasText: 'Together' });
    expect(await together.evaluate((el) => el.scrollWidth <= el.clientWidth), `${s.name}: "Together" in full`).toBe(true);
    const [tabBox, listBox] = [(await together.boundingBox())!, (await tablist.boundingBox())!];
    expect(tabBox.x + tabBox.width, `${s.name}: "Together" on screen`).toBeLessThanOrEqual(listBox.x + listBox.width);

    expect(await endsInEllipsis(tabs.filter({ hasText: 'Bartholomew' })), `${s.name}: long name ends in …`).toBe(true);
    for (const tab of await tabs.all()) {
      const name = await tab.innerText();
      if (name.startsWith('Bartholomew')) continue;
      expect(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth), `${s.name}: "${name}" in full`).toBe(true);
    }
    expect(await tablist.evaluate((el) => el.scrollWidth > el.clientWidth), `${s.name}: the tab row scrolls`).toBe(true);
    await expectScreenWide(page, s);
    await context.close();
  }
  await session.close();
});

/** Whether the circle drawn by `circle` (a round element) overlaps `l`'s box. */
const overlapsCircle = async (circle: Locator, l: Locator) => {
  const [c, b] = [(await circle.boundingBox())!, (await l.boundingBox())!];
  const [cx, cy, r] = [c.x + c.width / 2, c.y + c.height / 2, c.width / 2];
  const nx = Math.max(b.x, Math.min(cx, b.x + b.width));
  const ny = Math.max(b.y, Math.min(cy, b.y + b.height));
  return Math.hypot(cx - nx, cy - ny) < r;
};

test('#65 AC2: the guide’s yellow circle never overlaps the step arrows or "Or add more places", and the desktop route panel fits its content', async ({ browser }) => {
  const me = await personNamed(browser, uniqueName('Guided'), { guide: true });
  const placeIds: number[] = [];
  for (const name of ['Invented Diner ', 'Invented Bakery ']) placeIds.push((await (await me.request.post('/api/places', { data: { url: placeLink(uniqueName(name)) } })).json()).place.id);
  for (const s of [PORTRAIT[0], PORTRAIT[2], TABLET, DESKTOPS[2], DESKTOPS[3]]) {
    const { page, context } = await openOn(browser, s, me.state);
    await page.goto('/');
    const card = page.getByTestId('guide-card');
    const more = card.getByRole('button', { name: 'Or add more places' });
    await expect(more).toBeVisible(); // the guide opens on its current step: picking
    await settled(page);
    const circle = card.locator(':scope > span[aria-hidden="true"]').first();
    for (const [what, l] of [
      ['Previous step', card.getByRole('button', { name: 'Previous step' })],
      ['Next step', card.getByRole('button', { name: 'Next step' })],
      ['Or add more places', more],
    ] as const) {
      expect(await overlapsCircle(circle, l), `${s.name}: circle over ${what}`).toBe(false);
    }
    if (s.width >= 760) {
      const panel = card.getByRole('region', { name: 'Your route to dinner' });
      const { height, content } = await panel.evaluate((el) => {
        const kids = [...el.children].filter((k) => k.getBoundingClientRect().height > 0).map((k) => k.getBoundingClientRect());
        const style = getComputedStyle(el);
        const content = Math.max(...kids.map((k) => k.bottom)) - Math.min(...kids.map((k) => k.top)) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        return { height: el.getBoundingClientRect().height, content };
      });
      expect(height, `${s.name}: route panel height`).toBeLessThanOrEqual(content + 1);
    }
    await context.close();
  }
  for (const id of placeIds) await me.request.delete(`/api/places/${id}`);
  await me.close();
});

test('#65 AC3: at 320px, the Places summary is one line, sheet titles are at most 2 lines, and the You page arrows match', async ({ browser }) => {
  const me = await personNamed(browser, uniqueName('Polish'));
  const { place } = await (await me.request.post('/api/places', { data: { url: placeLink(LONG_PLACE) } })).json();
  await me.request.put('/api/me/home', {
    data: { address: 'Unit 1234, 5678 The Extraordinarily Long Boulevard, Carlton North, Melbourne, Victoria, Australia', lat: -37.79, lng: 144.97, country: 'AU' },
  });
  const s = PORTRAIT[0];
  const { page, context } = await openOn(browser, s, me.state);

  await page.goto('/places');
  const summary = page.getByText(/^\d+ places? in \d+ sets?$/);
  await expect(summary).toBeVisible();
  expect(await lineCount(summary), 'summary lines').toBe(1);
  expect(await summary.evaluate((el) => el.scrollWidth <= el.clientWidth), 'summary spills').toBe(true);

  await page.goto('/places/all');
  await page.getByRole('button', { name: `More for ${LONG_PLACE}` }).click();
  const title = page.getByRole('dialog').getByRole('heading', { level: 2 });
  await expect(title).toBeVisible();
  const shownLines = await title.evaluate((el) => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
  expect(shownLines, 'sheet title lines').toBeLessThanOrEqual(2);
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth), 'sheet title spills').toBe(true);
  await page.keyboard.press('Escape');

  await page.goto('/you');
  const arrow = (row: string) => page.getByRole('button', { name: new RegExp(`^${row}`) }).locator('svg').last();
  const [home, pin] = [(await arrow('Home address').boundingBox())!, (await arrow('Change PIN').boundingBox())!];
  expect([home.width, home.height]).toEqual([pin.width, pin.height]);
  await context.close();
  await me.request.delete(`/api/places/${place.id}`);
  await me.close();
});
