import { expect, test, type Page } from '@playwright/test';
import { addPlaceViaApi, newPerson, newSetViaApi, uniqueName } from './helpers.ts';

/** A new session over three fresh places, started by `page`'s person, who is on its screen. */
async function openSession(page: Page) {
  const places = [];
  for (let i = 0; i < 3; i++) places.push(await addPlaceViaApi(page, uniqueName('Invented Grill ')));
  const setId = await newSetViaApi(page, uniqueName('News '), places.map((p) => p.id));
  const { id } = await (await page.request.post('/api/sessions', { data: { setId } })).json();
  await page.goto(`/s/${id}`);
  await expect(page.getByRole('article')).toHaveCount(2);
  return { sessionId: id as string, places };
}

const toastsOf = (page: Page) => page.locator('[data-sonner-toast]');

test('#54 AC1 + AC2 + AC3: who joins while you are here gets a toast; nobody already there, and never you', async ({ browser }) => {
  const host = await newPerson(browser, 'Host');
  const { sessionId } = await openSession(host.page);
  const early = await newPerson(browser, 'Early', `/s/${sessionId}`);
  await expect(toastsOf(host.page).filter({ hasText: `${early.name} joined` })).toBeVisible({ timeout: 10_000 });

  // Someone opening the session sees no toast for those already in it, or for themselves.
  const late = await newPerson(browser, 'Late', `/s/${sessionId}`);
  await expect(late.page.getByRole('article')).toHaveCount(2);
  await late.page.waitForTimeout(3500); // a full poll
  await expect(toastsOf(late.page).filter({ hasText: 'joined' })).toHaveCount(0);

  // Two joining between checks: two toasts.
  const [a, b] = await Promise.all([newPerson(browser, 'Twin', `/s/${sessionId}`), newPerson(browser, 'Twin', `/s/${sessionId}`)]);
  for (const name of [a.name, b.name]) await expect(late.page.getByText(`${name} joined`)).toBeVisible({ timeout: 10_000 });
});

test('#54 AC4 + AC5 + AC6: others ruling a place out or bringing it back get toasts; what was out already, and your own, do not', async ({ browser }) => {
  const host = await newPerson(browser, 'Host');
  const { sessionId, places } = await openSession(host.page);
  const friend = await newPerson(browser, 'Friend', `/s/${sessionId}`);
  await friend.page.request.post(`/api/sessions/${sessionId}/vetoes`, { data: { placeId: places[2].id } }); // out before the late one opens

  const late = await newPerson(browser, 'Late', `/s/${sessionId}`);
  await expect(late.page.getByRole('article')).toHaveCount(2);
  await late.page.waitForTimeout(2500); // a full board poll
  await expect(toastsOf(late.page).filter({ hasText: 'ruled out' })).toHaveCount(0);

  await friend.page.request.post(`/api/sessions/${sessionId}/vetoes`, { data: { placeId: places[0].id } });
  await expect(late.page.getByText(`${friend.name} ruled out ${places[0].name}`)).toBeVisible({ timeout: 10_000 });
  await friend.page.request.delete(`/api/sessions/${sessionId}/vetoes/${places[0].id}`);
  await expect(late.page.getByText(`${friend.name} brought ${places[0].name} back`)).toBeVisible({ timeout: 10_000 });

  // Your own "Absolutely not" keeps its own toast, and isn't shown twice.
  const card = late.page.getByRole('article').first();
  const name = (await card.getByRole('heading').innerText()).trim();
  await card.getByRole('button', { name: 'Absolutely not', exact: true }).click();
  await expect(late.page.getByText(`${name} is out for tonight`)).toBeVisible();
  await late.page.waitForTimeout(2500);
  await expect(late.page.getByText(`${late.name} ruled out`)).toHaveCount(0);
});
