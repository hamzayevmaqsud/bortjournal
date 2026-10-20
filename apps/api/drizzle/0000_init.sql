CREATE TYPE "public"."entitlement_source" AS ENUM('free', 'trial', 'web', 'apple', 'google');--> statement-breakpoint
CREATE TYPE "public"."module" AS ENUM('food', 'gym', 'study', 'budget', 'books', 'plans', 'body');--> statement-breakpoint
CREATE TABLE "achievements" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"tier" smallint NOT NULL,
	"unlocked_on" date NOT NULL,
	CONSTRAINT "achievements_user_id_key_tier_pk" PRIMARY KEY("user_id","key","tier"),
	CONSTRAINT "achievements_tier_ck" CHECK ("achievements"."tier" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "activity_weeks" (
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "activity_weeks_user_id_week_start_pk" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "day_journal" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"note" text,
	"mood" smallint,
	CONSTRAINT "day_journal_user_id_day_pk" PRIMARY KEY("user_id","day"),
	CONSTRAINT "day_mood_ck" CHECK ("day_journal"."mood" is null or "day_journal"."mood" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module" "module" NOT NULL,
	"source" "entitlement_source" NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"module" "module" NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid,
	"day" date NOT NULL,
	"time" text,
	"title" text NOT NULL,
	"value" double precision,
	"unit" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"sex" text,
	"age" smallint,
	"age_measured_on" date,
	"height_cm" smallint,
	"body_fat" double precision,
	"build" text,
	"experience" text,
	"goal" text,
	"pace" text,
	"target_kg" double precision,
	"start_weight_kg" double precision,
	"started_on" date,
	"planned_steps" integer,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"source_id" text,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "reminder_log" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"day" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_log_user_id_key_day_pk" PRIMARY KEY("user_id","key","day")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tz_offset" smallint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "food_drinks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"day" date NOT NULL,
	"time" text,
	"type" text NOT NULL,
	"ml" integer NOT NULL,
	"name" text,
	"kcal_per_100" double precision,
	"sugar_per_100" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_meal_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"day" date NOT NULL,
	"time" text,
	"slot" text,
	"name" text NOT NULL,
	"kcal" double precision DEFAULT 0 NOT NULL,
	"protein" double precision DEFAULT 0 NOT NULL,
	"fat" double precision DEFAULT 0 NOT NULL,
	"carbs" double precision DEFAULT 0 NOT NULL,
	"fiber" double precision,
	"sugar" double precision,
	"salt" double precision,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_user_foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kcal" double precision NOT NULL,
	"protein" double precision DEFAULT 0 NOT NULL,
	"fat" double precision DEFAULT 0 NOT NULL,
	"carbs" double precision DEFAULT 0 NOT NULL,
	"fiber" double precision,
	"sugar" double precision,
	"salt" double precision,
	"uses" integer DEFAULT 1 NOT NULL,
	"last_used_on" date
);
--> statement-breakpoint
CREATE TABLE "gym_live" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_user_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"muscle_group" text NOT NULL,
	"kind" text NOT NULL,
	"icon" text NOT NULL,
	"equipment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_workout_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"exercise_key" text,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"weekdays" smallint[] NOT NULL,
	"time" text,
	"exercises" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_workout_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_exercise_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"kg" double precision,
	"reps" integer,
	"seconds" integer,
	"minutes" double precision,
	"km" double precision
);
--> statement-breakpoint
CREATE TABLE "gym_workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"day" date NOT NULL,
	"time" text,
	"title" text NOT NULL,
	"minutes" integer,
	"note" text,
	"plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_quizzes" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"items" jsonb NOT NULL,
	"source" text,
	CONSTRAINT "study_quizzes_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "study_srs" (
	"user_id" uuid NOT NULL,
	"card_key" text NOT NULL,
	"interval_days" integer NOT NULL,
	"ease" double precision NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"due_on" date NOT NULL,
	"last_on" date,
	CONSTRAINT "study_srs_user_id_card_key_pk" PRIMARY KEY("user_id","card_key")
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"day" date NOT NULL,
	"time" text,
	"topic" text NOT NULL,
	"category" text,
	"minutes" integer DEFAULT 0 NOT NULL,
	"theses" text[] DEFAULT '{}'::text[] NOT NULL,
	"qa" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_time" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"day" date,
	"minutes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"day" date NOT NULL,
	"time" text,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_kind_ck" CHECK ("budget_entries"."kind" in ('in', 'out')),
	CONSTRAINT "budget_amount_ck" CHECK ("budget_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"start_day" smallint DEFAULT 1 NOT NULL,
	"savings" numeric(14, 2) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT '₼' NOT NULL,
	CONSTRAINT "budget_start_ck" CHECK ("budget_settings"."start_day" between 1 and 28)
);
--> statement-breakpoint
CREATE TABLE "book_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"book_id" uuid NOT NULL,
	"text" text NOT NULL,
	"page" text,
	"added_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"title" text NOT NULL,
	"author" text,
	"pages" integer,
	"current_page" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"format" text DEFAULT 'paper' NOT NULL,
	"genre" text,
	"rating" smallint,
	"owned" boolean DEFAULT false NOT NULL,
	"cover_ol" integer,
	"cover_isbn" text[],
	"cover_key" text,
	"added_on" date,
	"started_on" date,
	"finished_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_rating_ck" CHECK ("books"."rating" is null or "books"."rating" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "book_reading_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"book_id" uuid NOT NULL,
	"day" date NOT NULL,
	"pages" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"period" text NOT NULL,
	"period_key" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"done" boolean DEFAULT false NOT NULL,
	"parent_id" uuid,
	"created_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_task_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"title" text NOT NULL,
	"time" text,
	"prio" boolean DEFAULT false NOT NULL,
	"goal_id" uuid,
	"note" text,
	"rule" jsonb NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date,
	"skip_days" date[] DEFAULT '{}'::date[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_id" text,
	"title" text NOT NULL,
	"day" date,
	"time" text,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"prio" boolean DEFAULT false NOT NULL,
	"goal_id" uuid,
	"series_id" uuid,
	"note" text,
	"created_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "body_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"weight_kg" double precision,
	"steps" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "body_days_user_id_day_pk" PRIMARY KEY("user_id","day"),
	CONSTRAINT "body_weight_ck" CHECK ("body_days"."weight_kg" is null or "body_days"."weight_kg" between 20 and 400),
	CONSTRAINT "body_steps_ck" CHECK ("body_days"."steps" is null or "body_days"."steps" between 0 and 200000)
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_weeks" ADD CONSTRAINT "activity_weeks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_journal" ADD CONSTRAINT "day_journal_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_samples" ADD CONSTRAINT "raw_samples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_samples" ADD CONSTRAINT "raw_samples_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drinks" ADD CONSTRAINT "food_drinks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_meal_sets" ADD CONSTRAINT "food_meal_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_meals" ADD CONSTRAINT "food_meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_user_foods" ADD CONSTRAINT "food_user_foods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_live" ADD CONSTRAINT "gym_live_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_user_exercises" ADD CONSTRAINT "gym_user_exercises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_workout_exercises" ADD CONSTRAINT "gym_workout_exercises_workout_id_gym_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."gym_workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_plans" ADD CONSTRAINT "gym_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_workout_sets" ADD CONSTRAINT "gym_workout_sets_workout_exercise_id_gym_workout_exercises_id_fk" FOREIGN KEY ("workout_exercise_id") REFERENCES "public"."gym_workout_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_workouts" ADD CONSTRAINT "gym_workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_quizzes" ADD CONSTRAINT "study_quizzes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_srs" ADD CONSTRAINT "study_srs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_time" ADD CONSTRAINT "study_time_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_settings" ADD CONSTRAINT "budget_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_quotes" ADD CONSTRAINT "book_quotes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_reading_log" ADD CONSTRAINT "book_reading_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_reading_log" ADD CONSTRAINT "book_reading_log_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_goals" ADD CONSTRAINT "plan_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_task_series" ADD CONSTRAINT "plan_task_series_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_tasks" ADD CONSTRAINT "plan_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_tasks" ADD CONSTRAINT "plan_tasks_series_id_plan_task_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."plan_task_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_days" ADD CONSTRAINT "body_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_user_module_source_uq" ON "entitlements" USING btree ("user_id","module","source");--> statement-breakpoint
CREATE INDEX "entitlements_user_idx" ON "entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_user_day_idx" ON "events" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "events_ref_kind_uq" ON "events" USING btree ("ref_id","kind") WHERE "events"."ref_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_user_provider_uq" ON "integrations" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "raw_samples_user_kind_idx" ON "raw_samples" USING btree ("user_id","kind","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_samples_dedup_uq" ON "raw_samples" USING btree ("integration_id","source_id") WHERE "raw_samples"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email")) WHERE "users"."email" is not null;--> statement-breakpoint
CREATE INDEX "food_drinks_user_day_idx" ON "food_drinks" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "food_drinks_legacy_uq" ON "food_drinks" USING btree ("user_id","legacy_id") WHERE "food_drinks"."legacy_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "food_meal_sets_legacy_uq" ON "food_meal_sets" USING btree ("user_id","legacy_id") WHERE "food_meal_sets"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "food_meals_user_day_idx" ON "food_meals" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "food_meals_legacy_uq" ON "food_meals" USING btree ("user_id","legacy_id") WHERE "food_meals"."legacy_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "food_user_foods_key_uq" ON "food_user_foods" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_user_exercises_legacy_uq" ON "gym_user_exercises" USING btree ("user_id","legacy_id") WHERE "gym_user_exercises"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "gym_workout_exercises_workout_idx" ON "gym_workout_exercises" USING btree ("workout_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_plans_legacy_uq" ON "gym_plans" USING btree ("user_id","legacy_id") WHERE "gym_plans"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "gym_workout_sets_ex_idx" ON "gym_workout_sets" USING btree ("workout_exercise_id","position");--> statement-breakpoint
CREATE INDEX "gym_workouts_user_day_idx" ON "gym_workouts" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_workouts_legacy_uq" ON "gym_workouts" USING btree ("user_id","legacy_id") WHERE "gym_workouts"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "study_srs_due_idx" ON "study_srs" USING btree ("user_id","due_on");--> statement-breakpoint
CREATE INDEX "study_sessions_user_day_idx" ON "study_sessions" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "study_sessions_legacy_uq" ON "study_sessions" USING btree ("user_id","legacy_id") WHERE "study_sessions"."legacy_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "study_time_key_uq" ON "study_time" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "budget_entries_user_day_idx" ON "budget_entries" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_entries_legacy_uq" ON "budget_entries" USING btree ("user_id","legacy_id") WHERE "budget_entries"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "book_quotes_book_idx" ON "book_quotes" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "books_user_status_idx" ON "books" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "books_legacy_uq" ON "books" USING btree ("user_id","legacy_id") WHERE "books"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "book_reading_log_user_day_idx" ON "book_reading_log" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "book_reading_log_legacy_uq" ON "book_reading_log" USING btree ("user_id","legacy_id") WHERE "book_reading_log"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "plan_goals_user_period_idx" ON "plan_goals" USING btree ("user_id","period","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_goals_legacy_uq" ON "plan_goals" USING btree ("user_id","legacy_id") WHERE "plan_goals"."legacy_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_task_series_legacy_uq" ON "plan_task_series" USING btree ("user_id","legacy_id") WHERE "plan_task_series"."legacy_id" is not null;--> statement-breakpoint
CREATE INDEX "plan_tasks_user_day_idx" ON "plan_tasks" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_tasks_legacy_uq" ON "plan_tasks" USING btree ("user_id","legacy_id") WHERE "plan_tasks"."legacy_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_tasks_series_day_uq" ON "plan_tasks" USING btree ("series_id","day") WHERE "plan_tasks"."series_id" is not null;