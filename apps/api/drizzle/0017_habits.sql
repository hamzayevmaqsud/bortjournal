ALTER TYPE "public"."module" ADD VALUE 'habits' BEFORE 'pro';--> statement-breakpoint
CREATE TABLE "habit_checks" (
	"habit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"icon" text,
	"color" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habits_title_ck" CHECK (char_length("habits"."title") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "habit_checks" ADD CONSTRAINT "habit_checks_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_checks" ADD CONSTRAINT "habit_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "habit_checks_habit_day_uq" ON "habit_checks" USING btree ("habit_id","day");--> statement-breakpoint
CREATE INDEX "habit_checks_user_day_idx" ON "habit_checks" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "habits_user_idx" ON "habits" USING btree ("user_id","sort");