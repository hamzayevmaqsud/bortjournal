/** Еда: сводка дня и записи. Напитки с калориями считаются и в еде, и в воде */
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { drinkName, drinkTotals, waterNorm } from '@bortjournal/core';
import { recordEvent, removeEvents } from '../../core/events.js';
import type { DayContext } from '../../core/module.js';
import type { Tx } from '../../db/index.js';
import { drinks, meals, userFoods } from './schema.js';

export async function dayFood(db: Tx, userId: string, day: string) {
  const ms = await db.select().from(meals).where(and(eq(meals.userId, userId), eq(meals.day, day))).orderBy(sql`${meals.time} nulls last`, asc(meals.createdAt));
  const ds = await db.select().from(drinks).where(and(eq(drinks.userId, userId), eq(drinks.day, day))).orderBy(sql`${drinks.time} nulls last`, asc(drinks.createdAt));
  const dt = ds.map(d => ({ ...d, title: drinkName(d), ...drinkTotals(d) }));
  const totals = {
    kcal: Math.round(ms.reduce((a, m) => a + m.kcal, 0) + dt.reduce((a, d) => a + d.kcal, 0)),
    protein: ms.reduce((a, m) => a + m.protein, 0) + dt.reduce((a, d) => a + d.p, 0),
    fat: ms.reduce((a, m) => a + m.fat, 0) + dt.reduce((a, d) => a + d.f, 0),
    carbs: ms.reduce((a, m) => a + m.carbs, 0) + dt.reduce((a, d) => a + d.c, 0),
    waterMl: Math.round(dt.reduce((a, d) => a + d.hyd, 0))
  };
  return { meals: ms, drinks: dt, totals };
}

export async function foodToday({ db, userId, day, profile, settings }: DayContext) {
  const { totals } = await dayFood(db, userId, day);
  return { ...totals, norm: { kcal: Number(settings.kcal) || 2200, protein: Number(settings.protein) || 0, fat: Number(settings.fat) || 0, carbs: Number(settings.carbs) || 0, water: Number(settings.water) || waterNorm(profile?.sex, null) } };
}

export async function addDrink(db: Tx, userId: string, v: { day: string; time: string | null; type: string; ml: number; name?: string | null; kcalPer100?: number | null; sugarPer100?: number | null }) {
  const [d] = await db.insert(drinks).values({ userId, ...v }).returning();
  await recordEvent(db, { userId, module: 'food', kind: 'drink', refId: d!.id, day: d!.day, time: d!.time, title: drinkName(d!), value: d!.ml, unit: 'ml', data: { type: d!.type } });
  return d!;
}

export async function deleteEntry(db: Tx, userId: string, id: string) {
  const m = await db.delete(meals).where(and(eq(meals.userId, userId), eq(meals.id, id))).returning({ id: meals.id });
  const d = m.length ? [] : await db.delete(drinks).where(and(eq(drinks.userId, userId), eq(drinks.id, id))).returning({ id: drinks.id });
  if (!m.length && !d.length) return false;
  await removeEvents(db, userId, [id]);
  return true;
}

export interface MealInput { day: string; time: string | null; slot: string | null; name: string; kcal: number; protein: number; fat: number; carbs: number; fiber?: number | null; sugar?: number | null; salt?: number | null; source?: string }
const mealEvent = (userId: string, m: typeof meals.$inferSelect) => ({ userId, module: 'food' as const, kind: 'meal', refId: m.id, day: m.day, time: m.time, title: m.name, value: m.kcal, unit: 'kcal' });

// запомнить блюдо: в следующий раз оно в подсказках «моё»
async function remember(db: Tx, userId: string, m: MealInput) {
  const key = m.name.trim().toLowerCase().slice(0, 200), v = { name: m.name, kcal: m.kcal, protein: m.protein, fat: m.fat, carbs: m.carbs, lastUsedOn: m.day };
  await db.insert(userFoods).values({ userId, key, ...v }).onConflictDoUpdate({ target: [userFoods.userId, userFoods.key], set: { ...v, uses: sql`${userFoods.uses} + 1` } });
}
export async function addMeal(db: Tx, userId: string, m: MealInput) {
  const [row] = await db.insert(meals).values({ userId, ...m, source: m.source ?? 'manual' }).returning();
  await recordEvent(db, mealEvent(userId, row!)); await remember(db, userId, m);
  return row!;
}
export async function updateMeal(db: Tx, userId: string, id: string, m: MealInput) {
  const [row] = await db.update(meals).set({ ...m }).where(and(eq(meals.userId, userId), eq(meals.id, id))).returning();
  if (row) await recordEvent(db, mealEvent(userId, row));
  return row ?? null;
}
export async function updateDrink(db: Tx, userId: string, id: string, v: { day: string; time: string | null; type: string; ml: number; name?: string | null; kcalPer100?: number | null; sugarPer100?: number | null }) {
  const [d] = await db.update(drinks).set(v).where(and(eq(drinks.userId, userId), eq(drinks.id, id))).returning();
  if (d) await recordEvent(db, { userId, module: 'food', kind: 'drink', refId: d.id, day: d.day, time: d.time, title: drinkName(d), value: d.ml, unit: 'ml', data: { type: d.type } });
  return d ?? null;
}
/** свои блюда для подсказок: по запросу или самые частые */
export async function myFoods(db: Tx, userId: string, q: string) {
  const where = q ? and(eq(userFoods.userId, userId), ilike(userFoods.name, `%${q.replace(/[%_\\]/g, '')}%`)) : eq(userFoods.userId, userId);
  return db.select({ name: userFoods.name, kcal: userFoods.kcal, protein: userFoods.protein, fat: userFoods.fat, carbs: userFoods.carbs, uses: userFoods.uses }).from(userFoods).where(where).orderBy(desc(userFoods.uses), desc(userFoods.lastUsedOn)).limit(q ? 8 : 12);
}
