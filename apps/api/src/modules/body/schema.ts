/** Тело: вес и шаги по дням. Ручные значения — здесь; данные с устройств — в raw_samples ядра */
import { sql } from 'drizzle-orm';
import { check, date, doublePrecision, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../core/schema.js';

export const bodyDays = pgTable('body_days', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  weightKg: doublePrecision('weight_kg'),
  steps: integer('steps'),
  /** manual | health | … */
  source: text('source').notNull().default('manual')
}, t => [
  primaryKey({ columns: [t.userId, t.day] }),
  check('body_weight_ck', sql`${t.weightKg} is null or ${t.weightKg} between 20 and 400`),
  check('body_steps_ck', sql`${t.steps} is null or ${t.steps} between 0 and 200000`)
]);
