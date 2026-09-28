import { expect, test, type Page } from '@playwright/test';
import { addPlaceViaApi, newPerson, signUp, uniqueName } from './helpers.ts';

type SetSummary = { id: number | 'all'; name: string; placeCount: number };

/** A named set holding `count` new places, made through the API. */
async function setWithPlaces(page: Page, count: number) {
  const name = uniqueName('Home set ');
  const { id } = await (await page.request.post('/api/sets', { data: { name } })).json();
  for (let i = 0; i < count; i++) {
    const place = await addPlaceViaApi(page, uniqueName('Invented Spot '));
    await page.request.put(`/api/sets/${id}/places/${place.id}`);
  }
  return { id: id as number, name };
}

const startCard = (page: Page) => page.getByRole('region', { name: 'Start picking' });
const setChooser = (page: Page) => startCard(page).getByRole('button', { name: /^Pick from/ });

test('#16 AC1 + AC2: the start card shows the chosen set; its sheet lists every set and disables small ones', async ({ page }) => {
  await signUp(page, uniqueName('Chooser'));
  const big = await setWithPlaces(page, 2);
  const small = await setWithPlaces(page, 1);
  await page.goto('/');

  const sets: SetSummary[] = await (await page.request.get('/api/sets')).json();
  const all = sets.find((s) => s.id === 'all')!;
  await expect(setChooser(page)).toContainText('All places');
  await expect(setChooser(page)).toContainText(`${all.placeCount} places`);

  await setChooser(page).click();
  const sheet = page.getByRole('dialog', { name: 'Pick from' });
  await expect(sheet.getByRole('radio')).toHaveCount(sets.length);
  for (const s of sets.filter((s) => s.placeCount >= 2)) await expect(sheet.getByRole('radio', { name: s.name })).toContainText(`${s.placeCount} places`);

  const smallOption = sheet.getByRole('radio', { name: small.name });
  await expect(smallOption).toBeDisabled();
  await expect(smallOption).toContainText('Add at least 2 places to pick from this');

  await sheet.getByRole('radio', { name: big.name }).click();
  await expect(sheet).toBeHidden();
  await expect(setChooser(page)).toContainText(big.name);
  await expect(setChooser(page)).toContainText('2 places');
});

test('#16 AC3: Start picking starts a session for the chosen set', async ({ page }) => {
  await signUp(page, uniqueName('Starter'));
  const set = await setWithPlaces(page, 2);
  await page.goto('/');
  await setChooser(page).click();
  await page.getByRole('radio', { name: set.name }).click();
  await startCard(page).getByRole('button', { name: 'Start picking' }).click();
  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: set.name })).toBeVisible();
});

test('#16 AC4: recent sessions show the set, top pick, members and when; tapping one opens it', async ({ page, browser }) => {
  await signUp(page, uniqueName('Recent'));
  const set = await setWithPlaces(page, 2);
  const { id: sessionId } = await (await page.request.post('/api/sessions', { data: { setId: set.id } })).json();
  const friend = await newPerson(browser, 'Pal', `/s/${sessionId}`);
  await expect(friend.page.getByRole('article')).toHaveCount(2);

  const [latest] = await (await page.request.get('/api/sessions')).json();
  expect(latest.id).toBe(sessionId);
  await page.goto('/');
  const recent = page.getByRole('region', { name: 'Recent' });
  const row = recent.getByRole('link', { name: new RegExp(set.name) });
  await expect(row).toContainText(`Top: ${latest.topPick}`);
  await expect(row).toContainText('Today');
  await expect(row.locator('[title]')).toHaveCount(2);
  for (const name of latest.members.map((m: { name: string }) => m.name)) await expect(row.locator(`[title="${name}"]`)).toHaveText(name[0].toUpperCase());

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}$`));
});
