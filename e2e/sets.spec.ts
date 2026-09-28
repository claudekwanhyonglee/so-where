import { expect, test, type Page } from '@playwright/test';
import { signUp, uniqueName } from './helpers.ts';

async function addPlace(page: Page, name: string) {
  const hex = Math.floor(Math.random() * 1e12).toString(16);
  await page.getByLabel('Google Maps link').fill(`https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@-37.8,144.96,17z/data=!4m2!3m1!1s0x1:0x${hex}`);
  await page.getByRole('button', { name: /add place/i }).click();
  await expect(page.getByRole('status')).toContainText(name);
}

test('#6 AC1 + AC2 + AC3: manage sets in the app', async ({ page }) => {
  await signUp(page, uniqueName('Setter'));
  await page.getByRole('link', { name: 'Places', exact: true }).click();
  const [p1, p2] = [uniqueName('Invented Cafe '), uniqueName('Invented Deli ')];
  await addPlace(page, p1);
  await addPlace(page, p2);

  await page.getByRole('link', { name: 'Sets', exact: true }).click();
  const all = page.getByRole('listitem').filter({ hasText: 'All places' });
  await expect(all).toBeVisible();
  await all.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'All places' })).toBeVisible();
  await expect(page.getByText(/always contains every place/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /rename|delete/i })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);

  await page.getByRole('link', { name: 'Sets', exact: true }).click();
  const setName = uniqueName('Date night ');
  await page.getByLabel('New set name').fill(setName);
  await page.getByRole('button', { name: /create set/i }).click();
  await expect(page.getByRole('heading', { name: setName })).toBeVisible();

  await page.getByRole('checkbox', { name: p1 }).check();
  await page.getByRole('checkbox', { name: p2 }).check();
  await page.getByRole('checkbox', { name: p2 }).uncheck();
  await expect(page.getByText(/1 place in this set/i)).toBeVisible();

  const renamed = `${setName} (fancy)`;
  await page.getByRole('button', { name: /rename/i }).click();
  await page.getByLabel('Set name').fill(renamed);
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /delete set/i }).click();
  await expect(page.getByRole('listitem').filter({ hasText: renamed })).toHaveCount(0);
  await page.getByRole('link', { name: 'Places', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: p1 })).toBeVisible();
});
