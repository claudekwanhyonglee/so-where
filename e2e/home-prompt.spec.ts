import { expect, test, type Page } from '@playwright/test';
import { addPlaceViaApi, homePrompt, newPerson, newSetViaApi, saveHomeFromSuggestion, uniqueName } from './helpers.ts';

const homeSheet = (page: Page) => page.getByRole('dialog', { name: 'Home address' });

/** A person with no home, and a session for a new two-place set (made through the API). Returns the session's path. */
async function homelessInSession(browser: Parameters<typeof newPerson>[0]) {
  const { page } = await newPerson(browser, 'Roamer');
  await page.removeLocatorHandler(homePrompt(page)); // these tests are about the prompt
  const ids = [];
  for (const name of [uniqueName('Invented Kebab '), uniqueName('Invented Gelato ')]) ids.push((await addPlaceViaApi(page, name, '', -37.81)).id);
  const setId = await newSetViaApi(page, uniqueName('Wander '), ids);
  const { id } = await (await page.request.post('/api/sessions', { data: { setId } })).json();
  return { page, path: `/s/${id}` };
}

test('#33 AC1 + AC2: with no home, opening a session suggests setting one; "Not now" holds until the next visit', async ({ browser }) => {
  const { page, path } = await homelessInSession(browser);
  await page.goto(path);
  await expect(homeSheet(page)).toBeVisible();

  await homeSheet(page).getByRole('button', { name: 'Not now' }).click();
  await expect(homeSheet(page)).toBeHidden();
  await page.waitForTimeout(3500); // longer than a poll of the session (3 s) and the board (2 s)
  await expect(homeSheet(page)).toBeHidden();

  // Leave and open the session again.
  await page.getByRole('link', { name: 'Pick', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Where to/ })).toBeVisible();
  await page.goto(path);
  await expect(homeSheet(page)).toBeVisible();
});

test('#33 AC3: saving a home from the prompt closes it, and the cards then show the transit time', async ({ browser }) => {
  const { page, path } = await homelessInSession(browser);
  await page.goto(path);
  await expect(page.getByRole('article')).toHaveCount(2);
  await saveHomeFromSuggestion(page);
  for (const card of await page.getByRole('article').all()) await expect(card).toContainText('25 min'); // the faked Transitous
});

test('#33 AC4: with a home set, opening a session does not show the sheet', async ({ browser }) => {
  const { page, path } = await homelessInSession(browser);
  await page.request.put('/api/me/home', { data: { address: 'Somewhere', lat: -37.8, lng: 144.97 } });
  await page.goto(path);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article').first()).toContainText('25 min');
  await expect(homeSheet(page)).toHaveCount(0);
});

test('#33 AC5: with no home, cards show no transit pill (no time, no Directions)', async ({ browser }) => {
  const { page, path } = await homelessInSession(browser);
  const answers: unknown[] = [];
  page.on('response', async (res) => res.url().includes('/transit?') && answers.push(await res.json()));
  await page.goto(path);
  await homeSheet(page).getByRole('button', { name: 'Not now' }).click();
  await expect.poll(() => answers).toEqual([{ minutes: null, reason: 'no-home' }, { minutes: null, reason: 'no-home' }]);
  for (const card of await page.getByRole('article').all()) {
    await expect(card.getByRole('link', { name: /directions/i })).toHaveCount(0);
    await expect(card).not.toContainText(/\d+ min/);
    await expect(card.getByRole('link', { name: /open in google maps/i })).toBeVisible();
  }
});
