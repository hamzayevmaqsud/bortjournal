/** «Как прошёл день?»: настроение и заметка, проверка ввода, будущий день, чужие записи, серия, совет, неделя и демо */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import { rankTips, type TipInput } from '../src/core/insights.js';
import { moodLink } from '../src/core/stats.js';
import { demoData } from '../src/core/demo-data.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: 'localhost' };
const TZ = 240, today = () => localNow(TZ).day;
const login = async (u: string) => String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: u, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
const as = (cookie: string) => (method: 'GET' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });
const ids: Record<string, string> = {};

beforeAll(async () => {
  conn = await freshDb();
  for (const name of ['ann', 'bob', 'moody']) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: TZ }).returning();
    ids[name] = u!.id; await grantFree(conn.db, u!.id);
    await conn.db.insert(s.profiles).values({ userId: u!.id, settings: {} });
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('как прошёл день', () => {
  it('пусто — null; настроение и заметка сохраняются и читаются', async () => {
    const r = as(await login('ann'));
    expect((await r('GET', '/api/journal')).json()).toEqual({ day: today(), today: today(), mood: null, note: null });
    const p = await r('PUT', '/api/journal', { day: today(), mood: 4 });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ day: today(), mood: 4, note: null });
    // заметка отдельно — настроение остаётся
    expect((await r('PUT', '/api/journal', { day: today(), note: '  Хороший день  ' })).json()).toMatchObject({ mood: 4, note: 'Хороший день' });
    expect((await r('GET', `/api/journal?day=${today()}`)).json()).toMatchObject({ mood: 4, note: 'Хороший день' });
    // null стирает
    expect((await r('PUT', '/api/journal', { day: today(), mood: null, note: '' })).json()).toMatchObject({ mood: null, note: null });
    // прошлый день — можно
    expect((await r('PUT', '/api/journal', { day: addDays(today(), -3), mood: 2 })).statusCode).toBe(200);
  });

  it('проверка ввода: настроение 1–5, заметка до 2000, дата, хоть что-то', async () => {
    const r = as(await login('ann'));
    for (const mood of [0, 6, 2.5, '3', true]) expect((await r('PUT', '/api/journal', { day: today(), mood })).statusCode).toBe(400);
    expect((await r('PUT', '/api/journal', { day: today(), note: 'я'.repeat(2001) })).statusCode).toBe(400);
    expect((await r('PUT', '/api/journal', { day: today(), note: 'я'.repeat(2000) })).statusCode).toBe(200);
    expect((await r('PUT', '/api/journal', { day: today(), note: 5 })).statusCode).toBe(400);
    expect((await r('PUT', '/api/journal', { day: '2026-02-31', mood: 3 })).statusCode).toBe(400);
    expect((await r('PUT', '/api/journal', { day: today() })).statusCode).toBe(400);
    expect((await r('GET', '/api/journal?day=вчера')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/journal', headers: H })).statusCode).toBe(401);
  });

  it('будущий день — 400 (по часовому поясу человека)', async () => {
    const r = as(await login('ann'));
    const res = await r('PUT', '/api/journal', { day: addDays(today(), 1), mood: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Этот день ещё не наступил.');
  });

  it('чужие записи не видны и не меняются', async () => {
    const a = as(await login('ann')), b = as(await login('bob'));
    await a('PUT', '/api/journal', { day: addDays(today(), -1), mood: 5, note: 'Секрет Анны' });
    expect((await b('GET', `/api/journal?day=${addDays(today(), -1)}`)).json()).toMatchObject({ mood: null, note: null });
    await b('PUT', '/api/journal', { day: addDays(today(), -1), mood: 1 });
    expect((await a('GET', `/api/journal?day=${addDays(today(), -1)}`)).json()).toMatchObject({ mood: 5, note: 'Секрет Анны' });
    const rows = await conn.db.select().from(s.dayJournal).where(and(eq(s.dayJournal.userId, ids.ann!), eq(s.dayJournal.day, addDays(today(), -1))));
    expect(rows).toHaveLength(1);
  });

  it('настроение — запись: день идёт в серию', async () => {
    const r = as(await login('moody'));
    expect((await r('GET', '/api/today')).json().streak).toBe(0);
    await r('PUT', '/api/journal', { day: addDays(today(), -1), mood: 3 });
    await r('PUT', '/api/journal', { day: today(), mood: 4 });
    expect((await r('GET', '/api/today')).json().streak).toBe(2);
    expect((await r('GET', '/api/stats/overview')).json().nums.streak).toBe(2);
    // только заметка без настроения серию не двигает
    await r('PUT', '/api/journal', { day: addDays(today(), -3), note: 'просто заметка' });
    expect((await r('GET', '/api/today')).json().streak).toBe(2);
  });

  it('совет вечером: «Отметь, как прошёл день», если настроения нет', () => {
    const x: TipInput = { day: today(), minutes: 19 * 60, on: new Set(), norms: { kcal: 2000, protein: 0, fat: 0, carbs: 0, water: 2000, steps: 10000, study: 60 }, today: {}, past: [], score: 0, perfectMonth: 0, streak: 0, askMood: true };
    expect(rankTips(x).map(t => t.key)).toEqual(['mood']);
    expect(rankTips(x)[0]).toMatchObject({ text: 'Отметь, как прошёл день', action: 'mood' });
    expect(rankTips({ ...x, today: { mood: 3 } })).toEqual([]);
    expect(rankTips({ ...x, minutes: 12 * 60 })).toEqual([]);
  });

  it('связь настроения с залом — от 10 дней с отметкой', () => {
    const t = '2026-10-25', N = { kcal: 2000, protein: 0, fat: 0, carbs: 0, water: 2000, steps: 10000, study: 60 };
    const F = new Map<string, any>();
    for (let k = 1; k <= 12; k++) { const d = addDays(t, -k), gym = k % 2 === 0; F.set(d, { day: d, mood: gym ? 4 : 3, workouts: gym ? 1 : 0 }); }
    expect(moodLink({ F, today: t, norms: N })).toBe('В дни с залом настроение выше на 1');
    const few = new Map([...F].slice(0, 9));
    expect(moodLink({ F: few, today: t, norms: N })).toBeNull();
  });

  it('итог недели и «неделя к неделе»: среднее настроение и лучший день', async () => {
    const r = as(await login('bob'));
    const mon = addDays(today(), -((new Date(today() + 'T12:00:00Z').getUTCDay() + 6) % 7) - 7);
    await r('PUT', '/api/journal', { day: mon, mood: 2 });
    await r('PUT', '/api/journal', { day: addDays(mon, 2), mood: 5 });
    const w = (await r('GET', `/api/insights/week?end=${addDays(mon, 6)}`)).json();
    expect(w.mood).toMatchObject({ avg: 3.5, days: 2, best: addDays(mon, 2) });
    expect(w.stats.find((x: any) => x.key === 'mood')).toMatchObject({ value: '3,5', unit: 'из 5', note: expect.stringContaining('среда') });
    await r('PUT', '/api/journal', { day: addDays(today(), -2), mood: 4 });
    const o = (await r('GET', '/api/stats/overview')).json();
    expect(o.week.metrics.find((m: any) => m.key === 'mood')).toMatchObject({ cur: expect.any(Number), unit: 'из 5' });
  });

  it('демо: настроение примерно в 80% дней с записями, без будущего и пропусков, с парой заметок', () => {
    const t = '2026-10-25', D = demoData('seed-1', t, '12:00'), missed = new Set(D.missed);
    const active = 90 - D.missed.length;
    expect(D.journal.length).toBeGreaterThanOrEqual(Math.floor(active * 0.65));
    expect(D.journal.length).toBeLessThanOrEqual(active);
    expect(D.journal.every(j => j.mood >= 1 && j.mood <= 5 && j.day < t && !missed.has(j.day))).toBe(true);
    expect(D.journal.some(j => j.note)).toBe(true);
    // в дни с залом в среднем лучше
    const gym = new Set(D.workouts.map(w => w.day)), avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(D.journal.filter(j => gym.has(j.day)).map(j => j.mood))).toBeGreaterThan(avg(D.journal.filter(j => !gym.has(j.day)).map(j => j.mood)));
    // тот же seed — те же отметки
    expect(demoData('seed-1', t, '12:00').journal).toEqual(D.journal);
  });

  it('демо-аккаунт: настроение лежит в базе', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/demo', headers: H, remoteAddress: '10.9.0.1', payload: { tz: 240 } });
    const cookie = String(res.headers['set-cookie']).split(';')[0]!, r = as(cookie);
    const me = (await r('GET', '/api/me')).json();
    const [u] = await conn.db.select().from(s.users).where(eq(s.users.username, me.username));
    const rows = await conn.db.select().from(s.dayJournal).where(eq(s.dayJournal.userId, u!.id));
    expect(rows.length).toBeGreaterThan(50);
    expect((await r('GET', `/api/journal?day=${rows[0]!.day}`)).json().mood).toBe(rows[0]!.mood);
  });
});
