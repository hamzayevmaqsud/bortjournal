/**
 * Доступ к модулям. Модуль доступен, если есть действующая запись любого источника.
 * requireModule — preHandler для маршрутов модуля: без доступа отвечает 402.
 */
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FREE_MODULES, MODULES, type EntitlementSource, type ModuleName } from '@bortjournal/core';
import type { Tx } from '../db/index.js';
import { entitlements } from './schema.js';

// время сравнивает база: её now() точнее JS-даты, и у всех реплик одни часы
const active = (now?: Date) => { const t = now ?? sql`now()`; return and(lte(entitlements.startsAt, t), or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, t))); };

export async function modulesOf(db: Tx, userId: string, now?: Date): Promise<ModuleName[]> {
  const rows = await db.selectDistinct({ module: entitlements.module }).from(entitlements).where(and(eq(entitlements.userId, userId), active(now)));
  return MODULES.filter(m => rows.some(r => r.module === m));
}

export async function hasModule(db: Tx, userId: string, module: ModuleName, now?: Date) {
  const [row] = await db.select({ one: sql<number>`1` }).from(entitlements).where(and(eq(entitlements.userId, userId), eq(entitlements.module, module), active(now))).limit(1);
  return !!row;
}

export async function grant(db: Tx, userId: string, module: ModuleName, source: EntitlementSource, expiresAt: Date | null = null, externalRef?: string) {
  await db.insert(entitlements).values({ userId, module, source, expiresAt, externalRef })
    .onConflictDoUpdate({ target: [entitlements.userId, entitlements.module, entitlements.source], set: { expiresAt, externalRef } });
}

/** новому пользователю — бесплатные модули */
export async function grantFree(db: Tx, userId: string) {
  for (const m of FREE_MODULES) await grant(db, userId, m, 'free');
}

/** preHandler: request.userId ставит слой авторизации */
export function requireModule(db: Tx, module: ModuleName) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as FastifyRequest & { userId?: string }).userId;
    if (!userId) return reply.code(401).send({ error: 'Нужно войти.' });
    if (!(await hasModule(db, userId, module))) return reply.code(402).send({ error: 'Раздел недоступен на твоём тарифе.', module });
  };
}
