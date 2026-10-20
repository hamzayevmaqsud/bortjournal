import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, userId: string, cookie = '';
const H = { host: 'localhost' };
const req = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, withCookie = true) =>
  app.inject({ method, url, payload: payload as any, headers: { ...H, ...(withCookie && cookie ? { cookie } : {}) } });

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'Maqsud', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  userId = u!.id;
  await grantFree(conn.db, userId);
  await conn.db.insert(s.profiles).values({ userId, sex: 'm', settings: { kcal: 2030, protein: 155, steps: 8000, study: 60 } });
  app = await buildApp({ db: conn.db, serveWeb: false });
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('вход', () => {
  it('чужой адрес сайта — 421', async () => {
    const r = await app.inject({ method: 'GET', url: '/health', headers: { host: 'evil.example' } });
    expect(r.statusCode).toBe(421);
  });
  it('без входа — 401', async () => { expect((await req('GET', '/api/today', undefined, false)).statusCode).toBe(401); });
  it('неверный пароль — 401, верный — cookie с сессией', async () => {
    expect((await req('POST', '/api/auth/login', { username: 'maqsud', password: 'nope' }, false)).statusCode).toBe(401);
    const r = await req('POST', '/api/auth/login', { username: 'MAQSUD', password: 'secret12' }, false);
    expect(r.statusCode).toBe(200);
    const set = String(r.headers['set-cookie']);
    expect(set).toMatch(/bj_sid=.+; Path=\/; HttpOnly; SameSite=Lax/);
    cookie = set.split(';')[0]!;
    const me = await req('GET', '/api/me');
    expect(me.json()).toMatchObject({ username: 'Maqsud', modules: expect.arrayContaining(['food', 'plans']) });
  });
});

describe('«Сегодня» и записи', () => {
  const day = '2026-10-20';
  it('собирает сводки модулей', async () => {
    const r = await req('GET', `/api/today?day=${day}`);
    expect(r.statusCode).toBe(200);
    const t = r.json();
    expect(t.parts.food).toMatchObject({ kcal: 0, waterMl: 0, norm: { kcal: 2030 } });
    expect(t.parts.budget).toEqual({ configured: false });
    expect(t.plan.kcal).toBe(2030);
  });
  it('вода: запись попадает в ленту и в кольцо, удаление убирает', async () => {
    const add = await req('POST', '/api/food/drinks', { day, time: '10:00', type: 'water', ml: 250 });
    expect(add.statusCode).toBe(201);
    const id = add.json().id;
    let t = (await req('GET', `/api/today?day=${day}`)).json();
    expect(t.parts.food.waterMl).toBe(250);
    expect(t.events).toEqual([expect.objectContaining({ id, kind: 'drink', time: '10:00', value: 250 })]);
    expect((await req('DELETE', `/api/food/entries/${id}`)).statusCode).toBe(200);
    t = (await req('GET', `/api/today?day=${day}`)).json();
    expect(t.parts.food.waterMl).toBe(0);
    expect(t.events).toEqual([]);
  });
  it('неверные данные — понятная ошибка 400', async () => {
    const r = await req('POST', '/api/food/drinks', { day: 'вчера', type: 'water', ml: 250 });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('ГГГГ-ММ-ДД');
  });
  it('задача переключается и пишет событие', async () => {
    const [task] = await conn.db.insert(s.tasks).values({ userId, title: 'Позвонить в банк', day, time: '16:00' }).returning();
    const r = await req('POST', `/api/plans/tasks/${task!.id}/toggle`);
    expect(r.json()).toEqual({ id: task!.id, done: true });
    const t = (await req('GET', `/api/today?day=${day}`)).json();
    expect(t.parts.plans.tasks[0]).toMatchObject({ title: 'Позвонить в банк', done: true });
  });
  it('без доступа к модулю — 402', async () => {
    await conn.db.delete(s.entitlements).where(eq(s.entitlements.module, 'food'));
    const r = await req('POST', '/api/food/drinks', { day, type: 'water', ml: 250 });
    expect(r.statusCode).toBe(402);
    const t = (await req('GET', `/api/today?day=${day}`)).json();
    expect(t.parts.food).toBeUndefined();
  });
});
