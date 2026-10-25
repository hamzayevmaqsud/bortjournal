/** Серия и заморозки: правила (получить, потратить, не больше 2, не больше 2 дней подряд), повторный подсчёт и одна серия на всё */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import { tipInput } from '../src/core/insights.js';
import { streakOf, walkStreak } from '../src/core/streak.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

const T = '2026-10-25';
/** дни по шаблону: строка от старого к вчера, «x» — запись, «.» — пусто; сегодня — отдельно */
const walk = (pattern: string, todayOn = false) => {
  const from = addDays(T, -pattern.length), on = new Set<string>();
  [...pattern].forEach((c, k) => { if (c === 'x') on.add(addDays(from, k)); });
  if (todayOn) on.add(T);
  return walkStreak(d => on.has(d), from, T);
};

describe('заморозки: правила', () => {
  it('новичку заморозок нет — пустой день рвёт серию', () => {
    expect(walk('xxx.')).toMatchObject({ now: 0, freezes: 0, frozen: [] });
    expect(walk('xxx', true)).toMatchObject({ now: 4, upToYesterday: 3 });
  });
  it('+1 за 7 активных дней, тратится на пустой день, серия не растёт, но живёт', () => {
    expect(walk('xxxxxxx')).toMatchObject({ now: 7, freezes: 1, earnedAt: addDays(T, -1) });
    const r = walk('xxxxxxx.x');
    expect(r).toMatchObject({ now: 8, freezes: 0, frozen: [addDays(T, -2)], usedYesterday: false });
    expect(walk('xxxxxxx.')).toMatchObject({ now: 7, upToYesterday: 7, freezes: 0, usedYesterday: true });
  });
  it('в запасе не больше 2', () => {
    expect(walk('x'.repeat(30))).toMatchObject({ now: 30, freezes: 2 });
  });
  it('не больше 2 замороженных дней подряд — третий рвёт серию', () => {
    expect(walk(`${'x'.repeat(14)}..`)).toMatchObject({ now: 14, freezes: 0, frozen: [addDays(T, -2), addDays(T, -1)] });
    expect(walk(`${'x'.repeat(21)}...`)).toMatchObject({ now: 0, freezes: 0 });
    // после двух замороженных — снова запись: серия продолжается
    expect(walk(`${'x'.repeat(14)}..x`)).toMatchObject({ now: 15 });
  });
  it('лучшая серия и сегодняшний день не замораживается', () => {
    expect(walk('xxxxxxx')).toMatchObject({ frozen: [] });
    expect(walk(`${'x'.repeat(10)}...xx`)).toMatchObject({ now: 2, best: 10 });
  });
  it('чистая функция: тот же вход — тот же ответ', () => {
    expect(walk('xxxxxxx.xxxxxxx..x')).toEqual(walk('xxxxxxx.xxxxxxx..x'));
  });
});

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: 'localhost' };
const TZ = 240, today = () => localNow(TZ).day;
const ids: Record<string, string> = {};
const login = async (u: string) => String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: u, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
const get = async (u: string, url: string) => (await app.inject({ method: 'GET', url, headers: { ...H, cookie: await login(u) } })).json();
const settingsOf = async (u: string) => (await conn.db.select().from(s.profiles).where(eq(s.profiles.userId, ids[u]!)))[0]!.settings as Record<string, any>;

beforeAll(async () => {
  conn = await freshDb();
  for (const name of ['ice', 'plain']) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: TZ }).returning();
    ids[name] = u!.id; await grantFree(conn.db, u!.id);
    await conn.db.insert(s.profiles).values({ userId: u!.id, settings: { name: 'Тест', kcal: 2000 } });
  }
  // ice: 10 дней шагов, потом вчера пусто, сегодня пусто — вчера закрывает заморозка
  for (let k = 2; k <= 11; k++) await conn.db.insert(s.bodyDays).values({ userId: ids.ice!, day: addDays(today(), -k), steps: 8000 });
  // plain: 5 дней подряд по вчера — без заморозок
  for (let k = 1; k <= 5; k++) await conn.db.insert(s.bodyDays).values({ userId: ids.plain!, day: addDays(today(), -k), steps: 6000 });
  app = await buildApp({ db: conn.db, serveWeb: false });
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('заморозки: в базе и на экранах', () => {
  it('вчера спасла заморозка: серия живёт, осталось 0, день виден в календаре', async () => {
    const t = await get('ice', '/api/today');
    expect(t.streak).toBe(10);
    expect(t.freeze).toMatchObject({ left: 0, max: 2, usedYesterday: true, frozen: [addDays(today(), -1)] });
    const o = await get('ice', '/api/stats/overview');
    expect(o.nums).toMatchObject({ streak: 10, freezes: 0 });
    const cell = o.calendar.cells.find((c: any) => c.day === addDays(today(), -1));
    if (cell) expect(cell.frozen).toBe(true);
    expect(o.year.cells.find((c: any) => c.day === addDays(today(), -1)).frozen).toBe(true);
  });

  it('сохраняется в настройках слиянием и не дублируется при повторном подсчёте', async () => {
    const a = await settingsOf('ice');
    expect(a).toMatchObject({ name: 'Тест', kcal: 2000, freezes: 0, frozenDays: [addDays(today(), -1)], freezeEarnedAt: addDays(today(), -5) });
    await get('ice', '/api/today'); await get('ice', '/api/stats/overview'); await streakOf(conn.db, ids.ice!, today());
    expect(await settingsOf('ice')).toEqual(a);
  });

  it('одна серия: «Сегодня», статистика, совет и итог недели считают одинаково', async () => {
    for (const u of ['ice', 'plain']) {
      const t = await get(u, '/api/today'), o = await get(u, '/api/stats/overview'), w = await get(u, `/api/insights/week?end=${today()}`);
      const x = await tipInput(conn.db, ids[u]!), h = await streakOf(conn.db, ids[u]!, today(), { persist: false });
      // сегодня записей нет — серия «до вчера» совпадает с текущей
      expect([t.streak, o.nums.streak, x.streak, h.now, h.upToYesterday]).toEqual(Array(5).fill(u === 'ice' ? 10 : 5));
      if (w.isThis) expect(w.streak).toBe(h.now);
    }
  });

  it('запись за замороженный день возвращает заморозку', async () => {
    await conn.db.insert(s.bodyDays).values({ userId: ids.ice!, day: addDays(today(), -1), steps: 5000 });
    const t = await get('ice', '/api/today');
    expect(t.streak).toBe(11);
    expect(t.freeze).toMatchObject({ left: 1, usedYesterday: false, frozen: [] });
    expect(await settingsOf('ice')).toMatchObject({ freezes: 1, frozenDays: [] });
  });
});
