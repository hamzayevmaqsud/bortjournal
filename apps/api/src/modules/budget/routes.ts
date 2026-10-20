/**
 * Бюджет (раздел Pro): настройки периода, операции, «сколько можно потратить сегодня», дни периода и категории.
 * Формулы — в @bortjournal/core (budgetDay), как в старом журнале.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, budgetDay, budgetPeriod, CURRENCIES, MONEY_CATS, parseAmount } from '@bortjournal/core';
import { requireUser } from '../../core/auth.js';
import { requireFeature } from '../../core/billing.js';
import { userContext } from '../../core/context.js';
import { recordEvent, removeEvents } from '../../core/events.js';
import { bad, dayParam, hmParam, idParam, notFound, uid } from '../../core/http.js';
import type { DB, Tx } from '../../db/index.js';
import { budgetEntries, budgets } from './schema.js';

const round = (v: number) => Math.round(v * 100) / 100;
const moneyEvent = (userId: string, e: typeof budgetEntries.$inferSelect) => ({ userId, module: 'budget' as const, kind: 'money', refId: e.id, day: e.day, time: e.time, title: e.note || (MONEY_CATS[e.kind === 'in' ? 'in' : 'out'].find(c => c[0] === e.category)?.[1] ?? 'Операция'), value: e.kind === 'in' ? e.amount : -e.amount, unit: 'money' });

async function overview(db: Tx, userId: string, day: string, today: string) {
  const [b] = await db.select().from(budgets).where(eq(budgets.userId, userId));
  if (!b) return { configured: false as const, now: today };
  const p = budgetPeriod(day, b.startDay);
  const es = await db.select().from(budgetEntries).where(and(eq(budgetEntries.userId, userId), gte(budgetEntries.day, p.from), lte(budgetEntries.day, p.to))).orderBy(asc(budgetEntries.day), asc(budgetEntries.time));
  const set = { amount: b.amount, startDay: b.startDay, savings: b.savings }, B = budgetDay(day, set, es);
  const outs = es.filter(e => e.kind !== 'in'), days: Array<{ day: string; spent: number; future: boolean }> = [];
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) days.push({ day: d, spent: round(outs.filter(o => o.day === d).reduce((a, o) => a + o.amount, 0)), future: d > today });
  const byCat = MONEY_CATS.out.map(([k, n, c]) => ({ key: k, name: n, color: c, sum: round(outs.filter(o => (MONEY_CATS.out.some(x => x[0] === o.category) ? o.category : 'other') === k).reduce((a, o) => a + o.amount, 0)) })).filter(x => x.sum > 0).sort((a, b2) => b2.sum - a.sum);
  const passed = Math.max(1, Math.min(p.days, Math.round((Date.parse(today) - Date.parse(p.from)) / 864e5) + 1));
  return {
    configured: true as const, now: today, day, settings: { amount: b.amount, startDay: b.startDay, savings: b.savings, currency: b.currency },
    ...B, base: round(B.total / p.days), avgPerDay: round(outs.filter(o => o.day <= today).reduce((a, o) => a + o.amount, 0) / passed),
    ops: es.filter(e => e.day === day).sort((a, c) => String(c.time ?? '').localeCompare(String(a.time ?? ''))).map(e => ({ id: e.id, day: e.day, time: e.time, kind: e.kind, category: e.category, amount: e.amount, note: e.note })),
    days, byCat
  };
}

export async function budgetRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = [requireUser, requireFeature(db, 'budget')];
  app.get('/overview', { preHandler }, async req => {
    const ctx = await userContext(db, uid(req)), q = req.query as { day?: string };
    return overview(db, uid(req), q.day ? dayParam(q.day) : ctx.today, ctx.today);
  });
  app.put('/settings', { preHandler }, async req => {
    const b = (req.body ?? {}) as Record<string, unknown>, amount = parseAmount(b.amount), savings = parseAmount(b.savings ?? 0);
    if (!(amount > 0 && amount < 1e9)) throw bad('Сумма на месяц — больше нуля.');
    if (savings < 0 || savings >= amount) throw bad('Копилка — меньше суммы на месяц.');
    const startDay = Math.min(28, Math.max(1, Math.round(Number(b.startDay) || 1))), currency = CURRENCIES.includes(String(b.currency)) ? String(b.currency) : '₼';
    const v = { amount, savings, startDay, currency };
    await db.insert(budgets).values({ userId: uid(req), ...v }).onConflictDoUpdate({ target: budgets.userId, set: v });
    return { ok: true, settings: v };
  });
  const entryBody = (b: Record<string, unknown>) => {
    const kind = b.kind === 'in' ? 'in' : 'out', amount = parseAmount(b.amount);
    if (!(amount > 0 && amount < 1e9)) throw bad('Сумма — больше нуля.');
    const category = MONEY_CATS[kind].some(c => c[0] === b.category) ? String(b.category) : 'other';
    return { day: dayParam(b.day), time: hmParam(b.time), kind, category, amount, note: String(b.note ?? '').trim().slice(0, 80) || null };
  };
  app.post('/entries', { preHandler }, async (req, reply) => {
    const v = entryBody((req.body ?? {}) as Record<string, unknown>);
    const e = await db.transaction(async tx => { const [r] = await tx.insert(budgetEntries).values({ userId: uid(req), ...v }).returning(); await recordEvent(tx, moneyEvent(uid(req), r!)); return r!; });
    return reply.code(201).send(e);
  });
  app.put('/entries/:id', { preHandler }, async (req, reply) => {
    const v = entryBody((req.body ?? {}) as Record<string, unknown>), id = idParam((req.params as any).id);
    const e = await db.transaction(async tx => { const [r] = await tx.update(budgetEntries).set(v).where(and(eq(budgetEntries.userId, uid(req)), eq(budgetEntries.id, id))).returning(); if (r) await recordEvent(tx, moneyEvent(uid(req), r)); return r; });
    return e ?? notFound(reply);
  });
  app.delete('/entries/:id', { preHandler }, async (req, reply) => {
    const id = idParam((req.params as any).id);
    const r = await db.delete(budgetEntries).where(and(eq(budgetEntries.userId, uid(req)), eq(budgetEntries.id, id))).returning({ id: budgetEntries.id });
    if (!r.length) return notFound(reply);
    await removeEvents(db, uid(req), [id]); return { ok: true };
  });
}
