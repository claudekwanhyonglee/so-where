import { expect, test, type Locator, type Page } from '@playwright/test';
import { addPlaceViaApi, signUp, uniqueName } from './helpers.ts';

const DESKTOP = { width: 1280, height: 800 };

async function openSession(page: Page, count = 4) {
  await signUp(page, uniqueName('Mover'));
  const places = [];
  for (let i = 0; i < count; i++) places.push(await addPlaceViaApi(page, uniqueName('Invented Diner ')));
  const { id: setId } = await (await page.request.post('/api/sets', { data: { name: uniqueName('Motion ') } })).json();
  for (const p of places) await page.request.put(`/api/sets/${setId}/places/${p.id}`);
  const { id } = await (await page.request.post('/api/sessions', { data: { setId } })).json();
  await page.goto(`/s/${id}`);
  await expect(cards(page)).toHaveCount(2);
}

const pickRegion = (page: Page) => page.getByRole('region', { name: 'Pick', exact: true });
const cards = (page: Page) => pickRegion(page).getByRole('article');
const orBadge = (page: Page) => pickRegion(page).getByTestId('or');
const style = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
/** The rotation (degrees) in an element's computed transform. */
const rotation = (l: Locator) =>
  l.evaluate((el) => {
    const t = getComputedStyle(el).transform;
    if (t === 'none') return 0;
    const m = new DOMMatrix(t);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  });
const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));

test('#56 AC1: hovering a card tips it in and lifts it, and OR leans towards it; the other card stays put', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openSession(page);
  await settled(page);
  const [first, second] = [cards(page).first(), cards(page).last()];

  await first.hover({ position: { x: 60, y: 200 } });
  await expect.poll(() => rotation(first)).toBeCloseTo(-1.8, 1);
  expect(await first.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).f)).toBeCloseTo(-4, 0); // lifted 4px
  await expect.poll(() => rotation(orBadge(page))).toBeCloseTo(-12, 0);
  expect(await style(second, 'transform')).toBe('none');

  await second.hover({ position: { x: 60, y: 200 } });
  await expect.poll(() => rotation(second)).toBeCloseTo(1.8, 1);
  await expect.poll(() => rotation(orBadge(page))).toBeCloseTo(12, 0);
  expect(await style(first, 'transform')).toBe('none');
});

for (const how of ['tap', 'key'] as const) {
  test(`#56 AC2 + AC3: picking (${how === 'tap' ? 'a tap' : '←'}) squashes and stamps it with confetti; the other drops, OR shrinks; ~700ms later the next pair`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openSession(page);
    await settled(page);
    const [first, second] = [cards(page).first(), cards(page).last()];

    const started = Date.now();
    if (how === 'tap') await first.getByRole('button', { name: /^Pick / }).click();
    else await page.keyboard.press('ArrowLeft');
    await expect(first.getByText('Yes please')).toBeVisible();
    expect(await style(first, 'animation-name')).toBe('pick-pop');
    await expect(first.getByTestId('confetti').locator('i')).toHaveCount(20);
    await expect(second.getByText('Yes please')).toHaveCount(0);
    await expect.poll(() => style(second, 'opacity').then(Number)).toBeLessThan(0.4);
    await expect.poll(() => style(orBadge(page), 'opacity').then(Number)).toBeLessThan(0.1);

    await expect(pickRegion(page).getByText('1 pick', { exact: true })).toBeVisible();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThan(650);
    expect(elapsed).toBeLessThan(1500);
    await expect(cards(page).first().getByText('Yes please')).toHaveCount(0);
  });
}

test('#56 AC4: the next pair is dealt in, each card from its own side with a tilt, the second a little later, then OR spins in', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openSession(page);
  await cards(page).first().getByRole('button', { name: /^Pick / }).click();
  await expect(pickRegion(page).getByText('1 pick', { exact: true })).toBeVisible();
  const [first, second] = [cards(page).first(), cards(page).last()];
  expect(await style(first, 'animation-name')).toBe('deal-left');
  expect(await style(second, 'animation-name')).toBe('deal-right');
  const [d1, d2, dOr] = await Promise.all([style(first, 'animation-delay'), style(second, 'animation-delay'), style(orBadge(page), 'animation-delay')]);
  expect(parseFloat(d2)).toBeGreaterThan(parseFloat(d1));
  expect(parseFloat(dOr)).toBeGreaterThan(parseFloat(d2));
  expect(await style(orBadge(page), 'animation-name')).toBe('or-spin');
});

test('#56 AC5: "Too close to call" (or ↓) stamps neither card and throws no confetti', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openSession(page);
  await settled(page);
  for (const tie of [() => page.getByRole('button', { name: 'Too close to call' }).click(), () => page.keyboard.press('ArrowDown')]) {
    const picked = page.waitForRequest((r) => r.url().endsWith('/picks'));
    await tie();
    await picked;
    await expect(pickRegion(page).getByText('Yes please')).toHaveCount(0);
    await expect(pickRegion(page).getByTestId('confetti')).toHaveCount(0);
    await settled(page);
  }
});

test('#56 AC6: with reduced motion nothing moves: the stamp just appears, the other card fades, the next pair fades in', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(DESKTOP);
  await openSession(page);
  const [first, second] = [cards(page).first(), cards(page).last()];
  expect(await style(first, 'animation-name')).toBe('pair-fade-in');
  await first.hover({ position: { x: 60, y: 200 } });
  expect(await style(first, 'transform')).toBe('none');

  await first.getByRole('button', { name: /^Pick / }).click();
  const stamp = first.getByText('Yes please');
  await expect(stamp).toBeVisible();
  expect(await style(stamp, 'opacity')).toBe('1');
  expect(await style(stamp, 'animation-name')).toBe('none');
  expect(await style(first, 'transform')).toBe('none');
  await expect(first.getByTestId('confetti')).toBeHidden();
  await expect.poll(() => style(second, 'opacity').then(Number)).toBeLessThan(0.4);
  expect(await style(second, 'transform')).toBe('none');
});

test('#56 AC7: "Absolutely not" slams a red stamp on that card, no confetti; it drops away and the next pair is dealt in', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openSession(page);
  await settled(page);
  const first = cards(page).first();
  const name = (await first.getByRole('heading').innerText()).trim();
  await first.getByRole('button', { name: 'Absolutely not', exact: true }).click();
  const stamp = first.getByText('Absolutely not', { exact: true });
  await expect(stamp).toBeVisible();
  await expect(stamp).toHaveCSS('color', 'rgb(214, 45, 79)'); // --color-stamp
  await expect(first.getByTestId('confetti')).toHaveCount(0);
  await expect(page.getByText(`${name} is out for tonight`)).toBeVisible();
  await expect(cards(page).filter({ hasText: name })).toHaveCount(0);
  expect(await style(cards(page).first(), 'animation-name')).toBe('deal-left');
});
