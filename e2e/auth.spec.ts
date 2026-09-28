import { expect, test } from '@playwright/test';
import { INVITE, PIN_WARNING, signedInAs, signInHere, signUp, uniqueName } from './helpers.ts';

test('#3 AC1: without the invite code the app shows no access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/no access/i)).toBeVisible();
});

test('#3 AC2 + AC9: a new person signs up with a warned PIN and stays signed in', async ({ page }) => {
  const name = uniqueName('Alex');
  await signUp(page, name);
  await page.reload();
  await signedInAs(page, name);
  await page.goto('/');
  await signedInAs(page, name);
});

test('#3 AC3: another device signs in by choosing the name and entering the PIN', async ({ page, browser }) => {
  const name = uniqueName('Jo');
  await signUp(page, name, '2468');

  const laptop = await (await browser.newContext()).newPage();
  await laptop.goto(`/?invite=${INVITE}`);
  await signInHere(laptop, name, '1111');
  await expect(laptop.getByText(/wrong pin/i)).toBeVisible();
  await laptop.getByLabel('4-digit PIN').fill('2468');
  await signedInAs(laptop, name);
});

test('#3 AC6 + AC7 + AC8 + AC9: profile — home address, PIN change with warning, sign out', async ({ page }) => {
  const name = uniqueName('Sam');
  await signUp(page, name);
  await page.getByRole('link', { name: /you/i }).click();

  await page.getByRole('button', { name: /^Home address/ }).click();
  const home = page.getByRole('dialog', { name: 'Home address' });
  await home.getByLabel('Address').fill('Nowhere Lane');
  await home.getByRole('button', { name: /save address/i }).click();
  await expect(home.getByText(/couldn.t find that address/i)).toBeVisible();

  await home.getByLabel('Address').fill('1 Pretend St, Carlton');
  await home.getByRole('button', { name: /save address/i }).click();
  await expect(page.getByText(/home saved/i)).toBeVisible();

  await page.getByRole('button', { name: 'Change PIN' }).click();
  const changePin = page.getByRole('dialog', { name: 'New PIN' });
  await expect(changePin.getByText(PIN_WARNING)).toBeVisible();
  await changePin.getByLabel('4-digit PIN').fill('9753');
  await expect(page.getByText(/pin changed/i)).toBeVisible();

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('button', { name: /i'm new/i })).toBeVisible();
});
