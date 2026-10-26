import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordEvent, removeEvents } from '../../core/events.js';
import { bad, dayParam, guard, hmParam, idParam, notFound, uid } from '../../core/http.js';
import type { CalendarItem, DayContext, Nudge } from '../../core/module.js';
import type { DB, Tx } from '../../db/index.js';
import { goals, tasks } from './schema.js';
import { goalRoutes, localToday, skipSeriesDay, syncSeries } from './goals.js';
import { captureRoutes, leadOf } from './capture.js';

export async function plansToday({ db, userId, day, now }: DayContext) {
  await syncSeries(db, userId, now.day);
  // на «Сегодня» — задачи верхнего уровня; у задачи с подзадачами — сколько их и сколько сделано
  const ts = await db.select({ id: tasks.id, title: tasks.title, time: tasks.time, done: tasks.done, prio: tasks.prio, seriesId: tasks.seriesId })
    .from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.day, day), isNull(tasks.parentId))).orderBy(asc(tasks.done), sql`${tasks.time} nulls last`, asc(tasks.createdAt));
  const subs = ts.length ? await db.select({ p: tasks.parentId, n: sql<number>`count(*)::int`, d: sql<number>`count(*) filter (where ${tasks.done})::int` })
    .from(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.parentId, ts.map(t => t.id)))).groupBy(tasks.parentId) : [];
  const sub = new Map(subs.map(x => [x.p!, { n: x.n, done: x.d }]));
  return { tasks: ts.map(t => ({ ...t, repeat: !!t.seriesId, seriesId: undefined, sub: sub.get(t.id) ?? null })) };
}

const taskBody = (b: Record<string, unknown>) => {
  const title = String(b.title ?? '').trim().slice(0, 200); if (!title) throw bad('Напиши, что нужно сделать.');
  const day = b.day === null || b.day === '' || b.day === undefined ? null : dayParam(b.day);
  return { title, day, time: day ? hmParam(b.time) : null, prio: !!b.prio, note: String(b.note ?? '').trim().slice(0, 2000) || null };
};
const taskEvent = (userId: string, t: typeof tasks.$inferSelect) => ({ userId, module: 'plans' as const, kind: 'task', refId: t.id, day: t.day!, time: t.time, title: t.title, value: t.done ? 1 : 0, unit: 'done' });
const pub = (t: typeof tasks.$inferSelect) => ({ id: t.id, title: t.title, day: t.day, time: t.time, done: t.done, prio: t.prio, note: t.note, repeat: !!t.seriesId, seriesId: t.seriesId, goalId: t.goalId, parentId: t.parentId });
const MAX_DEPTH = 5;
/** подзадачи: день у всей ветки — как у верхней задачи; события дня, напоминания и календарь — только по верхним задачам */
async function setBranchDay(db: DB | Tx, userId: string, rootId: string, day: string | null) {
  await db.execute(sql`with recursive br as (select id from plan_tasks where parent_id = ${rootId} and user_id = ${userId}
    union all select t.id from plan_tasks t join br on t.parent_id = br.id) update plan_tasks set day = ${day} where id in (select id from br)`);
}
/** родитель сделан, когда сделаны все его подзадачи — и так вверх по ветке */
async function rollUp(db: DB, userId: string, parentId: string | null) {
  for (let id = parentId, k = 0; id && k < MAX_DEPTH + 1; k++) {
    const [c] = await db.select({ n: sql<number>`count(*)::int`, d: sql<number>`count(*) filter (where ${tasks.done})::int` }).from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.parentId, id)));
    if (!c?.n) return;
    const all = c.d === c.n;
    const [p] = await db.update(tasks).set({ done: all, doneAt: all ? sql`coalesce(${tasks.doneAt}, now())` : null })
      .where(and(eq(tasks.userId, userId), eq(tasks.id, id), sql`${tasks.done} <> ${all}`)).returning();
    if (!p) return; // не изменился — выше тоже ничего не меняется
    if (!p.parentId && p.day) await recordEvent(db, taskEvent(userId, p));
    id = p.parentId;
  }
}

