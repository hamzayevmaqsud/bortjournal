/**
 * Демо без регистрации: временный аккаунт demo-… без пароля на сутки, с Pro и записями за три месяца —
 * чтобы посмотреть журнал живым. «Сохранить как аккаунт» (claim) задаёт логин и пароль и оставляет записи.
 * Просроченные демо удаляются целиком (каскадом) — воркером и при создании нового демо.
 */
import crypto from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { addDays, drinkName, localNow, mondayOf, moneyCat, TRIAL_DAYS, type ModuleName } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { drinks as drinksT, meals as mealsT, userFoods } from '../modules/food/schema.js';
import { bodyDays } from '../modules/body/schema.js';
import { habitChecks, habits } from '../modules/habits/schema.js';
import { goals as goalsT, taskSeries, tasks as tasksT } from '../modules/plans/schema.js';
import { answers, materials, questions, srsCards, studySessions } from '../modules/study/schema.js';
import { chunksOf } from '../modules/study/extract.js';
import { workoutExercises, workoutPlans, workouts, workoutSets } from '../modules/gym/schema.js';
import { budgetEntries, budgets } from '../modules/budget/schema.js';
import { bookQuotes, books, readingLog } from '../modules/books/schema.js';
import { hashPassword, newAccount, removeUserFiles, startSession } from './auth.js';
import { startTrial } from './billing.js';
import { demoData, DEMO_DAYS } from './demo-data.js';
import { activityWeeks, dayJournal, entitlements, events, profiles, users } from './schema.js';
import { review } from './stats.js';

export const DEMO_HOURS = 24;

/** удалить просроченные демо со всеми записями и файлами; возвращает, сколько удалено */
export async function cleanupDemos(db: DB, at = new Date()) {
  const gone = await db.delete(users).where(and(sql`${users.demoUntil} is not null`, lt(users.demoUntil, at))).returning({ id: users.id });
  for (const u of gone) removeUserFiles(u.id);
  return gone.length;
}

/** вставка пачками: одна команда на ~800 строк, без лишних обходов */
async function put(db: Tx, table: PgTable, rows: object[]) {
  for (let i = 0; i < rows.length; i += 800) await db.insert(table).values(rows.slice(i, i + 800) as any);
}
const uuid = () => crypto.randomUUID();

/**
 * Три месяца записей (demo-data.ts) одной транзакцией: каждая таблица — одной-двумя вставками, события ленты —
 * те же, что пишут сервисы модулей (еда, напитки, задачи с датой, занятия, тренировки, деньги). Достижения
 * открываются по ходу истории: статистика пересчитывается на несколько прошлых дат, как если бы человек заходил.
 */
