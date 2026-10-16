import { expect, test, type Locator, type Page } from '@playwright/test';
import { ALL_SCREENS, DESKTOPS, LONG_PLACE, PORTRAIT, openOn, pickingSession, settled, type Screen } from './screens.ts';

test.describe.configure({ timeout: 300_000 }); // AC4 and AC5 go through every screen size

const board = (page: Page) => page.getByRole('region', { name: 'Leaderboard' });
const topPick = (page: Page) => board(page).getByRole('region', { name: 'Top pick' });
const rows = (page: Page) => board(page).getByRole('list', { name: 'Together' }).getByRole('listitem');
const fire = (page: Page) => page.getByTestId('fire');
const stamp = (page: Page) => page.getByTestId('pretty-sure');

/**
 * A session whose top pick is `top`, opened on `s` with the leaderboard showing. Its "pretty sure" is switched by
 * rewriting the leaderboard the page polls, so the test decides when the board is sure.
 */
async function boardOn(browser: import('@playwright/test').Browser, s: Screen, top: string) {
  const session = await pickingSession(browser, { places: [top, 'Embla', 'Tipo 00', 'Shujinko'], friends: 2, home: true });
  const [best, ...rest] = session.placeIds;
  for (const other of rest) await session.me.request.post(`/api/sessions/${session.sessionId}/picks`, { data: { a: best, b: other, winner: best } });
  const { page, context } = await openOn(browser, s, session.me.state);
  let sure = false;
  await page.route(/\/api\/sessions\/[^/]+\/leaderboard/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), prettySure: sure } });
  });
  await page.goto(session.path);
  if (s.width < 760 || s.height < 500) await page.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Leaderboard' }).click();
  await expect(topPick(page)).toContainText(top.slice(0, 20));
  await settled(page);
  const setSure = async (on: boolean) => {
    sure = on;
    await expect(stamp(page)).toHaveCount(on ? 1 : 0, { timeout: 5_000 });
    await expect(fire(page)).toHaveCount(on ? 1 : 0);
    await settled(page);
  };
  const close = async () => {
    await context.close();
    await session.close();
  };
  return { page, setSure, close };
}

const round = (b: { x: number; y: number; width: number; height: number } | null) => b && [b.x, b.y, b.width, b.height].map((n) => Math.round(n));

/** The top pick card and every row below it: where they are and how big. */
const layout = async (page: Page) => Promise.all([topPick(page), ...(await rows(page).all())].map(async (l) => round(await l.boundingBox())));

const expectSameLayout = (a: (number[] | null)[], b: (number[] | null)[], what: string) => {
  expect(b.length, what).toBe(a.length);
  a.forEach((box, i) => box!.forEach((n, j) => expect(Math.abs(n - b[i]![j]), `${what}: box ${i}`).toBeLessThanOrEqual(1)));
};

test('#66 AC1: switching "pretty sure" on or off moves nothing on the leaderboard, even with a long top pick', async ({ browser }) => {
  for (const s of [PORTRAIT[0], PORTRAIT[2], DESKTOPS[3]]) {
    const { page, setSure, close } = await boardOn(browser, s, LONG_PLACE);
    const before = await layout(page);
    await setSure(true);
    expectSameLayout(before, await layout(page), `${s.name}: sure`);
    await setSure(false);
    expectSameLayout(before, await layout(page), `${s.name}: not sure again`);
    await close();
  }
});

test('#66 AC2: while sure, the fire draws over the ranking tabs above the card, and taps still reach the tabs', async ({ browser }) => {
  for (const s of [PORTRAIT[2], DESKTOPS[3]]) {
    const { page, setSure, close } = await boardOn(browser, s, 'Tipo 00 e Poi');
    await setSure(true);
    const [f, card] = [(await fire(page).boundingBox())!, (await topPick(page).boundingBox())!];
    expect(f.y, `${s.name}: fire rises above the card`).toBeLessThan(card.y - 30);
    const tabs = board(page).getByRole('tab');
    let checked = 0;
    for (const tab of await tabs.all()) {
      const t = (await tab.boundingBox())!;
      const [left, right, top, bottom] = [Math.max(t.x, f.x), Math.min(t.x + t.width, f.x + f.width), Math.max(t.y, f.y), Math.min(t.y + t.height, f.y + f.height)];
      if (left >= right || top >= bottom) continue; // not under the fire
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role=tab]')?.textContent, [(left + right) / 2, (top + bottom) / 2]);
      expect(hit, `${s.name}: a tap under the fire`).toBe(await tab.innerText());
      checked++;
    }
    expect(checked, `${s.name}: tabs under the fire`).toBeGreaterThan(0);
    await close();
  }
});

/** The number of lines of text an element shows. */
const shownLines = (l: Locator) => l.evaluate((el) => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));