export async function plansRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = guard(db, 'base');
  await goalRoutes(app, { db });
  await captureRoutes(app, { db });
  // цель задачи — только своя; без своей цели поле просто сбрасывается
  const goalOf = async (userId: string, v: unknown) => {
    if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) return null;
    const [g] = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.userId, userId), eq(goals.id, v)));
    return g?.id ?? null;
  };
  // задачи за период + без даты
  app.get('/tasks', { preHandler }, async req => {
    const q = req.query as { from?: string; to?: string }, from = dayParam(q.from), to = dayParam(q.to);
    await syncSeries(db, uid(req), await localToday(db, uid(req)));
    const rows = await db.select().from(tasks).where(and(eq(tasks.userId, uid(req)), or(and(gte(tasks.day, from), lte(tasks.day, to)), isNull(tasks.day))))
      .orderBy(asc(tasks.day), asc(tasks.done), sql`${tasks.time} nulls last`, asc(tasks.createdAt));
    return { items: rows.map(pub) };
  });
  app.post('/tasks', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as any, userId = uid(req);
    if (b.parentId) {
      // подзадача: родитель — своя задача, не глубже MAX_DEPTH уровней; день — родителя
      const pid = idParam(b.parentId);
      const [p] = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.id, pid)));
      if (!p) return notFound(reply);
      const [{ depth } = { depth: 0 }] = (await db.execute<{ depth: number }>(sql`with recursive up as (select id, parent_id, 1 as d from plan_tasks where id = ${pid}
        union all select t.id, t.parent_id, up.d + 1 from plan_tasks t join up on t.id = up.parent_id) select max(d)::int as depth from up`)).rows;
      if (depth >= MAX_DEPTH) throw bad(`Подзадачи — не глубже ${MAX_DEPTH} уровней.`);
      const v = taskBody({ ...b, day: p.day });
      const [t] = await db.insert(tasks).values({ userId, ...v, day: p.day, parentId: p.id, createdOn: p.day }).returning();
      if (p.done) await db.update(tasks).set({ done: false, doneAt: null }).where(eq(tasks.id, p.id)).then(() => rollUp(db, userId, p.parentId)); // новая подзадача — родитель снова не сделан
      if (p.done && !p.parentId && p.day) await recordEvent(db, taskEvent(userId, { ...p, done: false }));
      return reply.code(201).send(pub(t!));
    }
    const v = taskBody(b), goalId = await goalOf(userId, b.goalId);
    const [t] = await db.insert(tasks).values({ userId, ...v, goalId, createdOn: v.day }).returning();
    if (t!.day) await recordEvent(db, taskEvent(userId, t!));
    return reply.code(201).send(pub(t!));
  });
  app.put('/tasks/:id', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as any, v = taskBody(b), userId = uid(req), id = idParam((req.params as any).id);
    const [cur] = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.id, id)));
    if (!cur) return notFound(reply);
    // цель меняем, только если её прислали; задача повтора, перенесённая на другой день, выходит из повтора,
    // а её день запоминается как пропущенный — иначе повтор создал бы её снова (и столкнулся бы с другим днём серии)
    if (cur.parentId) v.day = cur.day; // подзадача живёт в дне родителя
    const goalId = cur.parentId ? null : 'goalId' in b ? await goalOf(userId, b.goalId) : cur.goalId;
    const leaves = !!cur.seriesId && cur.day !== v.day;
    if (leaves && cur.day) await skipSeriesDay(db, cur.seriesId!, cur.day);
    const [t] = await db.update(tasks).set({ ...v, goalId, ...(leaves ? { seriesId: null } : {}) }).where(and(eq(tasks.userId, userId), eq(tasks.id, id))).returning();
    if (!t) return notFound(reply);
    if (cur.day !== t.day) await setBranchDay(db, userId, t.id, t.day); // перенесли — подзадачи переезжают вместе
    if (!t.parentId) { if (t.day) await recordEvent(db, taskEvent(userId, t)); else await removeEvents(db, userId, [t.id]); }
    return pub(t);
  });
  app.delete('/tasks/:id', { preHandler }, async (req, reply) => {
    const userId = uid(req), id = idParam((req.params as any).id);
    const del = await db.delete(tasks).where(and(eq(tasks.userId, userId), eq(tasks.id, id))).returning({ id: tasks.id, seriesId: tasks.seriesId, day: tasks.day, parentId: tasks.parentId });
    if (!del.length) return notFound(reply);
    if (del[0]!.seriesId && del[0]!.day) await skipSeriesDay(db, del[0]!.seriesId, del[0]!.day);
    await removeEvents(db, userId, [id]);
    await rollUp(db, userId, del[0]!.parentId); // удалили последнюю несделанную подзадачу — родитель сделан
    return { ok: true };
  });
  app.post('/tasks/:id/toggle', { preHandler }, async (req, reply) => {
    const id = idParam((req.params as any).id), userId = uid(req);
    const [t] = await db.update(tasks).set({ done: sql`not ${tasks.done}`, doneAt: sql`case when ${tasks.done} then null else now() end` })
      .where(and(eq(tasks.userId, userId), eq(tasks.id, id))).returning();
    if (!t) return notFound(reply);
    // сделал задачу — сделаны и все её подзадачи
    if (t.done) await db.execute(sql`with recursive br as (select id from plan_tasks where parent_id = ${t.id} and user_id = ${userId}
      union all select x.id from plan_tasks x join br on x.parent_id = br.id) update plan_tasks set done = true, done_at = coalesce(done_at, now()) where id in (select id from br)`);
    if (!t.parentId && t.day) await recordEvent(db, { userId, module: 'plans', kind: 'task', refId: t.id, day: t.day, time: t.time, title: t.title, value: t.done ? 1 : 0, unit: 'done' });
    await rollUp(db, userId, t.parentId);
    return { id: t.id, done: t.done };
  });
}

