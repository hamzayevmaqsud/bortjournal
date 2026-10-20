import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import type { DayContext } from '../../core/module.js';
import type { Tx } from '../../db/index.js';
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

/** минуты учёбы и ответы на вопросы по дням */
export async function studyDaily(db: Tx, userId: string, from: string, to: string) {
  const by = new Map<string, { day: string; studyMin: number; quizTotal: number; quizAnswered: number; quizGood: number }>();
  const at = (day: string) => by.get(day) ?? by.set(day, { day, studyMin: 0, quizTotal: 0, quizAnswered: 0, quizGood: 0 }).get(day)!;
  const ss = await db.select({ day: studySessions.day, m: sql<number>`sum(${studySessions.minutes})::int` }).from(studySessions).where(and(eq(studySessions.userId, userId), gte(studySessions.day, from), lte(studySessions.day, to))).groupBy(studySessions.day);
  for (const r of ss) at(r.day).studyMin += r.m;
  const ts = await db.select({ day: studyTime.day, m: sql<number>`sum(${studyTime.minutes})::int` }).from(studyTime).where(and(eq(studyTime.userId, userId), gte(studyTime.day, from), lte(studyTime.day, to))).groupBy(studyTime.day);
  for (const r of ts) if (r.day) at(r.day).studyMin += r.m;
  const qs = await db.select().from(quizzes).where(and(eq(quizzes.userId, userId), gte(quizzes.day, from), lte(quizzes.day, to)));
  for (const q of qs) { const items = (q.items as Array<{ result?: string | null }>) ?? [], r = at(q.day); r.quizTotal += items.length; r.quizAnswered += items.filter(i => i.result).length; r.quizGood += items.filter(i => i.result === 'good').length; }
  return [...by.values()];
}