export async function seedDemo(db: Tx, userId: string, tz: number) {
  const now = localNow(tz), D = demoData(userId, now.day, now.hm);
  const ev: Array<typeof events.$inferInsert> = [];
  const E = (module: ModuleName, kind: string, refId: string, day: string, time: string | null, title: string, value: number | null, unit: string, data?: Record<string, unknown>) =>
    ev.push({ userId, module, kind, refId, day, time, title, value, unit, data: data ?? null });

  // еда: приёмы, напитки и «мои блюда» (как remember в addMeal: последний вариант, сколько раз, когда)
  const meals = D.meals.map(m => ({ id: uuid(), userId, ...m }));
  for (const m of meals) E('food', 'meal', m.id, m.day, m.time, m.name, m.kcal, 'kcal');
  const drinks = D.drinks.map(d => ({ id: uuid(), userId, ...d }));
  for (const d of drinks) E('food', 'drink', d.id, d.day, d.time, drinkName(d), d.ml, 'ml', { type: d.type });
  const foods = new Map<string, typeof userFoods.$inferInsert>();
  for (const m of D.meals) {
    const key = m.name.trim().toLowerCase(), prev = foods.get(key);
    foods.set(key, { userId, key, name: m.name, kcal: m.kcal, protein: m.protein, fat: m.fat, carbs: m.carbs, uses: (prev?.uses ?? 0) + 1, lastUsedOn: m.day });
  }
  await put(db, mealsT, meals); await put(db, drinksT, drinks); await put(db, userFoods, [...foods.values()]);
  await put(db, bodyDays, D.body.map(b => ({ userId, ...b })));

  // планы: повторы, цели (подцели ссылаются на родителя), задачи
  const series = D.series.map(s => ({ id: uuid(), userId, ...s }));
  const goals = D.goals.map(g => ({ id: uuid(), userId, period: g.period, periodKey: g.periodKey, title: g.title, done: g.done, createdOn: g.createdOn, parentId: null as string | null }));
  D.goals.forEach((g, i) => { if (g.parent !== undefined) goals[i]!.parentId = goals[g.parent]!.id; });
  const doneAt = (day: string, time: string | null) => new Date(Date.parse(`${day}T${time ?? '20:00'}:00Z`) - tz * 60e3);
  const tasks = D.tasks.map(t => ({
    id: uuid(), userId, title: t.title, day: t.day, time: t.time, done: t.done, prio: t.prio, createdOn: t.createdOn,
    doneAt: t.done && t.day ? doneAt(t.day, t.time) : null, seriesId: t.series === undefined ? null : series[t.series]!.id, goalId: t.goal === undefined ? null : goals[t.goal]!.id
  }));
  for (const t of tasks) if (t.day) E('plans', 'task', t.id, t.day, t.time, t.title, t.done ? 1 : 0, 'done');
  await put(db, taskSeries, series); await put(db, goalsT, goals); await put(db, tasksT, tasks);

  // учёба: занятия; конспект с вопросами (без ИИ), ответы и интервалы повторения
  const sessions = D.sessions.map(s => ({ id: uuid(), userId, ...s }));
  for (const s of sessions) E('study', 'session', s.id, s.day, s.time, s.topic, s.minutes || null, 'min');
  await put(db, studySessions, sessions);
  const parts = Math.max(1, chunksOf(D.material.text).length), matId = uuid();
  await put(db, materials, [{ id: matId, userId, kind: 'text', title: D.material.title, source: null, text: D.material.text, quiz: true, quizStatus: 'ready', quizDone: parts, quizTotal: parts, createdAt: new Date(Date.now() - 45 * 864e5) }]);
  const qIds = D.material.questions.map(() => uuid());
  await put(db, questions, D.material.questions.map((q, i) => ({ id: qIds[i], userId, materialId: matId, chunk: i % parts, ...q })));
  await put(db, answers, D.answers.map(a => ({ userId, questionId: qIds[a.q], day: a.day, correct: a.correct })));
  await put(db, srsCards, D.material.srs.map(s => ({ userId, cardKey: `q:${qIds[s.q]}`, intervalDays: s.interval, ease: s.ease, reps: s.reps, dueOn: s.due, lastOn: s.last })));

  // зал: планы «Верх/Низ», тренировки → упражнения → подходы
  const plans = D.gymPlans.map(p => ({ id: uuid(), userId, ...p }));
  const ws = D.workouts.map(w => ({ id: uuid(), userId, day: w.day, time: w.time, title: w.title, minutes: w.minutes, planId: w.planIdx === null ? null : plans[w.planIdx]!.id }));
  const wex: Array<typeof workoutExercises.$inferInsert> = [], wsets: Array<typeof workoutSets.$inferInsert> = [];
  D.workouts.forEach((w, i) => w.exercises.forEach((e, pos) => {
    const id = uuid(); wex.push({ id, workoutId: ws[i]!.id, position: pos, exerciseKey: e.key, name: e.name });
    e.sets.forEach((s, j) => wsets.push({ workoutExerciseId: id, position: j, ...s }));
  }));
  for (const w of ws) E('gym', 'workout', w.id, w.day, w.time, w.title, w.minutes, 'min');
  await put(db, workoutPlans, plans); await put(db, workouts, ws); await put(db, workoutExercises, wex); await put(db, workoutSets, wsets);
  await put(db, activityWeeks, [{ userId, weekStart: mondayOf(D.first), level: 'light' }]);

  // бюджет: 1500 ₼ в месяц, 200 — в копилку
  await put(db, budgets, [{ userId, amount: 1500, startDay: 1, savings: 200, currency: '₼' }]);
  const money = D.money.map(m => ({ id: uuid(), userId, ...m }));
  for (const m of money) E('budget', 'money', m.id, m.day, m.time, m.note || (moneyCat(m.kind, m.category)[1]), m.kind === 'in' ? m.amount : -m.amount, 'money');
  await put(db, budgetEntries, money);

  // книги: полка, журнал чтения, цитаты
  const bs = D.books.map(b => ({ id: uuid(), userId, ...b }));
  await put(db, books, bs);
  await put(db, readingLog, D.reading.map(r => ({ userId, bookId: bs[r.book]!.id, day: r.day, pages: r.pages })));
  await put(db, bookQuotes, D.quotes.map(q => ({ bookId: bs[q.book]!.id, text: q.text, page: q.page, addedOn: q.book === 0 ? bs[0]!.finishedOn : now.day })));

  // привычки с отметками
  const hs = D.habits.map((h, i) => ({ id: uuid(), userId, ...h, sort: i, createdAt: new Date(Date.now() - 90 * 864e5) }));
  await put(db, habits, hs);
  await put(db, habitChecks, D.checks.map(c => ({ habitId: hs[c.habit]!.id, userId, day: c.day })));
  // «как прошёл день»: настроение и редкие заметки
  await put(db, dayJournal, D.journal.map(j => ({ userId, ...j })));

  await put(db, events, ev);

  // достижения открываются по ходу истории: пересчёт на прошлые даты (каждые две недели) и на сейчас
  for (const back of [76, 62, 48, 34, 20, 6, 0]) await review(db, userId, undefined, Date.now() - back * 864e5);
}

