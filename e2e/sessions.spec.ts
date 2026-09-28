import { expect, test, type Page } from '@playwright/test';
import { settled, signUp, signUpHere, startPicking, uniqueName } from './helpers.ts';

async function addPlace(page: Page, name: string, note = '') {
  const hex = Math.floor(Math.random() * 1e12).toString(16);
  await page.getByLabel('Google Maps link').fill(`https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@-37.8,144.96,17z/data=!4m2!3m1!1s0x1:0x${hex}!3d-37.8!4d144.96`);
  await page.getByLabel('Note (optional)').fill(note);
  await page.getByRole('button', { name: /add place/i }).click();
  await expect(page.getByRole('status')).toContainText(name);
}

/** Signs up, adds places, puts them in a new set and starts a session for it. Returns the session page's URL. */
async function startSession(page: Page, places: string[]) {
  await signUp(page, uniqueName('Host'));
  await page.getByRole('link', { name: 'Places', exact: true }).click();
  for (const [i, name] of places.entries()) await addPlace(page, name, i === 0 ? 'Try the special' : '');

  await page.goto('/sets'); // the Sets page, until #19 folds it into Places
  const setName = uniqueName('Tonight ');
  await page.getByLabel('New set name').fill(setName);
  await page.getByRole('button', { name: /create set/i }).click();
  for (const name of places) await page.getByRole('checkbox', { name }).check();

  await startPicking(page, setName);
  await expect(page.getByRole('heading', { name: setName })).toBeVisible();
  return page.url();
}

const cards = (page: Page) => page.getByRole('article');

test('#8 AC1: a friend opens the share link and joins', async ({ page, browser }) => {
  const places = [uniqueName('Invented Pho '), uniqueName('Invented Pizza ')];
  await startSession(page, places);

  await page.getByRole('button', { name: /share/i }).first().click(); // the header's; the solo banner has one too
  const link = await page.getByLabel('Share link').inputValue();
  expect(link).toMatch(/\/s\/[\w-]+\?invite=/);

  const friend = await (await browser.newContext()).newPage();
  const name = uniqueName('Friend');
  await friend.goto(link);
  await signUpHere(friend, name);
  await expect(cards(friend)).toHaveCount(2);
  await expect(page.getByRole('list', { name: "Who's here" }).getByText(name)).toBeVisible({ timeout: 10_000 });
});

test('#8 AC2 + AC3 + AC4 + AC5: pick, tie and "Absolutely not"', async ({ page }) => {
  const places = [uniqueName('Invented Ramen '), uniqueName('Invented Tacos '), uniqueName('Invented Curry ')];
  await startSession(page, places);

  await expect(cards(page)).toHaveCount(2);
  for (const card of await cards(page).all()) {
    const text = await card.innerText();
    expect(places.some((p) => text.includes(p))).toBe(true); // only the set's places
    await expect(card).toContainText('Carlton'); // suburb (faked Nominatim)
    await expect(card.getByRole('link', { name: /open in google maps/i })).toHaveAttribute('href', /cid=/);
  }

  await expect(page.getByText('0 picks', { exact: true })).toBeVisible();
  await cards(page).first().getByRole('button', { name: /^pick /i }).click();
  await expect(page.getByText('1 pick', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /too close to call/i }).click();
  await expect(page.getByText('2 picks', { exact: true })).toBeVisible();

  const vetoedName = (await cards(page).first().getByRole('heading').innerText()).trim();
  await cards(page).first().getByRole('button', { name: /absolutely not/i }).click();
  for (let i = 0; i < 4; i++) {
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).filter({ hasText: vetoedName })).toHaveCount(0);
    await cards(page).first().getByRole('button', { name: /^pick /i }).click();
  }
});

test('#8 AC6: cards stack on a phone and sit side by side on a desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startSession(page, [uniqueName('Invented Deli '), uniqueName('Invented Bakery ')]);
  await expect(page.getByText('Try the special')).toBeVisible(); // #8 AC3: the note, when there is one

  const [first, second] = [cards(page).nth(0), cards(page).nth(1)];
  await settled(page); // the cards slide in
  let [a, b] = [(await first.boundingBox())!, (await second.boundingBox())!];
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1); // stacked
  expect(a.x + a.width).toBeLessThanOrEqual(390);

  await page.setViewportSize({ width: 1280, height: 800 });
  [a, b] = [(await first.boundingBox())!, (await second.boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThan(2); // same row
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1); // side by side
});
