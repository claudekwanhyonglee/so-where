import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import {
  addPlaceViaApi,
  emptyGroup,
  homeStep,
  INVITE,
  placeLink,
  PRETEND_ST_SUGGESTION,
  saveHomeFromSuggestion,
  signInHere,
  signUpToHomeStep,
  skipHomePrompt,
  uniqueName,
} from './helpers.ts';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const fixture = (name: string) => fileURLToPath(new URL(`../server/fixtures/${name}`, import.meta.url));

const guide = (page: Page) => page.getByRole('region', { name: 'Getting started' });
const routePanel = (page: Page) => guide(page).getByRole('region', { name: 'Your route to dinner' });
const stop = (page: Page, name: string) => routePanel(page).getByRole('button', { name, exact: true });
const dots = (page: Page) => guide(page).getByRole('group', { name: 'Steps' });
/** The step being shown: the others are hidden from screen readers (and so from these locators). */
const step = (page: Page, title: string) => guide(page).getByRole('region', { name: title, exact: true });
const card = (page: Page) => guide(page).getByTestId('guide-card');
const box = async (l: Locator) => (await l.boundingBox())!;

/**
 * A brand-new group, and a new person on Home with the guide showing. `home` is what they did at the sign-up home step:
 * skipped it, or left without deciding (so the guide's home step is still to do).
 */
async function newcomer(page: Page, browser: Browser, { home = 'skip' }: { home?: 'skip' | 'undecided' } = {}) {
  await emptyGroup(browser);
  const name = uniqueName('Newcomer');
  await skipHomePrompt(page);
  await page.goto(`/?invite=${INVITE}`);
  await signUpToHomeStep(page, name);
  if (home === 'skip') await homeStep(page).getByRole('button', { name: 'Skip for now' }).click();
  else await page.goto('/');
  await expect(guide(page)).toBeVisible();
  return name;
}

test('#38 AC1: a new person sees the guide in place of the start card, with "Pull up a chair"', async ({ page, browser }) => {
  const name = await newcomer(page, browser);
  await expect(page.getByRole('heading', { level: 1, name: `Pull up a chair, ${name}.` })).toBeVisible();
  await expect(page.getByText("Three quick stops and you're picking.")).toBeVisible();
  await expect(page.getByRole('heading', { name: "Let's pick somewhere." })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pick from/ })).toHaveCount(0);
});

test('#38 AC2 + AC3: on a desktop, one split card: the step on the bright side, the vertical route beside it, arrows in the corners', async ({ page, browser }) => {
  await page.setViewportSize(DESKTOP);
  await newcomer(page, browser);

  await expect(routePanel(page)).toContainText('0 of 3 done · 1 skipped');
  const stops = [stop(page, 'Set your home, skipped'), stop(page, 'Add 2 places'), stop(page, 'Start picking')];
  const [a, b, c] = await Promise.all(stops.map(box));
  expect(Math.abs(a.x - b.x)).toBeLessThan(2); // stacked
  expect(a.y).toBeLessThan(b.y);
  expect(b.y).toBeLessThan(c.y);
  await expect(dots(page)).toBeHidden(); // phones only

  // The current step is showing, and marked on the route.
  await expect(step(page, 'Add 2 places')).toBeVisible();
  await expect(stops[1]).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 'Add 2 places')).toContainText('Step 2 of 3');
  const pane = await box(step(page, 'Add 2 places'));
  expect((await box(routePanel(page))).x).toBeGreaterThanOrEqual(pane.x + pane.width - 1);

  // The arrows sit below the step's buttons, at the bright side's corners.
  const buttons = await box(step(page, 'Add 2 places').getByRole('button', { name: 'Import' }));
  const [prev, next] = await Promise.all([box(guide(page).getByRole('button', { name: 'Previous step' })), box(guide(page).getByRole('button', { name: 'Next step' }))]);
  expect(prev.y).toBeGreaterThanOrEqual(buttons.y + buttons.height);
  expect(prev.x).toBeLessThan(pane.x + 40);
  expect(next.x + next.width).toBeGreaterThan(pane.x + pane.width - 40);

  // Moving between steps never changes the card's size.
  const size = await box(card(page));
  await guide(page).getByRole('button', { name: 'Next step' }).click();
  await expect(step(page, 'Start picking')).toBeVisible();
  await expect(step(page, 'Start picking')).toContainText('Add 2 places first');
  await expect(stops[2]).toHaveAttribute('aria-current', 'step');
  await expect(guide(page).getByRole('button', { name: 'Next step' })).toBeDisabled();
  expect(await box(card(page))).toMatchObject({ width: size.width, height: size.height });

  await stops[0].click();
  await expect(step(page, 'Set your home')).toBeVisible();
  await expect(step(page, 'Set your home')).toContainText('No problem. Add it whenever you like to see travel times on every card.');
  await expect(step(page, 'Set your home').getByText('Skipped', { exact: true })).toBeVisible();
  await expect(routePanel(page).getByText('Skipped', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(step(page, 'Set your home').getByRole('button', { name: 'Add home' })).toBeVisible();
  await expect(guide(page).getByRole('button', { name: 'Previous step' })).toBeDisabled();
  expect(await box(card(page))).toMatchObject({ width: size.width, height: size.height });
});

