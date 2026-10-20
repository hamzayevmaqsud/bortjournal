import { and, desc, eq, sql } from 'drizzle-orm';
import type { DayContext } from '../../core/module.js';
import { books, readingLog } from './schema.js';

export async function booksToday({ db, userId, day }: DayContext) {
  const [b] = await db.select().from(books).where(and(eq(books.userId, userId), eq(books.status, 'reading'))).orderBy(desc(books.updatedAt)).limit(1);
  if (!b) return { reading: null };
  const [t] = await db.select({ pages: sql<number>`coalesce(sum(${readingLog.pages}), 0)::int` }).from(readingLog).where(and(eq(readingLog.bookId, b.id), eq(readingLog.day, day)));
  const pct = b.pages ? Math.min(100, Math.round(b.currentPage / b.pages * 100)) : 0;
  return { reading: { id: b.id, title: b.title, page: b.currentPage, pages: b.pages, pct, todayPages: t?.pages ?? 0 } };
}
