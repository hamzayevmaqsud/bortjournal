/** Совет дня и итог недели: правила (что важнее), выключенные разделы, склонения, ответы API и вечерние напоминания */
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow, nWord, ordinal, plural, weekday } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import { rankTips, type Area, type TipInput } from '../src/core/insights.js';
import { dueNudges, remindTick } from '../src/core/reminders.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

process.env.PUSH_ALLOW_ANY = '1';
process.env.VAPID_FILE = path.join(os.tmpdir(), `bj-vapid-ins-${process.pid}.json`);

const ALL: Area[] = ['food', 'water', 'steps', 'tasks', 'gym', 'study', 'budget', 'books'];
const N = { kcal: 2200, protein: 130, fat: 70, carbs: 250, water: 2300, steps: 10000, study: 60 };
const DAY = '2026-10-21';
const input = (x: Partial<TipInput> = {}): TipInput => ({ day: DAY, minutes: 19 * 60, on: new Set(ALL), norms: N, today: {}, past: [], score: 0.5, perfectMonth: 0, streak: 0, ...x });
const keys = (x: Partial<TipInput>) => rankTips(input(x)).map(t => t.key);

describe('совет дня: правила', () => {
  it('белок отстаёт — главный совет про ужин', () => {
    const [top] = rankTips(input({ today: { meals: 2, kcal: 1500, protein: 54, waterMl: 2000, steps: 9000 } }));
    expect(top).toMatchObject({ key: 'protein', tone: 'nudge', action: 'meal', text: 'Белок сегодня 54 из 130 г — на ужин творог или курица' });
  });
  it('воды мало — сколько стаканов до сна', () => {
    const [top] = rankTips(input({ on: new Set<Area>(['water']), today: { waterMl: 1100 } }));
    expect(top).toMatchObject({ key: 'water', action: 'water', text: 'Воды 1,1 л из 2,3 — ещё 5 стаканов до сна' });
    expect(rankTips(input({ on: new Set<Area>(['water']), today: { waterMl: 1600 } }))[0]!.text).toContain('ещё 3 стакана до сна');
    expect(rankTips(input({ on: new Set<Area>(['water']), norms: { ...N, water: 2000 }, today: { waterMl: 1500 } }))[0]!.text).toContain('ещё 2 стакана');
  });
  it('третий день без зала', () => {
    const past = [{ day: addDays(DAY, -3), workouts: 1 }];
    expect(rankTips(input({ on: new Set<Area>(['gym']), past }))[0]!.text).toBe('Третий день без зала — даже 20 минут засчитаются');
    expect(rankTips(input({ on: new Set<Area>(['gym']), past: [{ day: addDays(DAY, -12), workouts: 1 }] }))[0]!.text).toBe('Уже 12 дней без зала — начни с короткой тренировки на 20 минут');
    // вчера был — рано напоминать; сегодня был — тем более
    expect(keys({ on: new Set<Area>(['gym']), past: [{ day: addDays(DAY, -1), workouts: 1 }] })).not.toContain('gym');
    expect(keys({ on: new Set<Area>(['gym']), past, today: { workouts: 1 } })).not.toContain('gym');
  });
  it('задачи вечером: сколько сделано и что с остальными', () => {
    expect(rankTips(input({ on: new Set<Area>(['tasks']), today: { tasks: 5, tasksDone: 3 } }))[0]!.text).toBe('Задачи: 3 из 5 — перенеси оставшиеся на завтра?');
    expect(rankTips(input({ on: new Set<Area>(['tasks']), today: { tasks: 2, tasksDone: 1 } }))[0]!.text).toContain('перенеси оставшуюся');
    // днём не торопим
    expect(keys({ on: new Set<Area>(['tasks']), minutes: 12 * 60, today: { tasks: 5, tasksDone: 3 } })).toEqual([]);
  });
  it('всё хорошо — похвала, идеальный день с номером за месяц', () => {
    const [top] = rankTips(input({ score: 1, perfectMonth: 4, today: { meals: 3, kcal: 2150, protein: 130, waterMl: 2400, steps: 11000, tasks: 3, tasksDone: 3 } }));
    expect(top).toMatchObject({ key: 'perfect', tone: 'good', text: 'Идеальный день — 5-й за месяц' });
    expect(rankTips(input({ on: new Set<Area>(['food']), score: 1, today: { meals: 3, kcal: 2150, protein: 130 } })).every(t => t.tone === 'good')).toBe(true);
  });
  it('выключенные разделы не советуют', () => {
    const today = { meals: 2, kcal: 1500, protein: 40, waterMl: 0, steps: 2000, tasks: 4, tasksDone: 0 };
    const past = [{ day: addDays(DAY, -5), workouts: 1, studyMin: 30 }];
    expect(keys({ today, past })).toEqual(expect.arrayContaining(['protein', 'water', 'steps', 'tasks', 'gym', 'study']));
    expect(keys({ on: new Set<Area>(['tasks']), today, past })).toEqual(['tasks']);
    expect(keys({ on: new Set<Area>(['food', 'tasks']), today, past })).not.toContain('water');
  });
  it('пустой день при серии — важнее всего', () => {
    expect(rankTips(input({ streak: 4 }))[0]!.text).toBe('Сегодня пока пусто — запиши хоть что-нибудь, и серия станет 5 дней');
    expect(rankTips(input({ streak: 1 }))[0]?.key).toBe('food-empty');
  });
  it('склонения и порядковые', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111, 0].map(n => plural(n, 'день', 'дня', 'дней'))).toEqual(['день', 'дня', 'дней', 'дней', 'дней', 'день', 'дня', 'дней', 'дней', 'дней']);
    expect(nWord(1, 'стакан', 'стакана', 'стаканов')).toBe('1 стакан');
    expect(nWord(14, 'стакан', 'стакана', 'стаканов')).toBe('14 стаканов');
    expect([2, 3, 4, 10, 11].map(ordinal)).toEqual(['второй', 'третий', 'четвёртый', 'десятый', '11-й']);
    expect(rankTips(input({ on: new Set<Area>(['study']), today: { quizTotal: 5, quizAnswered: 4 } }))[0]!.text).toBe('Остался 1 вопрос дня — это пара минут');
    expect(rankTips(input({ on: new Set<Area>(['study']), today: { quizTotal: 5, quizAnswered: 2 } }))[0]!.text).toBe('Осталось 3 вопроса дня — это пара минут');
    expect(rankTips(input({ on: new Set<Area>(['water']), norms: { ...N, water: 2250 }, today: { waterMl: 2000 } }))).toEqual([]);
    expect(rankTips(input({ on: new Set<Area>(['water']), today: { waterMl: 1550 } }))[0]!.text).toContain('ещё 3 стакана');
  });
});

