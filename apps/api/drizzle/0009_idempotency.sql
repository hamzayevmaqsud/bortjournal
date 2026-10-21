CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"status" integer DEFAULT 0 NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idempotency_created_idx" ON "idempotency_keys" USING btree ("created_at");