test('#38 AC2 + AC3: on a phone, the route runs across the top; steps swipe, with arrows and dots kept in sync', async ({ page, browser }) => {
  await page.setViewportSize(PHONE);
  await newcomer(page, browser);

  const stops = [stop(page, 'Set your home, skipped'), stop(page, 'Add 2 places'), stop(page, 'Start picking')];
  const [a, b, c] = await Promise.all(stops.map(box));
  expect(Math.abs(a.y - b.y)).toBeLessThan(2); // side by side
  expect(a.x).toBeLessThan(b.x);
  expect(b.x).toBeLessThan(c.x);
  await expect(routePanel(page)).toContainText('Home');
  await expect(routePanel(page)).toContainText('Places');
  await expect(routePanel(page)).toContainText('Pick');
  expect((await box(routePanel(page))).y).toBeLessThan((await box(step(page, 'Add 2 places'))).y);

  const dotFor = (title: string) => dots(page).getByRole('button', { name: title, exact: true });
  await expect(dotFor('Add 2 places')).toHaveAttribute('aria-current', 'step');
  const size = await box(card(page));

  // Swipe (scroll the steps sideways): the dots, route and arrows follow.
  await guide(page)
    .getByTestId('guide-steps')
    .evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: 'instant' }));
  await expect(step(page, 'Start picking')).toBeVisible();
  await expect(dotFor('Start picking')).toHaveAttribute('aria-current', 'step');
  await expect(stops[2]).toHaveAttribute('aria-current', 'step');
  await expect(guide(page).getByRole('button', { name: 'Next step' })).toBeDisabled();

  await dotFor('Set your home, skipped').click();
  await expect(step(page, 'Set your home')).toBeVisible();
  await expect(stops[0]).toHaveAttribute('aria-current', 'step');
  await guide(page).getByRole('button', { name: 'Next step' }).click();
  await expect(step(page, 'Add 2 places')).toBeVisible();
  expect(await box(card(page))).toMatchObject({ width: size.width, height: size.height });

  // The arrows and dots share a row at the bottom of the card.
  const [prev, next, dotsBox] = await Promise.all([box(guide(page).getByRole('button', { name: 'Previous step' })), box(guide(page).getByRole('button', { name: 'Next step' })), box(dots(page))]);
  expect(Math.abs(prev.y + prev.height / 2 - (dotsBox.y + dotsBox.height / 2))).toBeLessThan(3);
  expect(prev.x).toBeLessThan(dotsBox.x);
  expect(next.x).toBeGreaterThan(dotsBox.x + dotsBox.width);
  expect(prev.y).toBeGreaterThan((await box(step(page, 'Add 2 places'))).y);
});

