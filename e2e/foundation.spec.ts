import { expect, test } from '@playwright/test';

test('#2 AC4: the app loads in a real browser', async ({ page }) => {
  const res = await page.request.get('/health');
  expect(res.status()).toBe(200);
  await page.goto('/');
  await expect(page).toHaveTitle(/so-where/);
});