export async function demoRoutes(app: FastifyInstance, { db }: { db: DB }) {
  // не больше 10 демо в час с одного адреса; с самой машины (локальная разработка, проверки) — без лимита:
  // на сервере за прокси (TRUST_PROXY) у посетителя всегда свой адрес, 127.0.0.1 там не бывает
  const made = new Map<string, { n: number; until: number }>();
  const local = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  app.post('/api/auth/demo', { config: { public: true } }, async (req, reply) => {
    const r = made.get(req.ip);
    if (!local(req.ip) && r && r.until > Date.now() && r.n >= 10) return reply.code(429).send({ error: 'Слишком много демо с этого адреса. Попробуй через час.' });
    await cleanupDemos(db);
    const t = Number((req.body as { tz?: unknown } | undefined)?.tz), tz = Number.isInteger(t) && Math.abs(t) <= 840 ? t : 0;
    const username = `demo-${crypto.randomBytes(6).toString('hex')}`;
    const userId = await db.transaction(async tx => {
      const [u] = await tx.insert(users).values({ username, passwordHash: null, tzOffset: tz, demoUntil: new Date(Date.now() + DEMO_HOURS * 3600e3) }).returning({ id: users.id });
      const today = localNow(tz).day;
      await tx.insert(profiles).values({
        userId: u!.id, sex: 'm', age: 29, heightCm: 178, goal: 'lose', pace: 'mid', targetKg: 75, startWeightKg: 81, startedOn: addDays(today, -(DEMO_DAYS - 1)), plannedSteps: 9000,
        settings: { name: 'Гость', kcal: 2100, protein: 130, fat: 70, carbs: 230, steps: 9000, water: 2300, study: 45, booksGoal: 12, sections: ['food', 'water', 'steps', 'tasks', 'gym', 'study', 'budget', 'books'], onboarded: true }
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
