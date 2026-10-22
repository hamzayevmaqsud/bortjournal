CREATE TABLE "food_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"time" text,
	"slot" text,
	"image" text,
	"mime" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"scale" text DEFAULT '' NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_drafts" ADD CONSTRAINT "food_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_drafts_user_day_idx" ON "food_drafts" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "food_drafts_queue_idx" ON "food_drafts" USING btree ("state","next_at");