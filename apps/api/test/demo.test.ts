/** Демо без регистрации: временный аккаунт с записями, сохранение как настоящего, запрет demo-…, уборка просроченных */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { addDays } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { runJobsOnce } from '../src/worker.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: 'localhost' };
const as = (cookie: string) => (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });
const demo = async (ip = '10.0.0.1') => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/demo', headers: H, remoteAddress: ip, payload: { tz: 240 } });
  return { res: r, cookie: String(r.headers['set-cookie']).split(';')[0]! };
};

beforeAll(async () => {
  conn = await freshDb();
  await conn.db.insert(s.users).values({ username: 'taken', email: 'taken@mail.az', passwordHash: await hashPassword('secret12') });
  app = await buildApp({ db: conn.db, serveWeb: false });
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('демо', () => {
  it('создаёт временный аккаунт с сессией, Pro и записями; анкета пройдена', async () => {
    const { res, cookie } = await demo();
    expect(res.statusCode).toBe(201);
    expect(res.json().username).toMatch(/^demo-[0-9a-f]{12}$/);
    const r = as(cookie), me = (await r('GET', '/api/me')).json();
    expect(me).toMatchObject({ demo: true, username: res.json().username, profile: { settings: { onboarded: true } } });
    expect(me.subscription.pro).toBe(true);
    expect(Date.parse(me.demoUntil) - Date.now()).toBeGreaterThan(23 * 3600e3);
    const t = (await r('GET', '/api/today')).json();
    expect(t.modules).toEqual(expect.arrayContaining(['food', 'plans', 'study', 'books']));
    expect(t.parts.plans.tasks.length).toBeGreaterThanOrEqual(3);
    // вчера — полный день: еда и вода с калориями, шаги
    const y = (await r('GET', `/api/food/day?day=${addDays(t.day, -1)}`)).json();
    expect(y.meals.length).toBeGreaterThanOrEqual(3);
    expect(y.totals.kcal).toBeGreaterThan(1000);
    expect(y.totals.waterMl).toBeGreaterThan(1000);
    expect(t.streak).toBeGreaterThanOrEqual(2);
    // пароль сменить нельзя, пока демо не сохранено
    expect((await r('POST', '/api/auth/password', { next: 'newpass12' })).statusCode).toBe(400);
  });

  it('сохранить как аккаунт: проверка полей, занятые — 409, записи остаются, вход по паролю', async () => {
    const { cookie } = await demo('10.0.0.2'), r = as(cookie);
    const before = (await r('GET', '/api/plans/tasks?from=2000-01-01&to=2100-01-01')).json().items.length;
    expect((await r('POST', '/api/auth/claim', { username: 'x', password: 'secret12', email: 'x1@mail.az' })).statusCode).toBe(400);
    expect((await r('POST', '/api/auth/claim', { username: 'demo-mine', password: 'secret12', email: 'x2@mail.az' })).statusCode).toBe(400);
    expect((await r('POST', '/api/auth/claim', { username: 'newbie', password: 'short', email: 'x3@mail.az' })).statusCode).toBe(400);
    expect((await r('POST', '/api/auth/claim', { username: 'TAKEN', password: 'secret12', email: 'x4@mail.az' })).statusCode).toBe(409);
    expect((await r('POST', '/api/auth/claim', { username: 'newbie', password: 'secret12', email: 'taken@mail.az' })).statusCode).toBe(409);
    const ok = await r('POST', '/api/auth/claim', { username: 'newbie', password: 'secret12', email: 'Me@Mail.az' });
    expect(ok.json()).toEqual({ username: 'newbie' });
    const me = (await r('GET', '/api/me')).json();
    expect(me).toMatchObject({ demo: false, username: 'newbie' });
    expect(me.subscription).toMatchObject({ pro: true, source: 'trial', daysLeft: 7 });
    expect((await r('GET', '/api/plans/tasks?from=2000-01-01&to=2100-01-01')).json().items.length).toBe(before);
    expect((await r('POST', '/api/auth/claim', { username: 'again', password: 'secret12', email: 'x5@mail.az' })).statusCode).toBe(409);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'newbie', password: 'secret12' } });
    expect(login.statusCode).toBe(200);
    // уже не демо — уборка не тронет
    expect(await runJobsOnce(conn.db, new Date(Date.now() + 3 * 864e5))).toBeGreaterThanOrEqual(0);
    expect((await r('GET', '/api/me')).statusCode).toBe(200);
  });

  it('demo-… занято: ни зарегистрироваться, ни войти', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, remoteAddress: '10.0.0.3', payload: { username: 'demo-abc', password: 'secret12' } });
    expect(reg.statusCode).toBe(400);
    const { res } = await demo('10.0.0.3');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, remoteAddress: '10.0.0.3', payload: { username: res.json().username, password: '' } });
    expect(login.statusCode).toBe(401);
  });

  it('не больше 10 демо в час с адреса', async () => {
    for (let i = 0; i < 10; i++) expect((await demo('10.0.0.9')).res.statusCode).toBe(201);
    expect((await demo('10.0.0.9')).res.statusCode).toBe(429);
  });

  it('просроченное демо: сессия не действует, воркер удаляет со всеми записями', async () => {
    const { res, cookie } = await demo('10.0.0.4');
    const [u] = await conn.db.select().from(s.users).where(eq(s.users.username, res.json().username));
    expect((await as(cookie)('GET', '/api/me')).statusCode).toBe(200);
    await conn.db.update(s.users).set({ demoUntil: new Date(Date.now() - 1000) }).where(eq(s.users.id, u!.id));
    expect((await as(cookie)('GET', '/api/me')).statusCode).toBe(401);
    expect(await runJobsOnce(conn.db, new Date())).toBeGreaterThanOrEqual(1);
    expect(await conn.db.select().from(s.users).where(eq(s.users.id, u!.id))).toHaveLength(0);
    const left = await conn.db.execute<{ n: number }>(sql`select count(*)::int as n from food_meals where user_id = ${u!.id}`);
    expect(left.rows[0]!.n).toBe(0);
    // живые демо и настоящие аккаунты на месте
    expect((await conn.db.select().from(s.users).where(eq(s.users.username, 'newbie')))).toHaveLength(1);
  });

  it('удалить демо из профиля: подтверждение — логин', async () => {
    const { res, cookie } = await demo('10.0.0.5'), r = as(cookie);
    expect((await r('GET', '/api/account')).json()).toMatchObject({ hasPassword: false });
    expect((await r('POST', '/api/account/delete', { confirm: 'nope' })).statusCode).toBe(400);
    expect((await r('POST', '/api/account/delete', { confirm: res.json().username })).json()).toEqual({ ok: true });
  });
});
