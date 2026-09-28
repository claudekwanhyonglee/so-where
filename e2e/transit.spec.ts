import { expect, test } from '@playwright/test';
import { addPlaceViaApi, newPerson, newSetViaApi, startPicking, uniqueName } from './helpers.ts';

// The e2e server fakes Transitous: every trip takes 25 minutes.
test('#10 AC1 + AC2: cards show transit time from home, or a Directions link without one', async ({ browser }) => {
  const { page } = await newPerson(browser, 'Commuter');
  const ids: number[] = [];
  for (const name of [uniqueName('Invented Tram Stop Cafe '), uniqueName('Invented Station Bar ')]) ids.push((await addPlaceViaApi(page, name, '', -37.81)).id);
  const setName = uniqueName('Transit ');
  await newSetViaApi(page, setName, ids);

  // No home yet: Directions links in transit mode.
  await startPicking(page, setName);
  const directions = page.getByRole('article').first().getByRole('link', { name: /directions/i });
  await expect(directions).toHaveAttribute('href', /maps\/dir\/\?api=1&destination=-37\.81,144\.96&travelmode=transit/);
  const sessionUrl = page.url();

  // With a home: the time, from Transitous.
  await page.getByRole('link', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: /^Home address/ }).click();
  await page.getByRole('dialog').getByLabel('Address').fill('1 Pretend St, Carlton');
  await page.getByRole('dialog').getByRole('button', { name: /save address/i }).click();
  await expect(page.getByText(/home saved/i)).toBeVisible();
  await page.goto(sessionUrl);
  for (const card of await page.getByRole('article').all()) await expect(card).toContainText('25 min');
});
