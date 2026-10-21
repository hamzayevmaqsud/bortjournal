CREATE TABLE "study_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" uuid,
	"day" date NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"source" text,
	"text" text NOT NULL,
	"file" text,
	"bytes" integer,
	"quiz" boolean DEFAULT false NOT NULL,
	"quiz_status" text DEFAULT 'none' NOT NULL,
	"quiz_error" text,
	"quiz_done" integer DEFAULT 0 NOT NULL,
	"quiz_total" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"chunk" integer NOT NULL,
	"q" text NOT NULL,
	"options" text[] NOT NULL,
	"correct" integer NOT NULL,
	"explain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_answers" ADD CONSTRAINT "study_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_answers" ADD CONSTRAINT "study_answers_question_id_study_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."study_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_questions" ADD CONSTRAINT "study_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_questions" ADD CONSTRAINT "study_questions_material_id_study_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."study_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_answers_user_day_idx" ON "study_answers" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "study_materials_user_idx" ON "study_materials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_materials_obsidian_uq" ON "study_materials" USING btree ("user_id","source") WHERE "study_materials"."kind" = 'obsidian';--> statement-breakpoint
CREATE INDEX "study_questions_material_idx" ON "study_questions" USING btree ("material_id");