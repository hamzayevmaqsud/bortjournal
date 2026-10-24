/** Демо без регистрации: временный аккаунт с записями, сохранение как настоящего, запрет demo-…, уборка просроченных */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { seedDemo } from '../src/core/demo.js';
import { demoData } from '../src/core/demo-data.js';
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
    expect(t.streak).toBeGreaterThanOrEqual(5);
    // пароль сменить нельзя, пока демо не сохранено
    expect((await r('POST', '/api/auth/password', { next: 'newpass12' })).statusCode).toBe(400);
  });

  it('три месяца истории: статистика, год клетками, итог недели, привычки, достижения, все разделы', async () => {
    const { cookie } = await demo('10.0.0.6'), r = as(cookie);
    const o = (await r('GET', '/api/stats/overview')).json();
    // ≥75 дней с записями из 90, живая серия, год клетками (нужно ≥14 дней), дни недели, неделя к неделе
    expect(o.year.active).toBeGreaterThanOrEqual(75);
    expect(o.year.active).toBeLessThanOrEqual(90);
    expect(o.nums.streak).toBeGreaterThanOrEqual(5);
    expect(o.nums.bestStreak).toBeGreaterThanOrEqual(7);
    expect(o.nums.perfect365).toBeGreaterThanOrEqual(3);
    expect(o.weekdays.every((d: any) => d.n > 0)).toBe(true);
    expect(o.week.metrics.length).toBeGreaterThanOrEqual(6);
    expect(o.records.length).toBeGreaterThanOrEqual(5);
    const w = (await r('GET', '/api/insights/week')).json();
    expect(w.days).toBeGreaterThanOrEqual(3);
    expect(w.stats.length).toBeGreaterThanOrEqual(5);
    expect(w.wins.length).toBeGreaterThan(0);
    const hs = (await r('GET', '/api/habits')).json().items;
    expect(hs).toHaveLength(4);
    expect(hs.every((h: any) => h.streak >= 3)).toBe(true);
    // достижения открывались по ходу истории, а не все сегодня
    const aw = (await r('GET', '/api/awards')).json();
    expect(aw.total).toBeGreaterThanOrEqual(15);
    expect(new Set(aw.unlocked.map((u: any) => u.day)).size).toBeGreaterThanOrEqual(3);
    expect((await r('POST', '/api/awards/check')).json().fresh).toEqual([]);
    // рост: белка и воды в последний месяц больше, чем в первый; вес 81 → 77,3
    const f30 = (await r('GET', '/api/stats/food?days=30')).json(), f90 = (await r('GET', '/api/stats/food?days=90')).json();
    expect(f90.logged).toBeGreaterThanOrEqual(70);
    const mean = (rows: any[], k: string) => { const xs = rows.filter(x => x.meals).map(x => x[k]); return xs.reduce((a: number, b: number) => a + b, 0) / xs.length; };
    const early = f90.rows.slice(0, 30), late = f90.rows.slice(59, 89);
    expect(mean(late, 'protein')).toBeGreaterThan(mean(early, 'protein'));
    expect(mean(late, 'waterMl')).toBeGreaterThan(mean(early, 'waterMl') + 300);
    expect(f30.top.length).toBeGreaterThanOrEqual(4);
    const b = (await r('GET', '/api/stats/body?days=90')).json();
    expect(b.weights.length).toBeGreaterThanOrEqual(30);
    expect(b.change).toBeLessThanOrEqual(-3);
    expect((await r('GET', '/api/gym/overview')).json().total).toBeGreaterThanOrEqual(15);
    const t = (await r('GET', '/api/today')).json();
    expect(t.parts.budget.configured).toBe(true);
    expect(t.parts.books.reading.page).toBeGreaterThan(100);
    const goals = (await r('GET', `/api/plans/goals?from=${addDays(t.day, -60)}&to=${t.day}`)).json().items;
    expect(goals.length).toBeGreaterThanOrEqual(4);
    expect(goals.some((g: any) => g.progress > 0 && g.progress < 100)).toBe(true);
    expect((await r('GET', '/api/study/quiz')).json().total).toBeGreaterThanOrEqual(10);
  });

  it('данные демо детерминированы по id; засев — быстро, пачками', async () => {
    const a = demoData('seed-a', '2026-10-25', '13:00');
    expect(demoData('seed-a', '2026-10-25', '13:00')).toEqual(a);
    expect(demoData('seed-b', '2026-10-25', '13:00').meals).not.toEqual(a.meals);
    // сегодня — только то, что уже случилось
    expect(a.meals.filter(m => m.day === '2026-10-25').every(m => m.time <= '13:00')).toBe(true);
    expect(demoData('seed-a', '2026-10-25', '06:00').meals.some(m => m.day === '2026-10-25')).toBe(false);
    expect(a.missed.length).toBeGreaterThanOrEqual(8);
    expect(a.missed.length).toBeLessThanOrEqual(12);

    const [u] = await conn.db.insert(s.users).values({ username: 'seedtime', passwordHash: null, tzOffset: 240 }).returning();
    const t0 = Date.now();
    await conn.db.transaction(tx => seedDemo(tx, u!.id, 240));
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(4000);
    const now = localNow(240), D = demoData(u!.id, now.day, now.hm);
    const n = async (table: string) => (await conn.db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${u!.id} and day < ${now.day}`)).rows[0]!.n;
    expect(await n('food_meals')).toBe(D.meals.filter(m => m.day < now.day).length);
    expect(await n('food_drinks')).toBe(D.drinks.filter(d => d.day < now.day).length);
    expect(await n('gym_workouts')).toBe(D.workouts.filter(w => w.day < now.day).length);
    expect(await n('budget_entries')).toBe(D.money.filter(m => m.day < now.day).length);
    // лента событий: на каждый приём, напиток, задачу с датой, занятие, тренировку и операцию
    const evs = (await conn.db.execute<{ n: number }>(sql`select count(*)::int as n from events where user_id = ${u!.id}`)).rows[0]!.n;
    expect(evs).toBe(D.meals.length + D.drinks.length + D.tasks.filter(x => x.day).length + D.sessions.length + D.workouts.length + D.money.length);
  });

  it('сохранить как аккаунт: проверка полей, занятые — 409, записи остаются, вход по паролю', async () => {
    const { cookie } = await demo('10.0.0.2'), r = as(cookie);
    const before = (await r('GET', '/api/plans/tasks?from=2000-01-01&to=2100-01-01')).json().items.length;
    const meals = (await r('GET', '/api/stats/food?days=90')).json().logged;
    expect(meals).toBeGreaterThanOrEqual(70);
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
    expect((await r('GET', '/api/stats/food?days=90')).json().logged).toBe(meals);
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
