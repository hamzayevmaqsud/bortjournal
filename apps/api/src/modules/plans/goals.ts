/**
 * Цели по периодам и повторяющиеся задачи — набор «Цели и повторы».
 * Прогресс цели — по её задачам и подцелям; если их нет — только ручная отметка.
 * Серия хранит правило; задачи по нему создаются на 14 дней вперёд (одна задача серии в день — уникальный индекс).
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, isDay, isPeriodKey, localNow, PERIOD_KINDS, PERIOD_PARENT, periodRange, REPEAT_KINDS, repeatHits, repeatText, type PeriodKind, type RepeatRule } from '@bortjournal/core';
import { requireUser } from '../../core/auth.js';
import { requirePro } from '../../core/billing.js';
import { recordEvents, removeEvents } from '../../core/events.js';
import { bad, dayParam, hmParam, idParam, notFound, uid } from '../../core/http.js';
import { users } from '../../core/schema.js';
import type { DB, Tx } from '../../db/index.js';
import { goals, taskSeries, tasks } from './schema.js';

const AHEAD = 14;
export const localToday = async (db: Tx, userId: string) => { const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId)); return localNow(u?.tz ?? 0).day; };

/** создать недостающие задачи серий с сегодняшнего дня на 14 дней вперёд */
export async function syncSeries(db: Tx, userId: string, today: string, only?: string) {
  const ss = await db.select().from(taskSeries).where(only ? and(eq(taskSeries.userId, userId), eq(taskSeries.id, only)) : eq(taskSeries.userId, userId));
  if (!ss.length) return 0;
  const rows = ss.flatMap(s => Array.from({ length: AHEAD }, (_, k) => addDays(today, k)).filter(d => repeatHits(s, d))
    .map(d => ({ userId, seriesId: s.id, title: s.title, day: d, time: s.time, prio: s.prio, goalId: s.goalId, note: s.note, createdOn: today })));
  if (!rows.length) return 0;
  const made = await db.insert(tasks).values(rows).onConflictDoNothing().returning();
  if (made.length) await recordEvents(db, made.map(t => ({ userId, module: 'plans' as const, kind: 'task', refId: t.id, day: t.day!, time: t.time, title: t.title, value: 0, unit: 'done' })));
  return made.length;
}

type GoalRow = typeof goals.$inferSelect;
/** все цели пользователя с прогрессом: по задачам и подцелям (до 4 уровней), отметка «сделано» — 100% */
async function withProgress(db: Tx, userId: string) {
  const gs = await db.select().from(goals).where(eq(goals.userId, userId)), today = await localToday(db, userId);
  // считаем задачи до сегодня включительно (и без даты): будущие повторы ещё не наступили и не тянут прогресс вниз
  const tc = await db.select({ g: tasks.goalId, n: sql<number>`count(*)::int`, d: sql<number>`count(*) filter (where ${tasks.done})::int` }).from(tasks)
    .where(and(eq(tasks.userId, userId), sql`${tasks.goalId} is not null`, sql`(${tasks.day} is null or ${tasks.day} <= ${today}::date)`)).groupBy(tasks.goalId);
  const byG = new Map(tc.map(r => [r.g!, r])), kids = new Map<string, GoalRow[]>();
  for (const g of gs) if (g.parentId) kids.set(g.parentId, [...(kids.get(g.parentId) ?? []), g]);
  const memo = new Map<string, number>();
  const pr = (g: GoalRow, depth = 0): number => {
    if (memo.has(g.id)) return memo.get(g.id)!;
    let v = 0;
    if (g.done) v = 100;
    else {
      const t = byG.get(g.id), ks = depth < 4 ? kids.get(g.id) ?? [] : [];
      const parts = [...Array(t?.d ?? 0).fill(100), ...Array((t?.n ?? 0) - (t?.d ?? 0)).fill(0), ...ks.map(k => pr(k, depth + 1))];
      v = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
    }
    memo.set(g.id, v); return v;
  };
  return gs.map(g => ({ id: g.id, period: g.period as PeriodKind, periodKey: g.periodKey, title: g.title, note: g.note, done: g.done, parentId: g.parentId,
    progress: pr(g), tasks: byG.get(g.id)?.n ?? 0, tasksDone: byG.get(g.id)?.d ?? 0, kids: kids.get(g.id)?.length ?? 0 }));
}

