/** Статистика чтения за n дней (вкладка «Книги» в «Статистике»): страницы, серия, книги года по месяцам, жанры, скорость */
import { and, eq, gte, lte } from 'drizzle-orm';
import { addDays, diffDays } from '@bortjournal/core';
import { userContext } from '../../core/context.js';
import { profiles } from '../../core/schema.js';
import type { Tx } from '../../db/index.js';
import { books, readingLog } from './schema.js';

const range = (n: number, end: string) => Array.from({ length: n }, (_, k) => addDays(end, k - n + 1));

export async function booksStats(db: Tx, userId: string, n: number) {
  const { today } = await userContext(db, userId), ds = range(n, today), year = +today.slice(0, 4);
  const log = await db.select({ day: readingLog.day, pages: readingLog.pages }).from(readingLog)
    .where(and(eq(readingLog.userId, userId), gte(readingLog.day, addDays(today, -Math.max(2 * n + 1, 400))), lte(readingLog.day, today)));
  const by = new Map<string, number>();
  for (const l of log) by.set(l.day, (by.get(l.day) ?? 0) + l.pages);
  // серия: дни подряд с чтением; сегодня ещё не читал — серия не прерывается
  let streak = 0;
  for (let d = by.get(today) ? today : addDays(today, -1); by.get(d); d = addDays(d, -1)) streak++;
  const done = (await db.select().from(books).where(and(eq(books.userId, userId), eq(books.status, 'done'))));
  const thisYear = done.filter(b => b.finishedOn?.startsWith(String(year)));
  const genres = new Map<string, number>();
  for (const b of done) genres.set(b.genre || 'Без жанра', (genres.get(b.genre || 'Без жанра') ?? 0) + 1);
  const speed = done.filter(b => b.startedOn && b.finishedOn && b.pages && b.finishedOn >= b.startedOn).map(b => b.pages! / (diffDays(b.startedOn!, b.finishedOn!) + 1));
  const [p] = await db.select({ settings: profiles.settings }).from(profiles).where(eq(profiles.userId, userId));
  const perDay = ds.map(day => ({ day, pages: by.get(day) ?? 0 }));
  return {
    days: n, today, perDay, total: perDay.reduce((a, d) => a + d.pages, 0), readDays: perDay.filter(d => d.pages).length,
    prevTotal: range(n, addDays(ds[0]!, -1)).reduce((a, d) => a + (by.get(d) ?? 0), 0),
    streak, year, doneYear: thisYear.length, goal: Number((p?.settings as Record<string, unknown> | undefined)?.booksGoal) || 12,
    speed: speed.length ? Math.round(speed.reduce((a, v) => a + v, 0) / speed.length) : null,
    months: Array.from({ length: 12 }, (_, k) => { const key = `${year}-${String(k + 1).padStart(2, '0')}`, xs = thisYear.filter(b => b.finishedOn!.startsWith(key)); return { n: xs.length, titles: xs.map(b => b.title) }; }),
    genres: [...genres].map(([name, n2]) => ({ name, n: n2 })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  };
}
