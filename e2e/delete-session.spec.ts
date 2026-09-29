import { expect, test, type Page } from '@playwright/test';
import { addPlaceViaApi, newPerson, signUp, uniqueName } from './helpers.ts';

/** A session for a new two-place set, made through the API. */
async function sessionViaApi(page: Page) {
  const setName = uniqueName('Doomed ');
  const { id: setId } = await (await page.request.post('/api/sets', { data: { name: setName } })).json();
  for (const name of [uniqueName('Invented Bao '), uniqueName('Invented Laksa ')]) {
    const place = await addPlaceViaApi(page, name);
    await page.request.put(`/api/sets/${setId}/places/${place.id}`);
  }
  const { id } = await (await page.request.post('/api/sessions', { data: { setId } })).json();
  return { id: id as string, setName };
}

const recentRow = (page: Page, setName: string) => page.getByRole('region', { name: 'Recent' }).getByRole('listitem').filter({ hasText: setName });

test('#30 AC2: each Recent sessions row can be deleted after confirming; cancelling keeps it', async ({ page }) => {
  await signUp(page, uniqueName('Tidy'));
  const { setName } = await sessionViaApi(page);
  await page.goto('/');
  await expect(recentRow(page, setName)).toBeVisible();

  await recentRow(page, setName).getByRole('button', { name: 'Delete session' }).click();
  const sheet = page.getByRole('dialog', { name: 'Delete session' });
  await sheet.getByRole('button', { name: 'Keep it' }).click();
  await expect(sheet).toBeHidden();
  await expect(recentRow(page, setName)).toBeVisible();

  await recentRow(page, setName).getByRole('button', { name: 'Delete session' }).click();
  await page.getByRole('dialog', { name: 'Delete session' }).getByRole('button', { name: 'Delete session' }).click();
  await expect(recentRow(page, setName)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Where to/ })).toBeVisible();
  await expect(recentRow(page, setName)).toHaveCount(0);
});

test('#30 AC3: someone inside a session that gets deleted is told so, with a way home', async ({ page, browser }) => {
  await signUp(page, uniqueName('Host'));
  const { id, setName } = await sessionViaApi(page);
  const friend = await newPerson(browser, 'Guest', `/s/${id}`);
  await expect(friend.page.getByRole('heading', { name: setName })).toBeVisible();

  expect((await page.request.delete(`/api/sessions/${id}`)).status()).toBe(200);

  await expect(friend.page.getByText('This session was deleted')).toBeVisible({ timeout: 10_000 }); // the next poll
  await friend.page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(friend.page).toHaveURL(/\/$/);
});

test('#30 AC3: an action in a deleted session shows the same message', async ({ page, browser }) => {
  await signUp(page, uniqueName('Host'));
  const { id } = await sessionViaApi(page);
  const friend = await newPerson(browser, 'Picker', `/s/${id}`);
  await expect(friend.page.getByRole('article')).toHaveCount(2);

  // Hold back the polls, so it's the action that finds out.
  await friend.page.route(new RegExp(`/api/sessions/${id}(/leaderboard\\?.*)?$`), (route) => route.abort());
  await page.request.delete(`/api/sessions/${id}`);
  await friend.page.getByRole('button', { name: 'Too close to call' }).click();
  await expect(friend.page.getByText('This session was deleted')).toBeVisible();
});
