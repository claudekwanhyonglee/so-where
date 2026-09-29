import { expect, test, type Page } from '@playwright/test';
import { pickCountry, PRETEND_ST_SUGGESTION, saveHomeFromSuggestion, signUp, uniqueName } from './helpers.ts';

const homeSheet = (page: Page) => page.getByRole('dialog', { name: 'Home address' });
const countryBox = (page: Page) => homeSheet(page).getByLabel('Country', { exact: true });

async function openHomeSheet(page: Page) {
  await signUp(page, uniqueName('Traveller'));
  await page.goto('/you');
  await page.getByRole('button', { name: /^Home address/ }).click();
  await expect(homeSheet(page)).toBeVisible();
}

test('#49 AC1: the address box is disabled until a country is picked', async ({ page }) => {
  await openHomeSheet(page);
  await expect(homeSheet(page).getByLabel('Address')).toBeDisabled();
  await pickCountry(homeSheet(page));
  await expect(homeSheet(page).getByLabel('Address')).toBeEnabled();
});

test('#49 AC2: typing suggests matching countries A to Z; nothing is pre-selected', async ({ page }) => {
  await openHomeSheet(page);
  await expect(countryBox(page)).toHaveValue('');
  await expect(homeSheet(page).getByRole('list', { name: 'Suggestions' })).toHaveCount(0);

  await countryBox(page).fill('aus');
  await expect(homeSheet(page).getByRole('list', { name: 'Suggestions' }).getByRole('button')).toHaveText(['Australia', 'Austria']);
});

test('#49 AC3: suggestions and the picked country show a flag image and the name', async ({ page }) => {
  await openHomeSheet(page);
  await countryBox(page).fill('aus');
  const australia = homeSheet(page).getByRole('button', { name: 'Australia', exact: true });
  await expect(australia.locator('img')).toHaveAttribute('src', /au[^/]*\.svg$/);
  await expect(australia.locator('img')).toHaveJSProperty('complete', true);
  expect(await australia.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await australia.click();
  await expect(countryBox(page)).toHaveValue('Australia');
  await expect(homeSheet(page).getByTestId('picked-flag').locator('img')).toHaveAttribute('src', /au[^/]*\.svg$/);
});

test('#49 AC4: address suggestions are asked for the picked country only', async ({ page }) => {
  await openHomeSheet(page);
  const asked: URL[] = [];
  page.on('request', (r) => r.url().includes('/api/geocode') && asked.push(new URL(r.url())));
  await pickCountry(homeSheet(page), 'Austria');
  await homeSheet(page).getByLabel('Address').fill('1 Pretend');
  await expect(homeSheet(page).getByRole('listitem').filter({ hasText: 'No matching addresses' })).toBeVisible(); // the fake Photon's addresses are all in Australia

  await pickCountry(homeSheet(page), 'Australia');
  await homeSheet(page).getByLabel('Address').fill('1 Pretend');
  await expect(homeSheet(page).getByRole('button', { name: PRETEND_ST_SUGGESTION })).toBeVisible();
  expect(asked.map((u) => u.searchParams.get('country'))).toEqual(['AT', 'AU']);
});

test('#49 AC5: a saved home with a country opens with that country picked', async ({ page }) => {
  await openHomeSheet(page);
  await saveHomeFromSuggestion(page);
  await page.getByRole('button', { name: /^Home address/ }).click();
  await expect(countryBox(page)).toHaveValue('Australia');
  await expect(homeSheet(page).getByTestId('picked-flag')).toBeVisible();
  await expect(homeSheet(page).getByLabel('Address')).toBeEnabled();
  await expect(homeSheet(page).getByLabel('Address')).toHaveValue(PRETEND_ST_SUGGESTION);
});
