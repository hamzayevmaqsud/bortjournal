/** Бюджет: настройки периода и операции. Деньги — numeric, без ошибок округления float */
import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../core/schema.js';
import { createdAt, hhmm, id, legacyId, owner } from '../../db/columns.js';

export const budgets = pgTable('budget_settings', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
  /** с какого числа начинается месяц (1–28) */
  startDay: smallint('start_day').notNull().default(1),
  savings: numeric('savings', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
  currency: text('currency').notNull().default('₼')
}, t => [check('budget_start_ck', sql`${t.startDay} between 1 and 28`)]);

export const budgetEntries = pgTable('budget_entries', {
  id: id(), userId: owner(), legacyId: legacyId(),
  day: date('day', { mode: 'string' }).notNull(),
  time: hhmm('time'),
  /** out — расход, in — доход */
  kind: text('kind').notNull(),
  category: text('category').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
  note: text('note'),
  createdAt: createdAt()
}, t => [
  index('budget_entries_user_day_idx').on(t.userId, t.day),
  uniqueIndex('budget_entries_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`),
  check('budget_kind_ck', sql`${t.kind} in ('in', 'out')`),
  check('budget_amount_ck', sql`${t.amount} > 0`)
]);
