/** Свои привычки: список привычек человека и отметки «сделано» по дням */
import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, owner } from '../../db/columns.js';

export const habits = pgTable('habits', {
  id: id(), userId: owner(),
  title: text('title').notNull(),
  /** эмодзи или короткий значок; null — без значка */
  icon: text('icon'),
  /** ключ цвета из палитры (orange, water, steps…); null — по порядку */
  color: text('color'),
  sort: integer('sort').notNull().default(0),
  /** в архиве — не в списке и не в лимите; отметки остаются для истории */
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt()
}, t => [
  index('habits_user_idx').on(t.userId, t.sort),
  check('habits_title_ck', sql`char_length(${t.title}) between 1 and 60`)
]);

export const habitChecks = pgTable('habit_checks', {
  habitId: uuid('habit_id').notNull().references(() => habits.id, { onDelete: 'cascade' }),
  userId: owner(),
  day: date('day', { mode: 'string' }).notNull(),
  createdAt: createdAt()
}, t => [
  uniqueIndex('habit_checks_habit_day_uq').on(t.habitId, t.day),
  index('habit_checks_user_day_idx').on(t.userId, t.day)
]);
