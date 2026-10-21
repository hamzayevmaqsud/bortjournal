/**
 * Ядро: пользователи, сессии, профиль, доступ к модулям, лента событий,
 * интеграции, напоминания и достижения. Модули ссылаются только на users.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, check, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey,
  smallint, text, timestamp, uniqueIndex, uuid
} from 'drizzle-orm/pg-core';
import { ENTITLEMENT_SOURCES, MODULES } from '@bortjournal/core';

export const moduleEnum = pgEnum('module', MODULES);
export const entitlementSourceEnum = pgEnum('entitlement_source', ENTITLEMENT_SOURCES);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull(),
  email: text('email'),
  /** scrypt$N$r$p$соль$хеш — формат переносится из старого журнала без изменений */
  /** null — вход только через Google или Apple, пароль не задан */
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** часовой пояс: смещение от UTC в минутах — по нему считаются «сегодня» и напоминания */
  tzOffset: smallint('tz_offset').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, t => [
  uniqueIndex('users_username_uq').on(sql`lower(${t.username})`),
  uniqueIndex('users_email_uq').on(sql`lower(${t.email})`).where(sql`${t.email} is not null`)
]);

/** Сколько раз за местный день человек обращался к ИИ — по видам (лимиты и расход) */
export const aiUsage = pgTable('ai_usage', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  kind: text('kind').notNull(),
  count: integer('count').notNull().default(0)
}, t => [primaryKey({ columns: [t.userId, t.day, t.kind] })]);

/**
 * Личные ключи для внешних клиентов: «Команды» на iPhone (голосовая запись) и подписка календаря.
 * В базе — только sha256 ключа; сам ключ показывается один раз при создании.
 */
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** capture — запись голосом, calendar — подписка календаря */
  kind: text('kind').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true })
}, t => [uniqueIndex('api_tokens_hash_uq').on(t.tokenHash), uniqueIndex('api_tokens_user_kind_uq').on(t.userId, t.kind)]);

/** Способы входа кроме пароля: Google и Apple. subject — постоянный id человека у провайдера */
export const authIdentities = pgTable('auth_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [uniqueIndex('auth_identities_provider_subject_uq').on(t.provider, t.subject), uniqueIndex('auth_identities_user_provider_uq').on(t.userId, t.provider)]);

export const sessions = pgTable('sessions', {
  /** sha256 от токена из cookie — сам токен в базе не хранится */
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  userAgent: text('user_agent')
}, t => [index('sessions_user_idx').on(t.userId)]);

/** Анкета и личные нормы. settings — то, что человек правит руками (ккал, белок, шаги, напоминания…) */
export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  sex: text('sex'),
  age: smallint('age'),
  ageMeasuredOn: date('age_measured_on', { mode: 'string' }),
  heightCm: smallint('height_cm'),
  bodyFat: doublePrecision('body_fat'),
  build: text('build'),
  experience: text('experience'),
  goal: text('goal'),
  pace: text('pace'),
  targetKg: doublePrecision('target_kg'),
  startWeightKg: doublePrecision('start_weight_kg'),
  startedOn: date('started_on', { mode: 'string' }),
  plannedSteps: integer('planned_steps'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/** Активность на неделю (понедельник → уровень) — от неё зависит план калорий */
export const activityWeeks = pgTable('activity_weeks', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  weekStart: date('week_start', { mode: 'string' }).notNull(),
  level: text('level').notNull()
}, t => [primaryKey({ columns: [t.userId, t.weekStart] })]);

/** Доступ к модулю. Middleware проверяет его на каждом запросе модуля, фронт по нему показывает разделы */
export const entitlements = pgTable('entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  module: moduleEnum('module').notNull(),
  source: entitlementSourceEnum('source').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  /** null — бессрочно */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** id подписки во внешней платёжке, когда она появится */
  externalRef: text('external_ref'),
  /** month | year — для покупок */
  plan: text('plan'),
  autoRenew: boolean('auto_renew').notNull().default(false),
  /** «свой набор»: открытые разделы (PackKey); null — весь Pro */
  features: text('features').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  uniqueIndex('entitlements_user_module_source_uq').on(t.userId, t.module, t.source),
  index('entitlements_user_idx').on(t.userId)
]);

/**
 * Лента событий: каждый модуль коротко пишет «что и когда». Из неё строятся лента дня,
 * итог недели и выводы между модулями — без join по десятку таблиц.
 * ref_id указывает на запись модуля; при её удалении событие удаляет сам модуль.
 */
export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  module: moduleEnum('module').notNull(),
  kind: text('kind').notNull(),
  refId: uuid('ref_id'),
  day: date('day', { mode: 'string' }).notNull(),
  time: text('time'),
  title: text('title').notNull(),
  value: doublePrecision('value'),
  unit: text('unit'),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  index('events_user_day_idx').on(t.userId, t.day),
  uniqueIndex('events_ref_kind_uq').on(t.refId, t.kind).where(sql`${t.refId} is not null`)
]);

/** Подключения к внешним сервисам (Apple Health и т. п.) — с явным согласием и областью доступа */
export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('active'),
  scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
  /** токены — только зашифрованными (ключ вне базы) */
  secretEnc: text('secret_enc'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [uniqueIndex('integrations_user_provider_uq').on(t.userId, t.provider)]);

/** Сырые данные с устройств — отдельно от ручных записей и с указанием источника */
export const rawSamples = pgTable('raw_samples', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  value: doublePrecision('value').notNull(),
  unit: text('unit').notNull(),
  sourceId: text('source_id'),
  payload: jsonb('payload')
}, t => [
  index('raw_samples_user_kind_idx').on(t.userId, t.kind, t.startAt),
  uniqueIndex('raw_samples_dedup_uq').on(t.integrationId, t.sourceId).where(sql`${t.sourceId} is not null`)
]);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [uniqueIndex('push_endpoint_uq').on(t.endpoint)]);

/** Что из напоминаний уже отправлено — защита от дублей, в том числе при нескольких воркерах */
export const reminderLog = pgTable('reminder_log', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  day: date('day', { mode: 'string' }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow()
}, t => [primaryKey({ columns: [t.userId, t.key, t.day] })]);

export const achievements = pgTable('achievements', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  tier: smallint('tier').notNull(),
  unlockedOn: date('unlocked_on', { mode: 'string' }).notNull()
}, t => [primaryKey({ columns: [t.userId, t.key, t.tier] }), check('achievements_tier_ck', sql`${t.tier} between 0 and 3`)]);

/** Заметка и настроение дня — общее для всех модулей */
export const dayJournal = pgTable('day_journal', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  note: text('note'),
  mood: smallint('mood')
}, t => [primaryKey({ columns: [t.userId, t.day] }), check('day_mood_ck', sql`${t.mood} is null or ${t.mood} between 1 and 5`)]);
