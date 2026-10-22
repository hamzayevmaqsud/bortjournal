/**
 * Книги (раздел Pro): «читаю» с целью года, темпом и серией, полка с фильтрами, цитаты, карточка книги,
 * запись страниц (журнал чтения), поиск в Open Library, обложки: из каталога (кэш на диске) и свои фото.
 * Сервер ходит только на адреса, собранные им самим (Open Library и Amazon по ISBN).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, diffDays } from '@bortjournal/core';
import { requireUser } from '../../core/auth.js';
import { requireFeature } from '../../core/billing.js';
import { userContext } from '../../core/context.js';
import { bad, idParam, notFound, uid } from '../../core/http.js';
import { profiles } from '../../core/schema.js';
import type { DB, Tx } from '../../db/index.js';
import { bookQuotes, books, readingLog } from './schema.js';

const STATUS = ['reading', 'want', 'done', 'drop'], FORMAT = ['paper', 'ebook', 'audio'];
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const COVERS = () => process.env.COVERS_DIR || path.join(ROOT, 'data', 'covers-next');
const OLD_CAT = () => path.join(ROOT, 'data', 'covers', 'cat'); // кэш старого журнала — читаем, не пишем
const isbn10 = (s: string) => { const d = String(s).replace(/[^0-9X]/gi, '').toUpperCase(); if (d.length === 10) return d; if (d.length === 13 && d.startsWith('978')) { const c = d.slice(3, 12), sum = [...c].reduce((a, x, i) => a + (10 - i) * +x, 0), ch = (11 - sum % 11) % 11; return c + (ch === 10 ? 'X' : String(ch)); } return null; };
const pct = (b: { status: string; pages: number | null; currentPage: number }) => b.status === 'done' ? 100 : b.pages ? Math.min(100, Math.round(b.currentPage / b.pages * 100)) : 0;
const coverOf = (b: typeof books.$inferSelect) => ({ ol: b.coverOl, isbn: b.coverIsbn ?? [], mine: !!b.coverKey && !b.coverKey.startsWith('legacy/'), v: b.updatedAt?.getTime() ?? 0 });
const view = (b: typeof books.$inferSelect) => ({ id: b.id, title: b.title, author: b.author, pages: b.pages, page: b.currentPage, status: b.status, format: b.format, genre: b.genre, rating: b.rating, owned: b.owned, cover: coverOf(b), added: b.addedOn, started: b.startedOn, finished: b.finishedOn, notes: b.notes, pct: pct(b) });

async function all(db: Tx, userId: string) {
  const bs = await db.select().from(books).where(eq(books.userId, userId)).orderBy(desc(books.addedOn), desc(books.createdAt));
  const log = await db.select().from(readingLog).where(eq(readingLog.userId, userId)).orderBy(asc(readingLog.day));
  return { bs, log };
}
const pagesOn = (log: Array<{ day: string; pages: number }>, d: string) => log.filter(x => x.day === d).reduce((a, x) => a + x.pages, 0);

async function overview(db: Tx, userId: string, today: string) {
  const { bs, log } = await all(db, userId);
  const [p] = await db.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, userId));
  const goal = Number((p?.s as any)?.booksGoal) || 12, y = today.slice(0, 4), done = bs.filter(b => b.status === 'done' && (b.finishedOn ?? '').startsWith(y)).length;
  // график года — с того дня, как полка появилась (но не раньше 1 января): новичок в октябре не «отстаёт на 10 книг»
  const firstAdded = bs.reduce<string>((m, b) => b.addedOn && b.addedOn < m ? b.addedOn : m, today);
  const from = firstAdded > `${y}-01-01` ? firstAdded : `${y}-01-01`;
  const should = goal * (diffDays(from, today) + 1) / (diffDays(from, `${y}-12-31`) + 1);
  const d30 = Array.from({ length: 30 }, (_, k) => addDays(today, k - 29)), v30 = d30.map(d => pagesOn(log, d));
  const readDays = v30.filter(Boolean), pace = readDays.length ? readDays.reduce((a, b) => a + b, 0) / readDays.length : 0;
  let s = pagesOn(log, today) ? today : addDays(today, -1), streak = 0; while (pagesOn(log, s) > 0 && streak < 3650) { streak++; s = addDays(s, -1); }
  const reading = bs.filter(b => b.status === 'reading').map(b => { const left = Math.max(0, (b.pages ?? 0) - b.currentPage); return { ...view(b), today: log.filter(x => x.bookId === b.id && x.day === today).reduce((a, x) => a + x.pages, 0), eta: pace && left ? Math.ceil(left / pace) : null }; });
  return {
    today, total: bs.length, year: y, goal, done, behind: Math.round((done - should) * 10) / 10, need: Math.max(0, goal - done), weeksLeft: Math.max(1, (diffDays(today, `${y}-12-31`) + 1) / 7),
    kpi: { streak, today: pagesOn(log, today), week: d30.slice(-7).reduce((a, d) => a + pagesOn(log, d), 0), pace: Math.round(pace), pages30: v30.reduce((a, b) => a + b, 0), done30: bs.filter(b => b.status === 'done' && (b.finishedOn ?? '') >= d30[0]!).length },
    days: d30.map((d, i) => ({ day: d, pages: v30[i]! })),
    reading, want: bs.filter(b => b.status === 'want').slice(0, 8).map(view),
    recent: bs.filter(b => b.status === 'done').sort((a, b) => String(b.finishedOn ?? '').localeCompare(String(a.finishedOn ?? ''))).slice(0, 8).map(view)
  };
}

async function logPages(db: Tx, userId: string, b: typeof books.$inferSelect, page: number, today: string) {
  const to = b.pages ? Math.min(Math.max(0, Math.round(page)), b.pages) : Math.max(0, Math.round(page)), delta = to - b.currentPage;
  if (delta > 0) {
    const [ex] = await db.select().from(readingLog).where(and(eq(readingLog.bookId, b.id), eq(readingLog.day, today)));
    if (ex) await db.update(readingLog).set({ pages: ex.pages + delta }).where(eq(readingLog.id, ex.id));
    else await db.insert(readingLog).values({ userId, bookId: b.id, day: today, pages: delta });
  }
  await db.update(books).set({ currentPage: to, startedOn: b.startedOn ?? today, status: b.status === 'want' ? 'reading' : b.status, updatedAt: new Date() }).where(eq(books.id, b.id));
  return delta;
}

// поиск в каталоге: не больше 300 запросов в день на человека
const searches = new Map<string, number>(), noCover = new Set<string>();

export async function booksRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = [requireUser, requireFeature(db, 'books')];
  const mine = async (userId: string, id: string) => (await db.select().from(books).where(and(eq(books.userId, userId), eq(books.id, id))))[0] ?? null;
  const today = async (userId: string) => (await userContext(db, userId)).today;

  app.get('/overview', { preHandler }, async req => overview(db, uid(req), await today(uid(req))));
  app.get('/shelf', { preHandler }, async req => {
    const { bs } = await all(db, uid(req)), rated = bs.filter(b => b.rating);
    return { books: bs.map(view), pagesRead: bs.reduce((a, b) => a + (b.status === 'done' ? b.pages ?? 0 : b.status === 'reading' ? b.currentPage : 0), 0), avgRating: rated.length ? Math.round(rated.reduce((a, b) => a + b.rating!, 0) / rated.length * 10) / 10 : null };
  });
  app.get('/quotes', { preHandler }, async req => {
    const rows = await db.select({ q: bookQuotes, b: books }).from(bookQuotes).innerJoin(books, eq(bookQuotes.bookId, books.id)).where(eq(books.userId, uid(req))).orderBy(desc(bookQuotes.addedOn), desc(bookQuotes.createdAt));
    return { quotes: rows.map(r => ({ id: r.q.id, text: r.q.text, page: r.q.page, day: r.q.addedOn, book: { id: r.b.id, title: r.b.title, author: r.b.author } })) };
  });
  app.get('/books/:id', { preHandler }, async (req, reply) => {
    const b = await mine(uid(req), idParam((req.params as any).id)); if (!b) return notFound(reply);
    const quotes = await db.select().from(bookQuotes).where(eq(bookQuotes.bookId, b.id)).orderBy(desc(bookQuotes.createdAt));
    const log = await db.select().from(readingLog).where(eq(readingLog.bookId, b.id)).orderBy(desc(readingLog.day));
    return { ...view(b), quotes: quotes.map(q => ({ id: q.id, text: q.text, page: q.page, day: q.addedOn })), log: log.slice(0, 60).map(l => ({ day: l.day, pages: l.pages })), readDays: new Set(log.map(l => l.day)).size };
  });

  const body = (b: any, partial = false) => {
    const v: Record<string, unknown> = {};
    if (!partial || b.title !== undefined) { const t = String(b.title ?? '').trim().slice(0, 200); if (!t) throw bad('Напиши название книги.'); v.title = t; }
    if (b.author !== undefined) v.author = String(b.author ?? '').trim().slice(0, 160) || null;
    if (b.pages !== undefined) { const n = b.pages === '' || b.pages === null ? null : Math.round(Number(b.pages)); if (n !== null && !(n >= 0 && n <= 20000)) throw bad('Страниц — от 0 до 20 000.'); v.pages = n; }
    if (b.status !== undefined) { if (!STATUS.includes(b.status)) throw bad('Неизвестный статус.'); v.status = b.status; }
    if (b.format !== undefined) v.format = FORMAT.includes(b.format) ? b.format : 'paper';
    if (b.genre !== undefined) v.genre = String(b.genre ?? '').trim().slice(0, 40) || null;
    if (b.rating !== undefined) { const r = Math.round(Number(b.rating)); v.rating = r >= 1 && r <= 5 ? r : null; }
    if (b.owned !== undefined) v.owned = !!b.owned;
    if (b.notes !== undefined) v.notes = String(b.notes ?? '').slice(0, 4000) || null;
    if (b.cover !== undefined && b.cover && typeof b.cover === 'object') { v.coverOl = Number.isInteger(b.cover.ol) && b.cover.ol > 0 ? b.cover.ol : null; v.coverIsbn = (Array.isArray(b.cover.isbn) ? b.cover.isbn : []).map(String).filter((x: string) => /^\d{9}[\dX]$/.test(x)).slice(0, 4); }
    return v;
  };
  app.post('/books', { preHandler }, async (req, reply) => {
    const v = body(req.body ?? {}), t = await today(uid(req));
    const [b] = await db.insert(books).values({ userId: uid(req), status: 'reading', ...v, addedOn: t, startedOn: v.status === 'reading' || !v.status ? t : null, finishedOn: v.status === 'done' ? t : null } as any).returning();
    return reply.code(201).send(view(b!));
  });
  app.patch('/books/:id', { preHandler }, async (req, reply) => {
    const b = await mine(uid(req), idParam((req.params as any).id)); if (!b) return notFound(reply);
    const v = body(req.body ?? {}, true), t = await today(uid(req));
    // статус меняет даты: начал читать, дочитал (страницы — до конца)
    if (v.status === 'reading' && !b.startedOn) v.startedOn = t;
    if (v.status === 'done') { v.finishedOn = b.finishedOn ?? t; if (b.pages && b.currentPage < b.pages && b.status === 'reading') await logPages(db, uid(req), b, b.pages, t); if (b.pages) v.currentPage = b.pages; }
    if (v.status && v.status !== 'done') v.finishedOn = null;
    const [r] = await db.update(books).set({ ...v, updatedAt: new Date() } as any).where(eq(books.id, b.id)).returning();
    return view(r!);
  });
  app.delete('/books/:id', { preHandler }, async (req, reply) => {
    const r = await db.delete(books).where(and(eq(books.userId, uid(req)), eq(books.id, idParam((req.params as any).id)))).returning({ id: books.id });
    return r.length ? { ok: true } : notFound(reply);
  });
  app.post('/books/:id/progress', { preHandler }, async (req, reply) => {
    const b = await mine(uid(req), idParam((req.params as any).id)); if (!b) return notFound(reply);
    const q = (req.body ?? {}) as { page?: unknown; add?: unknown };
    const page = q.add !== undefined ? b.currentPage + Math.round(Number(q.add) || 0) : Number(q.page);
    if (!Number.isFinite(page) || page < 0) throw bad('Страница — число.');
    const delta = await logPages(db, uid(req), b, page, await today(uid(req)));
    return { delta, book: view((await mine(uid(req), b.id))!) };
  });
  app.post('/books/:id/quotes', { preHandler }, async (req, reply) => {
    const b = await mine(uid(req), idParam((req.params as any).id)); if (!b) return notFound(reply);
    const x = (req.body ?? {}) as { text?: string; page?: string }, text = String(x.text ?? '').trim().slice(0, 1200);
    if (!text) throw bad('Напиши цитату.');
    const [q] = await db.insert(bookQuotes).values({ bookId: b.id, text, page: String(x.page ?? '').trim().slice(0, 10) || null, addedOn: await today(uid(req)) }).returning();
    return reply.code(201).send(q);
  });
  app.delete('/quotes/:id', { preHandler }, async (req, reply) => {
    const id = idParam((req.params as any).id);
    const own = await db.select({ id: bookQuotes.id }).from(bookQuotes).innerJoin(books, eq(bookQuotes.bookId, books.id)).where(and(eq(bookQuotes.id, id), eq(books.userId, uid(req))));
    if (!own.length) return notFound(reply);
    await db.delete(bookQuotes).where(eq(bookQuotes.id, id)); return { ok: true };
  });
  app.put('/goal', { preHandler }, async req => {
    const g = Math.round(Number((req.body as any)?.goal)); if (!(g >= 1 && g <= 365)) throw bad('Цель — от 1 до 365 книг.');
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, uid(req)));
    const settings = { ...(p?.settings ?? {}), booksGoal: g };
    await db.insert(profiles).values({ userId: uid(req), settings }).onConflictDoUpdate({ target: profiles.userId, set: { settings } });
    return { goal: g };
  });

  // поиск в Open Library
  app.get('/search', { preHandler }, async (req, reply) => {
    const q = String((req.query as any).q ?? '').trim().slice(0, 120);
    if (q.length < 2) return { items: [] };
    const k = `${uid(req)}:${new Date().toISOString().slice(0, 10)}`, n = (searches.get(k) ?? 0) + 1;
    if (n > 300) return reply.code(429).send({ error: 'Слишком много поисков за сегодня.' });
    searches.set(k, n);
    try {
      const base = process.env.OPENLIBRARY_URL || 'https://openlibrary.org';
      const r = await fetch(`${base}/search.json?q=${encodeURIComponent(q)}&limit=16&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,subject,isbn`, { headers: { 'User-Agent': 'Bortjournal/1.0 (personal tracker)' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json() as any;
      const items = (d.docs ?? []).map((x: any) => ({
        title: String(x.title ?? '').slice(0, 200), author: (x.author_name ?? []).slice(0, 2).join(', ').slice(0, 160), year: x.first_publish_year ?? null, pages: x.number_of_pages_median ?? null,
        cover: Number.isInteger(x.cover_i) && x.cover_i > 0 ? x.cover_i : null, genre: (x.subject ?? []).find((t: string) => t.length < 30) ?? '',
        isbn: [...new Set((x.isbn ?? []).map(isbn10).filter(Boolean))].slice(0, 4)
      })).filter((x: any) => x.title).sort((a: any, b: any) => (b.cover || b.isbn.length ? 1 : 0) - (a.cover || a.isbn.length ? 1 : 0)).slice(0, 12);
      return { items };
    } catch { return reply.code(502).send({ error: 'Каталог книг не ответил. Можно добавить книгу вручную.' }); }
  });

  // обложка из каталога: кэш на диске (сначала свой, потом старого журнала), иначе Amazon по ISBN и Open Library
  app.get('/cover', { preHandler }, async (req, reply) => {
    const q = req.query as { ol?: string; isbn?: string }, ol = q.ol && /^\d{1,12}$/.test(q.ol) ? q.ol : null;
    const isbns = String(q.isbn ?? '').split(',').filter(x => /^\d{9}[\dX]$/.test(x)).slice(0, 4);
    if (!ol && !isbns.length) return reply.code(400).send({ error: 'Нет обложки.' });
    const key = ol ? `ol${ol}` : `isbn${isbns[0]}`, file = path.join(COVERS(), 'cat', `${key}.jpg`);
    for (const f of [file, path.join(OLD_CAT(), `${key}.jpg`)]) { try { const buf = await fs.readFile(f); return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=2592000').send(buf); } catch { /* дальше */ } }
    if (noCover.has(key) || process.env.NODE_ENV === 'test') return reply.code(404).send({ error: 'Нет обложки.' });
    const urls = [...isbns.map(i => `https://images-na.ssl-images-amazon.com/images/P/${i}.01.LZZZZZZZ.jpg`), ...(ol ? [`https://covers.openlibrary.org/b/id/${ol}-M.jpg?default=false`] : [])];
    for (const u of urls) {
      try {
        const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(8000) }), host = new URL(r.url).hostname;
        if (!r.ok || !/(^|\.)(openlibrary\.org|archive\.org|amazon\.com|media-amazon\.com|ssl-images-amazon\.com)$/.test(host) || !/^image\/jpe?g/.test(r.headers.get('content-type') ?? '')) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 2000 && buf.length < 3e6) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, buf); return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=2592000').send(buf); }
      } catch { /* следующий адрес */ }
    }
    noCover.add(key); return reply.code(404).send({ error: 'Нет обложки.' });
  });
  // своя обложка: фото книги, JPEG до 1,5 МБ
  app.post('/books/:id/cover', { preHandler, bodyLimit: 2_200_000 }, async (req, reply) => {
    const b = await mine(uid(req), idParam((req.params as any).id)); if (!b) return notFound(reply);
    const img = String((req.body as any)?.image ?? ''); if (img.length < 100 || img.length > 2e6) throw bad('Фото не подошло.');
    const buf = Buffer.from(img, 'base64'); if (buf[0] !== 0xff || buf[1] !== 0xd8) throw bad('Нужен JPEG.');
    const rel = path.join('u', uid(req), `${b.id}.jpg`);
    await fs.mkdir(path.join(COVERS(), 'u', uid(req)), { recursive: true }); await fs.writeFile(path.join(COVERS(), rel), buf);
    await db.update(books).set({ coverKey: rel, updatedAt: new Date() }).where(eq(books.id, b.id));
    return { ok: true };
  });
  app.get('/books/:id/cover', { preHandler }, async (req, reply) => {
    const b = await mine(uid(req), idParam((req.params as any).id)); if (!b?.coverKey || b.coverKey.startsWith('legacy/')) return notFound(reply);
    try { return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=2592000').send(await fs.readFile(path.join(COVERS(), b.coverKey))); } catch { return notFound(reply); }
  });
}
