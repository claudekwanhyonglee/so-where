import { expect, test, type Page } from '@playwright/test';
import { pickCountry, PRETEND_ST_SUGGESTION, saveHomeFromSuggestion, signUp, stubMapTiles, uniqueName } from './helpers.ts';

const homeSheet = (page: Page) => page.getByRole('dialog', { name: 'Home address' });
const homeRow = (page: Page) => page.getByRole('button', { name: /^Home address/ });

async function openHomeSheet(page: Page) {
  await signUp(page, uniqueName('Nester'));
  await page.goto('/you');
  await homeRow(page).click();
  return homeSheet(page);
}

test('#32 AC2: typing suggests addresses; choosing one shows a map preview with a marker and OSM attribution', async ({ page }) => {
  const tiles = await stubMapTiles(page);
  const sheet = await openHomeSheet(page);
  await pickCountry(sheet);

  await sheet.getByLabel('Address').fill('1 Pretend');
  const suggestions = sheet.getByRole('list', { name: 'Suggestions' });
  await expect(suggestions.getByRole('button')).toHaveCount(1);
  await expect(sheet.getByRole('img', { name: /map/i })).toHaveCount(0);

  await suggestions.getByRole('button', { name: PRETEND_ST_SUGGESTION }).click();
  await expect(sheet.getByLabel('Address')).toHaveValue(PRETEND_ST_SUGGESTION);
  await expect(suggestions).toHaveCount(0);
  const map = sheet.getByRole('img', { name: `Map of ${PRETEND_ST_SUGGESTION}` });
  await expect(map).toBeVisible();
  await expect(map.getByTestId('map-marker')).toBeVisible();
  await expect(sheet.getByText('© OpenStreetMap contributors')).toBeVisible();
  expect(tiles.length).toBeGreaterThan(0);

  // The marker sits in the middle of the preview, where the chosen point is.
  const [box, marker] = [(await map.boundingBox())!, (await map.getByTestId('map-marker').boundingBox())!];
  expect(Math.abs(marker.x + marker.width / 2 - (box.x + box.width / 2))).toBeLessThan(2);
  expect(Math.abs(marker.y + marker.height - (box.y + box.height / 2))).toBeLessThan(2); // the pin's tip
});

test('#32 AC3: saving a chosen suggestion stores it as the home', async ({ page }) => {
  await openHomeSheet(page);
  await saveHomeFromSuggestion(page);
  await expect(homeRow(page)).toContainText(PRETEND_ST_SUGGESTION);
  const me = await (await page.request.get('/api/me')).json();
  expect(me.home).toEqual({ address: PRETEND_ST_SUGGESTION, lat: -37.7991, lng: 144.9671, country: 'AU' });
});

test("#32 AC4: when suggestions can't be fetched, the sheet says so and the saved home is unchanged", async ({ page }) => {
  await openHomeSheet(page);
  await saveHomeFromSuggestion(page);

  await homeRow(page).click();
  await homeSheet(page).getByLabel('Address').fill('Unreachable Lane');
  await expect(homeSheet(page).getByText(/suggestions are unavailable/i)).toBeVisible();
  await homeSheet(page).getByRole('button', { name: 'Close' }).click();
  expect((await (await page.request.get('/api/me')).json()).home.address).toBe(PRETEND_ST_SUGGESTION);
});
