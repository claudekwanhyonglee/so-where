// Usage (inside the container): reset-pin <name>
// Sets a new random PIN for that person, lifts any lockout, and prints the PIN.
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from './config.ts';
import { openDb, type Db } from './db.ts';
import { hashPin } from './pin.ts';

export async function resetPin(db: Db, name: string, pepper: string) {
  const person = db.prepare('SELECT id FROM people WHERE name = ?').get(name.trim()) as { id: number } | undefined;
  if (!person) throw new Error(`No person called "${name}".`);
  const pin = String(randomInt(10_000)).padStart(4, '0');
  db.prepare('UPDATE people SET pin_hash = ?, failed_pins = 0, locked_until = 0 WHERE id = ?').run(await hashPin(pin, pepper), person.id);
  return pin;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv.slice(2).join(' ');
  try {
    if (!name) throw new Error('Usage: reset-pin <name>');
    const config = configFromEnv();
    const pin = await resetPin(openDb(config.databasePath), name, config.pinPepper);
    console.log(`New PIN for ${name}: ${pin}\nThey can change it after signing in.`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
