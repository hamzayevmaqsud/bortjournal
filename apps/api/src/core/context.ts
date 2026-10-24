/** «Сегодня» человека и его нормы — общее для ядра и модулей (статистика, анализ еды) */
import { eq } from 'drizzle-orm';
import { localNow, waterNorm } from '@bortjournal/core';
import type { Tx } from '../db/index.js';
import { profiles, users } from './schema.js';

export interface Norms { kcal: number; protein: number; fat: number; carbs: number; water: number; steps: number; study: number }
export async function userContext(db: Tx, userId: string, at?: number) {
  const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
  const today = localNow(u?.tz ?? 0, at).day;
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  const s = (p?.settings ?? {}) as Record<string, unknown>;
  const kcal = Number(s.kcal) || 2200, protein = Number(s.protein) || Math.round(kcal * 0.25 / 4);
  const fat = Number(s.fat) || Math.round(kcal * 0.28 / 9), carbs = Number(s.carbs) || Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const norms: Norms = { kcal, protein, fat, carbs, water: Number(s.water) || waterNorm(p?.sex, null), steps: Number(s.steps) || 10000, study: Number(s.study) || 60 };
  return { today, norms, goal: p?.goal ?? null, sex: p?.sex ?? null };
}
