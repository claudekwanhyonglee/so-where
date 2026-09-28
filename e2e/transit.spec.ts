import { expect, test } from '@playwright/test';
import { newPerson, uniqueName } from './helpers.ts';

// The e2e server fakes Transitous: every trip takes 25 minutes.
test('#10 AC1 + AC2: cards show transit time from home, or a Directions link without one', async ({ browser }) => {
  const { page } = await newPerson(browser, 'Commuter');
  await page.getByRole('link', { name: 'Places', exact: true }).click();
  const places = [uniqueName('Invented Tram Stop Cafe '), uniqueName('Invented Station Bar ')];
  for (const name of places) {
    const hex = Math.floor(Math.random() * 1e12).toString(16);
    await page.getByLabel('Google Maps link').fill(`https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@-37.81,144.96,17z/data=!4m2!3m1!1s0x1:0x${hex}!3d-37.81!4d144.96`);
    await page.getByRole('button', { name: /add place/i }).click();
    await expect(page.getByRole('status')).toContainText(name);
  }
  await page.getByRole('link', { name: 'Sets', exact: true }).click();
  const setName = uniqueName('Transit ');
  await page.getByLabel('New set name').fill(setName);
  await page.getByRole('button', { name: /create set/i }).click();
  for (const name of places) await page.getByRole('checkbox', { name }).check();

  // No home yet: Directions links in transit mode.
  await page.getByRole('link', { name: 'Pick', exact: true }).click();
  await page.getByLabel('Set').selectOption({ label: setName });
  await page.getByRole('button', { name: /start picking/i }).click();
  const directions = page.getByRole('article').first().getByRole('link', { name: /directions/i });
  await expect(directions).toHaveAttribute('href', /maps\/dir\/\?api=1&destination=-37\.81,144\.96&travelmode=transit/);
  const sessionUrl = page.url();

  // With a home: the time, from Transitous.
  await page.getByRole('link', { name: 'You', exact: true }).click();
  await page.getByLabel('Home address').fill('1 Lygon St, Carlton');
  await page.getByRole('button', { name: /save address/i }).click();
  await expect(page.getByText(/home saved/i)).toBeVisible();
  await page.goto(sessionUrl);
  for (const card of await page.getByRole('article').all()) await expect(card).toContainText('25 min');
});
