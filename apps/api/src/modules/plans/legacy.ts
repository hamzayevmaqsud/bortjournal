/** Перенос планов: цели (со ссылками на родителя), серии повторов, задачи */
import { count, eq, sql } from 'drizzle-orm';
import { recordEvents } from '../../core/events.js';
import { hm, isDay, list, optStr, str, uniqById } from '../../core/legacy.js';
import type { ImportCheck, ImportContext, LegacyState } from '../../core/module.js';
import { upsertByLegacy } from '../../db/upsert.js';
import { goals, taskSeries, tasks } from './schema.js';

const PERIODS = new Set(['week', 'month', 'quarter', 'year']);
const KINDS = new Set(['daily', 'weekdays', 'days', 'weekly', 'monthly']);
const validTasks = (st: LegacyState) => uniqById(list(st.tasks)).filter(t => str(t?.title) && (t.date == null || t.date === '' || isDay(t.date)));

export async function importPlans({ db, userId, warn }: ImportContext, st: LegacyState) {
  const gs = uniqById(list(st.goals)).filter(g => str(g?.title) && PERIODS.has(g.period));
  const goalIds = await upsertByLegacy(db, goals, gs.map(g => ({
    userId, legacyId: String(g.id), period: g.period, periodKey: str(g.key, 20), title: str(g.title, 200), note: optStr(g.note, 2000), done: !!g.done, createdOn: isDay(g.created) ? g.created : null
  })));
  // родитель — вторым проходом: id родителя известен только после вставки
  for (const g of gs) if (g.parentId && goalIds.has(String(g.parentId))) await db.update(goals).set({ parentId: goalIds.get(String(g.parentId))! }).where(eq(goals.id, goalIds.get(String(g.id))!));

  const ss = uniqById(list(st.series)).filter(s => str(s?.title) && KINDS.has(s?.rule?.kind) && isDay(s.start));
  const seriesIds = await upsertByLegacy(db, taskSeries, ss.map(s => ({
    userId, legacyId: String(s.id), title: str(s.title, 200), time: hm(s.time), prio: !!s.prio, goalId: goalIds.get(String(s.goalId)) ?? null, note: optStr(s.note, 2000),
    rule: { kind: s.rule.kind, days: list<number>(s.rule.days).filter(d => Number.isInteger(d) && d >= 0 && d <= 6) }, startOn: s.start, endOn: isDay(s.end) ? s.end : null, skipDays: list<string>(s.skip).filter(isDay)
  })));
  const ts = validTasks(st);
  { const n = uniqById(list(st.tasks)).length - ts.length; if (n) warn(`планы: пропущено задач без названия или с битой датой — ${n}`); }
  const taskIds = await upsertByLegacy(db, tasks, ts.map(t => ({
    userId, legacyId: String(t.id), title: str(t.title, 200), day: isDay(t.date) ? t.date : null, time: hm(t.time), done: !!t.done,
    doneAt: t.done && t.doneAt && !Number.isNaN(Date.parse(t.doneAt)) ? new Date(t.doneAt) : null, prio: !!t.prio,
    goalId: goalIds.get(String(t.goalId)) ?? null, seriesId: seriesIds.get(String(t.seriesId)) ?? null, note: optStr(t.note, 2000), createdOn: isDay(t.created) ? t.created : null
  })));
  await recordEvents(db, ts.filter(t => isDay(t.date)).map(t => ({ userId, module: 'plans' as const, kind: 'task', refId: taskIds.get(String(t.id)), day: t.date, time: hm(t.time), title: str(t.title, 200), value: t.done ? 1 : 0, unit: 'done' })));
}

export async function verifyPlans({ db, userId }: ImportContext, st: LegacyState): Promise<ImportCheck[]> {
  const ts = validTasks(st);
  const [t] = await db.select({ n: count(), done: sql<number>`count(*) filter (where ${tasks.done})::int` }).from(tasks).where(eq(tasks.userId, userId));
  const [g] = await db.select({ n: count() }).from(goals).where(eq(goals.userId, userId));
  const [s] = await db.select({ n: count() }).from(taskSeries).where(eq(taskSeries.userId, userId));
  return [
    { name: 'задач', source: ts.length, db: t!.n },
    { name: 'задач выполнено', source: ts.filter(x => x.done).length, db: Number(t!.done) },
    { name: 'целей', source: list(st.goals).filter(x => str(x?.title) && PERIODS.has(x.period)).length, db: g!.n },
    { name: 'повторов (серий)', source: list(st.series).filter(x => str(x?.title) && KINDS.has(x?.rule?.kind) && isDay(x.start)).length, db: s!.n }
  ];
}
