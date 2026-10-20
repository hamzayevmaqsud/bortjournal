import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';
import type { DayContext } from '../../core/module.js';
import type { Tx } from '../../db/index.js';
import { bodyDays } from './schema.js';

export async function bodyToday({ db, userId, day, settings, profile }: DayContext) {
  const [d] = await db.select().from(bodyDays).where(and(eq(bodyDays.userId, userId), eq(bodyDays.day, day)));
  const [w] = await db.select({ day: bodyDays.day, kg: bodyDays.weightKg }).from(bodyDays)
    .where(and(eq(bodyDays.userId, userId), lte(bodyDays.day, day), isNotNull(bodyDays.weightKg))).orderBy(desc(bodyDays.day)).limit(1);
  return {
    steps: d?.steps ?? 0, stepsGoal: Number(settings.steps) || 8000,
    weight: w ? { kg: w.kg, day: w.day, today: w.day === day } : profile?.startWeightKg ? { kg: profile.startWeightKg, day: null, today: false } : null
  };
}

/** вес и/или шаги за день; null — стереть значение, undefined — не трогать */
export async function setBodyDay(db: Tx, userId: string, day: string, v: { weightKg?: number | null; steps?: number | null }) {
  const set: Record<string, unknown> = {};
  if (v.weightKg !== undefined) set.weightKg = v.weightKg;
  if (v.steps !== undefined) set.steps = v.steps;
  if (!Object.keys(set).length) return;
  await db.insert(bodyDays).values({ userId, day, ...set }).onConflictDoUpdate({ target: [bodyDays.userId, bodyDays.day], set });
}
