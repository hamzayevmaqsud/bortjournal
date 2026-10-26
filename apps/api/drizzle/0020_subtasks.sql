ALTER TABLE "plan_tasks" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_tasks" ADD CONSTRAINT "plan_tasks_parent_id_plan_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."plan_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_tasks_parent_idx" ON "plan_tasks" USING btree ("parent_id");