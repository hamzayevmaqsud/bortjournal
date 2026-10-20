/** Зал: свои упражнения, тренировки → упражнения → подходы, планы, идущая тренировка */
import { sql } from 'drizzle-orm';
import { date, doublePrecision, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../core/schema.js';
import { createdAt, hhmm, id, legacyId, owner, updatedAt } from '../../db/columns.js';

/** Свои упражнения. Встроенный каталог живёт в коде (@bortjournal/core), в базе — только добавленные */
export const userExercises = pgTable('gym_user_exercises', {
  id: id(), userId: owner(), legacyId: legacyId(),
  name: text('name').notNull(),
  muscleGroup: text('muscle_group').notNull(),
  /** w — вес×повторы, bw — свой вес, t — время, c — кардио */
  kind: text('kind').notNull(),
  icon: text('icon').notNull(),
  equipment: text('equipment'),
  createdAt: createdAt()
}, t => [uniqueIndex('gym_user_exercises_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);

export const workouts = pgTable('gym_workouts', {
  id: id(), userId: owner(), legacyId: legacyId(),
  day: date('day', { mode: 'string' }).notNull(),
  time: hhmm('time'),
  title: text('title').notNull(),
  minutes: integer('minutes'),
  note: text('note'),
  planId: uuid('plan_id'),
  createdAt: createdAt(), updatedAt: updatedAt()
}, t => [index('gym_workouts_user_day_idx').on(t.userId, t.day), uniqueIndex('gym_workouts_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);

export const workoutExercises = pgTable('gym_workout_exercises', {
  id: id(),
  workoutId: uuid('workout_id').notNull().references(() => workouts.id, { onDelete: 'cascade' }),
  position: smallint('position').notNull(),
  /** id из каталога или своего упражнения; null — старая запись только с названием */
  exerciseKey: text('exercise_key'),
  name: text('name').notNull()
}, t => [index('gym_workout_exercises_workout_idx').on(t.workoutId, t.position)]);

export const workoutSets = pgTable('gym_workout_sets', {
  id: id(),
  workoutExerciseId: uuid('workout_exercise_id').notNull().references(() => workoutExercises.id, { onDelete: 'cascade' }),
  position: smallint('position').notNull(),
  kg: doublePrecision('kg'),
  reps: integer('reps'),
  seconds: integer('seconds'),
  minutes: doublePrecision('minutes'),
  km: doublePrecision('km')
}, t => [index('gym_workout_sets_ex_idx').on(t.workoutExerciseId, t.position)]);

export const workoutPlans = pgTable('gym_plans', {
  id: id(), userId: owner(), legacyId: legacyId(),
  name: text('name').notNull(),
  /** дни недели: 0 — вс … 6 — сб */
  weekdays: smallint('weekdays').array().notNull(),
  time: hhmm('time'),
  exercises: jsonb('exercises').$type<Array<{ exerciseKey: string | null; name: string; sets: number }>>().notNull(),
  createdAt: createdAt()
}, t => [uniqueIndex('gym_plans_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);

/** Идущая тренировка — черновик, переживает закрытие приложения; одна на человека */
export const liveWorkouts = pgTable('gym_live', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