/* ---------- API и напоминания ---------- */
let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, srv: http.Server, endpoint = '';
const H = { host: 'localhost' }, TZ = 240, today = localNow(TZ).day, ids: Record<string, string> = {}, cookies: Record<string, string> = {};
const get = (who: string, url: string) => app.inject({ method: 'GET', url, headers: { ...H, cookie: cookies[who]! } });
const send = (who: string, method: 'POST' | 'PUT', url: string, payload: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: cookies[who]! } });
// момент «в hh:mm местного времени» в день d
const at = (d: string, hm: string) => Date.parse(`${d}T${hm}:00Z`) - TZ * 60e3;
// последнее воскресенье не позже сегодня — для итога недели
const sunday = (() => { let d = today; while (weekday(d) !== 0) d = addDays(d, -1); return d; })();

beforeAll(async () => {
  srv = http.createServer((r, res) => { r.resume(); r.on('end', () => res.writeHead(201).end()); });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  endpoint = `http://127.0.0.1:${(srv.address() as { port: number }).port}/push`;
  conn = await freshDb();
  for (const [name, sections] of [['eve', ['food', 'water', 'steps', 'tasks', 'gym']], ['dry', ['water', 'tasks']]] as const) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: TZ }).returning();
    ids[name] = u!.id; await grantFree(conn.db, u!.id); await grant(conn.db, u!.id, 'pro', 'free');
    await conn.db.insert(s.profiles).values({ userId: u!.id, heightCm: 180, sex: 'm', goal: 'lose', settings: { kcal: 2000, protein: 130, water: 2000, steps: 10000, sections: [...sections] } });
  }
  // неделя до сегодня: еда, вода, шаги; две тренировки; сегодня белка мало
  for (const id of Object.values(ids)) for (let k = 1; k <= 9; k++) {
    const d = addDays(today, -k);
    await conn.db.insert(s.meals).values({ userId: id, day: d, name: 'Обед', kcal: 1900, protein: 120 });
    await conn.db.insert(s.drinks).values({ userId: id, day: d, type: 'water', ml: 2100 });
    await conn.db.insert(s.bodyDays).values({ userId: id, day: d, steps: 9000 + k * 100, weightKg: 80 + k * 0.1 });
  }
  for (const id of Object.values(ids)) {
    await conn.db.insert(s.meals).values({ userId: id, day: today, name: 'Курица', kcal: 1800, protein: 40 });
    await conn.db.insert(s.drinks).values({ userId: id, day: today, type: 'water', ml: 2000 });
    await conn.db.insert(s.bodyDays).values({ userId: id, day: today, steps: 9500 });
    await conn.db.insert(s.workouts).values({ userId: id, day: addDays(today, -1), title: 'Ноги', minutes: 50 });
  }
  if (sunday !== today) await conn.db.insert(s.meals).values({ userId: ids.eve!, day: sunday, name: 'Ужин', kcal: 2000, protein: 130 }).onConflictDoNothing();
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const name of Object.keys(ids)) cookies[name] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: name, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); srv?.close(); });