const goalBody = (b: Record<string, unknown>) => {
  const title = String(b.title ?? '').trim().slice(0, 200); if (!title) throw bad('Напиши цель.');
  return { title, note: String(b.note ?? '').trim().slice(0, 2000) || null };
};
const ruleOf = (r: unknown): RepeatRule => {
  const x = (r ?? {}) as { kind?: unknown; days?: unknown };
  if (!(REPEAT_KINDS as readonly unknown[]).includes(x.kind)) throw bad('Выбери, как повторять.');
  const days = Array.isArray(x.days) ? [...new Set(x.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  if (x.kind === 'days' && !days.length) throw bad('Выбери дни недели для повтора.');
  return { kind: x.kind as RepeatRule['kind'], days: x.kind === 'days' ? days : [] };
};

export async function goalRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = [requireUser, requirePro(db, 'plans')];
  // своя ли цель — задачам и подцелям можно ссылаться только на свои
  const ownGoal = async (userId: string, id: unknown) => {
    if (id === null || id === undefined || id === '') return null;
    const gid = idParam(id), [g] = await db.select({ id: goals.id, period: goals.period, periodKey: goals.periodKey }).from(goals).where(and(eq(goals.userId, userId), eq(goals.id, gid)));
    if (!g) throw bad('Такой цели нет.');
    return g;
  };

  /** цели, чьи периоды пересекают [from, to] */
  app.get('/goals', { preHandler }, async req => {
    const q = req.query as { from?: string; to?: string }, from = dayParam(q.from), to = dayParam(q.to);
    const all = await withProgress(db, uid(req));
    return { items: all.filter(g => { const [a, b] = periodRange(g.period, g.periodKey); return a <= to && b >= from; }) };
  });
  app.post('/goals', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>, userId = uid(req);
    if (!(PERIOD_KINDS as readonly unknown[]).includes(b.period) || !isPeriodKey(b.period, b.periodKey)) throw bad('Неверный период цели.');
    const parent = await ownGoal(userId, b.parentId);
    if (parent && parent.period !== PERIOD_PARENT[b.period as PeriodKind]) throw bad('Цель можно вложить только в цель следующего периода.');
    const [g] = await db.insert(goals).values({ userId, period: b.period as string, periodKey: b.periodKey as string, ...goalBody(b), parentId: parent?.id ?? null, createdOn: await localToday(db, userId) }).returning();
    return reply.code(201).send({ id: g!.id });
  });
  app.put('/goals/:id', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>, userId = uid(req), id = idParam((req.params as any).id);
    const [cur] = await db.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.id, id)));
    if (!cur) return notFound(reply);
    const parent = 'parentId' in b ? await ownGoal(userId, b.parentId) : undefined;
    if (parent && parent.period !== PERIOD_PARENT[cur.period as PeriodKind]) throw bad('Цель можно вложить только в цель следующего периода.');
    await db.update(goals).set({ ...goalBody(b), ...(parent !== undefined ? { parentId: parent?.id ?? null } : {}) }).where(eq(goals.id, id));
    return { ok: true };
  });
  app.post('/goals/:id/toggle', { preHandler }, async (req, reply) => {
    const [g] = await db.update(goals).set({ done: sql`not ${goals.done}` }).where(and(eq(goals.userId, uid(req)), eq(goals.id, idParam((req.params as any).id)))).returning({ id: goals.id, done: goals.done });
    return g ?? notFound(reply);
  });
  app.delete('/goals/:id', { preHandler }, async (req, reply) => {
    const userId = uid(req), id = idParam((req.params as any).id);
    const del = await db.delete(goals).where(and(eq(goals.userId, userId), eq(goals.id, id))).returning({ id: goals.id });
    if (!del.length) return notFound(reply);
    // подцели и задачи остаются — просто без цели
    await db.update(goals).set({ parentId: null }).where(and(eq(goals.userId, userId), eq(goals.parentId, id)));
    await db.update(tasks).set({ goalId: null }).where(and(eq(tasks.userId, userId), eq(tasks.goalId, id)));
    await db.update(taskSeries).set({ goalId: null }).where(and(eq(taskSeries.userId, userId), eq(taskSeries.goalId, id)));
    return { ok: true };
  });

  /* ---------- повторы ---------- */
  const seriesBody = async (userId: string, b: Record<string, unknown>) => {
    const title = String(b.title ?? '').trim().slice(0, 200); if (!title) throw bad('Напиши, что нужно сделать.');
    return { title, time: hmParam(b.time), prio: !!b.prio, note: String(b.note ?? '').trim().slice(0, 2000) || null, goalId: (await ownGoal(userId, b.goalId))?.id ?? null, rule: ruleOf(b.rule) };
  };
  const pubSeries = (s: typeof taskSeries.$inferSelect) => ({ id: s.id, title: s.title, time: s.time, prio: s.prio, note: s.note, goalId: s.goalId, rule: s.rule, startOn: s.startOn, text: repeatText(s) });
  app.get('/series/:id', { preHandler }, async (req, reply) => {
    const [s] = await db.select().from(taskSeries).where(and(eq(taskSeries.userId, uid(req)), eq(taskSeries.id, idParam((req.params as any).id))));
    return s ? pubSeries(s) : notFound(reply);
  });
  app.post('/series', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>, userId = uid(req), today = await localToday(db, userId);
    const startOn = isDay(b.startOn) && b.startOn >= today ? b.startOn : today;
    const [s] = await db.insert(taskSeries).values({ userId, ...(await seriesBody(userId, b)), startOn }).returning();
    const made = await syncSeries(db, userId, today, s!.id);
    return reply.code(201).send({ ...pubSeries(s!), made });
  });
  // правка серии меняет все будущие несделанные задачи: удаляем их и создаём заново по новому правилу
  app.put('/series/:id', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>, userId = uid(req), id = idParam((req.params as any).id), today = await localToday(db, userId);
    const v = await seriesBody(userId, b);
    const [s] = await db.update(taskSeries).set(v).where(and(eq(taskSeries.userId, userId), eq(taskSeries.id, id))).returning();
    if (!s) return notFound(reply);
    const gone = await db.delete(tasks).where(and(eq(tasks.userId, userId), eq(tasks.seriesId, id), eq(tasks.done, false), gte(tasks.day, today))).returning({ id: tasks.id });
    if (gone.length) await removeEvents(db, userId, gone.map(x => x.id));
    await syncSeries(db, userId, today, id);
    return pubSeries(s);
  });
  // удалить повтор: будущие несделанные задачи уходят, сделанные остаются в истории
  app.delete('/series/:id', { preHandler }, async (req, reply) => {
    const userId = uid(req), id = idParam((req.params as any).id), today = await localToday(db, userId);
    const gone = await db.delete(tasks).where(and(eq(tasks.userId, userId), eq(tasks.seriesId, id), eq(tasks.done, false), gte(tasks.day, today))).returning({ id: tasks.id });
    if (gone.length) await removeEvents(db, userId, gone.map(x => x.id));
    const del = await db.delete(taskSeries).where(and(eq(taskSeries.userId, userId), eq(taskSeries.id, id))).returning({ id: taskSeries.id });
    return del.length ? { ok: true, removed: gone.length } : notFound(reply);
  });
}

/** задача серии удалена по одной — запомнить день, чтобы повтор её не вернул */
export async function skipSeriesDay(db: Tx, seriesId: string, day: string) {
  await db.update(taskSeries).set({ skipDays: sql`array_append(${taskSeries.skipDays}, ${day}::date)` }).where(and(eq(taskSeries.id, seriesId), sql`not (${day}::date = any(${taskSeries.skipDays}))`));
}
