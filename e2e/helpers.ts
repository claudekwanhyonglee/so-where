import { expect, type Browser, type Page } from '@playwright/test';

export const INVITE = 'e2e-invite';

export const uniqueName = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 7)}`;

const PIN_WARNING = /light lock.*not real security.*bank or phone PIN/is;

export async function signUp(page: Page, name: string, pin = '1234', path = '/') {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}invite=${INVITE}`);
  await page.getByRole('button', { name: /i'm new/i }).click();
  await expect(page.getByText(PIN_WARNING)).toBeVisible();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Choose a 4-digit PIN').fill(pin);
  await page.getByRole('button', { name: /^start$/i }).click();
  await expectSignedIn(page);
}

/** The signed-in app is showing: its nav (the top nav or the bottom tabs, whichever fits the screen) is there. */
export async function expectSignedIn(page: Page) {
  await expect(page.getByRole('link', { name: 'You', exact: true })).toBeVisible();
}

/** Who the desktop top nav says is signed in. */
export const signedInAs = (page: Page, name: string) => expect(page.getByRole('banner').getByText(name, { exact: true })).toBeVisible();

/** A fresh browser (as if another device) with a new person signed in. */
export async function newPerson(browser: Browser, prefix: string, path = '/') {
  const context = await browser.newContext();
  const page = await context.newPage();
  const name = uniqueName(prefix);
  await signUp(page, name, '1234', path);
  return { page, name, context };
}

export { PIN_WARNING };
