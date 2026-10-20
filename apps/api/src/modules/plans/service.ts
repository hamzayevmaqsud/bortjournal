import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordEvent } from '../../core/events.js';
import { guard, idParam, notFound, uid } from '../../core/http.js';
import type { DayContext } from '../../core/module.js';
import type { DB } from '../../db/index.js';
import { tasks } from './schema.js';

export async function plansToday({ db, userId, day }: DayContext) {
  const ts = await db.select({ id: tasks.id, title: tasks.title, time: tasks.time, done: tasks.done, prio: tasks.prio, seriesId: tasks.seriesId })
    .from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.day, day))).orderBy(asc(tasks.done), sql`${tasks.time} nulls last`, asc(tasks.createdAt));
  return { tasks: ts.map(t => ({ ...t, repeat: !!t.seriesId, seriesId: undefined })) };
}

export async function plansRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = guard(db, 'plans');
  app.post('/tasks/:id/toggle', { preHandler }, async (req, reply) => {
    const id = idParam((req.params as any).id), userId = uid(req);
    const [t] = await db.update(tasks).set({ done: sql`not ${tasks.done}`, doneAt: sql`case when ${tasks.done} then null else now() end` })
      .where(and(eq(tasks.userId, userId), eq(tasks.id, id))).returning();
    if (!t) return notFound(reply);
    if (t.day) await recordEvent(db, { userId, module: 'plans', kind: 'task', refId: t.id, day: t.day, time: t.time, title: t.title, value: t.done ? 1 : 0, unit: 'done' });
    return { id: t.id, done: t.done };
  });
}
