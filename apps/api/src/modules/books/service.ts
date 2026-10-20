import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DayContext } from '../../core/module.js';
import type { Tx } from '../../db/index.js';
import { bookQuotes, books, readingLog } from './schema.js';

export async function booksToday({ db, userId, day }: DayContext) {
  const [b] = await db.select().from(books).where(and(eq(books.userId, userId), eq(books.status, 'reading'))).orderBy(desc(books.updatedAt)).limit(1);
  if (!b) return { reading: null };
  const [t] = await db.select({ pages: sql<number>`coalesce(sum(${readingLog.pages}), 0)::int` }).from(readingLog).where(and(eq(readingLog.bookId, b.id), eq(readingLog.day, day)));
  const pct = b.pages ? Math.min(100, Math.round(b.currentPage / b.pages * 100)) : 0;
  return { reading: { id: b.id, title: b.title, page: b.currentPage, pages: b.pages, pct, todayPages: t?.pages ?? 0 } };
}

/** страницы по дням */
export async function booksDaily(db: Tx, userId: string, from: string, to: string) {
  const rows = await db.select({ day: readingLog.day, p: sql<number>`sum(${readingLog.pages})::int` }).from(readingLog)
    .where(and(eq(readingLog.userId, userId), gte(readingLog.day, from), lte(readingLog.day, to))).groupBy(readingLog.day);
  return rows.map(r => ({ day: r.day, pages: r.p }));
}
/** книги за всё время: дочитано, в коллекции, цитаты, страницы (дочитанные без журнала — целиком, как в старом журнале) */
export async function booksTotals(db: Tx, userId: string) {
  const bs = await db.select({ id: books.id, title: books.title, status: books.status, owned: books.owned, pages: books.pages, finishedOn: books.finishedOn }).from(books).where(eq(books.userId, userId));
  const [q] = await db.select({ n: sql<number>`count(*)::int` }).from(bookQuotes).innerJoin(books, eq(bookQuotes.bookId, books.id)).where(eq(books.userId, userId));
  const logged = await db.select({ book: readingLog.bookId, p: sql<number>`sum(${readingLog.pages})::int` }).from(readingLog).where(eq(readingLog.userId, userId)).groupBy(readingLog.bookId);
  const withLog = new Set(logged.map(l => l.book));
  const done = bs.filter(b => b.status === 'done');
  return {
    booksDone: done.length, booksOwned: bs.filter(b => b.owned).length, quotes: q?.n ?? 0,
    pagesTotal: logged.reduce((a, l) => a + l.p, 0) + done.filter(b => !withLog.has(b.id)).reduce((a, b) => a + (b.pages ?? 0), 0),
    booksDoneInRange: done.filter(b => b.finishedOn).map(b => ({ title: b.title, day: b.finishedOn! }))
  };
}
