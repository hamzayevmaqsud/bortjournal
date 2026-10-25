/** Учёба: занятия, карточки интервального повторения, порции вопросов, время по конспектам */
import { sql } from 'drizzle-orm';
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

/**
 * Конспекты: загруженные файлы (PDF, Word, текст), ссылки и конспекты Obsidian, для которых попросили вопросы.
 * text — извлечённый текст в Markdown. Вопросы появляются только по просьбе (quiz = true).
 */
export const materials = pgTable('study_materials', {
  id: id(), userId: owner(),
  /** pdf | docx | text | link | obsidian */
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  /** имя файла, адрес страницы или путь заметки в Obsidian */
  source: text('source'),
  text: text('text').notNull(),
  /** оригинал файла лежит на диске (STUDY_FILES_DIR) */
  file: text('file'),
  bytes: integer('bytes'),
  quiz: boolean('quiz').notNull().default(false),
  /** none | working | ready | error */
  quizStatus: text('quiz_status').notNull().default('none'),
  quizError: text('quiz_error'),
  quizDone: integer('quiz_done').notNull().default(0),
  quizTotal: integer('quiz_total').notNull().default(0),
  /** заметку удалили в Obsidian: конспект в архиве — не в списке и не в вопросах, история ответов цела */
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt()
}, t => [index('study_materials_user_idx').on(t.userId), uniqueIndex('study_materials_obsidian_uq').on(t.userId, t.source).where(sql`${t.kind} = 'obsidian'`)]);

/**
 * Дневник конспектов из Obsidian: какие разделы ## дописаны и изменены. Одна запись на конспект в день —
 * правки за день сливаются в неё. kind: new — конспект появился в этот день, edit — дописан или изменён.
 */
export const noteLog = pgTable('study_note_log', {
  id: id(), userId: owner(),
  materialId: uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  time: hhmm('time').notNull(),
  kind: text('kind').notNull(),
  added: jsonb('added').$type<string[]>().notNull().default([]),
  changed: jsonb('changed').$type<string[]>().notNull().default([]),
  createdAt: createdAt(), updatedAt: updatedAt()
}, t => [uniqueIndex('study_note_log_day_uq').on(t.materialId, t.day), index('study_note_log_user_idx').on(t.userId, t.day)]);

/** Вопрос с вариантами ответа (ровно один верный) по куску конспекта */
export const questions = pgTable('study_questions', {
  id: id(), userId: owner(),
  materialId: uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  chunk: integer('chunk').notNull(),
  q: text('q').notNull(),
  options: text('options').array().notNull(),
  correct: integer('correct').notNull(),
  explain: text('explain'),
  createdAt: createdAt()
}, t => [index('study_questions_material_idx').on(t.materialId), index('study_questions_user_idx').on(t.userId)]);

/** Ответы на вопросы: из них прогресс дня и точность */
export const answers = pgTable('study_answers', {
  id: id(), userId: owner(),
  questionId: uuid('question_id').references(() => questions.id, { onDelete: 'set null' }),
  day: date('day', { mode: 'string' }).notNull(),
  correct: boolean('correct').notNull(),
  createdAt: createdAt()
}, t => [index('study_answers_user_day_idx').on(t.userId, t.day), index('study_answers_question_idx').on(t.questionId)]);
