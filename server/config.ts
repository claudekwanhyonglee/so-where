import type { Config } from './app.ts';

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. Add it to .env (see .env.example); so-where won't start without it.`);
  return value;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config & { port: number; databasePath: string } {
  return {
    port: Number(env.PORT ?? 3000),
    databasePath: env.DATABASE_PATH ?? 'data/so-where.db',
    webRoot: env.WEB_ROOT ?? 'dist/web',
    inviteCode: required(env, 'INVITE_CODE'),
    pinPepper: required(env, 'PIN_PEPPER'),
    geocodeIntervalMs: 1100,
  };
}
