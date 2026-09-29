import { expect, test } from '@playwright/test';
import { INVITE, PIN_WARNING, PRETEND_ST_SUGGESTION, expectSignedIn, saveHomeFromSuggestion, signInHere, signUp, uniqueName } from './helpers.ts';

test('#20 AC1: the You page shows who you are, home, Change PIN and Sign out', async ({ page }) => {
  const name = uniqueName('Me');
  await signUp(page, name);
  await page.getByRole('link', { name: 'You', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText(name[0].toUpperCase(), { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Home address/ })).toContainText('Not set');
  await expect(page.getByRole('button', { name: 'Change PIN' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out on this device' })).toBeVisible();
});

test('#20 AC2: the Home address sheet saves, updates the row and says so', async ({ page }) => {
  await signUp(page, uniqueName('Homer'));
  await page.goto('/you');
  await page.getByRole('button', { name: /^Home address/ }).click();
  await saveHomeFromSuggestion(page);
  await expect(page.getByText('Home saved')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Home address/ })).toContainText(PRETEND_ST_SUGGESTION);
});

test('#20 AC3: Change PIN uses the 4-cell input; the 4th digit changes it', async ({ page, browser }) => {
  const name = uniqueName('Pinner');
  await signUp(page, name, '1234');
  await page.goto('/you');
  await page.getByRole('button', { name: 'Change PIN' }).click();
  const sheet = page.getByRole('dialog', { name: 'New PIN' });
  const pin = sheet.getByLabel('4-digit PIN');
  await expect(pin).toHaveAttribute('inputmode', 'numeric');
  await expect(sheet.locator('input')).toHaveCount(1);
  await expect(sheet.getByText(PIN_WARNING)).toBeVisible();
  await pin.pressSequentially('8642');
  await expect(sheet).toBeHidden();
  await expect(page.getByText('PIN changed')).toBeVisible();

  const device = await (await browser.newContext()).newPage();
  await device.goto(`/?invite=${INVITE}`);
  await signInHere(device, name, '1234');
  await expect(device.getByRole('alert')).toHaveText(/wrong pin/i);
  await device.getByLabel('4-digit PIN').fill('8642');
  await expectSignedIn(device);
});

test("#20 AC4: Sign out on this device goes back to Who's hungry?", async ({ page }) => {
  await signUp(page, uniqueName('Leaver'));
  await page.goto('/you');
  await page.getByRole('button', { name: 'Sign out on this device' }).click();
  await expect(page.getByRole('heading', { name: "Who's hungry?" })).toBeVisible();
});
