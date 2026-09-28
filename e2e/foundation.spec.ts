import { expect, test, type Page } from '@playwright/test';
import { signUp, uniqueName } from './helpers.ts';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

test('#2 AC4: the app loads in a real browser', async ({ page }) => {
  const res = await page.request.get('/health');
  expect(res.status()).toBe(200);
  await page.goto('/');
  await expect(page).toHaveTitle('So Where?');
});

/** Starts a session through the API (the UI for it isn't what's under test here). */
async function newSessionPath(page: Page) {
  const res = await page.request.post('/api/sessions', { data: { setId: 'all' } });
  return `/s/${(await res.json()).id}`;
}

const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Tabs' });
const topNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test('#14 AC1: users see "So Where?" and never "so-where"', async ({ page, browser }) => {
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto('/');
  await expect(stranger).toHaveTitle('So Where?');
  expect(await stranger.locator('body').innerText()).not.toMatch(/so-where/i);

  await page.setViewportSize(DESKTOP);
  await signUp(page, uniqueName('Namer'));
  await expect(page).toHaveTitle('So Where?');
  await expect(page.getByRole('banner').getByRole('link', { name: 'So Where?' })).toBeVisible();
  for (const path of ['/', '/places', '/you', await newSessionPath(page)]) {
    await page.goto(path);
    await expect(topNav(page)).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/so-where/i);
  }
});

test('#14 AC2: pages load nothing from other hosts, fonts included', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.goto('/');
  await signUp(page, uniqueName('Offline'));
  for (const path of ['/places', '/you', await newSessionPath(page)]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
  });
  expect(fonts.join()).toMatch(/Figtree/);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((url) => !url.startsWith(baseURL!) && !url.startsWith('data:'))).toEqual([]);
});

test('#14 AC3: bottom tabs on a phone, top nav on a desktop', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signUp(page, uniqueName('Tabs'));
  await expect(tabBar(page)).toBeVisible();
  await expect(tabBar(page).getByRole('link')).toHaveText(['Pick', 'Places', 'You']);
  await expect(topNav(page)).toBeHidden();

  await page.setViewportSize(DESKTOP);
  await expect(topNav(page)).toBeVisible();
  await expect(topNav(page).getByRole('link')).toHaveText(['Pick', 'Places', 'You']);
  await expect(tabBar(page)).toBeHidden();
});

test('#14 AC4: the active nav item follows the route', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signUp(page, uniqueName('Nav'));
  const active = () => topNav(page).locator('[aria-current="page"]');
  const sets = await (await page.request.get('/api/sets')).json();
  const setRes = await page.request.post('/api/sets', { data: { name: uniqueName('Nav set ') } });
  const setId = (await setRes.json()).id;

  const expected: [string, string][] = [
    ['/', 'Pick'],
    [await newSessionPath(page), 'Pick'],
    ['/places', 'Places'],
    [`/sets/${setId}`, 'Places'],
    [`/sets/${sets[0].id}`, 'Places'],
    ['/you', 'You'],
  ];
  for (const [path, item] of expected) {
    await page.goto(path);
    await expect(active(), path).toHaveText(item);
  }

  await page.setViewportSize(PHONE);
  await page.goto('/places');
  await expect(tabBar(page).locator('[aria-current="page"]')).toHaveText('Places');
});

test('#14 AC5: a sheet closes on Esc and on the backdrop; bottom on phones, centred on desktops', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signUp(page, uniqueName('Sheet'));
  await page.goto(await newSessionPath(page));
  const sheet = page.getByRole('dialog');
  const openSheet = async () => {
    await page.getByRole('button', { name: /share/i }).first().click();
    await expect(sheet).toBeVisible();
  };

  await openSheet();
  const phoneBox = (await sheet.boundingBox())!;
  expect(Math.abs(phoneBox.y + phoneBox.height - PHONE.height)).toBeLessThan(2); // flush with the bottom
  expect(phoneBox.width).toBeGreaterThan(PHONE.width - 2);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await openSheet();
  await page.mouse.click(PHONE.width / 2, 20); // the backdrop, above the sheet
  await expect(sheet).toBeHidden();

  await page.setViewportSize(DESKTOP);
  await openSheet();
  const box = (await sheet.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - DESKTOP.width / 2)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - DESKTOP.height / 2)).toBeLessThan(2);
  await page.mouse.click(20, 20);
  await expect(sheet).toBeHidden();
});
