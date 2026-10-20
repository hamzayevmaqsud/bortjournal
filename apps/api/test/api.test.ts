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
    expect(t.parts.budget).toBeUndefined(); // бюджет — Pro, у этого пользователя Pro нет
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
});

describe('регистрация, пробная неделя и подписка', () => {
  let c2 = '';
  const r2 = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, ...(c2 ? { cookie: c2 } : {}) } });
  it('проверяет логин, пароль и занятость', async () => {
    expect((await r2('POST', '/api/auth/register', { username: 'a', password: 'secret123' })).statusCode).toBe(400);
    expect((await r2('POST', '/api/auth/register', { username: 'newbie', password: 'short' })).statusCode).toBe(400);
    expect((await r2('POST', '/api/auth/register', { username: 'maqsud', password: 'secret123' })).statusCode).toBe(409);
  });
  it('регистрирует, входит и даёт 7 дней Pro', async () => {
    const r = await r2('POST', '/api/auth/register', { username: 'newbie', password: 'secret123', email: 'n@example.com', tz: 240 });
    expect(r.statusCode).toBe(201);
    c2 = String(r.headers['set-cookie']).split(';')[0]!;
    const b = (await r2('GET', '/api/billing')).json();
    expect(b.subscription).toMatchObject({ pro: true, source: 'trial', daysLeft: 7, autoRenew: false });
    expect(b.prices.year.price).toBe(39.99);
  });
  it('анкета считает план (31 год, 180 см, 107 кг, худеть умеренно)', async () => {
    const r = await r2('POST', '/api/profile/onboarding', { sex: 'm', age: 31, height: 180, weight: 107, activity: 'sed', goal: 'lose', pace: 'mid', target: 90, steps: 6000 });
    expect(r.statusCode).toBe(200);
    const p = r.json().plan;
    expect(p.kcal).toBeGreaterThan(1900); expect(p.kcal).toBeLessThan(2300);
    expect(p.weeklyKg).toBeLessThan(0);
    const t = (await r2('GET', '/api/today?day=2026-10-20')).json();
    expect(t.plan.kcal).toBe(p.kcal);
  });
  it('без Pro платные разделы не попадают в «Сегодня»; покупка возвращает', async () => {
    await conn.db.delete(s.entitlements).where(eq(s.entitlements.source, 'trial'));
    let t = (await r2('GET', '/api/today?day=2026-10-20')).json();
    expect(t.subscription.pro).toBe(false);
    expect(t.parts.gym).toBeUndefined(); expect(t.parts.food).toBeDefined();
    const buy = (await r2('POST', '/api/billing/purchase', { plan: 'year' })).json();
    expect(buy.subscription).toMatchObject({ pro: true, source: 'web', plan: 'year', autoRenew: true });
    expect(buy.subscription.daysLeft).toBeGreaterThanOrEqual(364);
    t = (await r2('GET', '/api/today?day=2026-10-20')).json();
    expect(t.parts.gym).toBeDefined();
    const cancel = (await r2('POST', '/api/billing/cancel')).json();
    expect(cancel.subscription).toMatchObject({ pro: true, autoRenew: false });
    expect((await r2('POST', '/api/billing/resume')).json().subscription.autoRenew).toBe(true);
  });
  it('еда вручную: создать, изменить, подсказка «моё», удалить', async () => {
    const day = '2026-10-21';
    const m = await r2('POST', '/api/food/meals', { day, time: '9:5', name: 'Овсянка', kcal: 350, protein: 12, fat: 7, carbs: 60 });
    expect(m.statusCode).toBe(201);
    const id = m.json().id;
    expect((await r2('PUT', `/api/food/meals/${id}`, { day, time: '09:05', name: 'Овсянка с бананом', kcal: 420, protein: 13, fat: 7, carbs: 75 })).json().kcal).toBe(420);
    const mine = (await r2('GET', '/api/food/mine?q=овс')).json().items;
    expect(mine[0]).toMatchObject({ name: 'Овсянка' });
    const f = (await r2('GET', `/api/food/day?day=${day}`)).json();
    expect(f.totals.kcal).toBe(420);
    expect((await r2('POST', '/api/food/meals', { day, name: '', kcal: 1 })).statusCode).toBe(400);
    expect((await r2('DELETE', `/api/food/entries/${id}`)).statusCode).toBe(200);
  });
  it('вес и шаги; задачи: создать, изменить, отметить, удалить', async () => {
    const day = '2026-10-21';
    expect((await r2('PUT', '/api/body/day', { day, weightKg: '106,4', steps: 9100 })).statusCode).toBe(200);
    expect((await r2('PUT', '/api/body/day', { day, weightKg: 5 })).statusCode).toBe(400);
    const t = (await r2('GET', `/api/today?day=${day}`)).json();
    expect(t.parts.body).toMatchObject({ steps: 9100, weight: { kg: 106.4, today: true } });
    const task = (await r2('POST', '/api/plans/tasks', { title: 'Купить продукты', day, time: '18:00', prio: true })).json();
    expect((await r2('PUT', `/api/plans/tasks/${task.id}`, { title: 'Купить продукты на неделю', day, time: '19:00' })).json().time).toBe('19:00');
    expect((await r2('POST', `/api/plans/tasks/${task.id}/toggle`)).json().done).toBe(true);
    const list = (await r2('GET', `/api/plans/tasks?from=${day}&to=${day}`)).json().items;
    expect(list).toEqual([expect.objectContaining({ title: 'Купить продукты на неделю', done: true })]);
    expect((await r2('DELETE', `/api/plans/tasks/${task.id}`)).statusCode).toBe(200);
  });
});
