/**
 * Подписка Pro. Сейчас оплата имитируется: «покупка» сразу выдаёт доступ (источник web),
 * без денег. Когда подключим платёжку, вместо purchase придёт её вебхук — остальное не меняется.
 */
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { customPrice, hasFeature, PACK_KEYS, PRICES, TRIAL_DAYS, type PackKey, type PriceId, type Subscription } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { requireUser } from './auth.js';
import { bad } from './http.js';
import { entitlements } from './schema.js';

const activePro = (userId: string) => and(eq(entitlements.userId, userId), eq(entitlements.module, 'pro'), lte(entitlements.startsAt, sql`now()`), or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, sql`now()`)));

export async function subscription(db: Tx, userId: string): Promise<Subscription> {
  const rows = await db.select().from(entitlements).where(activePro(userId)).orderBy(desc(entitlements.expiresAt));
  // весь Pro важнее своего набора; платная или навсегда — важнее пробной
  const full = rows.filter(r => !r.features), best = full.find(r => r.source !== 'trial') ?? full[0] ?? rows[0];
  if (!best) {
    // была ли подписка раньше — чтобы показать «Pro закончился», а не «попробуй»
    const [old] = await db.select({ id: entitlements.id }).from(entitlements).where(and(eq(entitlements.userId, userId), eq(entitlements.module, 'pro'))).limit(1);
    return { pro: false, source: null, expiresAt: null, daysLeft: null, plan: null, autoRenew: false, ended: !!old };
  }
  const left = best.expiresAt ? Math.max(0, Math.ceil((best.expiresAt.getTime() - Date.now()) / 864e5)) : null;
  return { pro: !best.features, features: (best.features as PackKey[] | null) ?? null, source: best.source, expiresAt: best.expiresAt?.toISOString() ?? null, daysLeft: left, plan: (best.plan as PriceId | null) ?? null, autoRenew: best.autoRenew };
}
export const hasPro = async (db: Tx, userId: string) => (await subscription(db, userId)).pro;

export async function startTrial(db: Tx, userId: string) {
  await db.insert(entitlements).values({ userId, module: 'pro', source: 'trial', expiresAt: new Date(Date.now() + TRIAL_DAYS * 864e5) }).onConflictDoNothing();
}

/** preHandler: раздел из Pro — открыт, если есть весь Pro или этот раздел в своём наборе. Без ключа — нужен весь Pro */
export function requirePro(db: DB, feature?: PackKey) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    const s = await subscription(db, req.userId);
    if (!(feature ? hasFeature(s, feature) : s.pro)) return reply.code(402).send({ error: 'Этот раздел — в Pro или в своём наборе. Открой «Подписку», чтобы попробовать.', pro: true, feature: feature ?? null });
  };
}
export const requireFeature = requirePro;

export async function billingRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/billing', { preHandler: requireUser }, async req => ({ subscription: await subscription(db, req.userId!), prices: PRICES }));

  // цена своего набора — считает сервер, клиенту не доверяем
  app.get('/api/billing/quote', { preHandler: requireUser }, async req => {
    const q = req.query as { plan?: string; features?: string };
    const plan = (q.plan === 'month' ? 'month' : 'year') as PriceId, keys = String(q.features ?? '').split(',').filter(k => (PACK_KEYS as string[]).includes(k));
    return { plan, features: keys, ...customPrice(keys, plan), pro: PRICES[plan].price };
  });

  // имитация покупки: доступ на срок тарифа, автопродление включено. features — свой набор; пусто или все разделы — весь Pro
  app.post('/api/billing/purchase', { preHandler: requireUser }, async req => {
    const b = (req.body ?? {}) as { plan?: string; features?: unknown };
    const plan = String(b.plan ?? '') as PriceId;
    if (!PRICES[plan]) throw bad('Неизвестный тариф.');
    let features: PackKey[] | null = null;
    if (Array.isArray(b.features) && b.features.length) {
      const keys = [...new Set(b.features.map(String))];
      if (keys.some(k => !(PACK_KEYS as string[]).includes(k))) throw bad('Неизвестный раздел в наборе.');
      features = keys.length === PACK_KEYS.length ? null : PACK_KEYS.filter(k => keys.includes(k)); // все разделы — это и есть Pro
    }
    const price = features ? customPrice(features, plan).price : PRICES[plan].price;
    // продление того же тарифа — от конца текущей оплаченной подписки; смена тарифа — с сегодня (пробный период не мешает)
    const [paid] = await db.select().from(entitlements).where(and(eq(entitlements.userId, req.userId!), eq(entitlements.module, 'pro'), eq(entitlements.source, 'web'), gt(entitlements.expiresAt, sql`now()`)));
    const same = !!paid?.expiresAt && paid.plan === plan && JSON.stringify(paid.features ?? null) === JSON.stringify(features);
    const from = same ? paid!.expiresAt!.getTime() : Date.now();
    const expiresAt = new Date(from + PRICES[plan].days * 864e5), ref = `demo-${Date.now()}-${price}`;
    await db.insert(entitlements).values({ userId: req.userId!, module: 'pro', source: 'web', expiresAt, plan, features, autoRenew: true, externalRef: ref })
      .onConflictDoUpdate({ target: [entitlements.userId, entitlements.module, entitlements.source], set: { expiresAt, plan, features, autoRenew: true, startsAt: sql`least(${entitlements.startsAt}, now())`, externalRef: ref } });
    // купил — пробный период закончился: дальше действует покупка
    await db.update(entitlements).set({ expiresAt: new Date() }).where(and(eq(entitlements.userId, req.userId!), eq(entitlements.module, 'pro'), eq(entitlements.source, 'trial'), gt(entitlements.expiresAt, sql`now()`)));
    return { subscription: await subscription(db, req.userId!), price };
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