test('#66 AC3 + AC6: the top name wraps the same either way, the stamp keeps off it, and reads STATISTICALLY / “PRETTY SURE”', async ({ browser }) => {
  for (const s of [PORTRAIT[0], PORTRAIT[2], DESKTOPS[0], DESKTOPS[3]]) {
    const { page, setSure, close } = await boardOn(browser, s, LONG_PLACE);
    const name = topPick(page).getByRole('heading');
    const lines = await shownLines(name);
    await setSure(true);
    expect(await shownLines(name), `${s.name}: lines when sure`).toBe(lines);
    await expect(stamp(page)).toHaveText(/^Statistically\s*“Pretty sure”$/i);
    const overlaps = await name.evaluate((el, st) => {
      const s = st!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      return [...range.getClientRects()].some((r) => r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom);
    }, await stamp(page).elementHandle());
    expect(overlaps, `${s.name}: stamp over the name`).toBe(false);
    await close();
  }
});

type Rect = { left: number; top: number; right: number; bottom: number };

/** Everything that clips `el` (ancestors that scroll or hide overflow, and the window): their visible boxes. */
const clippers = (l: Locator) =>
  l.evaluate((el) => {
    const boxes: Rect[] = [{ left: 0, top: 0, right: innerWidth, bottom: innerHeight }];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const r = p.getBoundingClientRect();
      const left = r.left + p.clientLeft;
      const top = r.top + p.clientTop;
      boxes.push({ left, top, right: left + p.clientWidth, bottom: top + p.clientHeight });
    }
    return boxes;
  });

/**
 * Where the fire draws: everywhere its rising blobs go over a couple of seconds, within the region its goo filter
 * draws in (its box and 10% more each side).
 */
const fireArea = (page: Page) =>
  fire(page).evaluate(async (el) => {
    const r = el.getBoundingClientRect();
    const region = { left: r.left - r.width * 0.1, top: r.top - r.height * 0.1, right: r.right + r.width * 0.1, bottom: r.bottom + r.height * 0.1 };
    const drawn = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (let sample = 0; sample < 8; sample++) {
      for (const blob of el.querySelectorAll('i')) {
        const b = blob.getBoundingClientRect();
        drawn.left = Math.min(drawn.left, b.left);
        drawn.top = Math.min(drawn.top, b.top);
        drawn.right = Math.max(drawn.right, b.right);
        drawn.bottom = Math.max(drawn.bottom, b.bottom);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return {
      left: Math.max(drawn.left, region.left),
      top: Math.max(drawn.top, region.top),
      right: Math.min(drawn.right, region.right),
      bottom: Math.min(drawn.bottom, region.bottom),
    };
  });

/** Where the card's glow draws: its box grown by its shadow, at its biggest (the end of the heat animation). */
const glowArea = (page: Page) =>
  topPick(page).evaluate((el) => {
    const extents = () => {
      const [x, y, blur, spread] = (getComputedStyle(el).boxShadow.match(/-?[\d.]+px/g) ?? []).map(parseFloat);
      return { left: blur + spread - x, right: blur + spread + x, top: blur + spread - y, bottom: blur + spread + y };
    };
    const heat = el.getAnimations().find((a) => (a as CSSAnimation).animationName === 'heat');
    const samples = [extents()];
    if (heat) {
      heat.pause();
      heat.currentTime = Number(heat.effect!.getComputedTiming().duration);
      samples.push(extents());
      heat.play();
    }
    const r = el.getBoundingClientRect();
    const most = (side: keyof ReturnType<typeof extents>) => Math.max(0, ...samples.map((e) => e[side]));
    return { left: r.left - most('left'), top: r.top - most('top'), right: r.right + most('right'), bottom: r.bottom + most('bottom') };
  });

const expectWithin = (area: Rect, boxes: Rect[], what: string) => {
  for (const b of boxes) {
    expect(area.left, `${what}: left`).toBeGreaterThanOrEqual(b.left - 0.5);
    expect(area.top, `${what}: top`).toBeGreaterThanOrEqual(b.top - 0.5);
    expect(area.right, `${what}: right`).toBeLessThanOrEqual(b.right + 0.5);
    expect(area.bottom, `${what}: bottom`).toBeLessThanOrEqual(b.bottom + 0.5);
  }
};

/** The page's and the leaderboard column's scroll sizes. */
const scrollSizes = (page: Page) =>
  board(page).evaluate((el) => {
    let column: Element = el;
    while (column.parentElement && getComputedStyle(column).overflowY === 'visible') column = column.parentElement;
    const root = document.documentElement;
    return [root.scrollWidth, root.scrollHeight, column.scrollWidth, column.scrollHeight];
  });

test('#66 AC4 + AC5: at every size the fire and glow are never cut off, and being sure adds no scrolling', async ({ browser }) => {
  for (const s of ALL_SCREENS) {
    const { page, setSure, close } = await boardOn(browser, s, 'Tipo 00 e Poi');
    const unsure = await scrollSizes(page);
    await setSure(true);
    expectWithin(await fireArea(page), await clippers(fire(page)), `${s.name}: fire`);
    expectWithin(await glowArea(page), await clippers(topPick(page)), `${s.name}: glow`);
    expect(await scrollSizes(page), `${s.name}: scroll sizes`).toEqual(unsure);
    await close();
  }
});
