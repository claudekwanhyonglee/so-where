import { expect, test, type Locator, type Page } from '@playwright/test';
import { DESKTOPS, PHONES, PORTRAIT, openOn, pickingSession, settled } from './screens.ts';

test.describe.configure({ timeout: 180_000 }); // AC2 goes through every phone size

const cards = (page: Page) => page.getByRole('region', { name: 'Pick', exact: true }).getByRole('article');
const shownToasts = (page: Page) => page.locator('[data-sonner-toast]').filter({ visible: true });

/** Rules out the first card's place from the picking screen, and waits for the next pair. Returns its name. */
async function ruleOutFirstCard(page: Page) {
  const card = cards(page).first();
  const name = (await card.getByRole('heading').innerText()).trim();
  await card.getByRole('button', { name: 'Absolutely not', exact: true }).click();
  await expect(cards(page).filter({ hasText: name })).toHaveCount(0);
  return name;
}

/** Whether a tap in the middle of `control` lands on it (rather than on something drawn over it). */
const tapReaches = (control: Locator) =>
  control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && el.contains(hit);
  });

test('#63 AC1: only one toast shows at a time: ruling out a second place replaces the first toast', async ({ browser }) => {
  const session = await pickingSession(browser, { places: ['Embla', 'Tipo 00', 'Shujinko', 'Chin Chin', 'Hochi Mama'], home: true });
  for (const s of [PORTRAIT[2], DESKTOPS[3]]) {
    const { page, context } = await openOn(browser, s, session.me.state);
    await page.goto(session.path);
    await expect(cards(page)).toHaveCount(2);
    const first = await ruleOutFirstCard(page);
    await expect(shownToasts(page)).toHaveText([new RegExp(`${first} is out for tonight`)]);
    const second = await ruleOutFirstCard(page);
    await expect(shownToasts(page)).toHaveText([new RegExp(`${second} is out for tonight`)]);
    await expect(page.getByText(`${first} is out for tonight`)).toHaveCount(0);
    for (const { placeId } of (await (await session.me.request.get(`/api/sessions/${session.sessionId}/leaderboard`)).json()).combined) {
      await session.me.request.delete(`/api/sessions/${session.sessionId}/vetoes/${placeId}`); // ready for the next size
    }
    await context.close();
  }
  await session.close();
});

test('#63 AC2: at every phone size, with a toast up after 2 rule-outs, taps on the "Absolutely not" chips and "Too close to call" reach them', async ({ browser }) => {
  for (const s of PHONES) {
    const session = await pickingSession(browser, { places: ['Embla', 'Tipo 00', 'Shujinko', 'Chin Chin', 'Hochi Mama'], friends: 4, home: true });
    const { page, context } = await openOn(browser, s, session.me.state);
    await page.goto(session.path);
    await expect(cards(page)).toHaveCount(2);
    await ruleOutFirstCard(page);
    await ruleOutFirstCard(page);
    const chips = page.getByRole('region', { name: 'Absolutely not' }).getByTestId('nope-chip');
    await expect(chips).toHaveCount(2);
    await settled(page);
    await expect(shownToasts(page), s.name).toHaveCount(1);
    for (const control of [...(await chips.all()), page.getByRole('button', { name: 'Too close to call' })]) {
      expect(await tapReaches(control), `${s.name}: ${await control.innerText()}`).toBe(true);
    }
    await expect(shownToasts(page), `${s.name}: the toast was still up`).toHaveCount(1);
    await context.close();
    await session.close();
  }
});

test('#63 AC3: a toast shown while a sheet is open ("Link copied") appears above the sheet and its dimmed overlay', async ({ browser }) => {
  const session = await pickingSession(browser, { places: ['Embla', 'Tipo 00'], home: true });
  for (const s of [PORTRAIT[2], DESKTOPS[3]]) {
    const { page, context } = await openOn(browser, s, session.me.state);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(session.path);
    await page.getByRole('button', { name: 'Share' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Invite your group' });
    await sheet.getByRole('button', { name: 'Copy' }).click();
    const toast = shownToasts(page).filter({ hasText: 'Link copied' });
    await expect(toast, s.name).toBeVisible();
    await expect.poll(() => tapReaches(toast), `${s.name}: the toast is on top (once it has slid in)`).toBe(true);
    await context.close();
  }
  await session.close();
});
