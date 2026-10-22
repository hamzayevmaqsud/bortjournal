CREATE TABLE "study_note_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"day" date NOT NULL,
	"time" text NOT NULL,
	"kind" text NOT NULL,
	"added" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_note_log" ADD CONSTRAINT "study_note_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_note_log" ADD CONSTRAINT "study_note_log_material_id_study_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."study_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_note_log_day_uq" ON "study_note_log" USING btree ("material_id","day");--> statement-breakpoint
CREATE INDEX "study_note_log_user_idx" ON "study_note_log" USING btree ("user_id","day");