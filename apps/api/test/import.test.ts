/**
 * Перенос из старого журнала на наборе с подвохами: дубли, битые даты, нулевые суммы,
 * свой напиток, подходы, цитаты, повторы задач, вложенные цели. Сверка должна сойтись,
 * повторный запуск — ничего не менять.
 */
import { count, eq, sql } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasModule } from '../src/core/entitlements.js';
import { importLegacy } from '../src/core/legacy-import.js';
import * as s from '../src/schema.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bj-import-'));

const state = {
  settings: { kcal: 2100, protein: 150, steps: 8000, study: 45, name: 'Тест', booksGoal: 10 },
  profile: { sex: 'm', age: 31, height: 180, goal: 'lose', pace: 'mid', target: 95, weight: 107, start: '2026-09-01', ageDate: '2026-09-01' },
  activity: { '2026-10-12': 'mod' },
  meals: [
    { id: 'm1', date: '2026-10-12', time: '9:05', name: 'Овсянка', kcal: 350, p: 12, f: 7, c: 60, slot: 'breakfast' },
    { id: 'm2', date: '2026-10-12', time: '13:00', name: 'Плов', kcal: 600.5, p: 21, f: 30, c: 63, fi: 2, su: 3, sa: 1.2 },
    { id: 'm2', date: '2026-10-12', time: '13:00', name: 'Плов (исправлено)', kcal: 650, p: 22, f: 31, c: 65 },
    { id: 'm3', date: 'вчера', name: 'Битая дата', kcal: 100 },
    { id: 'm4', date: '2026-10-13', name: '', kcal: 50 }
  ],
  drinks: [
    { id: 'd1', date: '2026-10-12', time: '10:00', type: 'water', ml: 250 },
    { id: 'd2', date: '2026-10-12', time: '11:00', type: 'custom', ml: 330, name: 'Лимонад', kcal100: 40, sugar100: 9 },
    { id: 'd3', date: '2026-10-12', type: 'water', ml: 0 }
  ],
  foods: { 'овсянка': { name: 'Овсянка', kcal: 350, p: 12, f: 7, c: 60, count: 5, last: '2026-10-12' } },
  workouts: [
    { id: 'w1', date: '2026-10-12', time: '19:00', type: 'Грудь', minutes: 60, note: '', exercises: [
      { ex: 'bench', name: 'Жим штанги лёжа', sets: [{ kg: 60, reps: 8 }, { kg: 62.5, reps: 6 }] },
      { name: 'Подтягивания', sets: [{ kg: 0, reps: 10 }] },
      { ex: 'treadmill', name: 'Беговая дорожка', sets: [{ min: 20, km: 3.2 }] },
      { ex: 'plank', name: 'Планка', sets: [{ sec: 75 }] }
    ] }
  ],
  gymPlans: [{ id: 'p1', name: 'Грудь', days: [1, 4, 9], time: '19:00', ex: [{ ex: 'bench', name: 'Жим', n: 3 }] }],
  study: [{ id: 's1', date: '2026-10-12', time: '20:00', topic: 'Kubernetes', category: 'DevOps', minutes: 45, notes: ['Pod — минимальная единица'], qa: [{ q: 'Что такое Pod?', a: 'Группа контейнеров' }] }],
  srs: { 's1:t1': { interval: 2, ease: 2.5, reps: 1, due: '2026-10-14', last: '2026-10-12' } },
  quizzes: { '2026-10-12': { items: [{ cardId: 's1:t1', q: 'Что такое Pod?', a: '…', result: 'good' }], source: 'local' } },
  studyTime: { 'note-a': 30, 'note-b': { m: 15, d: '2026-10-12' } },
  budget: { amount: 1500, start: 1, save: 100, cur: '₼' },
  money: [
    { id: 'x1', date: '2026-10-12', time: '12:00', kind: 'out', cat: 'food', amount: 12.35, note: 'Обед' },
    { id: 'x2', date: '2026-10-12', kind: 'out', cat: 'cafe', amount: 0.1 + 0.2 },
    { id: 'x3', date: '2026-10-12', kind: 'in', cat: 'salary', amount: 1000 },
    { id: 'x4', date: '2026-10-12', kind: 'out', cat: 'food', amount: 0 }
  ],
  books: [{ id: 'b1', title: 'Атомные привычки', author: 'Клир', pages: 320, page: 180, status: 'reading', format: 'paper', owned: true, rating: 4, cover: { ol: 123, isbn: ['0735211299', 'bad'] }, added: '2026-09-01', started: '2026-09-02', quotes: [{ id: 'q1', text: 'Системы важнее целей', page: '27', date: '2026-09-10' }] }],
  readLog: [{ id: 'r1', date: '2026-10-12', book: 'b1', pages: 25 }, { id: 'r2', date: '2026-10-12', book: 'нет такой', pages: 10 }],
  goals: [{ id: 'g1', period: 'month', key: '2026-10', title: 'Похудеть на 2 кг', done: false, parentId: null }, { id: 'g2', period: 'week', key: '2026-W42', title: 'Три тренировки', done: true, parentId: 'g1' }],
  series: [{ id: 'r1x', title: 'Зарядка', time: '07:00', rule: { kind: 'weekdays', days: [] }, start: '2026-10-12', skip: ['2026-10-13'] }],
  tasks: [
    { id: 't1', title: 'Позвонить', date: '2026-10-12', time: '16:00', done: true, doneAt: '2026-10-12T12:00:00Z', prio: true, goalId: 'g2' },
    { id: 'r1x:2026-10-12', seriesId: 'r1x', title: 'Зарядка', date: '2026-10-12', done: false },
    { id: 't3', title: 'Без даты', date: null },
    { id: 't4', title: 'Битая дата', date: '12.10.2026' }
  ],
  days: { '2026-10-12': { weight: 106.4, steps: 9000, note: 'Хороший день', mood: 4 }, '2026-10-13': { weight: 5, steps: -3 }, '2026-10-14': { mood: 9 } },
  achieved: { 'streak:0': '2026-10-12', 'food:1': '2026-10-12', 'bad': 'x' },
  gymLive: null
};

