import { expect, test } from '@playwright/test';
import { addPlaceViaApi, signUp, uniqueName } from './helpers.ts';

test('#6 AC1 + AC2 + AC3 + #19 AC8: manage sets in the app', async ({ page }) => {
  await signUp(page, uniqueName('Setter'));
  const [p1, p2] = [await addPlaceViaApi(page, uniqueName('Invented Cafe ')), await addPlaceViaApi(page, uniqueName('Invented Deli '))];
  await page.getByRole('link', { name: 'Places', exact: true }).click();
  const sets = page.getByRole('navigation', { name: 'Sets' });
  const sheet = page.getByRole('dialog');

  // "All places" is built in: always first, holding every place, with nothing to edit.
  await sets.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'All places' })).toBeVisible();
  await expect(page.getByText(/everything you.ve added/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set options' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Places in All places' }).getByRole('listitem').filter({ hasText: p1.name })).toBeVisible();

  // A new set, filled from the checklist it opens with.
  const setName = uniqueName('Date night ');
  await page.getByRole('button', { name: 'New set' }).click();
  await sheet.getByLabel('Set name').fill(setName);
  await sheet.getByRole('button', { name: 'Create set' }).click();
  await expect(page.getByRole('heading', { name: setName, exact: true })).toBeVisible();
  await sheet.getByRole('checkbox', { name: p1.name }).click();
  await sheet.getByRole('checkbox', { name: p2.name }).click();
  await sheet.getByRole('checkbox', { name: p2.name }).click();
  await sheet.getByRole('button', { name: /^Done/ }).click();
  await expect(page.getByText(/^Set · 1 place$/)).toBeVisible();

  const renamed = `${setName} (fancy)`;
  await page.getByRole('button', { name: 'Set options' }).click();
  await sheet.getByRole('button', { name: 'Rename' }).click();
  await sheet.getByLabel('Set name').fill(renamed);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Set options' }).click();
  await sheet.getByRole('button', { name: 'Delete set' }).click();
  await expect(sheet).toContainText(/places stay/i);
  await sheet.getByRole('button', { name: 'Delete set' }).click();
  await expect(sets.getByRole('link').filter({ hasText: renamed })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'All places' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Places in All places' }).getByRole('listitem').filter({ hasText: p1.name })).toBeVisible();
});
