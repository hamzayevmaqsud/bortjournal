/** Перенос еды из старого журнала: meals, drinks, foods, sets */
import { and, count, eq, sql } from 'drizzle-orm';
import { recordEvents } from '../../core/events.js';
import { dict, hm, isDay, list, num, optNum, optStr, str, sum, uniqById } from '../../core/legacy.js';
import type { ImportCheck, ImportContext, LegacyState } from '../../core/module.js';
import { upsertByLegacy } from '../../db/upsert.js';
import { drinks, mealSets, meals, userFoods } from './schema.js';

const SLOTS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);

export async function importFood({ db, userId, warn }: ImportContext, st: LegacyState) {
  const ms = uniqById(list(st.meals)).filter(m => { if (!isDay(m?.date) || !str(m?.name)) { warn(`еда: пропущена запись без даты или названия (${m?.id})`); return false; } return true; });
  const mealIds = await upsertByLegacy(db, meals, ms.map(m => ({
    userId, legacyId: String(m.id), day: m.date, time: hm(m.time), slot: SLOTS.has(m.slot) ? m.slot : null, name: str(m.name, 200),
    kcal: num(m.kcal), protein: num(m.p), fat: num(m.f), carbs: num(m.c), fiber: optNum(m.fi), sugar: optNum(m.su), salt: optNum(m.sa),
    source: optStr(m.source) ?? 'manual'
  })));
  const ds = uniqById(list(st.drinks)).filter(x => isDay(x?.date) && num(x?.ml) > 0);
  const drinkIds = await upsertByLegacy(db, drinks, ds.map(x => ({
    userId, legacyId: String(x.id), day: x.date, time: hm(x.time), type: str(x.type) || 'water', ml: Math.round(num(x.ml)),
    name: x.type === 'custom' ? optStr(x.name, 80) : null, kcalPer100: x.type === 'custom' ? optNum(x.kcal100) : null, sugarPer100: x.type === 'custom' ? optNum(x.sugar100) : null
  })));
  const foods = Object.entries(dict(st.foods)).filter(([, f]) => str(f?.name));
  for (const [key, f] of foods) {
    const v = { name: str(f.name, 200), kcal: num(f.kcal), protein: num(f.p), fat: num(f.f), carbs: num(f.c), fiber: optNum(f.fi), sugar: optNum(f.su), salt: optNum(f.sa), uses: Math.max(1, Math.round(num(f.count))), lastUsedOn: isDay(f.last) ? f.last : null };
    await db.insert(userFoods).values({ userId, key: key.slice(0, 200), ...v }).onConflictDoUpdate({ target: [userFoods.userId, userFoods.key], set: v });
  }
  await upsertByLegacy(db, mealSets, list(st.sets).filter(s => str(s?.name)).map(s => ({
    userId, legacyId: String(s.id), name: str(s.name, 80),
    items: list(s.items).map(i => ({ name: str(i.name, 200), kcal: num(i.kcal), protein: num(i.p), fat: num(i.f), carbs: num(i.c) }))
  })));
  await recordEvents(db, [
    ...ms.map(m => ({ userId, module: 'food' as const, kind: 'meal', refId: mealIds.get(String(m.id)), day: m.date, time: hm(m.time), title: str(m.name, 200), value: num(m.kcal), unit: 'kcal' })),
    ...ds.map(x => ({ userId, module: 'food' as const, kind: 'drink', refId: drinkIds.get(String(x.id)), day: x.date, time: hm(x.time), title: x.type === 'custom' ? str(x.name) || 'Напиток' : str(x.type), value: num(x.ml), unit: 'ml' }))
  ]);
}

export async function verifyFood({ db, userId }: ImportContext, st: LegacyState): Promise<ImportCheck[]> {
  const ms = uniqById(list(st.meals)).filter(m => isDay(m?.date) && str(m?.name)), ds = uniqById(list(st.drinks)).filter(x => isDay(x?.date) && num(x?.ml) > 0);
  const [m] = await db.select({ n: count(), kcal: sql<number>`coalesce(round(sum(${meals.kcal})::numeric, 2), 0)::float` }).from(meals).where(eq(meals.userId, userId));
  const [d] = await db.select({ n: count(), ml: sql<number>`coalesce(sum(${drinks.ml}), 0)::float` }).from(drinks).where(eq(drinks.userId, userId));
  const [f] = await db.select({ n: count() }).from(userFoods).where(and(eq(userFoods.userId, userId)));
  return [
    { name: 'еда: записей', source: ms.length, db: m!.n },
    { name: 'еда: сумма ккал', source: sum(ms.map(x => num(x.kcal))), db: Number(m!.kcal) },
    { name: 'напитки: записей', source: ds.length, db: d!.n },
    { name: 'напитки: сумма мл', source: sum(ds.map(x => Math.round(num(x.ml)))), db: Number(d!.ml) },
    { name: 'мои блюда', source: Object.values(dict(st.foods)).filter(f => str(f?.name)).length, db: f!.n }
  ];
}
