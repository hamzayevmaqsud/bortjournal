/** Статистика учёбы за n дней (вкладка «Учёба» в «Статистике»): минуты, цель, направления, точность ответов */
import { and, eq, gte, lte } from 'drizzle-orm';
import { addDays } from '@bortjournal/core';
import { userContext } from '../../core/context.js';
import type { Tx } from '../../db/index.js';
import { studySessions } from './schema.js';
import { studyDaily } from './service.js';

const range = (n: number, end: string) => Array.from({ length: n }, (_, k) => addDays(end, k - n + 1));

export async function studyStats(db: Tx, userId: string, n: number) {
  const { today, norms } = await userContext(db, userId), ds = range(n, today), from = ds[0]!, prevFrom = addDays(from, -n);
  const facts = new Map((await studyDaily(db, userId, prevFrom, today)).map(r => [r.day, r]));
  const perDay = ds.map(day => ({ day, minutes: facts.get(day)?.studyMin ?? 0 }));
  const prevTotal = range(n, addDays(from, -1)).reduce((a, d) => a + (facts.get(d)?.studyMin ?? 0), 0);
  const ss = await db.select({ topic: studySessions.topic, category: studySessions.category, minutes: studySessions.minutes }).from(studySessions)
    .where(and(eq(studySessions.userId, userId), gte(studySessions.day, from), lte(studySessions.day, today)));
  const cat = new Map<string, number>();
  for (const s of ss) cat.set(s.category || 'Без категории', (cat.get(s.category || 'Без категории') ?? 0) + s.minutes);
  const inRange = ds.map(d => facts.get(d)).filter(Boolean) as Array<NonNullable<ReturnType<typeof facts.get>>>;
  const answered = inRange.reduce((a, r) => a + r.quizAnswered, 0), good = inRange.reduce((a, r) => a + r.quizGood, 0);
  return {
    days: n, today, goal: norms.study, perDay,
    total: perDay.reduce((a, d) => a + d.minutes, 0), prevTotal,
    activeDays: perDay.filter(d => d.minutes > 0).length, goalDays: perDay.filter(d => d.minutes >= norms.study).length,
    topics: new Set(ss.map(s => s.topic.trim().toLowerCase())).size,
    categories: [...cat].map(([name, minutes]) => ({ name, minutes })).filter(c => c.minutes > 0).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name)),
    answers: { n: answered, good },
    accuracy: ds.slice(-60).map(d => facts.get(d)).filter(r => r && r.quizAnswered > 0).map(r => ({ day: r!.day, pct: Math.round(r!.quizGood / r!.quizAnswered * 100), n: r!.quizAnswered }))
  };
}
