ALTER TYPE "public"."module" ADD VALUE 'pro';--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "plan" text;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "auto_renew" boolean DEFAULT false NOT NULL;