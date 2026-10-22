/**
 * Выгрузка своих данных одним JSON: все таблицы, где есть user_id, — только строки этого человека.
 * Без секретов: хешей пароля, сессий и ключей устройств для уведомлений.
 * Импорт — файл выгрузки старого журнала (Настройки → «Экспорт JSON»): записи добавляются в свой аккаунт со сверкой.
 */
import { eq, getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/index.js';
import * as schema from '../schema.js';
import { requireUser } from './auth.js';
import { bad, uid } from './http.js';
import { checksOk, importState } from './legacy-import.js';
import type { ImportCheck, LegacyState } from './module.js';

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

  // импорт выгрузки старого журнала: всё или ничего — при расхождении сверки транзакция откатывается
  app.post('/api/account/import', { preHandler: requireUser, bodyLimit: 40 * 1024 * 1024 }, async (req, reply) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const st = (raw.state && typeof raw.state === 'object' ? raw.state : raw) as LegacyState;
    if (!Array.isArray(st.meals) || !Array.isArray(st.study)) throw bad(raw.format === 'bortjournal-export' ? 'Это выгрузка новой версии Lumi — она для резервной копии, загрузить её обратно пока нельзя.' : 'Не похоже на выгрузку старого журнала: нет еды и учёбы.');
    const warnings: string[] = [];
    let checks: ImportCheck[] = [];
    try {
      await db.transaction(async tx => {
        checks = await importState(tx, uid(req), st, { warn: m => warnings.push(m), merge: true });
        if (!checksOk(checks)) throw new Mismatch();
      });
    } catch (e) {
      if (e instanceof Mismatch) return reply.code(422).send({ error: 'Сверка не сошлась — ничего не записано.', ok: false, checks, warnings });
      throw e;
    }
    return { ok: true, checks, warnings };
  });
}
class Mismatch extends Error {}
