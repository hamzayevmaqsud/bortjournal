/** Статистика разделов (как в старом журнале): учёба, деньги, книги — за период и в сравнении с прошлым */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', userId = '';
const H = { host: 'localhost' };
const T = localNow(240).day, D = (k: number) => addDays(T, -k);
const r = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });

beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'stat', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  userId = u!.id;
  await grantFree(conn.db, userId); await grant(conn.db, userId, 'pro', 'free');
  await conn.db.insert(s.profiles).values({ userId, settings: { study: 30, booksGoal: 6 } });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'stat', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('учёба', () => {
  it('минуты по дням, дни с целью, направления, точность ответов и сравнение с прошлым периодом', async () => {
    await conn.db.insert(s.studySessions).values([
      { userId, day: D(0), time: '10:00', topic: 'Делегаты', category: 'C#', minutes: 40, theses: [], qa: [] },
      { userId, day: D(2), time: '10:00', topic: 'LINQ', category: 'C#', minutes: 20, theses: [], qa: [] },
      { userId, day: D(3), time: '10:00', topic: 'Кворум', category: 'DevOps', minutes: 30, theses: [], qa: [] },
      { userId, day: D(9), time: '10:00', topic: 'Старое', category: 'C#', minutes: 15, theses: [], qa: [] }
    ]);
    await conn.db.insert(s.answers).values([{ userId, day: D(2), correct: true }, { userId, day: D(2), correct: false }, { userId, day: D(3), correct: true }]);
    const st = (await r('GET', '/api/study/stats?days=7')).json();
    expect(st).toMatchObject({ days: 7, goal: 30, total: 90, prevTotal: 15, activeDays: 3, goalDays: 2, topics: 3, answers: { n: 3, good: 2 } });
    expect(st.perDay).toHaveLength(7);
    expect(st.perDay.at(-1)).toEqual({ day: T, minutes: 40 });
    expect(st.categories).toEqual([{ name: 'C#', minutes: 60 }, { name: 'DevOps', minutes: 30 }]);
    expect(st.accuracy).toEqual([{ day: D(3), pct: 100, n: 1 }, { day: D(2), pct: 50, n: 2 }]);
  });
});

describe('деньги', () => {
  it('без настроек бюджета — configured: false', async () => {
    expect((await r('GET', '/api/budget/stats?days=30')).json()).toEqual({ configured: false });
  });
  it('траты по дням, категории, доходы, сравнение и последние периоды', async () => {
    await r('PUT', '/api/budget/settings', { amount: 3000, savings: 0, startDay: 1, currency: '₼' });
    for (const [k, kind, category, amount] of [[0, 'out', 'food', 20], [1, 'out', 'cafe', 12.5], [1, 'in', 'salary', 500], [10, 'out', 'food', 40]] as const)
      await r('POST', '/api/budget/entries', { day: D(k), kind, category, amount });
    const st = (await r('GET', '/api/budget/stats?days=7')).json();
    expect(st).toMatchObject({ configured: true, currency: '₼', total: 32.5, prevTotal: 40, income: 500 });
    expect(st.perDay).toHaveLength(7);
    expect(st.perDay.at(-1)).toEqual({ day: T, spent: 20 });
    expect(st.byCat.map((c: any) => [c.key, c.sum])).toEqual([['food', 20], ['cafe', 12.5]]);
    expect(st.periods).toHaveLength(6);
    expect(st.periods.at(-1).to >= T).toBe(true);
    expect(st.base).toBeGreaterThan(0);
  });
});

describe('книги', () => {
  it('страницы, серия чтения, книги за год по месяцам, жанры и скорость', async () => {
    const y = T.slice(0, 4);
    const [a] = await conn.db.insert(s.books).values({ userId, title: 'Атомные привычки', pages: 300, currentPage: 300, status: 'done', genre: 'Саморазвитие', startedOn: D(9), finishedOn: D(0), addedOn: D(20) }).returning();
    await conn.db.insert(s.books).values({ userId, title: 'Дюна', pages: 600, currentPage: 600, status: 'done', genre: 'Фантастика', startedOn: `${+y - 1}-01-01`, finishedOn: `${+y - 1}-02-01`, addedOn: `${+y - 1}-01-01` });
    await conn.db.insert(s.readingLog).values([{ userId, bookId: a!.id, day: D(0), pages: 30 }, { userId, bookId: a!.id, day: D(1), pages: 20 }, { userId, bookId: a!.id, day: D(3), pages: 10 }]);
    const st = (await r('GET', '/api/books/stats?days=7')).json();
    expect(st).toMatchObject({ total: 60, readDays: 3, streak: 2, year: +y, doneYear: 1, goal: 6, speed: 24 });
    expect(st.perDay.at(-1)).toEqual({ day: T, pages: 30 });
    expect(st.months).toHaveLength(12);
    expect(st.months[+D(0).slice(5, 7) - 1]).toEqual({ n: 1, titles: ['Атомные привычки'] });
    expect(st.genres).toEqual([{ name: 'Саморазвитие', n: 1 }, { name: 'Фантастика', n: 1 }]);
  });
});
