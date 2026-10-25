/** Еда: приёмы пищи, напитки, «мои блюда» и наборы-избранное */
import { sql } from 'drizzle-orm';
import { date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, hhmm, id, legacyId, owner, updatedAt } from '../../db/columns.js';

export const meals = pgTable('food_meals', {
  id: id(), userId: owner(), legacyId: legacyId(),
  day: date('day', { mode: 'string' }).notNull(),
  time: hhmm('time'),
  /** breakfast | lunch | dinner | snack; пусто — по времени */
  slot: text('slot'),
  name: text('name').notNull(),
  kcal: doublePrecision('kcal').notNull().default(0),
  protein: doublePrecision('protein').notNull().default(0),
  fat: doublePrecision('fat').notNull().default(0),
  carbs: doublePrecision('carbs').notNull().default(0),
  /** клетчатка, сахар, соль — null, если неизвестно (не ноль!) */
  fiber: doublePrecision('fiber'),
  sugar: doublePrecision('sugar'),
  salt: doublePrecision('salt'),
  /** manual | photo | text | db — откуда пришла запись */
  source: text('source').notNull().default('manual'),
  createdAt: createdAt(), updatedAt: updatedAt()
}, t => [index('food_meals_user_day_idx').on(t.userId, t.day), uniqueIndex('food_meals_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);

export const drinks = pgTable('food_drinks', {
  id: id(), userId: owner(), legacyId: legacyId(),
  day: date('day', { mode: 'string' }).notNull(),
  time: hhmm('time'),
  /** water | soda | tea | coffee | … | custom */
  type: text('type').notNull(),
  ml: integer('ml').notNull(),
  /** только для custom */
  name: text('name'),
  kcalPer100: doublePrecision('kcal_per_100'),
  sugarPer100: doublePrecision('sugar_per_100'),
  createdAt: createdAt()
}, t => [index('food_drinks_user_day_idx').on(t.userId, t.day), uniqueIndex('food_drinks_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);

/** Блюда, которые человек уже ел: подсказки и поиск «моё» */
export const userFoods = pgTable('food_user_foods', {
  id: id(), userId: owner(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  kcal: doublePrecision('kcal').notNull(),
  protein: doublePrecision('protein').notNull().default(0),
  fat: doublePrecision('fat').notNull().default(0),
  carbs: doublePrecision('carbs').notNull().default(0),
  fiber: doublePrecision('fiber'), sugar: doublePrecision('sugar'), salt: doublePrecision('salt'),
  uses: integer('uses').notNull().default(1),
  lastUsedOn: date('last_used_on', { mode: 'string' })
}, t => [uniqueIndex('food_user_foods_key_uq').on(t.userId, t.key)]);

/** Набор блюд «в избранное»: записать завтрак одним касанием */
export const mealSets = pgTable('food_meal_sets', {
  id: id(), userId: owner(), legacyId: legacyId(),
  name: text('name').notNull(),
  items: jsonb('items').$type<Array<{ name: string; kcal: number; protein: number; fat: number; carbs: number }>>().notNull(),
  createdAt: createdAt()
}, t => [index('food_meal_sets_user_idx').on(t.userId), uniqueIndex('food_meal_sets_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);

/**
 * Черновик приёма: фото еды, которое разбирает воркер. Таблица одновременно и очередь (ADR-0002):
 * queued → working → ready | failed. Фото хранится, пока черновик не подтверждён или не удалён.
 */
/** в очереди → разбирается → готов | не удался */
export type DraftState = 'queued' | 'working' | 'ready' | 'failed';
export const drafts = pgTable('food_drafts', {
  id: id(), userId: owner(),
  /** день и время фото — станут днём и временем приёма */
  day: date('day', { mode: 'string' }).notNull(),
  time: hhmm('time'),
  slot: text('slot'),
  image: text('image'),
  mime: text('mime').notNull(),
  note: text('note').notNull().default(''),
  scale: text('scale').notNull().default(''),
  answers: jsonb('answers').$type<string[]>().notNull().default([]),
  state: text('state').$type<DraftState>().notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  nextAt: timestamp('next_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  result: jsonb('result').$type<{ isFood: boolean; items: unknown[]; questions: Array<{ text: string; options: string[] }>; comment: string }>(),
  error: text('error'),
  createdAt: createdAt(), updatedAt: updatedAt()
}, t => [index('food_drafts_user_day_idx').on(t.userId, t.day), index('food_drafts_queue_idx').on(t.state, t.nextAt)]);
