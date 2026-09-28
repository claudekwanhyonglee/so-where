import { expect, test, type Browser, type Page } from '@playwright/test';
import { INVITE, PIN_WARNING, expectSignedIn, signUp, uniqueName } from './helpers.ts';

/** Someone who already exists, and a fresh device showing the sign-in screen. */
async function existingPersonOnNewDevice(page: Page, browser: Browser, pin = '2468') {
  const name = uniqueName('Jo');
  await signUp(page, name, pin);
  const device = await (await browser.newContext()).newPage();
  await device.goto(`/?invite=${INVITE}`);
  return { name, device };
}

const pinInput = (page: Page) => page.getByLabel('4-digit PIN');

test("#15 AC1: Who's hungry? lists each person with their initial, plus I'm new here", async ({ page, browser }) => {
  const { name, device } = await existingPersonOnNewDevice(page, browser);
  await expect(device.getByRole('heading', { name: "Who's hungry?" })).toBeVisible();
  const person = device.getByRole('button', { name, exact: true });
  await expect(person).toBeVisible();
  await expect(person.getByText(name[0].toUpperCase(), { exact: true })).toBeVisible();
  await expect(device.getByRole('button', { name: "I'm new here" })).toBeVisible();
});

test('#15 AC2 + AC3: one numeric PIN input, no keypad, and the 4th digit signs in', async ({ page, browser }) => {
  const { name, device } = await existingPersonOnNewDevice(page, browser);
  await device.getByRole('button', { name, exact: true }).click();

  await expect(device.locator('input')).toHaveCount(1);
  await expect(pinInput(device)).toHaveAttribute('inputmode', 'numeric');
  await expect(device.getByRole('button', { name: /^\d$/ })).toHaveCount(0);

  await pinInput(device).pressSequentially('246');
  await expect(pinInput(device)).toBeVisible(); // 3 digits: still waiting
  await pinInput(device).pressSequentially('8'); // no button press
  await expect(device.getByRole('heading', { name: `Where to, ${name}?` })).toBeVisible();
});

test('#15 AC4: a wrong PIN shows an error, clears and stays on the PIN step', async ({ page, browser }) => {
  const { name, device } = await existingPersonOnNewDevice(page, browser);
  await device.getByRole('button', { name, exact: true }).click();
  await pinInput(device).pressSequentially('1111');
  await expect(device.getByRole('alert')).toHaveText(/wrong pin/i);
  await expect(pinInput(device)).toHaveValue('');
  await expect(pinInput(device)).toBeFocused();

  await pinInput(device).pressSequentially('2468');
  await expectSignedIn(device);
});

test('#15 AC5: "Not <name>?" goes back to the person picker', async ({ page, browser }) => {
  const { name, device } = await existingPersonOnNewDevice(page, browser);
  await device.getByRole('button', { name, exact: true }).click();
  await device.getByRole('button', { name: `Not ${name}?` }).click();
  await expect(device.getByRole('heading', { name: "Who's hungry?" })).toBeVisible();
});

test("#15 AC6: I'm new here → name → Continue → PIN (with the warning) creates the person and signs them in", async ({ page }) => {
  const name = uniqueName('Newbie');
  await page.goto(`/?invite=${INVITE}`);
  await page.getByRole('button', { name: "I'm new here" }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(PIN_WARNING)).toBeVisible();
  await pinInput(page).pressSequentially('4321');
  await expect(page.getByRole('heading', { name: `Where to, ${name}?` })).toBeVisible();

  // The new person can sign in with that PIN elsewhere.
  const res = await page.request.post('/api/signin', { data: { name, pin: '4321' } });
  expect(res.ok()).toBe(true);
});

test('#15: the PIN step sits in the top half of a phone screen', async ({ page, browser }) => {
  const { name, device } = await existingPersonOnNewDevice(page, browser);
  await device.setViewportSize({ width: 390, height: 844 });
  await device.getByRole('button', { name, exact: true }).click();
  const box = (await pinInput(device).boundingBox())!;
  expect(box.y + box.height).toBeLessThan(844 / 2);
});