/** задачи с датой по дням: сколько и сколько сделано */
export async function plansDaily(db: Tx, userId: string, from: string, to: string) {
  const rows = await db.select({ day: tasks.day, n: sql<number>`count(*)::int`, d: sql<number>`count(*) filter (where ${tasks.done})::int` }).from(tasks)
    .where(and(eq(tasks.userId, userId), gte(tasks.day, from), lte(tasks.day, to), isNull(tasks.parentId))).groupBy(tasks.day);
  return rows.filter(r => r.day).map(r => ({ day: r.day!, tasks: r.n, tasksDone: r.d }));
}
export async function plansTotals(db: Tx, userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*) filter (where ${tasks.done})::int` }).from(tasks).where(and(eq(tasks.userId, userId), isNull(tasks.parentId)));
  return { tasksDone: r?.n ?? 0 };
}

const hmMin = (s: string | null | undefined) => { const m = /^(\d{1,2}):(\d{2})/.exec(s ?? ''); return m ? +m[1]! * 60 + +m[2]! : null; };
/** задачи со временем: напомнить в это время, если ещё не сделаны */
/** задачи со временем: напомнить за N минут (по умолчанию 15, настраивается в «Напоминаниях»), если ещё не сделаны */
export async function plansRemind({ db, userId, now, settings }: DayContext & { min: number }): Promise<Nudge[]> {
  await syncSeries(db, userId, now.day);
  const lead = leadOf(settings);
  const ts = await db.select({ id: tasks.id, title: tasks.title, time: tasks.time }).from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.day, now.day), eq(tasks.done, false), isNull(tasks.parentId)));
  return ts.filter(t => t.time).map(t => ({ key: `tasks:${t.id}`, kind: 'tasks', title: lead ? `Через ${lead} мин: ${t.title}` : `Задача в ${t.time!.slice(0, 5)}`, body: lead ? `В ${t.time!.slice(0, 5)} — ${t.title}` : t.title, url: '/#plans', at: Math.max(0, hmMin(t.time)! - lead) }));
}

/** задачи с датой — в Google Календарь (со временем — на 30 минут, без времени — на весь день) */
export async function plansCalendar(db: Tx, userId: string, from: string, to: string): Promise<CalendarItem[]> {
  const rows = await db.select({ id: tasks.id, title: tasks.title, day: tasks.day, time: tasks.time, done: tasks.done }).from(tasks)
    .where(and(eq(tasks.userId, userId), gte(tasks.day, from), lte(tasks.day, to), isNull(tasks.parentId)));
  return rows.map(t => ({ key: `task:${t.id}`, title: t.title, day: t.day!, time: t.time, minutes: 30, done: t.done }));
}
