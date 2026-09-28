import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: Buffer, salt: Buffer, keylen: number) => Promise<Buffer>;

export const isValidPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4}$/.test(pin);

// Peppering first means the stored hash is useless to anyone who has the database but not the server's secret.
const derive = (pin: string, salt: Buffer, pepper: string) =>
  scryptAsync(createHmac('sha256', pepper).update(pin).digest(), salt, 32);

export async function hashPin(pin: string, pepper: string) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(pin, salt, pepper)).toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string, pepper: string) {
  const [salt, hash] = stored.split(':');
  const candidate = await derive(pin, Buffer.from(salt, 'hex'), pepper);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}
