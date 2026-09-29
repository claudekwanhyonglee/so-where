import { expect, test, type Page, type Route } from '@playwright/test';
import { signUp, uniqueName } from './helpers.ts';

const homeSheet = (page: Page) => page.getByRole('dialog', { name: 'Home address' });
const suggestionsList = (page: Page) => homeSheet(page).getByRole('list', { name: 'Suggestions' });
const searchingRow = (page: Page) => suggestionsList(page).getByRole('listitem').filter({ hasText: 'Searching addresses…' });
const liveRegion = (page: Page) => homeSheet(page).getByTestId('address-status');

const suggestion = (label: string) => ({ label, lat: -37.8, lng: 144.96 });

/** Holds every address lookup until the test answers it, so what shows while waiting can be checked. */
async function holdLookups(page: Page) {
  const held: { q: string; route: Route }[] = [];
  await page.route('**/api/geocode?*', (route) => void held.push({ q: new URL(route.request().url()).searchParams.get('q') ?? '', route }));
  const lookup = async (q: string) => {
    await expect.poll(() => held.some((h) => h.q === q)).toBe(true);
    return held.find((h) => h.q === q)!.route;
  };
  return {
    held,
    answer: async (q: string, labels: string[]) => (await lookup(q)).fulfill({ json: labels.map(suggestion) }),
    fail: async (q: string) => (await lookup(q)).fulfill({ status: 502, json: { error: 'down' } }),
  };
}

async function openHomeSheet(page: Page) {
  await signUp(page, uniqueName('Waiter'));
  await page.goto('/you');
  await page.getByRole('button', { name: /^Home address/ }).click();
  await expect(homeSheet(page)).toBeVisible();
}

test('#36 AC1: typing shows a single "Searching…" row with a spinner straight away, before the lookup starts', async ({ page }) => {
  await page.clock.install(); // the pause before the lookup only ends when the test says so
  const lookups = await holdLookups(page);
  await openHomeSheet(page);

  await homeSheet(page).getByLabel('Address').fill('1 Pretend');
  await expect(searchingRow(page)).toBeVisible();
  await expect(suggestionsList(page).getByRole('listitem')).toHaveCount(1);
  await expect(searchingRow(page).getByTestId('spinner')).toBeVisible();
  expect(lookups.held).toHaveLength(0); // still in the pause

  await page.clock.runFor(300);
  await expect.poll(() => lookups.held.length).toBe(1);
  await expect(searchingRow(page)).toBeVisible();
});

test('#36 AC2: the row gives way to the suggestions, to "No matching addresses", or to the unavailable message', async ({ page }) => {
  const lookups = await holdLookups(page);
  await openHomeSheet(page);
  const field = homeSheet(page).getByLabel('Address');

  await field.fill('1 Pretend');
  await expect(searchingRow(page)).toBeVisible();
  await lookups.answer('1 Pretend', ['1 Pretend Street, Carlton', '1 Pretend Lane, Carlton']);
  await expect(suggestionsList(page).getByRole('button')).toHaveText(['1 Pretend Street, Carlton', '1 Pretend Lane, Carlton']);
  await expect(searchingRow(page)).toHaveCount(0);

  await field.fill('Nowhere at all');
  await expect(searchingRow(page)).toBeVisible();
  await lookups.answer('Nowhere at all', []);
  await expect(homeSheet(page).getByText('No matching addresses', { exact: true }).first()).toBeVisible();
  await expect(searchingRow(page)).toHaveCount(0);

  await field.fill('Unreachable Lane');
  await expect(searchingRow(page)).toBeVisible();
  await lookups.fail('Unreachable Lane');
  await expect(homeSheet(page).getByText(/suggestions are unavailable/i)).toBeVisible();
  await expect(searchingRow(page)).toHaveCount(0);
});

test('#36 AC3: typing more swaps the suggestions for the row, and an older answer never overwrites a newer one', async ({ page }) => {
  const lookups = await holdLookups(page);
  await openHomeSheet(page);
  const field = homeSheet(page).getByLabel('Address');

  await field.fill('Pretend');
  await lookups.answer('Pretend', ['1 Pretend Street, Carlton', '5 Pretend Road, Windsor']);
  await expect(suggestionsList(page).getByRole('button')).toHaveCount(2);

  await field.fill('Pretend R');
  await expect(searchingRow(page)).toBeVisible();
  await expect(suggestionsList(page).getByRole('button')).toHaveCount(0);
  await expect.poll(() => lookups.held.some((h) => h.q === 'Pretend R')).toBe(true);

  // Answer the newer lookup first, then the older one late.
  await field.fill('Pretend Ro');
  await lookups.answer('Pretend Ro', ['5 Pretend Road, Windsor']);
  await expect(suggestionsList(page).getByRole('button')).toHaveText(['5 Pretend Road, Windsor']);
  await lookups.answer('Pretend R', ['Stale Street', 'Staler Street', 'Stalest Street']);
  await page.waitForTimeout(300);
  await expect(suggestionsList(page).getByRole('button')).toHaveText(['5 Pretend Road, Windsor']);
});

test('#36 AC4: a polite live region says "Searching…", then how many suggestions were found', async ({ page }) => {
  const lookups = await holdLookups(page);
  await openHomeSheet(page);
  await expect(liveRegion(page)).toHaveAttribute('role', 'status');
  await expect(liveRegion(page)).toHaveAttribute('aria-live', 'polite');

  await homeSheet(page).getByLabel('Address').fill('Pretend');
  await expect(liveRegion(page)).toHaveText('Searching…');
  await lookups.answer('Pretend', ['1 Pretend Street, Carlton', '5 Pretend Road, Windsor']);
  await expect(liveRegion(page)).toHaveText('2 suggestions found');

  await homeSheet(page).getByLabel('Address').fill('Nowhere');
  await lookups.answer('Nowhere', []);
  await expect(liveRegion(page)).toHaveText('No matching addresses');
});

test('#36 AC5: clearing the field removes the row and the suggestions', async ({ page }) => {
  const lookups = await holdLookups(page);
  await openHomeSheet(page);
  const field = homeSheet(page).getByLabel('Address');

  await field.fill('Pretend');
  await expect(searchingRow(page)).toBeVisible();
  await field.fill('');
  await expect(suggestionsList(page)).toHaveCount(0);

  await field.fill('Pretend St');
  await lookups.answer('Pretend St', ['1 Pretend Street, Carlton']);
  await expect(suggestionsList(page).getByRole('button')).toHaveCount(1);
  await field.fill('');
  await expect(suggestionsList(page)).toHaveCount(0);
  await expect(liveRegion(page)).toHaveText('');
});

test("#36 AC5: with reduced motion the spinner doesn't spin", async ({ page }) => {
  await holdLookups(page);
  await openHomeSheet(page);
  const spinning = () => searchingRow(page).getByTestId('spinner').evaluate((el) => getComputedStyle(el).animationName);

  await homeSheet(page).getByLabel('Address').fill('Pretend');
  expect(await spinning()).not.toBe('none');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(spinning).toBe('none');
  await expect(searchingRow(page).getByTestId('spinner')).toBeVisible();
});
