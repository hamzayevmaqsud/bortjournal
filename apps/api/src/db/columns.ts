/**
 * Общие колонки. У каждой записи пользователя: свой uuid, владелец (каскадное удаление
 * вместе с аккаунтом), id из старого журнала для идемпотентного переноса и время изменений.
 */
import { sql } from 'drizzle-orm';
import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../core/schema.js';

export const id = () => uuid('id').primaryKey().defaultRandom();
export const owner = () => uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' });
export const legacyId = () => text('legacy_id');
export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => sql`now()`);
/** «ЧЧ:ММ» в часовом поясе пользователя: записи привязаны к его дню, а не к UTC */
export const hhmm = (name: string) => text(name);
