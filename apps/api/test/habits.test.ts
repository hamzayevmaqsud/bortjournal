/** Свои привычки: список, отметки, серия, лимит, проверка ввода, чужие привычки, порядок, архив, история, стирание и демо */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: 'localhost' };
const TZ = 240, today = () => localNow(TZ).day;
const login = async (u: string) => String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: u, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
const as = (cookie: string) => (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie, ...headers } });
const ids: Record<string, string> = {};

beforeAll(async () => {
  conn = await freshDb();
  for (const name of ['owner', 'other', 'many']) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: TZ }).returning();
    ids[name] = u!.id; await grantFree(conn.db, u!.id);
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('привычки', () => {
  it('бесплатно: создать, список с отметкой, серией и 7 днями', async () => {
    const r = as(await login('owner'));
    const a = await r('POST', '/api/habits', { title: '  Медитация  ', icon: '🧘' });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ title: 'Медитация', icon: '🧘', done: false, streak: 0, last7: [false, false, false, false, false, false, false] });
    expect(a.json().color).toBeTruthy();
    await r('POST', '/api/habits', { title: 'Витамины' });
    const l = (await r('GET', '/api/habits')).json();
    expect(l).toMatchObject({ day: today(), today: today(), limit: 20 });
    expect(l.items.map((h: any) => h.title)).toEqual(['Медитация', 'Витамины']);
  });

  it('отметка: за сегодня по умолчанию, повтор не дублирует, серия считается, снять — можно', async () => {
    const r = as(await login('owner'));
    const [m] = (await r('GET', '/api/habits')).json().items;
    for (const n of [-3, -2, -1]) expect((await r('PUT', `/api/habits/${m.id}/check`, { day: addDays(today(), n), done: true })).statusCode).toBe(200);
    // вчера отмечено, сегодня ещё нет — серия не потеряна
    expect((await r('GET', '/api/habits')).json().items[0]).toMatchObject({ done: false, streak: 3, last7: [false, false, false, true, true, true, false] });
    const c = await r('PUT', `/api/habits/${m.id}/check`, { done: true });
    expect(c.json()).toMatchObject({ id: m.id, day: today(), done: true, streak: 4 });
    expect((await r('PUT', `/api/habits/${m.id}/check`, { done: true })).json()).toMatchObject({ done: true, streak: 4 });
    expect(await conn.db.select().from(s.habitChecks).where(eq(s.habitChecks.habitId, m.id))).toHaveLength(4);
    // дыра в серии
    expect((await r('PUT', `/api/habits/${m.id}/check`, { day: addDays(today(), -2), done: false })).json()).toMatchObject({ done: false, streak: 1 }); // на тот день: только −3
    expect((await r('GET', '/api/habits')).json().items[0]).toMatchObject({ done: true, streak: 2 });
    // список на прошлый день
    expect((await r('GET', `/api/habits?day=${addDays(today(), -3)}`)).json().items[0]).toMatchObject({ done: true, streak: 1 });
  });

  it('отметка — активный день для общей серии', async () => {
    const r = as(await login('many'));
    const h = (await r('POST', '/api/habits', { title: 'Сон до 23:00' })).json();
    expect((await r('GET', '/api/today')).json().streak).toBe(0);
    await r('PUT', `/api/habits/${h.id}/check`, { day: addDays(today(), -1), done: true });
    await r('PUT', `/api/habits/${h.id}/check`, { done: true });
    const t = (await r('GET', '/api/today')).json();
    expect(t.streak).toBe(2);
    expect(t.modules).toContain('habits');
  });

  it('повтор отметки из очереди телефона с тем же ключом — тот же ответ', async () => {
    const r = as(await login('owner'));
    const [, v] = (await r('GET', '/api/habits')).json().items;
    const k = { 'idempotency-key': 'habit-check-1' };
    const a = await r('PUT', `/api/habits/${v.id}/check`, { done: true }, k), b = await r('PUT', `/api/habits/${v.id}/check`, { done: true }, k);
    expect(b.statusCode).toBe(200); expect(b.headers['idempotent-replay']).toBe('1'); expect(b.json()).toEqual(a.json());
  });

  it('проверка ввода', async () => {
    const r = as(await login('owner'));
    const [m] = (await r('GET', '/api/habits')).json().items;
    expect((await r('POST', '/api/habits', { title: '   ' })).statusCode).toBe(400);
    expect((await r('POST', '/api/habits', { title: 'я'.repeat(61) })).statusCode).toBe(400);
    expect((await r('POST', '/api/habits', { title: 'я'.repeat(60) })).statusCode).toBe(201);
    expect((await r('POST', '/api/habits', { title: 'медитация' })).statusCode).toBe(400); // уже есть
    expect((await r('POST', '/api/habits', { title: 'Йога', color: 'pink' })).statusCode).toBe(400);
    expect((await r('POST', '/api/habits', { title: 'Йога', icon: 'очень длинный значок' })).statusCode).toBe(400);
    expect((await r('PUT', `/api/habits/${m.id}/check`, {})).statusCode).toBe(400);
    expect((await r('PUT', `/api/habits/${m.id}/check`, { done: 'yes' })).statusCode).toBe(400);
    expect((await r('PUT', `/api/habits/${m.id}/check`, { done: true, day: '2026-13-01' })).statusCode).toBe(400);
    expect((await r('PUT', `/api/habits/${m.id}/check`, { done: true, day: addDays(today(), 1) })).statusCode).toBe(400);
    expect((await r('PUT', '/api/habits/not-an-id/check', { done: true })).statusCode).toBe(400);
    expect((await r('GET', '/api/habits?day=вчера')).statusCode).toBe(400);
    expect((await r('GET', '/api/habits/history?from=2026-01-01&to=2020-01-01')).statusCode).toBe(400);
  });

  it('чужая привычка — 404 на всё', async () => {
    const r = as(await login('owner')), o = as(await login('other'));
    const [m] = (await r('GET', '/api/habits')).json().items;
    expect((await o('PUT', `/api/habits/${m.id}/check`, { done: true })).statusCode).toBe(404);
    expect((await o('PUT', `/api/habits/${m.id}`, { title: 'Взлом' })).statusCode).toBe(404);
    expect((await o('POST', `/api/habits/${m.id}/archive`)).statusCode).toBe(404);
    expect((await o('PUT', '/api/habits/order', { ids: [m.id] })).statusCode).toBe(400);
    expect((await o('GET', '/api/habits')).json().items).toEqual([]);
    expect((await r('GET', '/api/habits')).json().items[0].title).toBe('Медитация');
  });

  it('переименовать, порядок, архив', async () => {
    const r = as(await login('owner'));
    const [m, v, long] = (await r('GET', '/api/habits')).json().items;
    expect((await r('PUT', `/api/habits/${v.id}`, { title: 'Витамин D', icon: '' })).json()).toMatchObject({ title: 'Витамин D', icon: null });
    expect((await r('PUT', `/api/habits/${v.id}`, { title: '' })).statusCode).toBe(400);
    expect((await r('PUT', '/api/habits/order', { ids: [long.id, m.id] })).json()).toEqual({ ok: true });
    expect((await r('GET', '/api/habits')).json().items.map((h: any) => h.id)).toEqual([long.id, m.id, v.id]);
    expect((await r('POST', `/api/habits/${long.id}/archive`)).json()).toEqual({ ok: true });
    expect((await r('GET', '/api/habits')).json().items.map((h: any) => h.id)).toEqual([m.id, v.id]);
    expect((await r('PUT', `/api/habits/${long.id}/check`, { done: true })).statusCode).toBe(404);
  });

  it('история за период: привычки и отметки', async () => {
    const r = as(await login('owner'));
    const h = (await r('GET', `/api/habits/history?from=${addDays(today(), -6)}&to=${today()}`)).json();
    expect(h.from).toBe(addDays(today(), -6));
    expect(h.habits.map((x: any) => x.title)).toEqual(expect.arrayContaining(['Медитация', 'Витамин D']));
    expect(h.checks.length).toBeGreaterThanOrEqual(3);
    expect(h.checks[0]).toHaveProperty('habitId'); expect(h.checks[0]).toHaveProperty('day');
  });

  it('лимит: не больше 20 активных; архив освобождает место', async () => {
    const r = as(await login('many'));
    for (let i = 2; i <= 20; i++) expect((await r('POST', '/api/habits', { title: `Привычка ${i}` })).statusCode).toBe(201);
    const over = await r('POST', '/api/habits', { title: 'Двадцать первая' });
    expect(over.statusCode).toBe(400); expect(over.json().error).toMatch(/20/);
    const [first] = (await r('GET', '/api/habits')).json().items;
    await r('POST', `/api/habits/${first.id}/archive`);
    expect((await r('POST', '/api/habits', { title: 'Двадцать первая' })).statusCode).toBe(201);
  });

  it('стереть все записи — привычки и отметки уходят', async () => {
    const r = as(await login('owner'));
    expect((await r('POST', '/api/account/wipe', { password: 'secret12' })).json()).toMatchObject({ ok: true });
    expect(await conn.db.select().from(s.habits).where(eq(s.habits.userId, ids.owner!))).toHaveLength(0);
    expect(await conn.db.select().from(s.habitChecks).where(eq(s.habitChecks.userId, ids.owner!))).toHaveLength(0);
    expect((await r('GET', '/api/habits')).json().items).toEqual([]);
    expect((await conn.db.select().from(s.habits).where(eq(s.habits.userId, ids.many!))).length).toBeGreaterThan(0); // чужое цело
  });

  it('демо: четыре привычки с отметками и сериями', async () => {
    const d = await app.inject({ method: 'POST', url: '/api/auth/demo', headers: H, remoteAddress: '10.9.9.9', payload: { tz: TZ } });
    const r = as(String(d.headers['set-cookie']).split(';')[0]!);
    const l = (await r('GET', '/api/habits')).json().items;
    expect(l).toHaveLength(4);
    expect(l.some((h: any) => h.streak >= 3)).toBe(true);
    expect(l.some((h: any) => h.done)).toBe(true);
  });
});
