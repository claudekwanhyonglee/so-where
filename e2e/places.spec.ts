import { expect, test, type Page } from '@playwright/test';
import { addPlaceViaApi, newSetViaApi, placeLink, signUp, uniqueName } from './helpers.ts';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

type ApiPlace = { id: number; name: string; note: string; setIds: number[] };
const apiPlace = async (page: Page, name: string) => ((await (await page.request.get('/api/places')).json()) as ApiPlace[]).find((p) => p.name === name);

const sheet = (page: Page) => page.getByRole('dialog');
const placeRow = (page: Page, name: string) => page.getByRole('list', { name: /^Places in / }).getByRole('listitem').filter({ hasText: name });
const openPlaceMenu = (page: Page, name: string) => placeRow(page, name).getByRole('button', { name: `More for ${name}` }).click();

test('#4 AC1 + AC3 + AC4 + AC5 + AC6: add, dedupe, edit and delete places', async ({ page }) => {
  await signUp(page, uniqueName('Places'));
  await page.getByRole('link', { name: 'Places', exact: true }).click();

  const name = uniqueName('Pretend Diner ');
  const link = placeLink(name);
  await page.getByRole('button', { name: 'Add place', exact: true }).click();
  await sheet(page).getByLabel('Name or Google Maps link').fill(link);
  await sheet(page).getByLabel('Note (optional)').fill('Ask for the back room');
  await sheet(page).getByRole('button', { name: 'Add place' }).click();
  await expect(sheet(page)).toBeHidden();

  const row = placeRow(page, name);
  await expect(row).toContainText('Carlton');
  await expect(row).toContainText('Ask for the back room');
  await openPlaceMenu(page, name);
  await expect(sheet(page).getByRole('link', { name: /open in google maps/i })).toHaveAttribute('href', /maps\.google\.com\/\?cid=\d+/);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Add place', exact: true }).click();
  await sheet(page).getByLabel('Name or Google Maps link').fill(link);
  await sheet(page).getByRole('button', { name: 'Add place' }).click();
  await expect(page.getByText(/already in the list/i)).toBeVisible();
  await expect(placeRow(page, name)).toHaveCount(1);

  await page.getByRole('button', { name: 'Add place', exact: true }).click();
  await sheet(page).getByLabel('Name or Google Maps link').fill('https://example.com/nope');
  await expect(sheet(page).getByText(/isn.t a google maps place link/i)).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Add place' })).toBeDisabled(); // #44 AC3
  await page.keyboard.press('Escape');

  await openPlaceMenu(page, name);
  await sheet(page).getByRole('button', { name: 'Edit note' }).click();
  await sheet(page).getByLabel('Note').fill('Closed Mondays');
  await sheet(page).getByRole('button', { name: 'Save note' }).click();
  await expect(row).toContainText('Closed Mondays');

  await openPlaceMenu(page, name);
  await sheet(page).getByRole('button', { name: 'Delete place' }).click();
  await expect(placeRow(page, name)).toHaveCount(1); // not yet: it asks first
  await sheet(page).getByRole('button', { name: 'Delete place' }).click();
  await expect(placeRow(page, name)).toHaveCount(0);
});

test('#19 AC1: All places first, then every named set with its count, and New set', async ({ page }) => {
  await signUp(page, uniqueName('Organiser'));
  const place = await addPlaceViaApi(page, uniqueName('Invented Cafe '));
  const setName = uniqueName('Brunch ');
  await newSetViaApi(page, setName, [place.id]);
  const sets: { name: string; placeCount: number }[] = await (await page.request.get('/api/sets')).json();

  for (const viewport of [DESKTOP, PHONE]) {
    await page.setViewportSize(viewport);
    await page.goto('/places');
    const list = viewport === DESKTOP ? page.getByRole('navigation', { name: 'Sets' }) : page.getByRole('list', { name: 'Sets' });
    const links = list.getByRole('link');
    await expect(links).toHaveCount(sets.length);
    await expect(links.first()).toContainText('All places');
    for (const s of sets) await expect(links.filter({ hasText: s.name })).toContainText(String(s.placeCount));
    await expect(links.filter({ hasText: setName })).toContainText('1');
    await expect(page.getByRole('button', { name: 'New set' })).toBeVisible();
  }
});

// Picking from a set here moved to Home (#31); starting a session is covered in home.spec.ts.
test('#19 AC2: a set lists its places, with chips for their other sets', async ({ page }) => {
  await signUp(page, uniqueName('Opener'));
  const a = await addPlaceViaApi(page, uniqueName('Invented Deli '));
  const [one, other] = [uniqueName('Lunch '), uniqueName('Late ')];
  const oneId = await newSetViaApi(page, one, [a.id]);
  await newSetViaApi(page, other, [a.id]);

  await page.goto(`/places/${oneId}`);
  await expect(page.getByRole('heading', { name: one })).toBeVisible();
  await expect(placeRow(page, a.name)).toContainText(other);
  await expect(placeRow(page, a.name)).not.toContainText(one);
});