test('#38 AC2: the card keeps its size as steps get done, and nothing in it is clipped on a narrow phone with larger text', async ({ page, browser }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await newcomer(page, browser);
  const size = await box(card(page));
  await addPlaceViaApi(page, uniqueName('Invented Dumpling '));
  await page.reload();
  await expect(step(page, 'Add 2 places')).toContainText('1 of 2 added');
  expect(await box(card(page))).toMatchObject({ width: size.width, height: size.height });

  await page.addStyleTag({ content: 'html { zoom: 1.3 }' });
  for (const title of ['Set your home', 'Add 2 places', 'Start picking']) {
    await dots(page).getByRole('button', { name: new RegExp(`^${title}`) }).click();
    await expect(step(page, title)).toBeVisible();
    const overflow = await step(page, title).evaluate((el) => ({ x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight }));
    expect(overflow, title).toEqual({ x: 0, y: 0 });
  }
  // The steps' row and the route never need scrolling up and down (the card's sun is meant to hang off its corner).
  for (const part of [guide(page).getByTestId('guide-steps'), routePanel(page)]) expect(await part.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
  const panel = await box(routePanel(page));
  for (const s of await routePanel(page).getByRole('button').all()) {
    const b = await box(s);
    expect(b.x).toBeGreaterThanOrEqual(panel.x);
    expect(b.x + b.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320); // long names wrap too
});

test('#38 AC4: "Add home" and "Skip for now" on the home step', async ({ page, browser }) => {
  await page.setViewportSize(DESKTOP);
  await newcomer(page, browser, { home: 'undecided' });
  await expect(step(page, 'Set your home')).toBeVisible();
  await expect(step(page, 'Set your home')).toContainText('Step 1 of 3 · optional');
  await expect(stop(page, 'Set your home')).toHaveAttribute('aria-current', 'step');

  await step(page, 'Set your home').getByRole('button', { name: 'Skip for now' }).click();
  await expect(stop(page, 'Set your home, skipped')).toBeVisible();
  await expect(step(page, 'Add 2 places')).toBeVisible(); // on to the next one
  expect((await (await page.request.get('/api/me')).json()).homeSkipped).toBe(true);

  await stop(page, 'Set your home, skipped').click();
  await step(page, 'Set your home').getByRole('button', { name: 'Add home' }).click();
  await saveHomeFromSuggestion(page);
  await expect(stop(page, 'Set your home')).toBeVisible();
  await stop(page, 'Set your home').click();
  await expect(step(page, 'Set your home')).toContainText(`Home is ${PRETEND_ST_SUGGESTION}. Change it any time on the You page.`);
  await expect(routePanel(page)).toContainText('1 of 3 done');
});

test('#38 AC4: "Add a place" and "Import" use the usual sheets over Home; two places finish the step, and Start picking starts All places', async ({ page, browser }) => {
  await page.setViewportSize(DESKTOP);
  await newcomer(page, browser);
  const places = step(page, 'Add 2 places');

  await places.getByRole('button', { name: 'Add a place' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a place' });
  await sheet.getByLabel('Google Maps link').fill(placeLink(uniqueName('Pretend Bistro ')));
  await sheet.getByRole('button', { name: 'Add place' }).click();
  await expect(sheet).toBeHidden();
  await expect(places).toContainText('1 of 2 added');
  await expect(page).toHaveURL(/\/$/);

  await places.getByRole('button', { name: 'Import' }).click();
  const importSheet = page.getByRole('dialog', { name: 'Import from Google Maps' });
  await importSheet.getByLabel(/takeout files/i).setInputFiles([fixture('Date night.csv')]);
  await expect(importSheet.getByText(/added \d+ places/i)).toBeVisible();
  await importSheet.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/$/); // stays on Home, unlike importing from the Places page

  await expect(step(page, 'Start picking')).toBeVisible(); // places done: on to picking
  await expect(routePanel(page)).toContainText('1 of 3 done · 1 skipped');
  await stop(page, 'Add 2 places').click();
  const count = ((await (await page.request.get('/api/places')).json()) as unknown[]).length;
  await expect(step(page, 'Add 2 places')).toContainText(`${count} places added. Add more any time on the Places page.`);

  await stop(page, 'Start picking').click();
  await expect(step(page, 'Start picking')).toContainText("Tap whichever of two places you'd rather go to. Then share the link so friends can pick too.");
  await step(page, 'Start picking').getByRole('button', { name: 'Start picking' }).click();
  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: 'All places' })).toBeVisible();
});

