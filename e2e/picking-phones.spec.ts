import { expect, test, type Locator, type Page } from '@playwright/test';
import { ALL_SCREENS, DESKTOPS, LANDSCAPE, LONG_NOTE, LONG_PLACE, LONG_SET, LONG_WORD, PHONES, PORTRAIT, TABLET, openOn, pickingSession, settled, type Screen } from './screens.ts';

test.describe.configure({ timeout: 180_000 }); // each test goes through many screen sizes

const pickRegion = (page: Page) => page.getByRole('region', { name: 'Pick', exact: true });
const cards = (page: Page) => pickRegion(page).getByRole('article');
const tie = (page: Page) => page.getByRole('button', { name: 'Too close to call' });
const nopeHeading = (page: Page) => page.getByRole('region', { name: 'Absolutely not' }).getByTestId('nope-count');
// CSS locators: the one the layout doesn't use is display:none, which role locators never find.
const tabBar = (page: Page) => page.locator('nav[aria-label="Tabs"]');
const topNav = (page: Page) => page.locator('nav[aria-label="Main"]');

/** A busy session: 5 people, long names, a long note, and two places ruled out (so "Absolutely not" is open). */
async function busySession(browser: import('@playwright/test').Browser) {
  const session = await pickingSession(browser, {
    places: [LONG_PLACE, [LONG_WORD, LONG_NOTE], 'Embla', 'Tipo 00', 'Shujinko', 'Chin Chin'],
    setName: LONG_SET,
    friends: 4,
    home: true,
  });
  await session.veto(session.placeIds[4]);
  await session.veto(session.placeIds[5]);
  return session;
}

async function openBusy(browser: import('@playwright/test').Browser, s: Screen, state: Parameters<typeof openOn>[2], path: string) {
  const { page, context } = await openOn(browser, s, state);
  await page.goto(path);
  await expect(cards(page)).toHaveCount(2);
  await expect(nopeHeading(page)).toBeVisible();
  await settled(page);
  return { page, context };
}

const pageScrolls = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth);

/** `l` lies wholly in the window, above the tab bar if there is one. */
async function expectOnScreen(page: Page, l: Locator, s: Screen, what: string) {
  const box = (await l.boundingBox())!;
  const bar = await tabBar(page).boundingBox();
  const bottom = bar && bar.height > 0 ? bar.y : s.height;
  expect(box.x, `${s.name}: ${what} left`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${s.name}: ${what} top`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${s.name}: ${what} right`).toBeLessThanOrEqual(s.width);
  expect(box.y + box.height, `${s.name}: ${what} bottom`).toBeLessThanOrEqual(bottom + 0.5);
}

test('#62 AC1: at every phone size, with 5 people and "Absolutely not" open, nothing scrolls and every control is above the tab bar', async ({ browser }) => {
  const session = await busySession(browser);
  for (const s of PHONES) {
    const { page, context } = await openBusy(browser, s, session.me.state, session.path);
    expect(await pageScrolls(page), `${s.name}: page scrolls`).toBe(false);
    await expectOnScreen(page, cards(page).first(), s, 'first card');
    await expectOnScreen(page, cards(page).last(), s, 'second card');
    await expectOnScreen(page, tie(page), s, '"Too close to call"');
    await expectOnScreen(page, nopeHeading(page), s, '"Absolutely not" heading');
    await context.close();
  }
  await session.close();
});

test('#62 AC2: landscape phones get the phone layout with cards side by side, the view toggle in the header row and a slim tab bar', async ({ browser }) => {
  const session = await busySession(browser);
  for (const s of LANDSCAPE) {
    const { page, context } = await openBusy(browser, s, session.me.state, session.path);
    await expect(tabBar(page), s.name).toBeVisible();
    await expect(topNav(page), s.name).toBeHidden();
    expect((await tabBar(page).boundingBox())!.height, `${s.name}: tab bar height`).toBeLessThanOrEqual(44);

    const [a, b] = [(await cards(page).first().boundingBox())!, (await cards(page).last().boundingBox())!];
    expect(b.x, `${s.name}: side by side`).toBeGreaterThanOrEqual(a.x + a.width);
    expect(Math.abs(b.y - a.y), `${s.name}: same row`).toBeLessThan(1);

    const toggle = (await page.getByRole('group', { name: 'Session view' }).boundingBox())!;
    const back = (await page.getByRole('link', { name: 'Back' }).boundingBox())!;
    expect(Math.abs(toggle.y + toggle.height / 2 - (back.y + back.height / 2)), `${s.name}: toggle beside the back button`).toBeLessThan(6);
    await context.close();
  }
  await session.close();
});

test('#62 AC3: portrait 320px with 5 people: "Picking from" on one line, 3 avatars and "+2", and at least 150px for the set name', async ({ browser }) => {
  const session = await busySession(browser);
  const s = PORTRAIT[0];
  const { page, context } = await openBusy(browser, s, session.me.state, session.path);
  const eyebrow = page.getByText('Picking from', { exact: true });
  const { lines, spills } = await eyebrow.evaluate((el) => {
    const line = el.parentElement!;
    const tops = new Set<number>();
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
    }
    return { lines: tops.size, spills: line.scrollWidth > line.clientWidth };
  });
  expect(lines, '"Picking from" lines').toBe(1);
  expect(spills, '"Picking from" line spills').toBe(false);

  const here = page.getByRole('list', { name: "Who's here" });
  await expect(here.getByRole('listitem')).toHaveCount(5); // everyone is still listed for screen readers
  // Faces not shown are in visually hidden (1px) list items, still there for screen readers.
  const shownAvatars = await here.locator('[title]').evaluateAll((els) => els.filter((el) => el.closest('li')!.getBoundingClientRect().width > 1).length);
  expect(shownAvatars).toBe(3);
  await expect(page.getByText('+2', { exact: true })).toBeVisible();

  const title = (await page.getByRole('heading', { name: LONG_SET, level: 1 }).boundingBox())!;
  expect(title.width).toBeGreaterThanOrEqual(150);
  await context.close();
  await session.close();
});

test('#62 AC4: the desktop layout needs 760px wide and 500px tall; at 1024×600 the picking screen fits', async ({ browser }) => {
  const session = await busySession(browser);
  for (const s of [...PHONES, TABLET, ...DESKTOPS]) {
    const { page, context } = await openBusy(browser, s, session.me.state, session.path);
    const desktop = s.width >= 760 && s.height >= 500;
    await expect(topNav(page), s.name).toBeVisible({ visible: desktop });
    await expect(tabBar(page), s.name).toBeVisible({ visible: !desktop });
    if (s.width === 1024) {
      expect(await pageScrolls(page), `${s.name}: page scrolls`).toBe(false);
      for (const l of [cards(page).first(), cards(page).last(), tie(page), nopeHeading(page)]) await expectOnScreen(page, l, s, 'control');
    }
    await context.close();
  }
  await session.close();
});

test('#62 AC5: the OR badge is round at every size', async ({ browser }) => {
  const session = await busySession(browser);
  for (const s of ALL_SCREENS) {
    const { page, context } = await openBusy(browser, s, session.me.state, session.path);
    const or = (await pickRegion(page).getByTestId('or').boundingBox())!;
    expect(Math.abs(or.width - or.height), `${s.name}: OR is ${or.width}×${or.height}`).toBeLessThan(0.5);
    await context.close();
  }
  await session.close();
});
