import { expect, test } from '@playwright/test';
import { placeLink, uniqueName } from './helpers.ts';
import { LONG_PERSON, LONG_SET, LONG_WORD, PORTRAIT, endsInEllipsis, expectInside, expectScreenWide, openOn, personNamed, splitWords } from './screens.ts';

test('#60 AC1: at 320–430px, Home with a long set name in Recent is exactly screen-wide, and the name ends in … inside its row', async ({ browser }) => {
  const me = await personNamed(browser, uniqueName('Narrow'));
  const placeIds = [];
  for (const name of ['Invented Deli', 'Invented Noodle Bar']) placeIds.push((await (await me.request.post('/api/places', { data: { url: placeLink(uniqueName(name)) } })).json()).place.id);
  const { id: setId } = await (await me.request.post('/api/sets', { data: { name: LONG_SET } })).json();
  for (const id of placeIds) await me.request.put(`/api/sets/${setId}/places/${id}`);
  await me.request.post('/api/sessions', { data: { setId } });

  for (const s of PORTRAIT) {
    const { page, context } = await openOn(browser, s, me.state);
    await page.goto('/');
    const row = page.getByRole('region', { name: 'Recent' }).getByRole('listitem').filter({ hasText: LONG_SET.slice(0, 10) }).first();
    await expect(row).toBeVisible();
    await expectScreenWide(page, s);
    const name = row.getByText(LONG_SET, { exact: true });
    expect(await endsInEllipsis(name), `ellipsis at ${s.name}`).toBe(true);
    await expectInside(name, row, `name at ${s.name}`);
    await context.close();
  }
  await me.close();
});

test('#60 AC2: at 320px, a place called "Supercalifragilisticexpialidocious" stays inside its row on the Places pages', async ({ browser }) => {
  const me = await personNamed(browser, uniqueName('Wordy'));
  const { place } = await (await me.request.post('/api/places', { data: { url: placeLink(LONG_WORD) } })).json();
  const { id: setId } = await (await me.request.post('/api/sets', { data: { name: uniqueName('Words ') } })).json();
  await me.request.put(`/api/sets/${setId}/places/${place.id}`);

  const s = PORTRAIT[0];
  const { page, context } = await openOn(browser, s, me.state);
  for (const path of ['/places/all', `/places/${setId}`]) {
    await page.goto(path);
    const row = page.getByRole('list', { name: /^Places in/ }).getByRole('listitem').filter({ hasText: LONG_WORD }).first();
    await expect(row).toBeVisible();
    const name = row.getByText(LONG_WORD, { exact: true });
    await expectInside(name, row, `${path}: name`);
    expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth), `${path}: no spill`).toBe(true);
    await expectScreenWide(page, s);
  }
  await context.close();
  await me.close();
});

test('#60 AC3: at 320–430px, sign-in wraps a long name only between words or ends it in …', async ({ browser }) => {
  await (await personNamed(browser, LONG_PERSON)).close();
  for (const s of PORTRAIT) {
    const { page, context } = await openOn(browser, s);
    await page.goto('/?invite=e2e-invite');
    const label = page.getByRole('button', { name: LONG_PERSON }).locator('span').last();
    await expect(label).toHaveText(LONG_PERSON);
    expect(await splitWords(label), `words split at ${s.name}`).toEqual([]);
    const overflows = await label.evaluate((el) => el.scrollWidth > el.clientWidth);
    if (overflows) expect(await endsInEllipsis(label), `ellipsis at ${s.name}`).toBe(true);
    await expectScreenWide(page, s);
    await context.close();
  }
});
