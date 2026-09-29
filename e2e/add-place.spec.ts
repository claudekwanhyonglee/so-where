import { expect, test, type Page } from '@playwright/test';
import { placeLink, signUp, stubMapTiles, uniqueName } from './helpers.ts';

// "Pretend Trattoria" is the e2e server's fake Photon restaurant (see e2e/server.ts).
const TRATTORIA = { key: 'osm:N9001', name: 'Pretend Trattoria', address: '7 Invented Street, Carlton' };

async function openAddSheet(page: Page) {
  await stubMapTiles(page);
  await signUp(page, uniqueName('Finder'));
  await page.getByRole('link', { name: 'Places', exact: true }).click();
  await page.getByRole('button', { name: 'Add place', exact: true }).click();
  const sheet = page.getByRole('dialog');
  return { sheet, box: sheet.getByLabel('Name or Google Maps link'), add: sheet.getByRole('button', { name: 'Add place' }) };
}

const apiPlaces = async (page: Page) => (await (await page.request.get('/api/places')).json()) as { key: string; name: string; lat: number }[];

test('#44 AC1: typing a name suggests places; choosing one shows it on the map and Add adds it', async ({ page }) => {
  const { sheet, box, add } = await openAddSheet(page);
  await box.fill('Pretend Tratt');
  const suggestion = sheet.getByRole('list', { name: 'Suggestions' }).getByRole('button', { name: new RegExp(TRATTORIA.name) });
  await expect(suggestion).toContainText(TRATTORIA.address);
  await expect(add).toBeDisabled();

  await suggestion.click();
  await expect(sheet.getByRole('img', { name: `Map of ${TRATTORIA.name}` })).toBeVisible();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(sheet).toBeHidden();
  expect((await apiPlaces(page)).find((p) => p.key === TRATTORIA.key)).toMatchObject({ name: TRATTORIA.name, lat: -37.7985 });
});

test('#44 AC2: pasting a Google Maps link shows the place (name and map) before Add, and Add adds it', async ({ page }) => {
  const { sheet, box, add } = await openAddSheet(page);
  const name = uniqueName('Pretend Bistro ');
  await box.fill(placeLink(name, -37.81, 144.95));
  await expect(sheet.getByText(name, { exact: true })).toBeVisible();
  await expect(sheet.getByRole('img', { name: `Map of ${name}` })).toBeVisible();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(sheet).toBeHidden();
  expect((await apiPlaces(page)).find((p) => p.name === name)).toMatchObject({ lat: -37.81 });
});

test("#44 AC3: text that isn't a chosen suggestion or a resolved link can't be added; editing after a choice clears it", async ({ page }) => {
  const { sheet, box, add } = await openAddSheet(page);
  await box.fill('Pretend Trattoria');
  await expect(sheet.getByRole('list', { name: 'Suggestions' })).toBeVisible();
  await expect(add).toBeDisabled();

  await sheet.getByRole('button', { name: new RegExp(TRATTORIA.name) }).click();
  await expect(add).toBeEnabled();
  await box.press('End');
  await box.press('Backspace');
  await expect(sheet.getByRole('img', { name: /^Map of/ })).toHaveCount(0);
  await expect(add).toBeDisabled();

  const name = uniqueName('Pretend Grill ');
  await box.fill(placeLink(name));
  await expect(add).toBeEnabled();
  await box.press('End');
  await box.press('Backspace');
  await expect(add).toBeDisabled();
});

test("#44 AC4: a link that can't be pinned to a location shows an error and can't be added", async ({ page }) => {
  const { sheet, box, add } = await openAddSheet(page);
  await box.fill('https://maps.google.com/?cid=123456789');
  await expect(sheet.getByRole('alert')).toContainText(/doesn.t say where the place is/i);
  await expect(sheet.getByRole('img', { name: /^Map of/ })).toHaveCount(0);
  await expect(add).toBeDisabled();
});

test('#44 AC5: when search is unavailable, the box says so and suggests pasting a Google Maps link', async ({ page }) => {
  const { sheet, box, add } = await openAddSheet(page);
  await box.fill('Unreachable Diner');
  await expect(sheet.getByText(/search is unavailable/i)).toContainText(/paste a google maps link/i);
  await expect(add).toBeDisabled();
});
