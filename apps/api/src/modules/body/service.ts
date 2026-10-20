import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';
import type { DayContext } from '../../core/module.js';
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
