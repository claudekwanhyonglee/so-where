import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { signUp, uniqueName } from './helpers.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../server/fixtures/${name}`, import.meta.url));

test('#5 AC1 + AC2 + AC4 + #19 AC10: import Takeout files, see what was added, and land on the new set', async ({ page }) => {
  await signUp(page, uniqueName('Importer'));
  await page.getByRole('link', { name: 'Places', exact: true }).click();

  const sheet = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Import' }).click();
  await sheet.getByLabel(/takeout files/i).setInputFiles([fixture('Date night.csv'), fixture('Saved Places.json')]);
  await expect(sheet.getByText(/added 5 places.*1 was already there/i)).toBeVisible();

  // The list became a set, and that's what's showing.
  await sheet.getByRole('button', { name: 'See your sets' }).click();
  await expect(page.getByRole('heading', { name: 'Date night' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Places in Date night' });
  await expect(list.getByRole('listitem').filter({ hasText: 'Pretend Ramen Bar' })).toContainText('Late night option');

  await page.goto('/places/all');
  await expect(page.getByRole('list', { name: 'Places in All places' }).getByRole('listitem').filter({ hasText: 'Imaginary Taqueria' })).toBeVisible();

  await page.getByRole('button', { name: 'Import' }).click();
  await sheet.getByLabel(/takeout files/i).setInputFiles([fixture('Date night.csv')]);
  await expect(sheet.getByText(/no new places.*3 were already there/i)).toBeVisible();
});
