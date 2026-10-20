/**
 * Подписка Pro. Сейчас оплата имитируется: «покупка» сразу выдаёт доступ (источник web),
 * без денег. Когда подключим платёжку, вместо purchase придёт её вебхук — остальное не меняется.
 */
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PRICES, TRIAL_DAYS, type PriceId, type Subscription } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { requireUser } from './auth.js';
import { bad } from './http.js';
import { entitlements } from './schema.js';

const activePro = (userId: string) => and(eq(entitlements.userId, userId), eq(entitlements.module, 'pro'), lte(entitlements.startsAt, sql`now()`), or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, sql`now()`)));

export async function subscription(db: Tx, userId: string): Promise<Subscription> {
  const rows = await db.select().from(entitlements).where(activePro(userId)).orderBy(desc(entitlements.expiresAt));
  // платная или бесплатная навсегда важнее пробной
  const best = rows.find(r => r.source !== 'trial') ?? rows[0];
  if (!best) {
    // была ли подписка раньше — чтобы показать «Pro закончился», а не «попробуй»
    const [old] = await db.select({ id: entitlements.id }).from(entitlements).where(and(eq(entitlements.userId, userId), eq(entitlements.module, 'pro'))).limit(1);
    return { pro: false, source: null, expiresAt: null, daysLeft: null, plan: null, autoRenew: false, ended: !!old };
  }
  const left = best.expiresAt ? Math.max(0, Math.ceil((best.expiresAt.getTime() - Date.now()) / 864e5)) : null;
  return { pro: true, source: best.source, expiresAt: best.expiresAt?.toISOString() ?? null, daysLeft: left, plan: (best.plan as PriceId | null) ?? null, autoRenew: best.autoRenew };
}
export const hasPro = async (db: Tx, userId: string) => (await subscription(db, userId)).pro;

export async function startTrial(db: Tx, userId: string) {
  await db.insert(entitlements).values({ userId, module: 'pro', source: 'trial', expiresAt: new Date(Date.now() + TRIAL_DAYS * 864e5) }).onConflictDoNothing();
}

/** preHandler: платная функция */
export function requirePro(db: DB) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    if (!(await hasPro(db, req.userId))) return reply.code(402).send({ error: 'Это функция Pro. Открой «Подписку», чтобы попробовать.', pro: true });
  };
}

export async function billingRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/billing', { preHandler: requireUser }, async req => ({ subscription: await subscription(db, req.userId!), prices: PRICES }));

  // имитация покупки: доступ на срок тарифа, автопродление включено
  app.post('/api/billing/purchase', { preHandler: requireUser }, async req => {
    const plan = String((req.body as { plan?: string } | undefined)?.plan ?? '') as PriceId;
    if (!PRICES[plan]) throw bad('Неизвестный тариф.');
    const cur = await subscription(db, req.userId!);
    // продление — от конца текущей оплаченной подписки, а не от сегодня
    const from = cur.source === 'web' && cur.expiresAt ? new Date(cur.expiresAt).getTime() : Date.now();
    const expiresAt = new Date(from + PRICES[plan].days * 864e5);
    await db.insert(entitlements).values({ userId: req.userId!, module: 'pro', source: 'web', expiresAt, plan, autoRenew: true, externalRef: `demo-${Date.now()}` })
      .onConflictDoUpdate({ target: [entitlements.userId, entitlements.module, entitlements.source], set: { expiresAt, plan, autoRenew: true, startsAt: sql`least(${entitlements.startsAt}, now())`, externalRef: `demo-${Date.now()}` } });
    return { subscription: await subscription(db, req.userId!) };
  });
  // отмена: доступ остаётся до конца оплаченного периода, автопродление выключается
  app.post('/api/billing/cancel', { preHandler: requireUser }, async req => {
    await db.update(entitlements).set({ autoRenew: false }).where(and(eq(entitlements.userId, req.userId!), eq(entitlements.module, 'pro'), eq(entitlements.source, 'web')));
    return { subscription: await subscription(db, req.userId!) };
  });
  app.post('/api/billing/resume', { preHandler: requireUser }, async req => {
    await db.update(entitlements).set({ autoRenew: true }).where(and(eq(entitlements.userId, req.userId!), eq(entitlements.module, 'pro'), eq(entitlements.source, 'web'), gt(entitlements.expiresAt, sql`now()`)));
    return { subscription: await subscription(db, req.userId!) };
  });
}
