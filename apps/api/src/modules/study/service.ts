import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { answersByDay, queueOf } from './mc.js';
import type { DayContext, Nudge } from '../../core/module.js';
import type { Tx } from '../../db/index.js';
import { answers, quizzes, studySessions, studyTime } from './schema.js';

export async function studyToday({ db, userId, day, settings, now }: DayContext) {
  const [s] = await db.select({ min: sql<number>`coalesce(sum(${studySessions.minutes}), 0)::int` }).from(studySessions).where(and(eq(studySessions.userId, userId), eq(studySessions.day, day)));
  const [t] = await db.select({ min: sql<number>`coalesce(sum(${studyTime.minutes}), 0)::int` }).from(studyTime).where(and(eq(studyTime.userId, userId), eq(studyTime.day, day)));
  // вопросы — только если хоть по одному конспекту их попросили; прошлые дни — что было отвечено
  let quiz: { left: number; total: number } | null = null;
  if (day === now.day) { const q = await queueOf(db, userId, day); if (q.mats.length) quiz = { left: q.queue.length, total: q.queue.length + q.todayRows.length }; }
  else { const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(answers).where(and(eq(answers.userId, userId), eq(answers.day, day))); if (a?.n) quiz = { left: 0, total: a.n }; }
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
  // старые порции (до вопросов с вариантами) и новые ответы
  const qs = await db.select().from(quizzes).where(and(eq(quizzes.userId, userId), gte(quizzes.day, from), lte(quizzes.day, to)));
  for (const q of qs) { const items = (q.items as Array<{ result?: string | null }>) ?? [], r = at(q.day); r.quizTotal += items.length; r.quizAnswered += items.filter(i => i.result).length; r.quizGood += items.filter(i => i.result === 'good').length; }
  for (const r of await answersByDay(db, userId, from, to)) { const x = at(r.day); x.quizTotal += r.n; x.quizAnswered += r.n; x.quizGood += r.good; }
  return [...by.values()];
}

/** вопросы на повторение — в 10 утра, если есть что повторять */
export async function studyRemind(ctx: DayContext & { min: number }): Promise<Nudge[]> {
  const { quiz } = await studyToday({ ...ctx, day: ctx.now.day });
  return quiz && quiz.left > 0 ? [{ key: 'quiz', kind: 'quiz', title: `Вопросы дня: ${quiz.left}`, body: 'Пара минут — и знания не выветрятся.', url: '/#study', at: 10 * 60 }] : [];
}
