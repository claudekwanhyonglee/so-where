import { expect, type Browser, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import { INVITE, placeLink, uniqueName } from './helpers.ts';

/** A screen size from the layout audit (epic #59). Phones and the tablet get touch and mobile emulation. */
export type Screen = { name: string; width: number; height: number; mobile: boolean };

const screen = (width: number, height: number, mobile: boolean): Screen => ({ name: `${width}×${height}`, width, height, mobile });

export const PORTRAIT = [screen(320, 568, true), screen(360, 740, true), screen(390, 844, true), screen(430, 932, true)];
export const LANDSCAPE = [screen(568, 320, true), screen(740, 360, true), screen(814, 380, true), screen(932, 430, true)];
export const PHONES = [...PORTRAIT, ...LANDSCAPE];
export const TABLET = screen(768, 1024, true);
export const DESKTOPS = [screen(760, 900, false), screen(880, 700, false), screen(1024, 600, false), screen(1280, 800, false), screen(1920, 1080, false)];
export const ALL_SCREENS = [...PHONES, TABLET, ...DESKTOPS];

/** Edge-case data from the audit. */
export const LONG_PERSON = 'Bartholomew Maximilian Worthington III';
export const LONG_PLACE = 'The Extraordinarily Long-Named Neapolitan Pizzeria & Wine Bar';
export const LONG_WORD = 'Supercalifragilisticexpialidocious';
export const LONG_SET = 'Friday lunches near the office when it is raining';
export const LONG_NOTE = 'Ask for the table by the window, and try the burrata. Seriously, the burrata is worth the whole trip across the city.';

/**
 * Signs `name` in (signing them up the first time) in a fresh browser, past the home step and the guide.
 * Returns their signed-in state, for `openOn`, and an API client acting as them.
 */
export async function personNamed(browser: Browser, name: string) {
  const context = await browser.newContext();
  const { request } = context;
  await request.get(`/?invite=${INVITE}`);
  const created = await request.post('/api/people', { data: { name, pin: '1234' } });
  if (!created.ok()) expect((await request.post('/api/signin', { data: { name, pin: '1234' } })).ok()).toBe(true);
  await request.post('/api/me/skip-home', { data: {} });
  await request.post('/api/guide/close', { data: {} });
  const state = await context.storageState();
  return { state, request, close: () => context.close() };
}

const HOME = { address: '1 Pretend Street, Carlton, Melbourne, Victoria, Australia', lat: -37.7991, lng: 144.9671, country: 'AU' };

/**
 * A picking session over new places (name, and optional note), in a set called `setName`, started by a new person.
 * `friends` more people join it (the first is the one with the long name); `home` gives the starter travel times.
 */
export async function pickingSession(browser: Browser, { places, setName = uniqueName('Screens '), friends = 0, home = false }: { places: (string | [string, string])[]; setName?: string; friends?: number; home?: boolean }) {
  const me = await personNamed(browser, uniqueName('Picker'));
  if (home) await me.request.put('/api/me/home', { data: HOME });
  const placeIds: number[] = [];
  for (const [i, entry] of places.entries()) {
    const [name, note] = typeof entry === 'string' ? [entry, ''] : entry;
    const { place } = await (await me.request.post('/api/places', { data: { url: placeLink(name, -37.8 + i * 0.003), note } })).json();
    placeIds.push(place.id);
  }
  const { id: setId } = await (await me.request.post('/api/sets', { data: { name: setName } })).json();
  for (const id of placeIds) await me.request.put(`/api/sets/${setId}/places/${id}`);
  const { id: sessionId } = await (await me.request.post('/api/sessions', { data: { setId } })).json();
  const others: (typeof me)[] = [];
  for (let i = 0; i < friends; i++) {
    const friend = await personNamed(browser, i === 0 ? LONG_PERSON : uniqueName('Friend'));
    await friend.request.post(`/api/sessions/${sessionId}/join`, { data: {} });
    others.push(friend);
  }
  const veto = (placeId: number, who = me) => who.request.post(`/api/sessions/${sessionId}/vetoes`, { data: { placeId } });
  const close = () => Promise.all([me, ...others].map((p) => p.close()));
  return { me, others, sessionId: sessionId as string, path: `/s/${sessionId}`, placeIds, veto, close };
}

/** Waits for running (not endless) animations to finish, so boxes can be measured. */
export const settled = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));

type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

/** A fresh browser at `screen`'s size, signed in as whoever `storageState` belongs to (nobody if left out). */
export async function openOn(browser: Browser, s: Screen, storageState?: StorageState) {
  const context = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    isMobile: s.mobile,
    hasTouch: s.mobile,
    deviceScaleFactor: 1,
    storageState,
  });
  return { context, page: await context.newPage() };
}

/**
 * The page is exactly as wide as the screen. On a phone a too-wide page widens the layout viewport (innerWidth grows)
 * instead of scrolling, so both are checked.
 */
export async function expectScreenWide(page: Page, s: Screen) {
  const { inner, scroll } = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(inner, `innerWidth at ${s.name}`).toBe(s.width);
  expect(scroll, `scrollWidth at ${s.name}`).toBeLessThanOrEqual(s.width);
}

/** Whether an element's text overflows it and is cut with an ellipsis. */
export const endsInEllipsis = (l: Locator) => l.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis');

/** `inner`'s box lies within `outer`'s (to within half a pixel). */
export async function expectInside(inner: Locator, outer: Locator, what = 'box') {
  const [a, b] = [(await inner.boundingBox())!, (await outer.boundingBox())!];
  expect(a.x, `${what}: left`).toBeGreaterThanOrEqual(b.x - 0.5);
  expect(a.y, `${what}: top`).toBeGreaterThanOrEqual(b.y - 0.5);
  expect(a.x + a.width, `${what}: right`).toBeLessThanOrEqual(b.x + b.width + 0.5);
  expect(a.y + a.height, `${what}: bottom`).toBeLessThanOrEqual(b.y + b.height + 0.5);
}

/** The words in an element's text that the browser split across two lines. */
export const splitWords = (l: Locator) =>
  l.evaluate((el) => {
    const split: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.textContent!.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (lines.size > 1) split.push(match[0]);
      }
    }
    return split;
  });
