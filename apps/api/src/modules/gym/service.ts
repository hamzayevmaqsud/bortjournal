import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { weekday } from '@bortjournal/core';
import type { DayContext } from '../../core/module.js';
import type { Tx } from '../../db/index.js';
import { workoutPlans, workouts } from './schema.js';

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
