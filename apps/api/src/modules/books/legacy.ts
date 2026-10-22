/** Перенос книг: полка, цитаты (пересоздаются целиком), журнал чтения */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { recordEvents } from '../../core/events.js';
import { isDay, list, num, optStr, owned, str, uniqById } from '../../core/legacy.js';
import type { ImportCheck, ImportContext, LegacyState } from '../../core/module.js';
import { upsertByLegacy } from '../../db/upsert.js';
import { COVERS } from './files.js';
import { bookQuotes, books, readingLog } from './schema.js';

const STATUS = new Set(['reading', 'want', 'done', 'drop']);
const day = (v: unknown) => (isDay(v) ? v : null);
const validBooks = (st: LegacyState) => uniqById(list(st.books)).filter(b => str(b?.title));

export async function importBooks({ db, userId, warn, dataDir, username }: ImportContext, st: LegacyState) {
  const bs = validBooks(st);
  // уже перенесённые свои обложки (повторный импорт, файл выгрузки без папки data) — не терять
  const before = new Map((await db.select({ legacyId: books.legacyId, coverKey: books.coverKey }).from(books).where(eq(books.userId, userId))).map(b => [b.legacyId, b.coverKey]));
  const ids = await upsertByLegacy(db, books, bs.map(b => ({
    userId, legacyId: String(b.id), title: str(b.title, 200), author: optStr(b.author, 160), pages: num(b.pages) ? Math.round(num(b.pages)) : null, currentPage: Math.round(num(b.page)),
    status: STATUS.has(b.status) ? b.status : 'want', format: ['paper', 'ebook', 'audio'].includes(b.format) ? b.format : 'paper', genre: optStr(b.genre, 40),
    rating: num(b.rating) ? Math.min(5, Math.max(0, Math.round(num(b.rating)))) : null, owned: !!b.owned,
    coverOl: Number.isInteger(b.cover?.ol) ? b.cover.ol : null, coverIsbn: list<string>(b.cover?.isbn).filter(x => /^\d{9}[\dX]$/.test(x)), coverKey: b.cover?.mine ? `legacy/${b.id}.jpg` : null,
    addedOn: day(b.added), startedOn: day(b.started), finishedOn: day(b.finished), notes: optStr(b.notes, 5000)
  })));
  const bookIds = [...ids.values()];
  // свои обложки: файл старого журнала копируется к новой версии; нет файла — нет и обложки
  const oldDir = dataDir && username ? path.join(dataDir, 'covers', 'u', crypto.createHash('sha256').update(username).digest('hex').slice(0, 16)) : null;
  for (const b of bs.filter(x => x.cover?.mine)) {
    const id = ids.get(String(b.id))!, src = oldDir ? path.join(oldDir, `${String(b.id).replace(/[^a-z0-9]/gi, '')}.jpg`) : '';
    const had = before.get(String(b.id));
    let key: string | null = had && !had.startsWith('legacy/') ? had : null;
    if (src && fs.existsSync(src)) {
      key = path.join('u', userId, `${id}.jpg`);
      fs.mkdirSync(path.join(COVERS(), 'u', userId), { recursive: true }); fs.copyFileSync(src, path.join(COVERS(), key));
    } else if (!key) warn(`книги: своя обложка «${str(b.title, 60)}» не нашлась — книга без обложки`);
    await db.update(books).set({ coverKey: key }).where(and(eq(books.id, id), eq(books.userId, userId)));
  }
  if (bookIds.length) await db.delete(bookQuotes).where(inArray(bookQuotes.bookId, bookIds));
  const qs = bs.flatMap(b => list(b.quotes).filter(q => str(q?.text)).map(q => ({ bookId: ids.get(String(b.id))!, legacyId: optStr(q.id), text: str(q.text, 1200), page: optStr(q.page, 10), addedOn: day(q.date) })));
  if (qs.length) await db.insert(bookQuotes).values(qs);
  const logs = uniqById(list(st.readLog)).filter(r => isDay(r?.date) && num(r?.pages) > 0);
  const orphan = logs.filter(r => !ids.has(String(r.book)));
  if (orphan.length) warn(`книги: ${orphan.length} записей чтения без книги — пропущены`);
  const logIds = await upsertByLegacy(db, readingLog, logs.filter(r => ids.has(String(r.book))).map(r => ({ userId, legacyId: String(r.id), bookId: ids.get(String(r.book))!, day: r.date, pages: Math.round(num(r.pages)) })));
  const title = new Map(bs.map(b => [String(b.id), str(b.title, 200)]));
  await recordEvents(db, [
    ...logs.filter(r => ids.has(String(r.book))).map(r => ({ userId, module: 'books' as const, kind: 'reading', refId: logIds.get(String(r.id)), day: r.date, title: title.get(String(r.book)) ?? 'Чтение', value: Math.round(num(r.pages)), unit: 'pages' })),
    ...bs.filter(b => b.status === 'done' && isDay(b.finished)).map(b => ({ userId, module: 'books' as const, kind: 'finished', refId: ids.get(String(b.id)), day: b.finished, title: str(b.title, 200) }))
  ]);
}

export async function verifyBooks(ctx: ImportContext, st: LegacyState): Promise<ImportCheck[]> {
  const { db } = ctx;
  const bs = validBooks(st), ids = new Set(bs.map(b => String(b.id)));
  const logs = uniqById(list(st.readLog)).filter(r => isDay(r?.date) && num(r?.pages) > 0 && ids.has(String(r.book)));
  const [b] = await db.select({ n: count() }).from(books).where(owned(ctx, books.userId, books.legacyId));
  const [q] = await db.select({ n: count() }).from(bookQuotes).innerJoin(books, eq(bookQuotes.bookId, books.id)).where(owned(ctx, books.userId, books.legacyId));
  const [r] = await db.select({ pages: sql<number>`coalesce(sum(${readingLog.pages}), 0)::int` }).from(readingLog).where(owned(ctx, readingLog.userId, readingLog.legacyId));
  return [
    { name: 'книг', source: bs.length, db: b!.n },
    { name: 'цитат', source: bs.reduce((a, x) => a + list(x.quotes).filter(q => str(q?.text)).length, 0), db: q!.n },
    { name: 'прочитано страниц (журнал)', source: logs.reduce((a, x) => a + Math.round(num(x.pages)), 0), db: Number(r!.pages) }
  ];
}
