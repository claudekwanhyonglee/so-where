import { expect, test } from '@playwright/test';
import { addPlaceViaApi, newPerson, newSetViaApi, saveHomeFromSuggestion, startPicking, uniqueName } from './helpers.ts';

// The e2e server fakes Transitous: every trip takes 25 minutes.
// Without a home, cards used to show a Directions link; since #33 AC5 they show no transit pill at all
// (Directions stays for the other reasons, see web/transit-pill.test.ts).
test('#10 AC1 + #33 AC5: cards show transit time from home, and no transit pill without one', async ({ browser }) => {
  const { page } = await newPerson(browser, 'Commuter');
  const ids: number[] = [];
  for (const name of [uniqueName('Invented Tram Stop Cafe '), uniqueName('Invented Station Bar ')]) ids.push((await addPlaceViaApi(page, name, '', -37.81)).id);
  const setName = uniqueName('Transit ');
  await newSetViaApi(page, setName, ids);

  // No home yet: neither a time nor Directions, once both cards have their answer.
  const answers: unknown[] = [];
  page.on('response', async (res) => res.url().includes('/transit?') && answers.push(await res.json()));
  await startPicking(page, setName);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect.poll(() => answers).toEqual([{ minutes: null, reason: 'no-home' }, { minutes: null, reason: 'no-home' }]);
  for (const card of await page.getByRole('article').all()) {
    await expect(card.getByRole('link', { name: /open in google maps/i })).toBeVisible();
    await expect(card.getByRole('link', { name: /directions/i })).toHaveCount(0);
    await expect(card).not.toContainText(/\d+ min/);
  }
  const sessionUrl = page.url();

  // With a home: the time, from Transitous.
  await page.getByRole('link', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: /^Home address/ }).click();
  await saveHomeFromSuggestion(page);
  await expect(page.getByText(/home saved/i)).toBeVisible();
  await page.goto(sessionUrl);
  for (const card of await page.getByRole('article').all()) await expect(card).toContainText('25 min');
});
