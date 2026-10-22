CREATE TABLE "gcal_events" (
	"user_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"day" date NOT NULL,
	"time" text,
	"minutes" integer,
	"title" text NOT NULL,
	CONSTRAINT "gcal_events_user_id_event_id_day_pk" PRIMARY KEY("user_id","event_id","day")
);
--> statement-breakpoint
CREATE TABLE "gcal_links" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"event_id" text NOT NULL,
	"hash" text NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "gcal_links_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "gcal_events" ADD CONSTRAINT "gcal_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gcal_links" ADD CONSTRAINT "gcal_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gcal_events_user_day_idx" ON "gcal_events" USING btree ("user_id","day");