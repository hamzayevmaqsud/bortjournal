import { and, eq, gte, lte } from 'drizzle-orm';
import { addDays, budgetDay, budgetPeriod } from '@bortjournal/core';
import type { DayContext } from '../../core/module.js';
import type { Tx } from '../../db/index.js';
import { budgetEntries, budgets } from './schema.js';

export async function budgetToday({ db, userId, day }: DayContext) {
  const [b] = await db.select().from(budgets).where(eq(budgets.userId, userId));
  if (!b) return { configured: false };
  const p = budgetPeriod(day, b.startDay);
  const es = await db.select({ day: budgetEntries.day, kind: budgetEntries.kind, amount: budgetEntries.amount }).from(budgetEntries)
    .where(and(eq(budgetEntries.userId, userId), gte(budgetEntries.day, p.from), lte(budgetEntries.day, p.to)));
  const r = budgetDay(day, { amount: b.amount, startDay: b.startDay, savings: b.savings }, es);
  return { configured: true, currency: b.currency, leftToday: r.leftToday, allow: r.allow, tomorrow: r.tomorrow, leftPeriod: r.leftPeriod };
}

/** день в рамках бюджета и траты — с первой операции; без настроек бюджета — ничего */
export async function budgetDaily(db: Tx, userId: string, from: string, to: string) {
  const [b] = await db.select().from(budgets).where(eq(budgets.userId, userId));
  if (!b) return [];
  const es = await db.select({ day: budgetEntries.day, kind: budgetEntries.kind, amount: budgetEntries.amount }).from(budgetEntries)
    .where(and(eq(budgetEntries.userId, userId), gte(budgetEntries.day, budgetPeriod(from, b.startDay).from), lte(budgetEntries.day, to)));
  if (!es.length) return [];
  const first = es.reduce((a, e) => e.day < a ? e.day : a, es[0]!.day), out = [];
  const set = { amount: b.amount, startDay: b.startDay, savings: b.savings };
  for (let d = first > from ? first : from; d <= to; d = addDays(d, 1)) {
    out.push({ day: d, budgetOk: budgetDay(d, set, es).leftToday >= 0, spent: es.filter(e => e.day === d && e.kind !== 'in').reduce((a, e) => a + e.amount, 0) });
  }
  return out;
}
