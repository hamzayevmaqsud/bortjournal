/** Профиль и аккаунт: почта, нормы и настройки разделов, устройства, удаление аккаунта со всеми записями */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: 'localhost' };
const login = async (u: string, ua = 'Mozilla/5.0 (iPhone)') => String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...H, 'user-agent': ua }, payload: { username: u, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
const as = (cookie: string) => (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });

beforeAll(async () => {
  conn = await freshDb();
  for (const [name, email] of [['owner', null], ['other', 'taken@mail.az']] as const) {
    const [u] = await conn.db.insert(s.users).values({ username: name, email, passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    await grantFree(conn.db, u!.id);
    await conn.db.insert(s.profiles).values({ userId: u!.id, heightCm: 180, settings: { kcal: 2000 } });
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('аккаунт', () => {
  it('почта: формат, занятая, сброс', async () => {
    const r = as(await login('owner'));
    expect((await r('GET', '/api/account')).json()).toMatchObject({ username: 'owner', email: null });
    expect((await r('PUT', '/api/account', { email: 'bad' })).statusCode).toBe(400);
    expect((await r('PUT', '/api/account', { email: 'TAKEN@mail.az' })).statusCode).toBe(409);
    expect((await r('PUT', '/api/account', { email: 'Me@Mail.az' })).json()).toEqual({ email: 'me@mail.az' });
    expect((await r('PUT', '/api/account', { email: '' })).json()).toEqual({ email: null });
  });
  it('нормы и настройки разделов', async () => {
    const r = as(await login('owner'));
    const st = (await r('PUT', '/api/profile/settings', { fat: 70, carbs: '250', study: 45, rest: 120, booksGoal: 20 })).json().settings;
    expect(st).toMatchObject({ kcal: 2000, fat: 70, carbs: 250, study: 45, rest: 120, booksGoal: 20 });
    expect((await r('PUT', '/api/profile/settings', { rest: 5 })).statusCode).toBe(400);
  });
  it('устройства: список, выйти на одном и на всех других', async () => {
    const a = await login('owner', 'Mozilla/5.0 (Macintosh) Chrome/130'), b = await login('owner', 'Mozilla/5.0 (iPhone) Safari'), c = await login('owner', 'Mozilla/5.0 (iPad)');
    const r = as(a), list = (await r('GET', '/api/account/sessions')).json().items;
    expect(list.filter((x: any) => x.current)).toHaveLength(1);
    expect(list.find((x: any) => x.current).userAgent).toMatch(/Macintosh/);
    const mine = list.find((x: any) => x.current).id, phone = list.find((x: any) => /iPhone\) Safari/.test(x.userAgent)).id;
    expect((await r('DELETE', `/api/account/sessions/${mine}`)).statusCode).toBe(400);
    expect((await r('DELETE', `/api/account/sessions/${phone}`)).json()).toEqual({ ok: true });
    expect((await as(b)('GET', '/api/today')).statusCode).toBe(401);
    expect((await r('POST', '/api/account/sessions/others')).json().signedOut).toBeGreaterThanOrEqual(1);
    expect((await as(c)('GET', '/api/today')).statusCode).toBe(401);
    expect((await r('GET', '/api/today')).statusCode).toBe(200);
  });
  it('стереть все записи: нужен пароль; аккаунт, анкета, вход и подписка остаются, чужое не задето', async () => {
    const r = as(await login('owner')), o = as(await login('other'));
    await r('POST', '/api/food/drinks', { day: '2026-01-01', type: 'water', ml: 300 });
    await r('POST', '/api/plans/tasks', { title: 'Позвонить', day: '2026-01-01' });
    await o('POST', '/api/food/drinks', { day: '2026-01-01', type: 'water', ml: 200 });
    expect((await r('POST', '/api/account/wipe', { password: 'nope' })).statusCode).toBe(400);
    expect((await r('POST', '/api/account/wipe', { password: 'secret12' })).json()).toMatchObject({ ok: true });
    const [u] = await conn.db.select().from(s.users).where(eq(s.users.username, 'owner'));
    expect((await conn.db.select().from(s.drinks).where(eq(s.drinks.userId, u!.id)))).toHaveLength(0);
    expect((await conn.db.select().from(s.tasks).where(eq(s.tasks.userId, u!.id)))).toHaveLength(0);
    expect((await conn.db.select().from(s.events).where(eq(s.events.userId, u!.id)))).toHaveLength(0);
    expect((await conn.db.select().from(s.profiles).where(eq(s.profiles.userId, u!.id)))[0]?.heightCm).toBe(180);
    expect((await conn.db.select().from(s.entitlements).where(eq(s.entitlements.userId, u!.id))).length).toBeGreaterThan(0);
    expect((await r('GET', '/api/today')).statusCode).toBe(200); // всё ещё вошёл
    expect((await conn.db.select().from(s.drinks)).length).toBe(1); // у другого запись цела
    await conn.db.delete(s.drinks);
  });
  it('удаление аккаунта: нужен пароль, записи уходят вместе с ним', async () => {
    const r = as(await login('owner'));
    await r('POST', '/api/food/drinks', { day: '2026-01-01', type: 'water', ml: 300 });
    expect((await r('POST', '/api/account/delete', { password: 'nope' })).statusCode).toBe(400);
    const res = await r('POST', '/api/account/delete', { password: 'secret12' });
    expect(res.json()).toEqual({ ok: true });
    expect(String(res.headers['set-cookie'])).toMatch(/Max-Age=0/);
    expect(await conn.db.select().from(s.users).where(eq(s.users.username, 'owner'))).toHaveLength(0);
    expect((await conn.db.select().from(s.drinks)).length).toBe(0);
    expect((await r('GET', '/api/today')).statusCode).toBe(401);
    // другой пользователь не задет
    expect((await as(await login('other'))('GET', '/api/account')).json().email).toBe('taken@mail.az');
  });
});
