/** Настройки профиля (profiles.settings): правка — слиянием в базе одной командой, без гонки «прочитал — дописал» */
import { sql } from 'drizzle-orm';
import type { DB, Tx } from '../db/index.js';
import { profiles } from './schema.js';

/** дописать ключи верхнего уровня; профиля нет — создать. Возвращает настройки после правки */
export async function patchSettings(db: DB | Tx, userId: string, patch: Record<string, unknown>) {
  const [r] = await db.insert(profiles).values({ userId, settings: patch })
    .onConflictDoUpdate({ target: profiles.userId, set: { settings: sql`"profiles"."settings" || excluded.settings`, updatedAt: new Date() } })
    .returning({ s: profiles.settings });
  return (r?.s ?? {}) as Record<string, unknown>;
}