const setDetail = (page: Page) => page.locator('section[aria-labelledby="set-title"]');

test('#31 AC1: the Places page has no Start picking button, whichever set is selected, on phone or desktop', async ({ page }) => {
  await signUp(page, uniqueName('NoStart'));
  const [a, b] = [await addPlaceViaApi(page, uniqueName('Invented Pie ')), await addPlaceViaApi(page, uniqueName('Invented Stew '))];
  const setName = uniqueName('Pickable ');
  const setId = await newSetViaApi(page, setName, [a.id, b.id]);
  for (const viewport of [DESKTOP, PHONE]) {
    await page.setViewportSize(viewport);
    for (const [path, heading] of [['/places/all', 'All places'], [`/places/${setId}`, setName]]) {
      await page.goto(path);
      await expect(setDetail(page).getByRole('heading', { name: heading })).toBeVisible();
      await expect(page.getByRole('button', { name: /start picking/i })).toHaveCount(0);
    }
  }
});

test("#31 AC2: with All places selected, the header's Add place is the only add button", async ({ page }) => {
  await signUp(page, uniqueName('OneAdd'));
  await addPlaceViaApi(page, uniqueName('Invented Wrap '));
  await page.setViewportSize(DESKTOP);
  await page.goto('/places/all');
  await expect(setDetail(page).getByRole('heading', { name: 'All places' })).toBeVisible();
  await expect(setDetail(page).getByRole('button', { name: /add/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /add/i })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add place', exact: true })).toBeVisible();

  // A phone shows the detail without the header, so the detail carries the one Add place (agreed with the user).
  await page.setViewportSize(PHONE);
  await page.goto('/places/all');
  await expect(setDetail(page).getByRole('heading', { name: 'All places' })).toBeVisible();
  await expect(page.getByRole('button', { name: /add/i })).toHaveCount(1);
  await page.getByRole('button', { name: 'Add place', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add a place' })).toBeVisible();
});

test("#31 AC3: a named set's detail has an Add to set button that opens its add-to-set sheet", async ({ page }) => {
  await signUp(page, uniqueName('AddTo'));
  const a = await addPlaceViaApi(page, uniqueName('Invented Soup '));
  const setName = uniqueName('Cosy ');
  const setId = await newSetViaApi(page, setName, [a.id]);
  await page.goto(`/places/${setId}`);
  await expect(setDetail(page).getByRole('button', { name: 'Add places' })).toHaveCount(0);
  await setDetail(page).getByRole('button', { name: 'Add to set', exact: true }).click();
  await expect(page.getByRole('dialog', { name: `Add to ${setName}` })).toBeVisible();
});

test('#19 AC3 + AC4 + AC5: Add place picks its sets, can make a new one, and explains bad links inline', async ({ page }) => {
  await signUp(page, uniqueName('Adder'));
  const [named, unticked] = [uniqueName('Dates '), uniqueName('Cheap ')];
  const namedId = await newSetViaApi(page, named);
  await newSetViaApi(page, unticked);
  await page.goto(`/places/${namedId}`);

  await page.getByRole('button', { name: 'Paste a link' }).click();
  const s = sheet(page);
  await expect(s.getByRole('checkbox', { name: /All places/ })).toBeChecked();
  await expect(s.getByRole('checkbox', { name: /All places/ })).toBeDisabled();
  await expect(s.getByRole('checkbox', { name: named })).toBeChecked(); // opened from it
  await expect(s.getByRole('checkbox', { name: unticked })).not.toBeChecked();

  // AC5: an invalid link gets an inline explanation, and no native validation bubble.
  await s.getByLabel('Name or Google Maps link').fill('https://example.com/nope');
  await expect(s.getByRole('alert')).toContainText(/tap share and copy the link/i);
  expect(await s.getByLabel('Name or Google Maps link').evaluate((el: HTMLInputElement) => el.validationMessage)).toBe('');

  // AC4: a new set from the checklist is ticked, and what was typed stays.
  const name = uniqueName('Invented Bistro ');
  const url = placeLink(name);
  await s.getByLabel('Name or Google Maps link').fill(url);
  await s.getByLabel('Note (optional)').fill('Window seat');
  const fresh = uniqueName('Birthday ');
  await s.getByLabel('New set name').fill(fresh);
  await s.getByRole('button', { name: 'Create' }).click();
  await expect(s.getByRole('checkbox', { name: fresh })).toBeChecked();
  await expect(s.getByLabel('Name or Google Maps link')).toHaveValue(url);
  await expect(s.getByLabel('Note (optional)')).toHaveValue('Window seat');

  await s.getByRole('button', { name: 'Add place' }).click();
  await expect(s).toBeHidden();
  const sets: { id: number; name: string }[] = await (await page.request.get('/api/sets')).json();
  const idOf = (n: string) => sets.find((x) => x.name === n)!.id;
  await expect.poll(async () => (await apiPlace(page, name))?.setIds.sort()).toEqual([idOf(named), idOf(fresh)].sort());
  expect((await apiPlace(page, name))!.note).toBe('Window seat');
});

test('#19 AC6 + AC9: an empty set offers Choose places / Paste a link; the checklist searches and saves as you tick', async ({ page }) => {
  await signUp(page, uniqueName('Filler'));
  const [a, b] = [await addPlaceViaApi(page, uniqueName('Invented Noodles ')), await addPlaceViaApi(page, uniqueName('Invented Tapas '))];
  const setName = uniqueName('Empty ');
  const setId = await newSetViaApi(page, setName);
  await page.goto(`/places/${setId}`);

  await expect(page.getByRole('button', { name: 'Paste a link' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose places' }).click();
  const s = sheet(page);
  const search = s.getByLabel('Search your places');
  await search.fill(a.name.toLowerCase());
  await expect(s.getByRole('checkbox')).toHaveCount(1);
  await search.fill('carlton'); // the suburb
  await expect(s.getByRole('checkbox', { name: a.name })).toBeVisible();
  await expect(s.getByRole('checkbox', { name: b.name })).toBeVisible();
  await search.fill('zzzz nothing');
  await expect(s.getByRole('checkbox')).toHaveCount(0);
  await search.fill('');

  await s.getByRole('checkbox', { name: a.name }).click();
  await s.getByRole('checkbox', { name: b.name }).click();
  await expect.poll(async () => (await apiPlace(page, b.name))!.setIds).toContain(setId);
  await s.getByRole('checkbox', { name: b.name }).click();
  await expect.poll(async () => (await apiPlace(page, b.name))!.setIds).not.toContain(setId);
  expect((await apiPlace(page, a.name))!.setIds).toContain(setId);

  await s.getByRole('button', { name: /^Done/ }).click();
  await expect(placeRow(page, a.name)).toBeVisible();
  await expect(placeRow(page, b.name)).toHaveCount(0);
});

test("#19 AC7: a place's … menu: sets, note, Maps, remove from this set, and delete with confirmation", async ({ page }) => {
  await signUp(page, uniqueName('Menu'));
  const place = await addPlaceViaApi(page, uniqueName('Invented Grill '));
  const [here, elsewhere] = [uniqueName('Here '), uniqueName('There ')];
  const hereId = await newSetViaApi(page, here, [place.id]);
  const elsewhereId = await newSetViaApi(page, elsewhere);

  // In "All places" there's nothing to remove it from.
  await page.goto('/places/all');
  await openPlaceMenu(page, place.name);
  await expect(sheet(page).getByRole('button', { name: /^Remove from/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto(`/places/${hereId}`);
  await openPlaceMenu(page, place.name);
  await expect(sheet(page).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', /cid=/);
  await sheet(page).getByRole('button', { name: 'Sets' }).click();
  await sheet(page).getByRole('checkbox', { name: elsewhere }).click();
  await expect.poll(async () => (await apiPlace(page, place.name))!.setIds.sort()).toEqual([hereId, elsewhereId].sort());
  await sheet(page).getByRole('button', { name: 'Done' }).click();

  await openPlaceMenu(page, place.name);
  await sheet(page).getByRole('button', { name: `Remove from ${here}` }).click();
  await expect(placeRow(page, place.name)).toHaveCount(0);
  expect((await apiPlace(page, place.name))!.setIds).toEqual([elsewhereId]);

  await page.goto(`/places/${elsewhereId}`);
  await openPlaceMenu(page, place.name);
  await sheet(page).getByRole('button', { name: 'Delete place' }).click();
  await expect(sheet(page)).toContainText(/for everyone/i);
  await sheet(page).getByRole('button', { name: 'Keep it' }).click();
  expect(await apiPlace(page, place.name)).toBeDefined();
  await openPlaceMenu(page, place.name);
  await sheet(page).getByRole('button', { name: 'Delete place' }).click();
  await sheet(page).getByRole('button', { name: 'Delete place' }).click();
  await expect(placeRow(page, place.name)).toHaveCount(0);
  expect(await apiPlace(page, place.name)).toBeUndefined();
});

test('#19 AC11: old /sets URLs land on the Places view', async ({ page }) => {
  await signUp(page, uniqueName('Oldie'));
  const setName = uniqueName('Legacy ');
  const setId = await newSetViaApi(page, setName);
  await page.goto('/sets');
  await expect(page).toHaveURL(/\/places$/);
  await expect(page.getByRole('heading', { name: 'Places', exact: true })).toBeVisible();
  await page.goto(`/sets/${setId}`);
  await expect(page).toHaveURL(new RegExp(`/places/${setId}$`));
  await expect(page.getByRole('heading', { name: setName })).toBeVisible();
});
