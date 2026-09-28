import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { signUp, uniqueName } from './helpers.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../server/fixtures/${name}`, import.meta.url));

test('#5 AC1 + AC2 + AC4: import Takeout files and see what was added', async ({ page }) => {
  await signUp(page, uniqueName('Importer'));
  await page.getByRole('link', { name: 'Places' }).click();

  const importer = page.getByRole('region', { name: /import from google takeout/i });
  await importer.getByLabel(/takeout files/i).setInputFiles([fixture('Date night.csv'), fixture('Saved Places.json')]);
  await importer.getByRole('button', { name: /^import$/i }).click();
  await expect(importer.getByText(/added 5 places.*1 was already there/i)).toBeVisible();

  const list = page.getByRole('region', { name: /all places/i });
  await expect(list.getByRole('listitem').filter({ hasText: 'Pretend Ramen Bar' })).toContainText('Late night option');
  await expect(list.getByRole('listitem').filter({ hasText: 'Imaginary Taqueria' })).toBeVisible();

  await importer.getByLabel(/takeout files/i).setInputFiles([fixture('Date night.csv')]);
  await importer.getByRole('button', { name: /^import$/i }).click();
  await expect(importer.getByText(/no new places.*3 were already there/i)).toBeVisible();
});
