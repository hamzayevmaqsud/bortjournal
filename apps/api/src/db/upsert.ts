/**
 * Вставка «или обновление» по (user_id, legacy_id): повторный перенос из старого журнала
 * не плодит дубли, а обновляет записи. Возвращает соответствие legacy_id → uuid.
 */
import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from './index.js';

type WithLegacy = PgTable & { id: PgColumn; userId: PgColumn; legacyId: PgColumn };

export async function upsertByLegacy<T extends WithLegacy>(db: Tx, table: T, rows: Array<T['$inferInsert']>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!rows.length) return map;
  // одна запись старого журнала дважды — оставляем последнюю (Postgres не обновит строку дважды за запрос)
  rows = [...new Map(rows.map(r => [String((r as any).legacyId), r])).values()];
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const set: Record<string, SQL> = {};
  for (const [key, col] of Object.entries(cols)) if (!['id', 'userId', 'legacyId', 'createdAt'].includes(key)) set[key] = sql.raw(`excluded."${col.name}"`);
  for (let i = 0; i < rows.length; i += 500) {
    const out = await (db as any).insert(table).values(rows.slice(i, i + 500))
      .onConflictDoUpdate({ target: [table.userId, table.legacyId], targetWhere: sql`${table.legacyId} is not null`, set })
      .returning({ id: table.id, legacyId: table.legacyId });
    for (const r of out as Array<{ id: string; legacyId: string | null }>) if (r.legacyId) map.set(r.legacyId, r.id);
  }
  return map;
}