test('#38 AC4: a step done elsewhere shows as done without reloading', async ({ page, browser }) => {
  await newcomer(page, browser);
  await expect(stop(page, 'Add 2 places')).toBeVisible();
  for (const name of [uniqueName('Invented Tapas '), uniqueName('Invented Curry ')]) await addPlaceViaApi(page, name); // e.g. from another device
  await expect(routePanel(page)).toContainText('1 of 3 done · 1 skipped', { timeout: 10_000 });
  await expect(step(page, 'Start picking').getByRole('button', { name: 'Start picking' })).toBeEnabled();
});

test('#38 AC4: picking waits for 2 places, but places can be added before deciding on home', async ({ page, browser }) => {
  await page.setViewportSize(DESKTOP);
  await newcomer(page, browser, { home: 'undecided' });
  await stop(page, 'Add 2 places').click();
  await expect(step(page, 'Add 2 places')).toContainText('Coming up');
  await expect(step(page, 'Add 2 places').getByRole('button', { name: 'Add a place' })).toBeVisible();
  await stop(page, 'Start picking').click();
  await expect(step(page, 'Start picking').getByRole('button', { name: 'Start picking' })).toHaveCount(0);
  await expect(step(page, 'Start picking')).toContainText('Add 2 places first');
});

test('#38 AC5 + AC6: starting with home undecided skips it; back on Home, "You\'re all set!" until the guide is closed, on every device', async ({ page, browser }) => {
  await page.setViewportSize(DESKTOP);
  const name = await newcomer(page, browser, { home: 'undecided' });
  for (const place of [uniqueName('Invented Laksa '), uniqueName('Invented Bagel ')]) await addPlaceViaApi(page, place);
  await page.reload();
  await stop(page, 'Start picking').click();
  await step(page, 'Start picking').getByRole('button', { name: 'Start picking' }).click();
  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
  expect((await (await page.request.get('/api/me')).json()).homeSkipped).toBe(true);

  await page.getByRole('link', { name: 'Pick', exact: true }).click();
  await expect(page.getByText('Your table is ready.')).toBeVisible();
  await expect(guide(page).getByRole('heading', { name: "You're all set!" })).toBeVisible();
  await expect(routePanel(page)).toContainText('2 of 3 done · 1 skipped');
  await expect(guide(page).getByRole('button', { name: 'Add home' })).toBeVisible();
  await expect(guide(page).getByRole('button', { name: 'Next step' })).toBeHidden();

  await page.reload(); // stored on the server
  await expect(guide(page).getByRole('heading', { name: "You're all set!" })).toBeVisible();

  await guide(page).getByRole('button', { name: 'Close the guide' }).click();
  await expect(guide(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: `Where to, ${name}?` })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Let's pick somewhere." })).toBeVisible();

  const laptop = await (await browser.newContext()).newPage();
  await laptop.goto(`/?invite=${INVITE}`);
  await signInHere(laptop, name, '1234');
  await expect(laptop.getByRole('heading', { name: `Where to, ${name}?` })).toBeVisible();
  await expect(guide(laptop)).toHaveCount(0);
});

test('#38: the guide can be closed before it is finished, from the link under the card', async ({ page, browser }) => {
  const name = await newcomer(page, browser);
  await page.getByRole('button', { name: 'Close the guide' }).click();
  await expect(page.getByRole('heading', { name: `Where to, ${name}?` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: "Let's pick somewhere." })).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
});

test('#38 AC7: arrows, dots and stops are labelled buttons, the viewed stop is aria-current, it all works by keyboard, and drawings are hidden', async ({ page, browser }) => {
  await page.setViewportSize(PHONE);
  await newcomer(page, browser);
  await expect(guide(page).locator('svg:not([aria-hidden="true"])')).toHaveCount(0);

  const next = guide(page).getByRole('button', { name: 'Next step' });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(step(page, 'Start picking')).toBeVisible();
  await expect(stop(page, 'Start picking')).toHaveAttribute('aria-current', 'step');
  await expect(stop(page, 'Add 2 places')).not.toHaveAttribute('aria-current', 'step');

  await stop(page, 'Set your home, skipped').focus();
  await page.keyboard.press('Enter');
  await expect(step(page, 'Set your home')).toBeVisible();
  await stop(page, 'Start picking').focus(); // the last stop on the route
  await page.keyboard.press('Tab'); // on into the shown step's own buttons, never into hidden steps
  await expect(step(page, 'Set your home').getByRole('button', { name: 'Add home' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Home address' })).toBeVisible();
});
