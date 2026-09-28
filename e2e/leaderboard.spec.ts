import { expect, test } from '@playwright/test';
import { newPerson, startPicking, uniqueName } from './helpers.ts';

test('#9 AC1–AC5: the leaderboard updates live across devices', async ({ browser }) => {
  // Host sets up two places and starts a session for "All places" — but with a fresh set so it stays small.
  const host = await newPerson(browser, 'Host');
  const h = host.page;
  await h.getByRole('link', { name: 'Places', exact: true }).click();
  const places = [uniqueName('Invented Sushi '), uniqueName('Invented Grill '), uniqueName('Invented Bao ')];
  for (const name of places) {
    const hex = Math.floor(Math.random() * 1e12).toString(16);
    await h.getByLabel('Google Maps link').fill(`https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@-37.8,144.96,17z/data=!4m2!3m1!1s0x1:0x${hex}!3d-37.8!4d144.96`);
    await h.getByRole('button', { name: /add place/i }).click();
    await expect(h.getByRole('status')).toContainText(name);
  }
  await h.goto('/sets'); // the Sets page, until #19 folds it into Places
  const setName = uniqueName('Live ');
  await h.getByLabel('New set name').fill(setName);
  await h.getByRole('button', { name: /create set/i }).click();
  for (const name of places) await h.getByRole('checkbox', { name }).check();
  await startPicking(h, setName);
  const sessionPath = new URL(h.url()).pathname;

  // A friend joins on another device.
  const friend = await newPerson(browser, 'Friend', sessionPath);
  const f = friend.page;
  await expect(f.getByRole('article')).toHaveCount(2);

  const board = (page: typeof h) => page.getByRole('region', { name: /leaderboard/i });
  await expect(board(h).getByRole('heading', { name: /together/i })).toBeVisible();
  await expect(board(h).getByRole('list', { name: `${friend.name}'s ranking` })).toBeVisible({ timeout: 5_000 });

  // The friend picks; the host sees it within 5 seconds without reloading.
  const winner = (await f.getByRole('article').first().getByRole('heading').innerText()).trim();
  await f.getByRole('article').first().getByRole('button', { name: /^pick /i }).click();
  const friendColumn = board(h).getByRole('list', { name: `${friend.name}'s ranking` });
  await expect(friendColumn.getByRole('listitem').first()).toContainText(winner, { timeout: 5_000 });
  await expect(board(h).getByText(`${friend.name} · 1 pick`)).toBeVisible({ timeout: 5_000 });

  // "Absolutely not" is clearly marked for everyone.
  const vetoed = (await f.getByRole('article').first().getByRole('heading').innerText()).trim();
  await f.getByRole('article').first().getByRole('button', { name: /absolutely not/i }).click();
  const combinedRow = board(h).getByRole('row').filter({ hasText: vetoed });
  await expect(combinedRow.getByText(/absolutely not/i)).toBeVisible({ timeout: 5_000 });

  // Only the set's places are listed.
  await expect(board(h).getByRole('row')).toHaveCount(places.length + 1); // + header row
});
