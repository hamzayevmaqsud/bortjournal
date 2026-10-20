import { and, count, eq, lte, sql } from 'drizzle-orm';
import type { DayContext } from '../../core/module.js';
import { quizzes, srsCards, studySessions, studyTime } from './schema.js';

/** порция вопросов в день — как в старом журнале */
const QUIZ_SIZE = 6;

export async function studyToday({ db, userId, day, settings }: DayContext) {
  const [s] = await db.select({ min: sql<number>`coalesce(sum(${studySessions.minutes}), 0)::int` }).from(studySessions).where(and(eq(studySessions.userId, userId), eq(studySessions.day, day)));
  const [t] = await db.select({ min: sql<number>`coalesce(sum(${studyTime.minutes}), 0)::int` }).from(studyTime).where(and(eq(studyTime.userId, userId), eq(studyTime.day, day)));
  const [q] = await db.select().from(quizzes).where(and(eq(quizzes.userId, userId), eq(quizzes.day, day)));
  let quiz: { left: number; total: number };
  if (q) { const items = (q.items as Array<{ result?: string | null }>) ?? []; quiz = { left: items.filter(i => !i.result).length, total: items.length }; }
  else { const [d] = await db.select({ n: count() }).from(srsCards).where(and(eq(srsCards.userId, userId), lte(srsCards.dueOn, day))); quiz = { left: Math.min(QUIZ_SIZE, d!.n), total: Math.min(QUIZ_SIZE, d!.n) }; }
  return { minutes: (s?.min ?? 0) + (t?.min ?? 0), goal: Number(settings.study) || 60, quiz };
}
