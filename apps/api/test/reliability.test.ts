/** Надёжность: адрес посетителя за прокси, зависший ключ очереди, замок напоминаний, GET без записи, давние отметки, уборка сессий, слияние настроек */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { proxyTrust } from '../src/core/client-ip.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import { REMIND_LOCK, remindTickLocked } from '../src/core/reminders.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { runJobsOnce } from '../src/worker.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', uid = '';
const H = { host: 'localhost' }, TZ = 240;
const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie, ...headers } });

beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'steady', passwordHash: await hashPassword('secret12'), tzOffset: TZ }).returning();
  uid = u!.id; await grantFree(conn.db, uid); await grant(conn.db, uid, 'pro', 'free');
  await conn.db.insert(s.profiles).values({ userId: uid, settings: { kcal: 2000 } });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'steady', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

/** приложение с заданным TRUST_PROXY — как на сервере за туннелем */
async function behind(trust: string) {
  const was = process.env.TRUST_PROXY; process.env.TRUST_PROXY = trust;
  try { return await buildApp({ db: conn.db, serveWeb: false }); } finally { if (was === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = was; }
}
const badLogin = (a: typeof app, i: number, remoteAddress: string, headers: Record<string, string>) =>
  a.inject({ method: 'POST', url: '/api/auth/login', remoteAddress, headers: { ...H, ...headers }, payload: { username: `nobody${i}`, password: 'wrong-pass' } });

describe('адрес посетителя за прокси', () => {
  it('доверие: число прокси, подсети, по умолчанию — только 127.0.0.1', () => {
    expect(proxyTrust('1')('203.0.113.1', 0)).toBe(true);
    expect(proxyTrust('1')('203.0.113.1', 1)).toBe(false);
    expect(proxyTrust('loopback,uniquelocal')('::ffff:10.0.0.7', 0)).toBe(true);
    expect(proxyTrust('loopback,uniquelocal')('172.18.0.3', 0)).toBe(true);
    expect(proxyTrust('loopback,uniquelocal')('8.8.8.8', 0)).toBe(false);
    expect(proxyTrust('')('127.0.0.1', 0)).toBe(true);
    expect(proxyTrust('')('10.0.0.1', 0)).toBe(false);
  });

  it('подмена левого края X-Forwarded-For не обходит лимит входа', async () => {
    const a = await behind('1');
    try {
      for (let i = 0; i < 10; i++) expect((await badLogin(a, i, '172.18.0.2', { 'x-forwarded-for': `1.1.1.${i}, 203.0.113.7` })).statusCode).toBe(401);
      expect((await badLogin(a, 99, '172.18.0.2', { 'x-forwarded-for': '9.9.9.9, 203.0.113.7' })).statusCode).toBe(429);
      // другой настоящий адрес — свой счётчик
      expect((await badLogin(a, 100, '172.18.0.2', { 'x-forwarded-for': '203.0.113.8' })).statusCode).toBe(401);
    } finally { await a.close(); }
  });

  it('CF-Connecting-IP — только от своего прокси', async () => {
    const a = await behind('loopback,uniquelocal');
    try {
      for (let i = 0; i < 10; i++) expect((await badLogin(a, 200 + i, '172.18.0.5', { 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': `5.5.5.${i}` })).statusCode).toBe(401);
      expect((await badLogin(a, 210, '172.18.0.5', { 'cf-connecting-ip': '198.51.100.9' })).statusCode).toBe(429);
      expect((await badLogin(a, 211, '172.18.0.5', { 'cf-connecting-ip': '198.51.100.10' })).statusCode).toBe(401);
      // напрямую, без прокси: заголовок от посетителя не считается — лимит по его собственному адресу
      expect((await badLogin(a, 212, '203.0.113.50', { 'cf-connecting-ip': '198.51.100.11' })).statusCode).toBe(401);
    } finally { await a.close(); }
  });
});

describe('очередь телефона', () => {
  it('ключ, зависший без ответа дольше 2 минут, забирается; свежий — 409', async () => {
    const send = (key: string) => req('POST', '/api/food/drinks', { day: '2026-05-05', time: '09:00', type: 'water', ml: 200 }, { 'idempotency-key': key });
    await conn.db.insert(s.idempotency).values([{ key: `${uid}:stuck`, createdAt: new Date(Date.now() - 5 * 60e3) }, { key: `${uid}:busy` }]);
    const a = await send('stuck');
    expect(a.statusCode).toBe(201);
    expect((await send('stuck')).json().id).toBe(a.json().id);
    expect((await send('busy')).statusCode).toBe(409);
  });
});

describe('напоминания', () => {
  it('проход идёт под замком: занят другим процессом — пропускаем', async () => {
    expect(await remindTickLocked(conn.db)).toBe(0);
    let inner: number | null = -1;
    await conn.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${REMIND_LOCK})`);
      inner = await remindTickLocked(conn.db);
    });
    expect(inner).toBeNull();
  });
});

describe('GET ничего не пишет', () => {
  it('/api/me?tz= не меняет пояс; PUT /api/me/tz — меняет', async () => {
    await req('GET', '/api/me?tz=-300');
    expect((await conn.db.select().from(s.users).where(eq(s.users.id, uid)))[0]!.tzOffset).toBe(TZ);
    expect((await req('PUT', '/api/me/tz', { tz: 999 })).statusCode).toBe(400);
    expect((await req('PUT', '/api/me/tz', { tz: 180 })).json()).toEqual({ tzOffset: 180 });
    expect((await req('GET', '/api/me')).json().tzOffset).toBe(180);
    await req('PUT', '/api/me/tz', { tz: TZ });
  });
});

describe('привычки', () => {
  it('давнее прошлое не отмечается: до появления привычки (с запасом в неделю) — 400', async () => {
    const h = (await req('POST', '/api/habits', { title: 'Зарядка' })).json(), today = localNow(TZ).day;
    expect((await req('PUT', `/api/habits/${h.id}/check`, { day: addDays(today, -6), done: true })).statusCode).toBe(200);
    expect((await req('PUT', `/api/habits/${h.id}/check`, { day: addDays(today, -30), done: true })).statusCode).toBe(400);
    expect((await req('PUT', `/api/habits/${h.id}/check`, { day: '2001-01-01', done: true })).statusCode).toBe(400);
  });
});

describe('уборка и настройки', () => {
  it('воркер удаляет истёкшие сессии', async () => {
    await conn.db.insert(s.sessions).values({ tokenHash: 'old-session-hash', userId: uid, expiresAt: new Date(Date.now() - 1000) });
    await runJobsOnce(conn.db, new Date());
    expect(await conn.db.select().from(s.sessions).where(eq(s.sessions.tokenHash, 'old-session-hash'))).toHaveLength(0);
    expect((await req('GET', '/api/me')).statusCode).toBe(200);
  });

  it('одновременные правки настроек не затирают друг друга', async () => {
    await Promise.all([
      req('PUT', '/api/profile/settings', { theme: 'dark' }),
      req('PUT', '/api/profile/settings', { name: 'Тимур' }),
      req('PUT', '/api/push/settings', { lead: 30 }),
      req('PUT', '/api/books/goal', { goal: 20 })
    ]);
    const st = (await req('GET', '/api/me')).json().profile.settings;
    expect(st).toMatchObject({ theme: 'dark', name: 'Тимур', booksGoal: 20, kcal: 2000, remind: { lead: 30 } });
  });
});