beforeAll(async () => {
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ test: { salt: 'a'.repeat(32), hash: 'b'.repeat(128), created: '2026-09-01T00:00:00Z' } }));
  fs.writeFileSync(path.join(dir, 'state', 'test.json'), JSON.stringify({ rev: 1, state }));
  fs.writeFileSync(path.join(dir, 'push.json'), JSON.stringify({ test: { tz: 240, subs: [{ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }] } }));
  conn = await freshDb();
}, 60000);
afterAll(async () => { await conn?.pool.end(); fs.rmSync(dir, { recursive: true, force: true }); });

const tableCounts = async () => {
  const out: Record<string, number> = {};
  for (const [name, t] of Object.entries({ meals: s.meals, drinks: s.drinks, events: s.events, sets: s.workoutSets, exercises: s.workoutExercises, quotes: s.bookQuotes, entitlements: s.entitlements, tasks: s.tasks, journal: s.dayJournal, body: s.bodyDays, ach: s.achievements, push: s.pushSubscriptions }))
    out[name] = (await conn.db.select({ n: count() }).from(t as any))[0]!.n;
  return out;
};

describe('перенос из старого журнала', () => {
  let first: Record<string, number>;
  it('переносит всё и сверка сходится', async () => {
    const [r] = await importLegacy(conn.db, dir);
    expect(r?.warnings.join('\n')).toContain('meals: в старом журнале 1 повторов');
    for (const c of r!.checks) expect({ name: c.name, db: c.db }).toEqual({ name: c.name, db: c.source });
    expect(r!.ok).toBe(true);
    first = await tableCounts();
    expect(first).toMatchObject({ meals: 2, drinks: 2, sets: 5, exercises: 4, quotes: 1, entitlements: 8, tasks: 3, journal: 1, body: 1, ach: 2, push: 1 });
  });
  it('берёт последнюю версию дубля и сохраняет null там, где данных нет', async () => {
    const [plov] = await conn.db.select().from(s.meals).where(eq(s.meals.legacyId, 'm2'));
    expect(plov).toMatchObject({ name: 'Плов (исправлено)', kcal: 650, fiber: null, time: '13:00' });
    const [oat] = await conn.db.select().from(s.meals).where(eq(s.meals.legacyId, 'm1'));
    expect(oat?.time).toBe('09:05');
  });
  it('деньги — точно, без ошибок float', async () => {
    const [x] = await conn.db.select({ total: sql<string>`sum(${s.budgetEntries.amount})` }).from(s.budgetEntries).where(eq(s.budgetEntries.kind, 'out'));
    expect(Number(x!.total)).toBe(12.65);
  });
  it('связи: цель-родитель, повтор задачи, книга у цитаты; лишние дни недели отброшены', async () => {
    const gs = await conn.db.select().from(s.goals);
    const parent = gs.find(g => g.legacyId === 'g1')!, child = gs.find(g => g.legacyId === 'g2')!;
    expect(child.parentId).toBe(parent.id);
    const [t] = await conn.db.select().from(s.tasks).where(eq(s.tasks.legacyId, 'r1x:2026-10-12'));
    expect(t?.seriesId).toBeTruthy();
    const [plan] = await conn.db.select().from(s.workoutPlans);
    expect(plan?.weekdays).toEqual([1, 4]);
    const [b] = await conn.db.select().from(s.books);
    expect(b?.coverIsbn).toEqual(['0735211299']);
  });
  it('пароль, часовой пояс и бесплатный доступ ко всем модулям', async () => {
    const [u] = await conn.db.select().from(s.users);
    expect(u?.passwordHash).toBe(`scrypt$16384$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`);
    expect(u?.tzOffset).toBe(240);
    expect(await hasModule(conn.db, u!.id, 'books')).toBe(true);
    expect(await hasModule(conn.db, u!.id, 'pro')).toBe(true); // владелец из старого журнала — Pro навсегда
  });
  it('повторный перенос ничего не задваивает', async () => {
    const [r] = await importLegacy(conn.db, dir);
    expect(r!.ok).toBe(true);
    expect(await tableCounts()).toEqual(first);
  });
});

describe('доступ к модулям', () => {
  it('истёкший доступ не работает, бессрочный — работает', async () => {
    const [u] = await conn.db.select().from(s.users);
    await conn.db.delete(s.entitlements).where(eq(s.entitlements.module, 'gym'));
    await conn.db.insert(s.entitlements).values({ userId: u!.id, module: 'gym', source: 'trial', expiresAt: new Date(Date.now() - 1000) });
    expect(await hasModule(conn.db, u!.id, 'gym')).toBe(false);
    await conn.db.insert(s.entitlements).values({ userId: u!.id, module: 'gym', source: 'web', expiresAt: null });
    expect(await hasModule(conn.db, u!.id, 'gym')).toBe(true);
  });
});
