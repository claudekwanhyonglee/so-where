import { expect, test, type Locator, type Page } from '@playwright/test';
import { ALL_SCREENS, DESKTOPS, LANDSCAPE, LONG_NOTE, LONG_PLACE, LONG_WORD, PORTRAIT, endsInEllipsis, expectScreenWide, openOn, pickingSession, settled } from './screens.ts';

test.describe.configure({ timeout: 180_000 }); // each test goes through many screen sizes

const pickRegion = (page: Page) => page.getByRole('region', { name: 'Pick', exact: true });
const cards = (page: Page) => pickRegion(page).getByRole('article');
const tie = (page: Page) => page.getByRole('button', { name: 'Too close to call' });

/** Whether any line of `title`'s text overlaps `other`'s box. */
const textOverlaps = async (title: Locator, other: Locator) =>
  title.evaluate((el, button) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const b = button!.getBoundingClientRect();
    return [...range.getClientRects()].some((r) => r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom);
  }, await other.elementHandle());

test('#61 AC1: card titles show at most 2 lines ending in …, a long single word breaks, and titles keep clear of "Absolutely not"', async ({ browser }) => {
  const session = await pickingSession(browser, { places: [LONG_PLACE, LONG_WORD] });
  for (const s of [PORTRAIT[0], PORTRAIT[2], LANDSCAPE[1], DESKTOPS[0], DESKTOPS[3]]) {
    const { page, context } = await openOn(browser, s, session.me.state);
    await page.goto(session.path);
    await expect(cards(page)).toHaveCount(2);
    await settled(page);
    for (const card of await cards(page).all()) {
      const title = card.getByRole('heading');
      const { lines, clamp, spills } = await title.evaluate((el) => {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        return { lines: Math.round(el.clientHeight / lineHeight), clamp: getComputedStyle(el).webkitLineClamp, spills: el.scrollWidth > el.clientWidth };
      });
      expect(lines, `${s.name}: lines`).toBeLessThanOrEqual(2);
      expect(clamp, `${s.name}: clamped with …`).toBe('2');
      expect(spills, `${s.name}: spills sideways`).toBe(false);
      expect(await textOverlaps(title, card.getByRole('button', { name: 'Absolutely not' })), `${s.name}: overlaps "Absolutely not"`).toBe(false);
    }
    const long = cards(page).filter({ hasText: LONG_PLACE }).getByRole('heading');
    expect(await long.evaluate((el) => el.scrollHeight > el.clientHeight), `${s.name}: long name is cut`).toBe(true);
    await context.close();
  }
  await session.close();
});

test('#61 AC2: at every size the picking screen is screen-wide with both cards fully across it', async ({ browser }) => {
  const session = await pickingSession(browser, { places: [LONG_PLACE, [LONG_WORD, LONG_NOTE]], friends: 1, home: true });
  for (const s of ALL_SCREENS) {
    const { page, context } = await openOn(browser, s, session.me.state);
    await page.goto(session.path);
    await expect(cards(page)).toHaveCount(2);
    await settled(page);
    await expectScreenWide(page, s);
    for (const card of await cards(page).all()) {
      const box = (await card.boundingBox())!;
      expect(box.x, `${s.name}: left edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${s.name}: right edge`).toBeLessThanOrEqual(s.width);
      expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth), `${s.name}: nothing spills out of the card`).toBe(true);
    }
    await context.close();
  }
  await session.close();
});

test('#61 AC3: at a given size both cards and "Too close to call" keep their size and place for every pair', async ({ browser }) => {
  const session = await pickingSession(browser, { places: ['Embla', [LONG_PLACE, LONG_NOTE], LONG_WORD, ['Tipo 00', 'Best pasta']], home: true });
  for (const s of [PORTRAIT[0], PORTRAIT[2], LANDSCAPE[1], DESKTOPS[0], DESKTOPS[3]]) {
    const { page, context } = await openOn(browser, s, session.me.state);
    await page.goto(session.path);
    const seen = new Set<string>();
    let first: string | undefined;
    for (let pair = 0; pair < 6; pair++) {
      await expect(cards(page)).toHaveCount(2);
      await page.waitForLoadState('networkidle');
      await settled(page);
      for (const card of await cards(page).all()) seen.add((await card.getByRole('heading').innerText()).trim());
      const boxes = JSON.stringify(await Promise.all([cards(page).first(), cards(page).last(), tie(page)].map((l) => l.boundingBox())));
      if (first === undefined) first = boxes;
      else expect(boxes, `${s.name}: pair ${pair + 1}`).toBe(first);
      const shown = await pickRegion(page).locator('.pick-pair').elementHandle();
      await tie(page).dispatchEvent('click'); // on to the next pair (whether it's reachable is #62's business)
      await expect.poll(() => shown!.evaluate((el) => el.isConnected)).toBe(false);
    }
    expect([...seen].some((name) => name.startsWith('The Extraordinarily') || name === LONG_WORD), `${s.name}: saw a long name`).toBe(true);
    await context.close();
  }
  await session.close();
});

test('#61 AC4: long names in the "Absolutely not" chips end in … inside the column', async ({ browser }) => {
  const session = await pickingSession(browser, { places: [LONG_PLACE, 'Embla', 'Shujinko'] });
  await session.veto(session.placeIds[0]);
  for (const s of [PORTRAIT[0], DESKTOPS[0]]) {
    const { page, context } = await openOn(browser, s, session.me.state);
    await page.goto(session.path);
    const items = page.getByRole('region', { name: 'Absolutely not' }).getByTestId('nope-items');
    const chip = items.getByTestId('nope-chip').filter({ hasText: 'The Extraordinarily' });
    await expect(chip).toBeVisible();
    await settled(page);
    expect(await endsInEllipsis(chip.locator('s')), `${s.name}: ellipsis`).toBe(true);
    const [c, column] = [(await chip.boundingBox())!, (await items.boundingBox())!];
    expect(c.x + c.width, `${s.name}: chip inside the column`).toBeLessThanOrEqual(column.x + column.width + 0.5);
    await context.close();
  }
  await session.close();
});
