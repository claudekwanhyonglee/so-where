import type { Config } from './app.ts';

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config & { port: number; databasePath: string } {
  return {
    port: Number(env.PORT ?? 3000),
    databasePath: env.DATABASE_PATH ?? 'data/so-where.db',
    webRoot: env.WEB_ROOT ?? 'dist/web',
  };
}
