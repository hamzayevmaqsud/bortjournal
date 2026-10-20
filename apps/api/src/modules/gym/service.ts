import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { weekday } from '@bortjournal/core';
import type { DayContext, Nudge } from '../../core/module.js';
import type { Tx } from '../../db/index.js';
import { liveWorkouts, workoutPlans, workouts } from './schema.js';

export async function gymToday({ db, userId, day }: DayContext) {
  const ws = await db.select({ id: workouts.id, title: workouts.title, time: workouts.time, minutes: workouts.minutes }).from(workouts).where(and(eq(workouts.userId, userId), eq(workouts.day, day)));
  const plans = await db.select().from(workoutPlans).where(and(eq(workoutPlans.userId, userId), sql`${weekday(day)} = any(${workoutPlans.weekdays})`));
  const plan = plans[0];
  return { workouts: ws, plan: plan ? { id: plan.id, name: plan.name, time: plan.time, exercises: plan.exercises.length } : null };
}

/** тренировки по дням */
export async function gymDaily(db: Tx, userId: string, from: string, to: string) {
  const rows = await db.select({ day: workouts.day, n: sql<number>`count(*)::int`, m: sql<number>`coalesce(sum(${workouts.minutes}), 0)::int` }).from(workouts)
    .where(and(eq(workouts.userId, userId), gte(workouts.day, from), lte(workouts.day, to))).groupBy(workouts.day);
  return rows.map(r => ({ day: r.day, workouts: r.n, gymMin: r.m }));
}

const hmMin = (s: string | null | undefined) => { const m = /^(\d{1,2}):(\d{2})/.exec(s ?? ''); return m ? +m[1]! * 60 + +m[2]! : null; };
const plural = (n: number, a: string, b: string, c: string) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c; };
/** тренировка по плану на сегодня: ещё не было и не идёт прямо сейчас */
export async function gymRemind({ db, userId, now }: DayContext & { min: number }): Promise<Nudge[]> {
  const t = await gymToday({ db, userId, day: now.day } as DayContext);
  if (t.workouts.length || !t.plan) return [];
  const [live] = await db.select({ u: liveWorkouts.userId }).from(liveWorkouts).where(eq(liveWorkouts.userId, userId));
  if (live) return [];
  const n = t.plan.exercises;
  return [{ key: `gym:${t.plan.id}`, kind: 'gym', title: `Сегодня тренировка: ${t.plan.name}`, body: `${n} ${plural(n, 'упражнение', 'упражнения', 'упражнений')} — открой и начни, веса подскажу.`, url: '/#gym', at: hmMin(t.plan.time) ?? 19 * 60 }];
}
