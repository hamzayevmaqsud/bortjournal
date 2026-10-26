/** Статистика: оценка дня по правилам старого журнала, календарь, итог недели, достижения (сохраняются один раз) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const cookies: Record<string, string> = {}, H = { host: 'localhost' };
const as = (who: string, method: 'GET' | 'POST', url: string) => app.inject({ method, url, headers: { ...H, cookie: cookies[who]! } });
const today = localNow(240).day;

beforeAll(async () => {
  conn = await freshDb();
  const ids: Record<string, string> = {};
  for (const name of ['pro', 'free', 'mix']) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    ids[name] = u!.id; await grantFree(conn.db, u!.id);
    if (name === 'pro') await grant(conn.db, u!.id, 'pro', 'free');
  }
  const id = ids.pro!;
  await conn.db.insert(s.profiles).values({ userId: id, sex: 'm', goal: 'lose', settings: { kcal: 2000, protein: 100, water: 2000, steps: 10000 } });
  // 10 дней подряд до вчера: еда ровно в норме, белок закрыт, вода и шаги — норма → 100%
  for (let k = 1; k <= 10; k++) {
    const d = addDays(today, -k);
    await conn.db.insert(s.meals).values({ userId: id, day: d, name: 'Обед', kcal: 2000, protein: 100 });
    await conn.db.insert(s.drinks).values({ userId: id, day: d, type: 'water', ml: 2000 });
    await conn.db.insert(s.bodyDays).values({ userId: id, day: d, steps: 10000 });
  }
  // позавчера ещё и тренировка (бонус не выводит за 100%), сегодня — половина шагов, без еды
  await conn.db.insert(s.workouts).values({ userId: id, day: addDays(today, -2), title: 'Грудь', minutes: 60 });
  await conn.db.insert(s.bodyDays).values({ userId: id, day: today, steps: 5000 });
  // mix: 7 дней до вчера — вода и калории в норме, белка и шагов мало; вес 80 → 79,2 за неделю
  await conn.db.insert(s.profiles).values({ userId: ids.mix!, sex: 'm', goal: 'lose', settings: { kcal: 2000, protein: 100, water: 2000, steps: 10000 } });
  for (let k = 1; k <= 7; k++) {
    const d = addDays(today, -k);
    await conn.db.insert(s.meals).values({ userId: ids.mix!, day: d, name: 'Обед', kcal: 2000, protein: 30 });
    await conn.db.insert(s.drinks).values({ userId: ids.mix!, day: d, type: 'water', ml: 2000 });
    await conn.db.insert(s.bodyDays).values({ userId: ids.mix!, day: d, steps: 3000, weightKg: k === 1 ? 79.2 : null });
  }
  await conn.db.insert(s.bodyDays).values({ userId: ids.mix!, day: addDays(today, -9), weightKg: 80 });
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const name of Object.keys(ids)) cookies[name] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: name, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('статистика', () => {
  it('статистика бесплатна — открыта и без Pro', async () => {
    for (const u of ['/api/stats/overview', '/api/stats/food', '/api/stats/week', '/api/awards']) expect((await as('free', 'GET', u)).statusCode).toBe(200);
  });
  it('оценка дня: ведомые направления, сегодня — частично', async () => {
    const o = (await as('pro', 'GET', '/api/stats/overview')).json();
    expect(o.score.parts.map((p: any) => p.area)).toEqual(['food', 'protein', 'water', 'steps']);
    // сегодня: еды нет (0), белка нет (0), воды нет (0), шаги 50% → 12,5%
    expect(o.score.now).toBe(13);
    expect(o.score.avg7).toBe(100);
    expect(o.nums).toMatchObject({ streak: 11, bestStreak: 11 });
    const yesterday = o.calendar.cells.find((c: any) => c.day === addDays(today, -1));
    if (yesterday) expect(yesterday.score).toBe(100);
    expect(o.records[0]).toMatchObject({ name: 'Лучшая серия', value: '11' });
    // первый подсчёт открывает и сохраняет достижения
    expect(o.fresh.map((f: any) => `${f.key}:${f.tier}`)).toEqual(expect.arrayContaining(['streak:0', 'streak:1', 'food:0', 'gym:0', 'perfect:0', 'water:0', 'steps:0']));
  });
  it('цифры обзора согласованы: дни с записями, серия, средние', async () => {
    const o = (await as('pro', 'GET', '/api/stats/overview')).json();
    // 10 завершённых дней + сегодня (шаги): дни с записями считают и сегодня — как серия
    expect(o.nums.active365).toBe(11);
    expect(o.nums.streak).toBe(11);
    expect(o.score.days7).toBe(7);
    const month = today.slice(0, 7), inMonth = Array.from({ length: 11 }, (_, k) => addDays(today, -k)).filter(d => d.startsWith(month));
    expect(o.calendar.days).toBe(inMonth.length);
    // средняя месяца — по завершённым дням с записями, сегодня не считается
    expect(o.calendar.avgDays).toBe(inMonth.length - 1);
    if (o.calendar.avgDays) expect(o.calendar.avg).toBe(100);
    expect(o.calendar.cells.find((c: any) => c.day === today).any).toBe(true);
    // дни недели: есть данные — есть средняя; дней без данных нет
    expect(o.weekdays.filter((w: any) => w.avg !== null).length).toBe(7);
    expect(o.pastDays).toBe(10);
  });
  it('пустые дни не тянут среднее за 7 дней вниз', async () => {
    const o = (await as('free', 'GET', '/api/stats/overview')).json();
    expect(o.score.avg7).toBeNull();
    expect(o.score.days7).toBe(0);
    expect(o.weekdays).toBeNull();
    expect(o.week.insights).toEqual([]);
  });
  it('год клетками: с понедельника, минимум 16 недель, без будущих дней', async () => {
    const y = (await as('pro', 'GET', '/api/stats/overview')).json().year;
    expect(y.first).toBe(addDays(today, -10));
    expect(y.active).toBe(11);
    expect(new Date(`${y.from}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(y.cells[0].day).toBe(y.from);
    expect(y.cells.at(-1).day).toBe(today);
    expect(y.cells.length).toBeGreaterThanOrEqual(15 * 7 + 1);
    expect(y.cells.length).toBeLessThanOrEqual(16 * 7);
    expect(y.cells.find((c: any) => c.day === addDays(today, -11)).score).toBeNull();
    expect(y.cells.find((c: any) => c.day === addDays(today, -1)).score).toBe(100);
  });
  it('неделя к неделе: дельты и подсказки', async () => {
    const w = (await as('pro', 'GET', '/api/stats/overview')).json().week;
    expect(w).toMatchObject({ from: addDays(today, -7), to: addDays(today, -1), days: 7, prevDays: 3 });
    const m = Object.fromEntries(w.metrics.map((x: any) => [x.key, x]));
    expect(m.score).toMatchObject({ cur: 100, prev: 100, better: null });
    expect(m.kcal).toMatchObject({ cur: 2000, prev: 2000, norm: 2000 });
    expect(m.gym).toMatchObject({ cur: 1, prev: 0, better: true });
    expect(m.study).toBeUndefined();
    expect(w.insights).toEqual(['Лучше всего у тебя получается вода — в норме 7 из 7 дней']);
    const x = (await as('mix', 'GET', '/api/stats/overview')).json().week;
    expect(x.insights).toEqual(['Лучше всего у тебя получается вода — в норме 7 из 7 дней', 'Слабое место — белок: 0 дней из 7']);
    const mx = Object.fromEntries(x.metrics.map((v: any) => [v.key, v]));
    expect(mx.weight).toMatchObject({ cur: -0.8, better: true });
    expect(mx.kcal).toMatchObject({ cur: 2000, prev: null, better: null });
  });
  it('один день: оценка по частям и что записано', async () => {
    const y = (await as('pro', 'GET', `/api/stats/day?day=${addDays(today, -2)}`)).json();
    expect(y).toMatchObject({ score: 100, any: true, isToday: false, future: false });
    expect(y.parts.map((p: any) => [p.area, p.v])).toEqual([['food', 100], ['protein', 100], ['water', 100], ['steps', 100]]);
    expect(y.facts).toMatchObject({ kcal: 2000, protein: 100, kcalLevel: 'good', waterMl: 2000, steps: 10000, workouts: 1, gymMin: 60, spent: null });
    const t = (await as('pro', 'GET', `/api/stats/day?day=${today}`)).json();
    expect(t).toMatchObject({ isToday: true, score: 13 });
    const e = (await as('pro', 'GET', `/api/stats/day?day=${addDays(today, -40)}`)).json();
    expect(e).toMatchObject({ any: false, score: 0 });
    expect((await as('pro', 'GET', `/api/stats/day?day=${addDays(today, 1)}`)).json()).toMatchObject({ future: true, score: null });
    expect((await as('pro', 'GET', '/api/stats/day?day=вчера')).statusCode).toBe(400);
  });
  it('еда и тело за период', async () => {
    const f = (await as('pro', 'GET', '/api/stats/food?days=30')).json();
    expect(f).toMatchObject({ logged: 10, inNorm: 10, avgKcal: 2000, waterDays: 10 });
    expect(f.top[0]).toMatchObject({ name: 'Обед', n: 10 });
    expect((await as('pro', 'GET', '/api/stats/food?days=13')).statusCode).toBe(400);
    const b = (await as('pro', 'GET', '/api/stats/body?days=7')).json();
    expect(b.hit).toBe(6);
  });
  it('итог недели собирает «получилось» и «фокус»', async () => {
    const w = (await as('pro', 'GET', `/api/stats/week?mon=${addDays(today, -7)}`)).json();
    expect(w.wins.length).toBeGreaterThan(0);
    expect(w.kpis[0].name).toBe('Дней с записями');
  });
  it('достижения: открываются один раз и с датой', async () => {
    // уже открытые не поздравляются повторно
    expect((await as('pro', 'POST', '/api/awards/check')).json().fresh).toEqual([]);
    const a = (await as('pro', 'GET', '/api/awards')).json();
    expect(a.recent[0].day).toBe(today);
    expect(a.unlocked.length).toBe(a.total);
    // новая тренировка — ступень «Железо» не меняется (нужно 10), а новых записей нет
    await conn.db.insert(s.workouts).values({ userId: (await conn.db.select().from(s.users)).find(u => u.username === 'pro')!.id, day: today, title: 'Спина' });
    expect((await as('pro', 'POST', '/api/awards/check')).json().fresh).toEqual([]);
  });
});

describe('оценка сегодняшнего дня', () => {
  it('днём недобор калорий — прогресс к норме, а не «0% в норме»; в прошлые дни — промах; перебор — промах всегда', async () => {
    const { score } = await import('../src/core/stats.js');
    const A = { food: true } as any, N = { kcal: 2000, protein: 0, fat: 0, carbs: 0, water: 2000, steps: 10000, study: 60 } as any;
    const lunch = { meals: 2, kcal: 900 } as any, over = { meals: 4, kcal: 3000 } as any;
    expect(score(lunch, A, N, true)).toBeCloseTo(0.5, 1);   // 900 из 2000 — половина пути
    expect(score(lunch, A, N, false)).toBe(0);              // закончился с 900 — мимо нормы
    expect(score(over, A, N, true)).toBe(0);                // перебор сегодня — тоже мимо
    expect(score({ meals: 3, kcal: 1950 } as any, A, N, true)).toBe(1);
  });
});
