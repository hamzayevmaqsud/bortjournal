/** Перенос бюджета: настройки и операции. Суммы сверяются до копейки */
import { count, eq, sql } from 'drizzle-orm';
import { recordEvents } from '../../core/events.js';
import { dict, hm, isDay, list, num, optStr, owned, str, sum, uniqById } from '../../core/legacy.js';
import type { ImportCheck, ImportContext, LegacyState } from '../../core/module.js';
import { upsertByLegacy } from '../../db/upsert.js';
import { budgetEntries, budgets } from './schema.js';

const cents = (v: unknown) => Math.round(num(v) * 100) / 100;
const validEntries = (st: LegacyState) => uniqById(list(st.money)).filter(x => isDay(x?.date) && cents(x?.amount) > 0);

export async function importBudget({ db, userId, warn }: ImportContext, st: LegacyState) {
  const b = dict(st.budget);
  if (num(b.amount) > 0) {
    const v = { amount: cents(b.amount), startDay: Math.min(28, Math.max(1, Math.round(num(b.start)) || 1)), savings: cents(b.save), currency: str(b.cur, 3) || '₼' };
    await db.insert(budgets).values({ userId, ...v }).onConflictDoUpdate({ target: budgets.userId, set: v });
  }
  const es = validEntries(st);
  { const n = uniqById(list(st.money)).length - es.length; if (n) warn(`бюджет: пропущено операций с нулевой суммой или без даты — ${n}`); }
  const ids = await upsertByLegacy(db, budgetEntries, es.map(x => ({
    userId, legacyId: String(x.id), day: x.date, time: hm(x.time), kind: x.kind === 'in' ? 'in' : 'out', category: str(x.cat, 30) || 'other', amount: cents(x.amount), note: optStr(x.note, 80)
  })));
  await recordEvents(db, es.map(x => ({ userId, module: 'budget' as const, kind: x.kind === 'in' ? 'income' : 'expense', refId: ids.get(String(x.id)), day: x.date, time: hm(x.time), title: str(x.note, 80) || str(x.cat, 30), value: cents(x.amount), unit: str(b.cur, 3) || '₼' })));
}

export async function verifyBudget(ctx: ImportContext, st: LegacyState): Promise<ImportCheck[]> {
  const { db } = ctx;
  const es = validEntries(st);
  const rows = await db.select({ kind: budgetEntries.kind, n: count(), total: sql<string>`coalesce(sum(${budgetEntries.amount}), 0)` }).from(budgetEntries).where(owned(ctx, budgetEntries.userId, budgetEntries.legacyId)).groupBy(budgetEntries.kind);
  const of = (k: string) => rows.find(r => r.kind === k);
  return [
    { name: 'операций', source: es.length, db: rows.reduce((a, r) => a + r.n, 0) },
    { name: 'расходы, сумма', source: sum(es.filter(x => x.kind !== 'in').map(x => cents(x.amount))), db: Number(of('out')?.total ?? 0) },
    { name: 'доходы, сумма', source: sum(es.filter(x => x.kind === 'in').map(x => cents(x.amount))), db: Number(of('in')?.total ?? 0) }
  ];
}