describe('совет дня и итог недели: API', () => {
  it('/api/insights/today — главный совет и запасные', async () => {
    const r = await get('eve', '/api/insights/today');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b).toMatchObject({ day: today, evening: expect.any(Boolean), tip: { key: 'protein', tone: 'nudge', action: 'meal', text: 'Белок сегодня 40 из 130 г — на ужин творог или курица' } });
    expect(Array.isArray(b.more)).toBe(true);
    expect(b.more.length).toBeLessThanOrEqual(2);
    expect(b.tip.weight).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/insights/today', headers: H })).statusCode).toBe(401);
  });
  it('еду не ведёт — про белок не советует', async () => {
    const b = (await get('dry', '/api/insights/today')).json();
    expect([b.tip?.key, ...b.more.map((t: { key: string }) => t.key)]).not.toContain('protein');
  });
  it('/api/insights/week — оценка, серия, цифры по включённым разделам, вывод и фокус', async () => {
    const r = await get('eve', `/api/insights/week?end=${sunday}`);
    expect(r.statusCode).toBe(200);
    const w = r.json();
    expect(w).toMatchObject({ mon: addDays(sunday, -6), sun: sunday, score: expect.any(Number), days: expect.any(Number), of: expect.any(Number), perfect: expect.any(Number), streak: expect.any(Number), verdict: expect.any(String), focus: expect.any(String) });
    expect(w.scores).toHaveLength(7);
    expect(w.days).toBeGreaterThan(0);
    const ks = w.stats.map((x: { key: string }) => x.key);
    expect(ks).toEqual(expect.arrayContaining(['kcal', 'water', 'steps']));
    expect(ks).not.toContain('study');
    const dry = (await get('dry', `/api/insights/week?end=${sunday}`)).json();
    expect(dry.stats.map((x: { key: string }) => x.key)).not.toContain('kcal');
    expect((await get('eve', '/api/insights/week?end=2026-02-31')).statusCode).toBe(400);
    expect((await get('eve', '/api/insights/week')).json().scores).toHaveLength(7);
  });
});

describe('совет дня и итог недели: напоминания', () => {
  const k = () => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return { p256dh: e.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }; };
  it('совет — в 20:40, один раз, со своим выключателем', async () => {
    expect((await send('eve', 'POST', '/api/push/subscribe', { endpoint, keys: k() })).json().kinds).toMatchObject({ tip: true, review: true });
    const tipOf = async (hm: string) => (await dueNudges(conn.db, ids.eve!, at(today, hm))).list.find(x => x.key === 'tip');
    expect(await tipOf('20:00')).toBeUndefined();
    expect(await tipOf('20:45')).toMatchObject({ kind: 'tip', title: 'Совет на вечер', body: 'Белок сегодня 40 из 130 г — на ужин творог или курица', url: '/#today' });
    expect(await tipOf('21:15')).toBeUndefined();
    const before = await remindTick(conn.db, at(today, '20:41'));
    expect(before).toBeGreaterThanOrEqual(1);
    expect(await tipOf('20:50')).toBeUndefined(); // уже отправлен
    await send('eve', 'PUT', '/api/push/settings', { kinds: { tip: false } });
    expect((await get('eve', '/api/push')).json().kinds.tip).toBe(false);
  });
  it('итог недели — в воскресенье в 19:00: оценка и серия, ведёт в итог', async () => {
    const r = (await dueNudges(conn.db, ids.eve!, at(sunday, '19:05'))).list.find(x => x.key === 'review');
    expect(r).toMatchObject({ kind: 'review', url: '/#week' });
    expect(r!.title).toMatch(/^Итог недели готов: \d+%( · серия \d+ (день|дня|дней))?$/);
    expect((await dueNudges(conn.db, ids.eve!, at(sunday, '18:30'))).list.map(x => x.key)).not.toContain('review');
    expect((await dueNudges(conn.db, ids.eve!, at(addDays(sunday, -1), '19:05'))).list.map(x => x.key)).not.toContain('review');
  });
});
