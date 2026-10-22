/** Статистика денег за n дней (вкладка «Деньги» в «Статистике»): траты по дням, категории, доходы, последние периоды */
import { and, eq, gte, lte } from 'drizzle-orm';
import { addDays, budgetDay, budgetPeriod, MONEY_CATS } from '@bortjournal/core';
import { userContext } from '../../core/context.js';
import type { Tx } from '../../db/index.js';
import { budgetEntries, budgets } from './schema.js';

const round = (v: number) => Math.round(v * 100) / 100;
const range = (n: number, end: string) => Array.from({ length: n }, (_, k) => addDays(end, k - n + 1));

export async function budgetStats(db: Tx, userId: string, n: number) {
  const [b] = await db.select().from(budgets).where(eq(budgets.userId, userId));
  if (!b) return { configured: false as const };
  const { today } = await userContext(db, userId), ds = range(n, today), from = ds[0]!;
  // шесть последних периодов бюджета — для графика по месяцам
  const periods: Array<{ from: string; to: string }> = [];
  for (let p = budgetPeriod(today, b.startDay), k = 0; k < 6; k++, p = budgetPeriod(addDays(p.from, -1), b.startDay)) periods.unshift({ from: p.from, to: p.to });
  const since = [periods[0]!.from, addDays(from, -n)].sort()[0]!;
  const es = await db.select({ day: budgetEntries.day, kind: budgetEntries.kind, category: budgetEntries.category, amount: budgetEntries.amount }).from(budgetEntries)
    .where(and(eq(budgetEntries.userId, userId), gte(budgetEntries.day, since), lte(budgetEntries.day, today)));
  const outs = es.filter(e => e.kind !== 'in'), sum = (xs: typeof es) => round(xs.reduce((a, e) => a + e.amount, 0));
  const inR = outs.filter(e => e.day >= from), set = { amount: b.amount, startDay: b.startDay, savings: b.savings };
  const first = es.reduce<string | null>((a, e) => !a || e.day < a ? e.day : a, null);
  const cur = budgetPeriod(today, b.startDay), B = budgetDay(today, set, es.filter(e => e.day >= cur.from));
  const catOf = (k: string) => MONEY_CATS.out.some(c => c[0] === k) ? k : 'other';
  return {
    configured: true as const, days: n, today, currency: b.currency, amount: b.amount,
    perDay: ds.map(day => ({ day, spent: sum(outs.filter(e => e.day === day)) })),
    total: sum(inR), prevTotal: sum(outs.filter(e => e.day >= addDays(from, -n) && e.day < from)),
    income: sum(es.filter(e => e.kind === 'in' && e.day >= from)),
    base: round(B.total / cur.days),
    inLimit: first ? ds.filter(d => d < today && d >= first && budgetDay(d, set, es.filter(e => e.day >= budgetPeriod(d, b.startDay).from && e.day <= budgetPeriod(d, b.startDay).to)).leftToday >= 0).length : 0,
    byCat: MONEY_CATS.out.map(([key, name, color]) => ({ key, name, color, sum: sum(inR.filter(e => catOf(e.category) === key)) })).filter(c => c.sum > 0).sort((a, c) => c.sum - a.sum),
    periods: periods.map(p => ({ ...p, spent: sum(outs.filter(e => e.day >= p.from && e.day <= p.to)) }))
  };
}
