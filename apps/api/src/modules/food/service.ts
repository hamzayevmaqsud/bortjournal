/** Еда: сводка дня и записи. Напитки с калориями считаются и в еде, и в воде */
import { and, asc, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { drinkName, drinkTotals, waterNorm } from '@bortjournal/core';
import { recordEvent, removeEvents } from '../../core/events.js';
import type { DayContext, Nudge } from '../../core/module.js';
import type { Tx } from '../../db/index.js';
import { drinks, meals, userFoods } from './schema.js';
import { dayDrafts, draftSum, draftView, rangeDrafts } from './drafts.js';

export async function dayFood(db: Tx, userId: string, day: string) {
  const ms = await db.select().from(meals).where(and(eq(meals.userId, userId), eq(meals.day, day))).orderBy(sql`${meals.time} nulls last`, asc(meals.createdAt));
  const ds = await db.select().from(drinks).where(and(eq(drinks.userId, userId), eq(drinks.day, day))).orderBy(sql`${drinks.time} nulls last`, asc(drinks.createdAt));
  const dt = ds.map(d => ({ ...d, title: drinkName(d), ...drinkTotals(d) }));
  // черновики приёма (фото в разборе или ждёт подтверждения): их калории — предварительная часть итогов
  const dr = await dayDrafts(db, userId, day), draft = dr.map(draftSum).reduce((a, x) => ({ kcal: a.kcal + x.kcal, protein: a.protein + x.protein, fat: a.fat + x.fat, carbs: a.carbs + x.carbs }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
  const totals = {
    kcal: Math.round(ms.reduce((a, m) => a + m.kcal, 0) + dt.reduce((a, d) => a + d.kcal, 0) + draft.kcal),
    protein: ms.reduce((a, m) => a + m.protein, 0) + dt.reduce((a, d) => a + d.p, 0) + draft.protein,
    fat: ms.reduce((a, m) => a + m.fat, 0) + dt.reduce((a, d) => a + d.f, 0) + draft.fat,
    carbs: ms.reduce((a, m) => a + m.carbs, 0) + dt.reduce((a, d) => a + d.c, 0) + draft.carbs,
    waterMl: Math.round(dt.reduce((a, d) => a + d.hyd, 0)),
    draft: { ...draft, kcal: Math.round(draft.kcal) }
  };
  return { meals: ms, drinks: dt, drafts: dr.map(draftView), totals };
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

/** итоги по дням за период (еда + калорийные напитки, вода) — для цели и статистики; дни без записей не возвращаются */
export async function foodSeries(db: Tx, userId: string, from: string, to: string) {
  const ms = await db.select({ day: meals.day, kcal: sql<number>`sum(${meals.kcal})`, protein: sql<number>`sum(${meals.protein})`, fat: sql<number>`sum(${meals.fat})`, carbs: sql<number>`sum(${meals.carbs})`, n: sql<number>`count(*)` })
    .from(meals).where(and(eq(meals.userId, userId), gte(meals.day, from), lte(meals.day, to))).groupBy(meals.day);
  const ds = await db.select().from(drinks).where(and(eq(drinks.userId, userId), gte(drinks.day, from), lte(drinks.day, to)));
  const by = new Map<string, { day: string; kcal: number; protein: number; fat: number; carbs: number; waterMl: number; meals: number }>();
  const at = (day: string) => by.get(day) ?? by.set(day, { day, kcal: 0, protein: 0, fat: 0, carbs: 0, waterMl: 0, meals: 0 }).get(day)!;
  for (const m of ms) Object.assign(at(m.day), { kcal: Number(m.kcal), protein: Number(m.protein), fat: Number(m.fat), carbs: Number(m.carbs), meals: Number(m.n) });
  for (const d of ds) { const t = drinkTotals(d), r = at(d.day); r.kcal += t.kcal; r.protein += t.p; r.fat += t.f; r.carbs += t.c; r.waterMl += t.hyd; }
  // черновик приёма — предварительная запись: калории и сам факт приёма
  for (const d of await rangeDrafts(db, userId, from, to)) { const t = draftSum(d), r = at(d.day); r.kcal += t.kcal; r.protein += t.protein; r.fat += t.fat; r.carbs += t.carbs; r.meals += 1; }
  return [...by.values()].map(r => ({ ...r, kcal: Math.round(r.kcal), waterMl: Math.round(r.waterMl) })).sort((a, b) => a.day.localeCompare(b.day));
}

/** чаще всего съедаемое за период: сколько раз и средние калории */
export async function topMeals(db: Tx, userId: string, from: string, to: string, limit = 8) {
  const rows = await db.select({ name: sql<string>`min(${meals.name})`, n: sql<number>`count(*)::int`, kcal: sql<number>`avg(${meals.kcal})` }).from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.day, from), lte(meals.day, to))).groupBy(sql`lower(trim(${meals.name}))`).orderBy(sql`count(*) desc`).limit(limit);
  return rows.map(r => ({ name: r.name, n: r.n, kcal: Math.round(Number(r.kcal)) }));
}

const hmMin = (s: string | null | undefined) => { const m = /^(\d{1,2}):(\d{2})/.exec(s ?? ''); return m ? +m[1]! * 60 + +m[2]! : null; };
const fmtL = (ml: number) => (Math.round(ml / 100) / 10).toString().replace('.', ',');
/** напоминания еды: обед не записан; вода — с 10 до 21, если отстаёшь от равномерного графика и давно не пил */
export async function foodRemind(ctx: DayContext & { min: number }): Promise<Nudge[]> {
  const { db, userId, now, min } = ctx, { meals: ms, drinks: ds, drafts: dr, totals } = await dayFood(db, userId, now.day), out: Nudge[] = [];
  // фото, ждущее подтверждения, — уже запись: «не ел» было бы неправдой
  if (!ms.length && !dr.length) out.push({ key: 'food', kind: 'food', title: 'Записать обед?', body: 'Сегодня ещё нет записей еды — хватит фото или пары слов.', url: '/#food', at: 13 * 60 + 30 });
  if (min >= 10 * 60 && min < 21 * 60) {
    const norm = (await foodToday({ ...ctx, day: now.day })).norm.water || 2000, expect = norm * Math.min(1, Math.max(0, (min / 60 - 8) / 13));
    const last = Math.max(-1, ...ds.filter(d => d.hyd > 0).map(d => hmMin(d.time) ?? -1));
    if (totals.waterMl < expect - 400 && (last < 0 || min - last > 120)) out.push({ key: 'water', kind: 'water', title: 'Пора выпить воды', body: `Выпито ${fmtL(totals.waterMl)} из ${fmtL(norm)} л.`, url: '/#today', every: 150 });
  }
  return out;
}
