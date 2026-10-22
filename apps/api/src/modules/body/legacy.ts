/** Перенос тела: вес и шаги из days старого журнала. Это значения дня, а не события — лента берёт их из body_days */
import { count, eq, sql } from 'drizzle-orm';
import { dict, inRange, isDay, num, optNum, owned } from '../../core/legacy.js';
import type { ImportCheck, ImportContext, LegacyState } from '../../core/module.js';
import { bodyDays } from './schema.js';

const rowsOf = (st: LegacyState) => Object.entries(dict(st.days)).filter(([d]) => isDay(d)).map(([day, r]) => ({
  day, weightKg: inRange(optNum(r?.weight), 20, 400), steps: inRange(r?.steps == null ? null : Math.round(num(r.steps)), 0, 200000)
})).filter(r => r.weightKg !== null || (r.steps !== null && r.steps > 0));

export async function importBody({ db, userId, warn }: ImportContext, st: LegacyState) {
  const rows = rowsOf(st);
  const bad = Object.values(dict(st.days)).filter(r => (r?.weight && inRange(optNum(r.weight), 20, 400) === null) || (r?.steps && inRange(Math.round(num(r.steps)), 0, 200000) === null)).length;
  if (bad) warn(`тело: ${bad} значений веса или шагов вне разумных границ — не перенесены`);
  for (const r of rows) {
    const v = { weightKg: r.weightKg, steps: r.steps };
    await db.insert(bodyDays).values({ userId, day: r.day, ...v }).onConflictDoUpdate({ target: [bodyDays.userId, bodyDays.day], set: v });
  }
}

export async function verifyBody(ctx: ImportContext, st: LegacyState): Promise<ImportCheck[]> {
  const { db } = ctx;
  const rows = rowsOf(st);
  const [b] = await db.select({ n: count(), steps: sql<number>`coalesce(sum(${bodyDays.steps}), 0)::bigint` }).from(bodyDays).where(owned(ctx, bodyDays.userId));
  return [
    { name: 'дней с весом или шагами', source: rows.length, db: b!.n },
    { name: 'шагов всего', source: rows.reduce((a, r) => a + (r.steps ?? 0), 0), db: Number(b!.steps) }
  ];
}
