/** Планы: цели по периодам, задачи и правила повторов */
import { sql } from 'drizzle-orm';
import { boolean, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, hhmm, id, legacyId, owner, updatedAt } from '../../db/columns.js';

export const goals = pgTable('plan_goals', {
  id: id(), userId: owner(), legacyId: legacyId(),
  /** week | month | quarter | year */
  period: text('period').notNull(),
  /** ключ периода: 2026-W43, 2026-10, 2026-Q4, 2026 */
  periodKey: text('period_key').notNull(),
  title: text('title').notNull(),
  note: text('note'),
  done: boolean('done').notNull().default(false),
  parentId: uuid('parent_id'),
  createdOn: date('created_on', { mode: 'string' }),
  createdAt: createdAt()
}, t => [index('plan_goals_user_period_idx').on(t.userId, t.period, t.periodKey), uniqueIndex('plan_goals_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);

/** Правило повтора: задачи по нему создаются на две недели вперёд */
export const taskSeries = pgTable('plan_task_series', {
  id: id(), userId: owner(), legacyId: legacyId(),
  title: text('title').notNull(),
  time: hhmm('time'),
  prio: boolean('prio').notNull().default(false),
  goalId: uuid('goal_id'),
  note: text('note'),
  rule: jsonb('rule').$type<{ kind: 'daily' | 'weekdays' | 'days' | 'weekly' | 'monthly'; days?: number[] }>().notNull(),
  startOn: date('start_on', { mode: 'string' }).notNull(),
  endOn: date('end_on', { mode: 'string' }),
  skipDays: date('skip_days', { mode: 'string' }).array().notNull().default(sql`'{}'::date[]`),
  createdAt: createdAt()
}, t => [uniqueIndex('plan_task_series_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);

export const tasks = pgTable('plan_tasks', {
  id: id(), userId: owner(), legacyId: legacyId(),
  title: text('title').notNull(),
  /** null — «без даты» */
  day: date('day', { mode: 'string' }),
  time: hhmm('time'),
  done: boolean('done').notNull().default(false),
  doneAt: timestamp('done_at', { withTimezone: true }),
  prio: boolean('prio').notNull().default(false),
  goalId: uuid('goal_id'),
  seriesId: uuid('series_id').references(() => taskSeries.id, { onDelete: 'set null' }),
  note: text('note'),
  createdOn: date('created_on', { mode: 'string' }),
  createdAt: createdAt(), updatedAt: updatedAt()
}, t => [
  index('plan_tasks_user_day_idx').on(t.userId, t.day),
  uniqueIndex('plan_tasks_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`),
  /** один повтор серии в день — защита от дублей между устройствами */
  uniqueIndex('plan_tasks_series_day_uq').on(t.seriesId, t.day).where(sql`${t.seriesId} is not null`)
]);

/** Заметки: короткие записи без даты (голосом или руками) — во «Входящих» в «Планах» */
export const notes = pgTable('plan_notes', {
  id: id(), userId: owner(),
  text: text('text').notNull(),
  /** voice — продиктовано, manual — написано */
  source: text('source').notNull().default('manual'),
  done: boolean('done').notNull().default(false),
  createdAt: createdAt()
}, t => [index('plan_notes_user_idx').on(t.userId, t.createdAt)]);
