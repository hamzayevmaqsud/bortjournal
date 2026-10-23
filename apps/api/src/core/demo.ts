/**
 * Демо без регистрации: временный аккаунт demo-… без пароля на сутки, с Pro и записями за три дня —
 * чтобы посмотреть журнал живым. «Сохранить как аккаунт» (claim) задаёт логин и пароль и оставляет записи.
 * Просроченные демо удаляются целиком (каскадом) — воркером и при создании нового демо.
 */
import crypto from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, localNow, TRIAL_DAYS } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { addDrink, addMeal } from '../modules/food/service.js';
import { setBodyDay } from '../modules/body/service.js';
import { tasks } from '../modules/plans/schema.js';
import { studySessions } from '../modules/study/schema.js';
import { books, readingLog } from '../modules/books/schema.js';
import { hashPassword, newAccount, removeUserFiles, startSession } from './auth.js';
import { startTrial } from './billing.js';
import { recordEvents } from './events.js';
import { entitlements, profiles, users } from './schema.js';

export const DEMO_HOURS = 24;

/** удалить просроченные демо со всеми записями и файлами; возвращает, сколько удалено */
export async function cleanupDemos(db: DB, at = new Date()) {
  const gone = await db.delete(users).where(and(sql`${users.demoUntil} is not null`, lt(users.demoUntil, at))).returning({ id: users.id });
  for (const u of gone) removeUserFiles(u.id);
  return gone.length;
}

const MEALS = [
  { time: '08:10', slot: 'breakfast', name: 'Овсянка с бананом и орехами', kcal: 420, protein: 14, fat: 12, carbs: 64 },
  { time: '13:20', slot: 'lunch', name: 'Курица с рисом и салатом', kcal: 610, protein: 48, fat: 14, carbs: 70 },
  { time: '16:30', slot: 'snack', name: 'Греческий йогурт с ягодами', kcal: 180, protein: 15, fat: 4, carbs: 20 },
  { time: '19:40', slot: 'dinner', name: 'Лосось с овощами на гриле', kcal: 540, protein: 38, fat: 28, carbs: 22 }
];
const MEALS_B = [
  { time: '08:30', slot: 'breakfast', name: 'Омлет из трёх яиц с тостом', kcal: 450, protein: 26, fat: 28, carbs: 22 },
  { time: '13:00', slot: 'lunch', name: 'Борщ со сметаной и хлебом', kcal: 480, protein: 18, fat: 18, carbs: 58 },
  { time: '19:15', slot: 'dinner', name: 'Гречка с говядиной', kcal: 620, protein: 42, fat: 20, carbs: 64 }
];
const DRINKS = [
  { time: '08:20', type: 'water', ml: 300 }, { time: '09:00', type: 'latte', ml: 250 }, { time: '11:30', type: 'water', ml: 500 },
  { time: '15:00', type: 'water', ml: 500 }, { time: '17:30', type: 'tea', ml: 250 }, { time: '20:30', type: 'water', ml: 330 }
];

/** записи за сегодня и два прошлых дня; сегодня — только то, что уже «случилось» к текущему времени */
export async function seedDemo(db: Tx, userId: string, tz: number) {
  const now = localNow(tz), today = now.day, d1 = addDays(today, -1), d2 = addDays(today, -2);
  const past = (day: string, time: string) => day < today || time <= now.hm;

  for (const [day, list] of [[d2, MEALS_B], [d1, MEALS], [today, MEALS]] as const)
    for (const m of list) if (past(day, m.time)) await addMeal(db, userId, { day, ...m });
  for (const day of [d2, d1, today])
    for (const d of DRINKS) if (past(day, d.time) && (day !== d2 || d.type === 'water')) await addDrink(db, userId, { day, ...d });

  // вес по неделям — для цели и графика; шаги: сегодня — сколько успел к этому часу
  const weights: Array<[number, number]> = [[-21, 79.2], [-17, 78.8], [-14, 78.5], [-10, 78.1], [-7, 77.8], [-4, 77.6], [-1, 77.3]];
  for (const [n, kg] of weights) await setBodyDay(db, userId, addDays(today, n), { weightKg: kg });
  await setBodyDay(db, userId, d2, { steps: 7310 });
  await setBodyDay(db, userId, d1, { steps: 10240 });
  const stepsNow = Math.round(Math.min(1, Math.max(0, (now.minutes - 7 * 60) / (14 * 60))) * 9000);
  if (stepsNow > 0) await setBodyDay(db, userId, today, { steps: stepsNow });

  const T = [
    { day: d1, time: null, title: 'Записаться к стоматологу', done: true, prio: false },
    { day: d1, time: '18:30', title: 'Пробежка 5 км', done: true, prio: false },
    { day: today, time: null, title: 'Оплатить интернет', done: true, prio: false },
    { day: today, time: null, title: 'Купить продукты на неделю', done: false, prio: true },
    { day: today, time: '18:00', title: 'Позвонить маме', done: false, prio: false },
    { day: today, time: '21:30', title: 'Прочитать 20 страниц', done: false, prio: false },
    { day: null, time: null, title: 'Разобрать фото с отпуска', done: false, prio: false }
  ];
  const ts = await db.insert(tasks).values(T.map(t => ({ userId, ...t, createdOn: t.day ?? today, doneAt: t.done ? new Date() : null }))).returning();
  await recordEvents(db, ts.filter(t => t.day).map(t => ({ userId, module: 'plans' as const, kind: 'task', refId: t.id, day: t.day!, time: t.time, title: t.title, value: t.done ? 1 : 0, unit: 'done' })));

  const S = [
    { day: d2, time: '20:00', topic: 'SQL: оконные функции', category: 'Программирование', minutes: 45, theses: ['ROW_NUMBER нумерует строки внутри окна', 'PARTITION BY делит строки на группы, не схлопывая их'] },
    { day: d1, time: '19:30', topic: 'Английский: Present Perfect', category: 'Языки', minutes: 30, theses: ['Present Perfect — результат к настоящему моменту', 'since — с какого момента, for — сколько времени'] },
    { day: today, time: '07:45', topic: 'Английский: фразовые глаголы', category: 'Языки', minutes: 25, theses: ['give up — бросить, сдаться', 'look after — присматривать за кем-то'] }
  ].filter(s => past(s.day, s.time));
  if (S.length) {
    const ss = await db.insert(studySessions).values(S.map(s => ({ userId, ...s }))).returning();
    await recordEvents(db, ss.map(s => ({ userId, module: 'study' as const, kind: 'session', refId: s.id, day: s.day, time: s.time, title: s.topic, value: s.minutes || null, unit: 'min' })));
  }

  const [b] = await db.insert(books).values([
    { userId, title: 'Атомные привычки', author: 'Джеймс Клир', pages: 320, currentPage: 142, status: 'reading', genre: 'Саморазвитие', addedOn: addDays(today, -12), startedOn: addDays(today, -10) },
    { userId, title: 'Думай медленно… решай быстро', author: 'Даниэль Канеман', pages: 656, status: 'want', addedOn: addDays(today, -5) },
    { userId, title: 'Мастер и Маргарита', author: 'Михаил Булгаков', pages: 480, currentPage: 480, status: 'done', rating: 5, addedOn: addDays(today, -60), startedOn: addDays(today, -45), finishedOn: addDays(today, -20) }
  ]).returning();
  await db.insert(readingLog).values([[-6, 22], [-4, 18], [-3, 30], [-2, 24], [-1, 28]].map(([n, pages]) => ({ userId, bookId: b!.id, day: addDays(today, n!), pages: pages! })));
}

