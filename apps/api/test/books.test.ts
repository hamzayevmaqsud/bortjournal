/** Книги: добавить, записать страницы (журнал чтения, серия), дочитать, цель года, цитаты, полка, поиск (поддельный каталог) */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', fake: http.Server;
const H = { host: 'localhost' }, today = localNow(240).day, year = today.slice(0, 4);
const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });

beforeAll(async () => {
  conn = await freshDb();
  process.env.COVERS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bj-covers-'));
  const [u] = await conn.db.insert(s.users).values({ username: 'reader', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  await grantFree(conn.db, u!.id); await grant(conn.db, u!.id, 'pro', 'free');
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'reader', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
  fake = http.createServer((_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ docs: [{ title: 'Атомные привычки', author_name: ['Джеймс Клир'], first_publish_year: 2018, number_of_pages_median: 320, cover_i: 42, isbn: ['9780735211292'] }] })); });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', r));
  process.env.OPENLIBRARY_URL = `http://127.0.0.1:${(fake.address() as any).port}`;
}, 60000);
afterAll(async () => { delete process.env.OPENLIBRARY_URL; fake?.close(); await app?.close(); await conn?.pool.end(); });

describe('книги', () => {
  let id = '';
  it('поиск: ISBN-13 превращается в ISBN-10 для обложки', async () => {
    const r = (await req('GET', '/api/books/search?q=атомные')).json();
    expect(r.items[0]).toMatchObject({ title: 'Атомные привычки', pages: 320, cover: 42, isbn: ['0735211299'] });
  });
  it('цель года: новичок, который только начал вести полку, не «отстаёт» с 1 января', async () => {
    // полка пустая — первая книга добавлена сегодня; график считается с этого дня, а не с начала года
    const o = (await req('GET', '/api/books/overview')).json();
    expect(o.behind).toBeGreaterThan(-0.5);
  });

  it('добавить и читать: страницы попадают в журнал, серия, темп', async () => {
    const b = (await req('POST', '/api/books/books', { title: 'Атомные привычки', author: 'Джеймс Клир', pages: 320, cover: { ol: 42, isbn: ['0735211299'] } })).json();
    id = b.id; expect(b).toMatchObject({ status: 'reading', started: today, pct: 0 });
    expect((await req('POST', `/api/books/books/${id}/progress`, { page: 40 })).json().delta).toBe(40);
    expect((await req('POST', `/api/books/books/${id}/progress`, { add: 25 })).json().book.page).toBe(65);
    const o = (await req('GET', '/api/books/overview')).json();
    expect(o.kpi).toMatchObject({ today: 65, streak: 1, pace: 65 });
    expect(o.reading[0]).toMatchObject({ today: 65, pct: 20, eta: 4 });
  });
  it('дочитал: страницы до конца, дата, цель года', async () => {
    const b = (await req('PATCH', `/api/books/books/${id}`, { status: 'done', rating: 5 })).json();
    expect(b).toMatchObject({ status: 'done', page: 320, finished: today, rating: 5, pct: 100 });
    await req('PUT', '/api/books/goal', { goal: 24 });
    const o = (await req('GET', '/api/books/overview')).json();
    expect(o).toMatchObject({ goal: 24, done: 1, year });
    expect(o.kpi.today).toBe(320);
  });
  it('цитаты и полка', async () => {
    const q = (await req('POST', `/api/books/books/${id}/quotes`, { text: 'Мы не поднимаемся до уровня целей', page: '27' })).json();
    expect((await req('GET', '/api/books/quotes')).json().quotes[0]).toMatchObject({ text: 'Мы не поднимаемся до уровня целей', book: { title: 'Атомные привычки' } });
    const d = (await req('GET', `/api/books/books/${id}`)).json();
    expect(d.quotes).toHaveLength(1); expect(d.readDays).toBe(1);
    expect((await req('DELETE', `/api/books/quotes/${q.id}`)).statusCode).toBe(200);
    const sh = (await req('GET', '/api/books/shelf')).json();
    expect(sh).toMatchObject({ pagesRead: 320, avgRating: 5 });
  });
  it('своя обложка — только JPEG', async () => {
    expect((await req('POST', `/api/books/books/${id}/cover`, { image: Buffer.from('not a jpeg at all, definitely not, just some text to be long enough for the check......').toString('base64') })).statusCode).toBe(400);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 1)]).toString('base64');
    expect((await req('POST', `/api/books/books/${id}/cover`, { image: jpg })).statusCode).toBe(200);
    const c = await req('GET', `/api/books/books/${id}/cover`);
    expect(c.statusCode).toBe(200); expect(c.headers['content-type']).toBe('image/jpeg');
  });
});
