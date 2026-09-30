import { expect, test, type Page } from '@playwright/test';
import {
  addPlaceViaApi,
  expectSignedIn,
  homePrompt,
  homeStep,
  INVITE,
  newSetViaApi,
  pickCountry,
  PRETEND_ST_SUGGESTION,
  signInHere,
  signUp,
  signUpToHomeStep,
  stubMapTiles,
  uniqueName,
} from './helpers.ts';

const me = async (page: Page) => (await page.request.get('/api/me')).json();

/** A fresh device on the sign-in screen at `path`, signed up as far as the home step. */
async function atHomeStep(page: Page, path = '/') {
  await page.goto(`${path}?invite=${INVITE}`);
  await signUpToHomeStep(page, uniqueName('Fresh'));
}

/** A session (for a new two-place set) started by the person signed in on `page`; returns its path. */
async function someonesSession(page: Page) {
  const ids = [];
  for (const name of [uniqueName('Invented Pho '), uniqueName('Invented Pie ')]) ids.push((await addPlaceViaApi(page, name)).id);
  const setId = await newSetViaApi(page, uniqueName('Supper '), ids);
  const { id } = await (await page.request.post('/api/sessions', { data: { setId } })).json();
  return `/s/${id}`;
}

test('#37 AC1: straight after the PIN, a new person sees "How far is dinner?" before anything else', async ({ page }) => {
  await atHomeStep(page);
  await expect(homeStep(page).getByText('Add your home so each place shows how long public transport takes from your door, leaving now.')).toBeVisible();
  await expect(homeStep(page).getByRole('button', { name: 'Save home' })).toBeVisible();
  await expect(homeStep(page).getByRole('button', { name: 'Skip for now' })).toBeVisible();
  await expect(homeStep(page).getByText('Only you see your address and travel times.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'You', exact: true })).toHaveCount(0); // not in the app yet

  // Button first, then the skip link under it, then the privacy line.
  const [save, skip, privacy] = await Promise.all(
    [homeStep(page).getByRole('button', { name: 'Save home' }), homeStep(page).getByRole('button', { name: 'Skip for now' }), homeStep(page).getByText('Only you see')].map(
      async (l) => (await l.boundingBox())!.y,
    ),
  );
  expect(save).toBeLessThan(skip);
  expect(skip).toBeLessThan(privacy);
});

test('#37 AC2 + AC3: the field suggests addresses, shows the map, and "Save home" stores it and continues', async ({ page }) => {
  await stubMapTiles(page);
  await atHomeStep(page);
  await pickCountry(homeStep(page));
  await homeStep(page).getByLabel('Address').fill('1 Pretend');
  await expect(homeStep(page).getByRole('list', { name: 'Suggestions' })).toBeVisible();
  await homeStep(page).getByRole('button', { name: PRETEND_ST_SUGGESTION }).click();
  await expect(homeStep(page).getByRole('img', { name: `Map of ${PRETEND_ST_SUGGESTION}` })).toBeVisible();
  await homeStep(page).getByRole('button', { name: 'Save home' }).click();

  await expectSignedIn(page);
  await expect(page).toHaveURL(/\/$/);
  expect(await me(page)).toMatchObject({ home: { address: PRETEND_ST_SUGGESTION, lat: -37.7991, lng: 144.9671, country: 'AU' }, homeSkipped: false });
});

test('#37 AC2: typing shows the "Searching…" row', async ({ page }) => {
  await page.route('**/api/geocode?*', () => undefined); // never answers
  await atHomeStep(page);
  await pickCountry(homeStep(page));
  await homeStep(page).getByLabel('Address').fill('1 Pretend');
  await expect(homeStep(page).getByText('Searching addresses…')).toBeVisible();
});

test('#37 AC3 + AC4: "Skip for now" continues to Home without a home, and records the skip', async ({ page }) => {
  await atHomeStep(page);
  await homeStep(page).getByRole('button', { name: 'Skip for now' }).click();
  await expectSignedIn(page);
  await expect(page).toHaveURL(/\/$/);
  expect(await me(page)).toMatchObject({ home: null, homeSkipped: true });
});

test("#37 AC4 + AC5: signing up from a share link lands in that session; after skipping, it doesn't ask again that visit, but the next session does", async ({ page, browser }) => {
  await signUp(page, uniqueName('Host'));
  const first = await someonesSession(page);
  const second = await someonesSession(page);

  const friend = await (await browser.newContext()).newPage();
  await atHomeStep(friend, first);
  await homeStep(friend).getByRole('button', { name: 'Skip for now' }).click();
  await expect(friend).toHaveURL(new RegExp(`${first}$`));
  await expect(friend.getByRole('article')).toHaveCount(2);
  await friend.waitForTimeout(3500); // longer than a poll of the session (3 s) and the board (2 s)
  await expect(homePrompt(friend)).toHaveCount(0);

  await friend.goto(second);
  await expect(homePrompt(friend)).toBeVisible();
});

test('#37 AC4: saving home from a share link also lands in the session', async ({ page, browser }) => {
  await signUp(page, uniqueName('Host'));
  const session = await someonesSession(page);
  const friend = await (await browser.newContext()).newPage();
  await stubMapTiles(friend);
  await atHomeStep(friend, session);
  await pickCountry(homeStep(friend));
  await homeStep(friend).getByLabel('Address').fill('1 Pretend');
  await homeStep(friend).getByRole('button', { name: PRETEND_ST_SUGGESTION }).click();
  await homeStep(friend).getByRole('button', { name: 'Save home' }).click();
  await expect(friend).toHaveURL(new RegExp(`${session}$`));
  await expect(friend.getByRole('article').first()).toContainText('25 min');
  await expect(homePrompt(friend)).toHaveCount(0);
});

test('#37 AC6: people signing in to an existing account never see the home step', async ({ page, browser }) => {
  const name = uniqueName('Regular');
  await signUp(page, name, '1357');
  const device = await (await browser.newContext()).newPage();
  await device.goto(`/?invite=${INVITE}`);
  await signInHere(device, name, '1357');
  await expectSignedIn(device);
  await expect(device.getByRole('heading', { name: 'How far is dinner?' })).toHaveCount(0);
});

for (const [label, size] of [
  ['phone', { width: 360, height: 740 }],
  ['desktop', { width: 1280, height: 800 }],
] as const) {
  test(`#37 AC7: the home step fits a ${label} and works with the keyboard; the illustration is decorative`, async ({ page }) => {
    await page.setViewportSize(size);
    await stubMapTiles(page);
    await atHomeStep(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await expect(homeStep(page).locator('svg[aria-hidden="true"]').first()).toBeAttached();
    await expect(homeStep(page).getByRole('img')).toHaveCount(0);

    await expect(homeStep(page).getByLabel('Country', { exact: true })).toBeFocused();
    await page.keyboard.type('Austral');
    await page.keyboard.press('Tab');
    await expect(homeStep(page).getByRole('button', { name: 'Australia' })).toBeFocused();
    await page.keyboard.press('Enter');

    const field = homeStep(page).getByLabel('Address');
    await expect(field).toBeFocused();
    await page.keyboard.type('1 Pretend');
    const suggestion = homeStep(page).getByRole('button', { name: PRETEND_ST_SUGGESTION });
    await expect(suggestion).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(suggestion).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(homeStep(page).getByRole('img', { name: `Map of ${PRETEND_ST_SUGGESTION}` })).toBeVisible();
    await expect(field).toHaveValue(PRETEND_ST_SUGGESTION);
    await homeStep(page).getByRole('button', { name: 'Save home' }).focus();
    await page.keyboard.press('Enter');
    await expectSignedIn(page);
    expect((await me(page)).home.address).toBe(PRETEND_ST_SUGGESTION);
  });
}
