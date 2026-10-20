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
  for (const name of ['pro', 'free']) {
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
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const name of Object.keys(ids)) cookies[name] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: name, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('статистика', () => {
  it('без Pro — 402', async () => {
    for (const u of ['/api/stats/overview', '/api/stats/food', '/api/stats/week', '/api/awards']) expect((await as('free', 'GET', u)).statusCode).toBe(402);
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
