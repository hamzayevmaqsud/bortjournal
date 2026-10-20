/** Книги: полка, цитаты, журнал чтения. Обложки — во внешнем хранилище, здесь только ключ */
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, legacyId, owner, updatedAt } from '../../db/columns.js';

export const books = pgTable('books', {
  id: id(), userId: owner(), legacyId: legacyId(),
  title: text('title').notNull(),
  author: text('author'),
  pages: integer('pages'),
  currentPage: integer('current_page').notNull().default(0),
  /** reading | want | done | drop */
  status: text('status').notNull(),
  /** paper | ebook | audio */
  format: text('format').notNull().default('paper'),
  genre: text('genre'),
  rating: smallint('rating'),
  owned: boolean('owned').notNull().default(false),
  /** обложка из каталога (Open Library id и ISBN) или своя — ключ в хранилище файлов */
  coverOl: integer('cover_ol'),
  coverIsbn: text('cover_isbn').array(),
  coverKey: text('cover_key'),
  addedOn: date('added_on', { mode: 'string' }),
  startedOn: date('started_on', { mode: 'string' }),
  finishedOn: date('finished_on', { mode: 'string' }),
  notes: text('notes'),
  createdAt: createdAt(), updatedAt: updatedAt()
}, t => [
  index('books_user_status_idx').on(t.userId, t.status),
  uniqueIndex('books_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`),
  check('books_rating_ck', sql`${t.rating} is null or ${t.rating} between 0 and 5`)
]);

export const bookQuotes = pgTable('book_quotes', {
  id: id(), legacyId: legacyId(),
  bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  page: text('page'),
  addedOn: date('added_on', { mode: 'string' }),
  createdAt: createdAt()
}, t => [index('book_quotes_book_idx').on(t.bookId)]);

export const readingLog = pgTable('book_reading_log', {
  id: id(), userId: owner(), legacyId: legacyId(),
  bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  pages: integer('pages').notNull()
}, t => [index('book_reading_log_user_day_idx').on(t.userId, t.day), uniqueIndex('book_reading_log_legacy_uq').on(t.userId, t.legacyId).where(sql`${t.legacyId} is not null`)]);
