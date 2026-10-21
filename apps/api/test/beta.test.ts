/** Бета (BETA_PRO=1) — всем весь Pro, покупки нет; после конца подписки платные разделы — только просмотр; напоминание о конце пробного */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { subscription } from '../src/core/billing.js';
import { grantFree } from '../src/core/entitlements.js';
import { dueNudges } from '../src/core/reminders.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', userId = '';
const H = { host: 'localhost' }, TZ = 240, today = localNow(TZ).day;
const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });

beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'ex', passwordHash: await hashPassword('secret12'), tzOffset: TZ }).returning();
  userId = u!.id; await grantFree(conn.db, userId);
  await conn.db.insert(s.profiles).values({ userId, heightCm: 180, settings: {} });
  // пробный Pro был и закончился вчера
  await conn.db.insert(s.entitlements).values({ userId, module: 'pro', source: 'trial', startsAt: new Date(Date.now() - 8 * 864e5), expiresAt: new Date(Date.now() - 864e5) });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'ex', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { delete process.env.BETA_PRO; await app?.close(); await conn?.pool.end(); });

describe('после конца подписки — только просмотр', () => {
  it('смотреть платный раздел можно, добавлять — нет', async () => {
    expect((await subscription(conn.db, userId))).toMatchObject({ pro: false, ended: true });
    expect((await req('GET', '/api/budget/overview')).statusCode).toBe(200);
    const w = await req('POST', '/api/budget/entries', { day: today, kind: 'out', category: 'cafe', amount: 5 });
    expect(w.statusCode).toBe(402);
    expect(w.json()).toMatchObject({ pro: true });
  });
  it('без подписки в прошлом — раздел закрыт и на просмотр', async () => {
    const [u] = await conn.db.insert(s.users).values({ username: 'never', passwordHash: await hashPassword('secret12') }).returning();
    await grantFree(conn.db, u!.id);
    const c = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'never', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/budget/overview', headers: { ...H, cookie: c } })).statusCode).toBe(402);
  });
});

describe('пробный период', () => {
  it('за 2 дня и накануне конца — напоминание в 19:00', async () => {
    await conn.db.update(s.entitlements).set({ expiresAt: new Date(Date.now() + 1.5 * 864e5) }).where(eq(s.entitlements.userId, userId));
    const at = Date.parse(`${today}T19:05:00Z`) - TZ * 60e3;
    expect((await dueNudges(conn.db, userId, at)).list.find(x => x.kind === 'trial')).toMatchObject({ key: 'trial:2', title: 'Пробный Pro — ещё 2 дня' });
  });
});

describe('бета', () => {
  it('BETA_PRO=1 — у всех весь Pro, покупать нечего', async () => {
    process.env.BETA_PRO = '1';
    expect(await subscription(conn.db, userId)).toMatchObject({ pro: true, source: 'beta', beta: true });
    expect((await req('POST', '/api/budget/entries', { day: today, kind: 'out', category: 'cafe', amount: 5 })).statusCode).toBe(201);
    expect((await req('POST', '/api/billing/purchase', { plan: 'year' })).statusCode).toBe(409);
    delete process.env.BETA_PRO;
  });
});
