import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '@bortjournal/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => { process.env.NODE_ENV = 'test'; conn = await freshDb(); }, 60000);
afterAll(async () => { await conn?.pool.end(); });

it('/health отвечает, когда база доступна', async () => {
  const app = await buildApp({ db: conn.db });
  const r = await app.inject({ method: 'GET', url: '/health' });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true, version: APP_VERSION });   // по версии видно, что выкачено
  await app.close();
});

// карты исходников наружу не отдаются, даже если остались в сборке
it.runIf(fs.existsSync(fileURLToPath(new URL('../../web/dist', import.meta.url))))('*.js.map — 404', async () => {
  const app = await buildApp({ db: conn.db, serveWeb: true });
  expect((await app.inject({ method: 'GET', url: '/assets/index.js.map' })).statusCode).toBe(404);
  expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
  await app.close();
});
