import { and, eq, gte, lte } from 'drizzle-orm';
import { budgetDay, budgetPeriod } from '@bortjournal/core';
import type { DayContext } from '../../core/module.js';
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
