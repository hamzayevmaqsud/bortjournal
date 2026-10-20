/** Учёба: занятия, карточки интервального повторения, порции вопросов, время по конспектам */
import { sql } from 'drizzle-orm';
import { date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../core/schema.js';
import { createdAt, hhmm, id, legacyId, owner, updatedAt } from '../../db/columns.js';

export const studySessions = pgTable('study_sessions', {
  id: id(), userId: owner(), legacyId: legacyId(),
  day: date('day', { mode: 'string' }).notNull(),
  time: hhmm('time'),
  topic: text('topic').notNull(),
  category: text('category'),
  minutes: integer('minutes').notNull().default(0),
  theses: text('theses').array().notNull().default(sql`'{}'::text[]`),
  qa: jsonb('qa').$type<Array<{ q: string; a: string }>>().notNull().default([]),
  createdAt: createdAt(), updatedAt: updatedAt()
}, t => [index('study_sessions_user_day_idx').on(t.userId, t.day), uniqueIndex('study_sessions_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);

/** Состояние карточки в интервальном повторении. card_key — стабильный ключ (тезис занятия или раздел конспекта) */
export const srsCards = pgTable('study_srs', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cardKey: text('card_key').notNull(),
  intervalDays: integer('interval_days').notNull(),
  ease: doublePrecision('ease').notNull(),
  reps: integer('reps').notNull().default(0),
  dueOn: date('due_on', { mode: 'string' }).notNull(),
  lastOn: date('last_on', { mode: 'string' })
}, t => [primaryKey({ columns: [t.userId, t.cardKey] }), index('study_srs_due_idx').on(t.userId, t.dueOn)]);

/** Порция вопросов на день — вопросы и ответы целиком, чтобы день не менялся задним числом */
export const quizzes = pgTable('study_quizzes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  items: jsonb('items').notNull(),
  source: text('source')
}, t => [primaryKey({ columns: [t.userId, t.day] })]);

/** Минуты, вписанные к записям дневника конспектов */
export const studyTime = pgTable('study_time', {
  id: id(), userId: owner(),
  key: text('key').notNull(),
  day: date('day', { mode: 'string' }),
  minutes: integer('minutes').notNull()
}, t => [uniqueIndex('study_time_key_uq').on(t.userId, t.key)]);
