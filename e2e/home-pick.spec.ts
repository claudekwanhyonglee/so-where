import { expect, test, type Locator, type Page } from '@playwright/test';
import { homeStep, INVITE, pickCountry, PRETEND_ST_SUGGESTION, signUp, signUpToHomeStep, stubMapTiles, uniqueName } from './helpers.ts';

/** #42 AC5: every check runs in both places a home is set. */
const WHERE: { name: string; open: (page: Page) => Promise<{ form: Locator; save: string }> }[] = [
  {
    name: 'the sign-up home step',
    open: async (page) => {
      await page.goto(`/?invite=${INVITE}`);
      await signUpToHomeStep(page, uniqueName('Picker'));
      await pickCountry(homeStep(page));
      return { form: homeStep(page), save: 'Save home' };
    },
  },
  {
    name: 'Profile → Home',
    open: async (page) => {
      await signUp(page, uniqueName('Picker'));
      await page.goto('/you');
      await page.getByRole('button', { name: /^Home address/ }).click();
      await pickCountry(page.getByRole('dialog', { name: 'Home address' }));
      return { form: page.getByRole('dialog', { name: 'Home address' }), save: 'Save address' };
    },
  },
];

for (const { name, open } of WHERE) {
  test(`#42 AC1 + AC5: in ${name}, Save stays disabled until a suggestion is chosen, which shows on the map`, async ({ page }) => {
    await stubMapTiles(page);
    const { form, save } = await open(page);
    const saveButton = form.getByRole('button', { name: save });
    await expect(saveButton).toBeDisabled();

    await form.getByLabel('Address').fill('1 Pretend Street');
    await expect(form.getByRole('list', { name: 'Suggestions' })).toBeVisible();
    await expect(saveButton).toBeDisabled(); // typed, not chosen

    await form.getByRole('button', { name: PRETEND_ST_SUGGESTION }).click();
    await expect(form.getByRole('img', { name: `Map of ${PRETEND_ST_SUGGESTION}` })).toBeVisible();
    await expect(saveButton).toBeEnabled();
  });

  test(`#42 AC2 + AC5: in ${name}, editing the text after choosing clears the choice, the map and Save`, async ({ page }) => {
    await stubMapTiles(page);
    const { form, save } = await open(page);
    await form.getByLabel('Address').fill('1 Pretend');
    await form.getByRole('button', { name: PRETEND_ST_SUGGESTION }).click();
    await expect(form.getByRole('button', { name: save })).toBeEnabled();

    await form.getByLabel('Address').press('End');
    await form.getByLabel('Address').press('Backspace');
    await expect(form.getByLabel('Address')).not.toHaveValue(PRETEND_ST_SUGGESTION);
    await expect(form.getByRole('img', { name: /^Map of/ })).toHaveCount(0);
    await expect(form.getByRole('button', { name: save })).toBeDisabled();
  });

  test(`#42 AC3 + AC5: in ${name}, when suggestions can't load it asks to try again and Save stays disabled`, async ({ page }) => {
    const { form, save } = await open(page);
    await form.getByLabel('Address').fill('Unreachable Lane');
    await expect(form.getByText(/suggestions are unavailable.*try again/i)).toBeVisible();
    await expect(form.getByText(/you can still type/i)).toHaveCount(0);
    await expect(form.getByRole('button', { name: save })).toBeDisabled();
  });
}
