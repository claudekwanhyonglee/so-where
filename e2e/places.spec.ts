import { expect, test } from '@playwright/test';
import { signUp, uniqueName } from './helpers.ts';

// Invented place; the e2e server fakes Nominatim, so its suburb is always "Carlton".
const link = (id: string, name: string) =>
  `https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@-37.8,144.96,17z/data=!4m6!3m5!1s0x6ad6000000000000:0x${id}!8m2!3d-37.8001!4d144.9601`;

test('#4 AC1 + AC3 + AC4 + AC5 + AC6: add, dedupe, edit and delete places', async ({ page }) => {
  await signUp(page, uniqueName('Places'));
  await page.getByRole('link', { name: 'Places', exact: true }).click();

  const name = uniqueName('Pretend Diner ');
  const id = Math.floor(Math.random() * 1e12).toString(16);
  await page.getByLabel('Google Maps link').fill(link(id, name));
  await page.getByLabel('Note (optional)').fill('Ask for the back room');
  await page.getByRole('button', { name: /add place/i }).click();

  const card = page.getByRole('listitem').filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Carlton');
  await expect(card).toContainText('Ask for the back room');
  await expect(card.getByRole('link', { name: /open in google maps/i })).toHaveAttribute('href', /maps\.google\.com\/\?cid=\d+/);

  await page.getByLabel('Google Maps link').fill(link(id, name));
  await page.getByRole('button', { name: /add place/i }).click();
  await expect(page.getByText(/already in the list/i)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(1);

  await page.getByLabel('Google Maps link').fill('https://example.com/nope');
  await page.getByRole('button', { name: /add place/i }).click();
  await expect(page.getByText(/isn.t a google maps place link/i)).toBeVisible();

  await card.getByRole('button', { name: /edit note/i }).click();
  await card.getByLabel('Note').fill('Closed Mondays');
  await card.getByRole('button', { name: /save/i }).click();
  await expect(card).toContainText('Closed Mondays');

  page.once('dialog', (d) => d.accept());
  await card.getByRole('button', { name: /delete/i }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});
