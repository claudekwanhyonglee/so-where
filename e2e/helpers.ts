import { expect, type Browser, type Page } from '@playwright/test';

export const INVITE = 'e2e-invite';

export const uniqueName = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 7)}`;

const PIN_WARNING = /light lock.*not real security.*bank or phone PIN/is;

export async function signUp(page: Page, name: string, pin = '1234', path = '/') {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}invite=${INVITE}`);
  await signUpHere(page, name, pin);
}

/** The "set your home" prompt a session shows someone with no home (#33). */
export const homePrompt = (page: Page) => page.getByRole('dialog', { name: 'Home address' }).filter({ has: page.getByRole('button', { name: 'Not now' }) });

/**
 * New people have no home, so every session they open prompts for one. Most tests aren't about that:
 * whenever the prompt is in the way, press "Not now". Tests about the prompt remove this with `page.removeLocatorHandler(homePrompt(page))`.
 */
export const skipHomePrompt = (page: Page) => page.addLocatorHandler(homePrompt(page), (prompt) => prompt.getByRole('button', { name: 'Not now' }).click());

/** The sign-up step asking for a home, right after the PIN (#37). */
export const homeStep = (page: Page) => page.getByRole('main').filter({ has: page.getByRole('heading', { name: 'How far is dinner?' }) });

/** From the sign-in screen that's already showing: name, then PIN, stopping at the home step. */
export async function signUpToHomeStep(page: Page, name: string, pin = '1234') {
  await page.getByRole('button', { name: /i'm new/i }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(PIN_WARNING)).toBeVisible();
  await page.getByLabel('4-digit PIN').fill(pin); // the 4th digit submits
  await expect(homeStep(page)).toBeVisible();
}

/**
 * Signs up a new person from the sign-in screen that's already showing. Most tests aren't about getting started,
 * so it skips the home step and closes the getting-started guide (#38), leaving Home as it is for everyone else.
 */
export async function signUpHere(page: Page, name: string, pin = '1234') {
  await skipHomePrompt(page);
  await signUpToHomeStep(page, name, pin);
  await page.request.post('/api/guide/close'); // the new person is signed in by now
  await homeStep(page).getByRole('button', { name: 'Skip for now' }).click();
  await expectSignedIn(page);
}

/**
 * Empties the group's places (and, with `sessions`, its sessions) from another device, so the next person to sign up
 * finds a brand-new group. The e2e server is shared by every test, so earlier tests leave both behind.
 */
export async function emptyGroup(browser: Browser, { sessions = false } = {}) {
  const { page, context } = await newPerson(browser, 'Tidier');
  for (const { id } of await (await page.request.get('/api/places')).json()) await page.request.delete(`/api/places/${id}`);
  if (sessions) for (const { id } of await (await page.request.get('/api/sessions')).json()) await page.request.delete(`/api/sessions/${id}`);
  await context.close();
}

/** Signs in an existing person from the sign-in screen that's already showing. */
export async function signInHere(page: Page, name: string, pin: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByLabel('4-digit PIN').fill(pin);
}

/** The signed-in app is showing: its nav (the top nav or the bottom tabs, whichever fits the screen) is there. */
export async function expectSignedIn(page: Page) {
  await expect(page.getByRole('link', { name: 'You', exact: true })).toBeVisible();
}

/** Who the desktop top nav says is signed in. */
export const signedInAs = (page: Page, name: string) => expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();

/** Waits for running animations (cards sliding in, sheets rising) to finish, so boxes can be measured. */
export const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));

/** A Google Maps link to an invented place (the e2e server fakes the lookups; its suburb is always "Carlton"). */
export const placeLink = (name: string, lat = -37.8, lng = 144.96) => {
  const hex = Math.floor(Math.random() * 1e12).toString(16);
  return `https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@${lat},${lng},17z/data=!4m2!3m1!1s0x1:0x${hex}!3d${lat}!4d${lng}`;
};

/** Adds a place through the API, for tests where adding it isn't the point. */
export async function addPlaceViaApi(page: Page, name: string, note = '', lat?: number) {
  const res = await page.request.post('/api/places', { data: { url: placeLink(name, lat), note } });
  return (await res.json()).place as { id: number; name: string };
}

/** Makes a named set holding the given places through the API. */
export async function newSetViaApi(page: Page, name: string, placeIds: number[] = []) {
  const { id } = await (await page.request.post('/api/sets', { data: { name } })).json();
  for (const placeId of placeIds) await page.request.put(`/api/sets/${id}/places/${placeId}`);
  return id as number;
}

/** From anywhere in the app: choose a set on the Pick home screen and start picking from it. */
export async function startPicking(page: Page, setName: string) {
  await page.getByRole('link', { name: 'Pick', exact: true }).click();
  await page.getByRole('button', { name: /^Pick from/ }).click();
  await page.getByRole('dialog').getByRole('radio', { name: setName }).click();
  await page.getByRole('button', { name: 'Start picking' }).click();
  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
}

/** The home sheet's fake Photon suggestion for "1 Pretend" (see e2e/server.ts). */
export const PRETEND_ST_SUGGESTION = '1 Pretend Street, Carlton, Melbourne, Victoria, Australia';

/** Serves OpenStreetMap map tiles from a blank stub, so map previews never reach the network. Returns the tile URLs asked for. */
export async function stubMapTiles(page: Page) {
  const requested: string[] = [];
  await page.context().route('https://tile.openstreetmap.org/**', (route) => {
    requested.push(route.request().url());
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>' });
  });
  return requested;
}

/** In the open Home address sheet: type, choose the suggestion, and save it. */
export async function saveHomeFromSuggestion(page: Page) {
  await stubMapTiles(page);
  const sheet = page.getByRole('dialog', { name: 'Home address' });
  await sheet.getByLabel('Address').fill('1 Pretend');
  await sheet.getByRole('button', { name: PRETEND_ST_SUGGESTION }).click();
  await sheet.getByRole('button', { name: 'Save address' }).click();
  await expect(sheet).toBeHidden();
}

/** A fresh browser (as if another device) with a new person signed in. */
export async function newPerson(browser: Browser, prefix: string, path = '/') {
  const context = await browser.newContext();
  const page = await context.newPage();
  const name = uniqueName(prefix);
  await signUp(page, name, '1234', path);
  return { page, name, context };
}

export { PIN_WARNING };
