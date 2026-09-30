import { expect, test, type Browser, type Page } from '@playwright/test';
import { addPlaceViaApi, emptyGroup, homeStep, INVITE, newPerson, placeLink, signUpToHomeStep, skipHomePrompt, uniqueName } from './helpers.ts';

const guide = (page: Page) => page.getByRole('region', { name: 'Getting started' });
const routePanel = (page: Page) => guide(page).getByRole('region', { name: 'Your route to dinner' });
const stop = (page: Page, name: string) => routePanel(page).getByRole('button', { name, exact: true });
const step = (page: Page, title: string) => guide(page).getByRole('region', { name: title, exact: true });

/**
 * A group that already has two places, with `pickers` (0, 1 or 2 people) in a session started just now.
 * Returns the pickers' names and the session's id.
 */
async function groupWithPlaces(browser: Browser, pickers: 0 | 1 | 2) {
  await emptyGroup(browser, { sessions: true });
  const host = await newPerson(browser, 'Alex');
  for (const name of [uniqueName('Invented Ramen '), uniqueName('Invented Tacos ')]) await addPlaceViaApi(host.page, name);
  if (pickers === 0) return { names: [], sessionId: null };
  const { id } = await (await host.page.request.post('/api/sessions', { data: { setId: 'all' } })).json();
  const names = [host.name];
  if (pickers === 2) {
    const friend = await newPerson(browser, 'Jo', `/s/${id}`);
    await expect(friend.page.getByRole('article')).toHaveCount(2); // in the session
    names.push(friend.name);
  }
  return { names, sessionId: id as string };
}

/** A new person signing up now, on Home with the guide; `home` is what they did at the sign-up home step. */
async function newcomer(page: Page, { home = 'skip' }: { home?: 'skip' | 'undecided' } = {}) {
  await skipHomePrompt(page);
  await page.goto(`/?invite=${INVITE}`);
  await signUpToHomeStep(page, uniqueName('Joiner'));
  if (home === 'skip') await homeStep(page).getByRole('button', { name: 'Skip for now' }).click();
  else await page.goto('/');
  await expect(guide(page)).toBeVisible();
}

test('#39 AC1: someone joining a group with places gets two steps, home then picking, and no Places step anywhere', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await groupWithPlaces(browser, 0);
  await newcomer(page, { home: 'undecided' });

  await expect(page.getByText("Two quick stops and you're picking.")).toBeVisible();
  await expect(routePanel(page)).toContainText('0 of 2 done');
  await expect(routePanel(page).getByRole('button')).toHaveCount(2);
  await expect(stop(page, 'Set your home')).toBeVisible();
  await expect(stop(page, 'Start picking')).toBeVisible();
  await expect(guide(page).getByRole('group', { name: 'Steps' }).getByRole('button')).toHaveCount(2);
  await expect(guide(page).getByText(/Add 2 places|Places/)).toHaveCount(0);
  await expect(step(page, 'Set your home')).toContainText('Step 1 of 2 · optional');

  await guide(page).getByRole('button', { name: 'Next step' }).click();
  await expect(step(page, 'Start picking')).toBeVisible();
  await expect(guide(page).getByRole('button', { name: 'Next step' })).toBeDisabled();
});

test('#39 AC2: someone who was here before the group had 2 places keeps the three-step guide', async ({ page, browser }) => {
  await emptyGroup(browser);
  await newcomer(page);
  for (const name of [uniqueName('Invented Soup '), uniqueName('Invented Salad ')]) await addPlaceViaApi(page, name);
  await page.reload();
  await expect(routePanel(page).getByRole('button')).toHaveCount(3);
  await expect(stop(page, 'Add 2 places')).toBeVisible();
  await expect(page.getByText("Three quick stops and you're picking.")).toBeVisible();
});

test('#39 AC3 + AC5: with two friends picking, Start picking names them and joins their session; the guide then says who you are picking with', async ({ page, browser }) => {
  const { names, sessionId } = await groupWithPlaces(browser, 2);
  const [a, b] = names;
  await newcomer(page);

  const pick = step(page, 'Start picking');
  await expect(pick).toBeVisible(); // home was skipped, so picking is current
  await expect(pick).toContainText(`${a} and ${b} are picking from All places right now. Jump in, or start your own.`);
  await expect(pick.getByText('Picking now')).toBeVisible();
  for (const name of names) await expect(pick.locator(`[title="${name}"]`)).toHaveText(name[0].toUpperCase());
  await expect(pick.getByRole('button', { name: 'Start your own' })).toBeVisible();

  await pick.getByRole('button', { name: `Join ${a} and ${b}` }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}$`));
  await expect(page.getByRole('list', { name: "Who's here" }).getByRole('listitem')).toHaveCount(3);

  await page.getByRole('link', { name: 'Pick', exact: true }).click();
  await expect(guide(page).getByRole('heading', { name: "You're all set!" })).toBeVisible();
  await expect(guide(page)).toContainText(`You're picking with ${a} and ${b}.`);
  await expect(guide(page)).not.toContainText('share');
  await expect(routePanel(page)).toContainText('1 of 2 done · 1 skipped');
});

test('#39 AC3: with one friend picking it reads "is"; "Start your own" starts a new All places session instead', async ({ page, browser }) => {
  const { names, sessionId } = await groupWithPlaces(browser, 1);
  await newcomer(page);

  const pick = step(page, 'Start picking');
  await expect(pick).toContainText(`${names[0]} is picking from All places right now. Jump in, or start your own.`);
  await pick.getByRole('button', { name: 'Start your own' }).click();
  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
  expect(page.url()).not.toContain(sessionId);
  await expect(page.getByRole('heading', { name: 'All places' })).toBeVisible();
  await expect(page.getByRole('list', { name: "Who's here" }).getByRole('listitem')).toHaveCount(1);

  await page.getByRole('link', { name: 'Pick', exact: true }).click();
  await expect(guide(page).getByRole('heading', { name: "You're all set!" })).toBeVisible();
  await expect(guide(page)).not.toContainText("You're picking with");
});

test('#39 AC4: with no session going, Start picking is as in the new-group guide', async ({ page, browser }) => {
  await groupWithPlaces(browser, 0);
  await newcomer(page);

  const pick = step(page, 'Start picking');
  await expect(pick).toContainText("Tap whichever of two places you'd rather go to. Then share the link so friends can pick too.");
  await expect(pick.getByText('Picking now')).toHaveCount(0);
  await expect(pick.getByRole('button', { name: /^Join/ })).toHaveCount(0);
  await pick.getByRole('button', { name: 'Start picking' }).click();
  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: 'All places' })).toBeVisible();
});

for (const pickers of [0, 1] as const) {
  test(`#51 AC1 + AC2: ${pickers ? 'with' : 'without'} a live session, "Or add more places" opens the add-place sheet, and adding one stays on Start picking with the count updated`, async ({ page, browser }) => {
    await groupWithPlaces(browser, pickers);
    await newcomer(page);
    const pick = step(page, 'Start picking');
    await expect(pick).toContainText('2 places so far');

    await pick.getByRole('button', { name: 'Or add more places' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a place' });
    await sheet.getByLabel('Name or Google Maps link').fill(placeLink(uniqueName('Invented Noodles ')));
    await sheet.getByRole('button', { name: 'Add place' }).click();
    await expect(sheet).toBeHidden();

    await expect(step(page, 'Start picking')).toBeVisible();
    await expect(pick).toContainText('3 places so far');
    await expect(page).toHaveURL(/\/$/);
  });
}
