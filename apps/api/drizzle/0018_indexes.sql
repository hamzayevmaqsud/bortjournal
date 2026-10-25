CREATE INDEX "feedback_user_idx" ON "feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_demo_until_idx" ON "users" USING btree ("demo_until") WHERE "users"."demo_until" is not null;--> statement-breakpoint
CREATE INDEX "food_meal_sets_user_idx" ON "food_meal_sets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gym_user_exercises_user_idx" ON "gym_user_exercises" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gym_plans_user_idx" ON "gym_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "study_answers_question_idx" ON "study_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "study_questions_user_idx" ON "study_questions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "book_reading_log_book_idx" ON "book_reading_log" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "plan_task_series_user_idx" ON "plan_task_series" USING btree ("user_id");