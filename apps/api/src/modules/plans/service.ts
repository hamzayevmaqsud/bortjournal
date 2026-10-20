import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordEvent, removeEvents } from '../../core/events.js';
import { bad, dayParam, guard, hmParam, idParam, notFound, uid } from '../../core/http.js';
import type { DayContext, Nudge } from '../../core/module.js';
import type { DB, Tx } from '../../db/index.js';
import { tasks } from './schema.js';

export async function plansToday({ db, userId, day }: DayContext) {
  const ts = await db.select({ id: tasks.id, title: tasks.title, time: tasks.time, done: tasks.done, prio: tasks.prio, seriesId: tasks.seriesId })
    .from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.day, day))).orderBy(asc(tasks.done), sql`${tasks.time} nulls last`, asc(tasks.createdAt));
  return { tasks: ts.map(t => ({ ...t, repeat: !!t.seriesId, seriesId: undefined })) };
}

const taskBody = (b: Record<string, unknown>) => {
  const title = String(b.title ?? '').trim().slice(0, 200); if (!title) throw bad('Напиши, что нужно сделать.');
  const day = b.day === null || b.day === '' || b.day === undefined ? null : dayParam(b.day);
  return { title, day, time: day ? hmParam(b.time) : null, prio: !!b.prio, note: String(b.note ?? '').trim().slice(0, 2000) || null };
};
const taskEvent = (userId: string, t: typeof tasks.$inferSelect) => ({ userId, module: 'plans' as const, kind: 'task', refId: t.id, day: t.day!, time: t.time, title: t.title, value: t.done ? 1 : 0, unit: 'done' });
const pub = (t: typeof tasks.$inferSelect) => ({ id: t.id, title: t.title, day: t.day, time: t.time, done: t.done, prio: t.prio, note: t.note, repeat: !!t.seriesId });

export async function plansRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = guard(db, 'base');
  // задачи за период + без даты
  app.get('/tasks', { preHandler }, async req => {
    const q = req.query as { from?: string; to?: string }, from = dayParam(q.from), to = dayParam(q.to);
    const rows = await db.select().from(tasks).where(and(eq(tasks.userId, uid(req)), or(and(gte(tasks.day, from), lte(tasks.day, to)), isNull(tasks.day))))
      .orderBy(asc(tasks.day), asc(tasks.done), sql`${tasks.time} nulls last`, asc(tasks.createdAt));
    return { items: rows.map(pub) };
  });
  app.post('/tasks', { preHandler }, async (req, reply) => {
    const v = taskBody((req.body ?? {}) as any), userId = uid(req);
    const [t] = await db.insert(tasks).values({ userId, ...v, createdOn: v.day }).returning();
    if (t!.day) await recordEvent(db, taskEvent(userId, t!));
    return reply.code(201).send(pub(t!));
  });
  app.put('/tasks/:id', { preHandler }, async (req, reply) => {
    const v = taskBody((req.body ?? {}) as any), userId = uid(req), id = idParam((req.params as any).id);
    const [t] = await db.update(tasks).set(v).where(and(eq(tasks.userId, userId), eq(tasks.id, id))).returning();
    if (!t) return notFound(reply);
    if (t.day) await recordEvent(db, taskEvent(userId, t)); else await removeEvents(db, userId, [t.id]);
    return pub(t);
  });
  app.delete('/tasks/:id', { preHandler }, async (req, reply) => {
    const userId = uid(req), id = idParam((req.params as any).id);
    const del = await db.delete(tasks).where(and(eq(tasks.userId, userId), eq(tasks.id, id))).returning({ id: tasks.id });
    if (!del.length) return notFound(reply);
    await removeEvents(db, userId, [id]);
    return { ok: true };
  });
  app.post('/tasks/:id/toggle', { preHandler }, async (req, reply) => {
    const id = idParam((req.params as any).id), userId = uid(req);
    const [t] = await db.update(tasks).set({ done: sql`not ${tasks.done}`, doneAt: sql`case when ${tasks.done} then null else now() end` })
      .where(and(eq(tasks.userId, userId), eq(tasks.id, id))).returning();
    if (!t) return notFound(reply);
    if (t.day) await recordEvent(db, { userId, module: 'plans', kind: 'task', refId: t.id, day: t.day, time: t.time, title: t.title, value: t.done ? 1 : 0, unit: 'done' });
    return { id: t.id, done: t.done };
  });
}

/** задачи с датой по дням: сколько и сколько сделано */
export async function plansDaily(db: Tx, userId: string, from: string, to: string) {
  const rows = await db.select({ day: tasks.day, n: sql<number>`count(*)::int`, d: sql<number>`count(*) filter (where ${tasks.done})::int` }).from(tasks)
    .where(and(eq(tasks.userId, userId), gte(tasks.day, from), lte(tasks.day, to))).groupBy(tasks.day);
  return rows.filter(r => r.day).map(r => ({ day: r.day!, tasks: r.n, tasksDone: r.d }));
}
export async function plansTotals(db: Tx, userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*) filter (where ${tasks.done})::int` }).from(tasks).where(eq(tasks.userId, userId));
  return { tasksDone: r?.n ?? 0 };
}

const hmMin = (s: string | null | undefined) => { const m = /^(\d{1,2}):(\d{2})/.exec(s ?? ''); return m ? +m[1]! * 60 + +m[2]! : null; };
/** задачи со временем: напомнить в это время, если ещё не сделаны */
export async function plansRemind({ db, userId, now }: DayContext & { min: number }): Promise<Nudge[]> {
  const ts = await db.select({ id: tasks.id, title: tasks.title, time: tasks.time }).from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.day, now.day), eq(tasks.done, false)));
  return ts.filter(t => t.time).map(t => ({ key: `tasks:${t.id}`, kind: 'tasks', title: `Задача в ${t.time!.slice(0, 5)}`, body: t.title, url: '/#plans', at: hmMin(t.time)! }));
}