export async function demoRoutes(app: FastifyInstance, { db }: { db: DB }) {
  // не больше 10 демо в час с одного адреса
  const made = new Map<string, { n: number; until: number }>();
  app.post('/api/auth/demo', { config: { public: true } }, async (req, reply) => {
    const r = made.get(req.ip);
    if (r && r.until > Date.now() && r.n >= 10) return reply.code(429).send({ error: 'Слишком много демо с этого адреса. Попробуй через час.' });
    await cleanupDemos(db);
    const t = Number((req.body as { tz?: unknown } | undefined)?.tz), tz = Number.isInteger(t) && Math.abs(t) <= 840 ? t : 0;
    const username = `demo-${crypto.randomBytes(6).toString('hex')}`;
    const userId = await db.transaction(async tx => {
      const [u] = await tx.insert(users).values({ username, passwordHash: null, tzOffset: tz, demoUntil: new Date(Date.now() + DEMO_HOURS * 3600e3) }).returning({ id: users.id });
      const today = localNow(tz).day;
      await tx.insert(profiles).values({
        userId: u!.id, sex: 'm', age: 29, heightCm: 178, goal: 'lose', pace: 'mid', targetKg: 74, startWeightKg: 79.2, startedOn: addDays(today, -21), plannedSteps: 9000,
        settings: { name: 'Гость', kcal: 2100, protein: 130, fat: 70, carbs: 230, steps: 9000, water: 2300, study: 45, booksGoal: 12, sections: ['food', 'water', 'steps', 'tasks', 'study', 'books'], onboarded: true }
      });
      await startTrial(tx, u!.id);
      await seedDemo(tx, u!.id, tz);
      return u!.id;
    });
    made.set(req.ip, r && r.until > Date.now() ? { n: r.n + 1, until: r.until } : { n: 1, until: Date.now() + 3600e3 });
    await startSession(db, req, reply, userId);
    return reply.code(201).send({ username });
  });

  // сохранить демо как аккаунт: логин (или почта), пароль, почта обязательна; записи остаются, пробный Pro — 7 дней с этого момента
  app.post('/api/auth/claim', async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    const [me] = await db.select({ demo: users.demoUntil }).from(users).where(eq(users.id, req.userId));
    if (!me?.demo) return reply.code(409).send({ error: 'Это уже настоящий аккаунт.' });
    const acc = await newAccount(db, (req.body ?? {}) as Record<string, unknown>, req.userId);
    if ('error' in acc) return reply.code(acc.status).send({ error: acc.error });
    const passwordHash = await hashPassword(acc.password);
    try {
      await db.transaction(async tx => {
        await tx.update(users).set({ username: acc.username, email: acc.email || null, passwordHash, demoUntil: null, createdAt: new Date() }).where(eq(users.id, req.userId!));
        await tx.update(entitlements).set({ expiresAt: new Date(Date.now() + TRIAL_DAYS * 864e5) }).where(and(eq(entitlements.userId, req.userId!), eq(entitlements.module, 'pro'), eq(entitlements.source, 'trial')));
      });
    } catch (e) {
      // тот же логин заняли одновременно — уникальный индекс
      if (((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505') return reply.code(409).send({ error: 'Такой логин или почта уже заняты.' });
      throw e;
    }
    return { username: acc.username };
  });
}
