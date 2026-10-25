/** «Цель и прогноз»: путь к весу, вехи, факт против плана, пересчёт норм и смена активности недели */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const cookies: Record<string, string> = {}, H = { host: 'localhost' };
const as = (who: string, method: 'GET' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: cookies[who]! } });
const today = localNow(240).day;

beforeAll(async () => {
  conn = await freshDb();
  const ids: Record<string, string> = {};
  for (const name of ['pro', 'free', 'blank']) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    ids[name] = u!.id; await grantFree(conn.db, u!.id);
    if (name !== 'free') await grant(conn.db, u!.id, 'pro', 'free');
  }
  const start = addDays(today, -28);
  await conn.db.insert(s.profiles).values({ userId: ids.pro!, sex: 'm', age: 31, ageMeasuredOn: start, heightCm: 180, goal: 'lose', pace: 'mid', targetKg: 90, startWeightKg: 100, startedOn: start, plannedSteps: 6000, settings: { kcal: 2100, steps: 8000 } });
  // вес снижается на 0,5 кг в неделю, еда — 2000 ккал каждый день
  for (let k = 0; k <= 28; k += 2) await conn.db.insert(s.bodyDays).values({ userId: ids.pro!, day: addDays(start, k), weightKg: 100 - k * 0.5 / 7, steps: 8000 });
  for (let k = 1; k <= 27; k++) await conn.db.insert(s.meals).values({ userId: ids.pro!, day: addDays(start, k), name: 'Еда', kcal: 2000 });
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const name of Object.keys(ids)) cookies[name] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: name, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('цель', () => {
  it('цель бесплатна: без Pro открыта (без анкеты — 409)', async () => {
    expect((await as('free', 'GET', '/api/goal')).statusCode).toBe(409);
    expect((await as('blank', 'GET', '/api/goal')).statusCode).toBe(409);
  });
  it('путь, вехи, факт и реальный расход', async () => {
    const g = (await as('pro', 'GET', '/api/goal')).json();
    expect(g.weight.byTrend).toBe(true);
    expect(g.weight.weekly).toBeCloseTo(-0.5, 1);
    expect(g.weight.now).toBeCloseTo(98, 0);
    expect(g.path).toMatchObject({ start: 100, target: 90, total: 10, reached: false, byFact: true });
    expect(g.path.pct).toBe(20);
    expect(g.path.weeks).toBeCloseTo(16, 0); // 8 кг по 0,5 в неделю
    expect(g.path.milestones.map((m: any) => m.kg)).toEqual([96, 94, 92, 90]);
    expect(g.fact).toMatchObject({ intake: 2000, intakeDays: 27 });
    expect(g.fact.tdee).toBeGreaterThan(2500); // 2000 + 0,5 кг × 7700 / 7 ≈ 2550
    expect(g.steps).toMatchObject({ measured: true, steps: 8000 });
    expect(g.series.history.length).toBe(15);
    expect(g.series.plan[0]).toMatchObject({ day: addDays(today, -28), kg: 100 });
    expect(g.levels).toHaveLength(5);
  });
  it('открыть «Цель» — ничего не меняет; нормы пересчитываются на записи (вес)', async () => {
    const g1 = (await as('pro', 'GET', '/api/goal')).json();
    expect(g1.recalculated).toBeNull();
    expect((await as('pro', 'GET', '/api/me')).json().profile.settings.kcal).toBe(2100); // GET без побочных действий
    const w = (await as('pro', 'PUT', '/api/body/day', { day: today, weightKg: 98 })).json();
    const g2 = (await as('pro', 'GET', '/api/goal')).json();
    expect(w.recalculated).toEqual({ from: 2100, to: g2.plan.kcal });
    const t = (await app.inject({ method: 'GET', url: `/api/today?day=${today}`, headers: { ...H, cookie: cookies.pro! } })).json();
    expect(t.plan.kcal).toBe(g2.plan.kcal);
    // снова то же — пересчитывать нечего
    expect((await as('pro', 'PUT', '/api/body/day', { day: today, steps: 8000 })).json().recalculated).toBeNull();
  });
  it('активность недели меняет калории', async () => {
    const before = (await as('pro', 'GET', '/api/goal')).json();
    const after = (await as('pro', 'PUT', '/api/goal/activity', { level: 'mod' })).json();
    expect(after.level).toBe('mod');
    expect(after.plan.kcal).toBeGreaterThan(before.plan.kcal);
    expect((await as('pro', 'PUT', '/api/goal/activity', { level: 'nope' })).statusCode).toBe(400);
  });
  it('норма калорий, поправленная руками, не перезаписывается «Целью»; kcalManual:false возвращает расчёт', async () => {
    const plan = (await as('pro', 'GET', '/api/goal')).json().plan.kcal as number;
    expect((await as('pro', 'PUT', '/api/profile/settings', { kcal: plan + 300 })).statusCode).toBe(200);
    await as('pro', 'PUT', '/api/goal/activity', { level: 'mod' });
    await as('pro', 'PUT', '/api/body/day', { day: today, weightKg: 97.5 });
    const me = (await as('pro', 'GET', '/api/me')).json();
    expect(me.profile.settings.kcal).toBe(plan + 300);
    const back = (await as('pro', 'PUT', '/api/profile/settings', { kcalManual: false })).json();
    const now = (await as('pro', 'GET', '/api/goal')).json().plan;
    expect(back.settings).toMatchObject({ kcalManual: false, kcal: now.kcal, protein: now.protein });
    expect((await as('pro', 'GET', '/api/me')).json().profile.settings.kcal).toBe(now.kcal);
  });
});
