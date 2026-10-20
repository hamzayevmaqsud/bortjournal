/**
 * Выгрузка своих данных одним JSON: все таблицы, где есть user_id, — только строки этого человека.
 * Без секретов: хешей пароля, сессий и ключей устройств для уведомлений.
 */
import { eq, getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/index.js';
import * as schema from '../schema.js';
import { requireUser } from './auth.js';
import { uid } from './http.js';

const SKIP = new Set(['sessions', 'push_subscriptions', 'users', 'raw_samples']);

export async function exportRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/export', { preHandler: requireUser }, async (req, reply) => {
    const userId = uid(req), out: Record<string, unknown> = {};
    const [u] = await db.select({ username: schema.users.username, email: schema.users.email, createdAt: schema.users.createdAt, tzOffset: schema.users.tzOffset }).from(schema.users).where(eq(schema.users.id, userId));
    out.account = u;
    for (const t of Object.values(schema)) {
      if (!is(t, PgTable)) continue;
      const name = getTableName(t), cols = getTableColumns(t) as Record<string, any>;
      if (SKIP.has(name) || !cols.userId) continue;
      out[name] = await db.select().from(t).where(eq(cols.userId, userId));
    }
    const day = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="bortjournal-${u?.username ?? 'me'}-${day}.json"`).header('Cache-Control', 'no-store');
    return { format: 'bortjournal-export', version: 1, exportedAt: new Date().toISOString(), ...out };
  });
}
