/** Фото еды в фоне: черновик приёма, разбор воркером, подтверждение, уточнения, сбои. Gemini — поддельный */
import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { runJobsOnce } from '../src/worker.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, fake: http.Server;
const cookies: Record<string, string> = {};
const H = { host: 'localhost' };
const as = (who: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: cookies[who]! } });

// поддельный Gemini: отвечает тем, что лежит в очереди replies (по умолчанию — обед из двух позиций)
type Reply = { status: number; body?: unknown };
const LUNCH = { is_food: true, comment: 'Учёл масло.', questions: [] as unknown[],
  items: [{ name: 'Гречка', grams: 200, kcal: 220, protein: 8, fat: 2, carbs: 43, fiber: 4, sugar: 1, salt: 0.5, confidence: 'high', source: 'estimate' },
    { name: 'Котлета', grams: 100, kcal: 230, protein: 15, fat: 15, carbs: 8, fiber: 0, sugar: 0, salt: 1, confidence: 'medium', source: 'estimate' }] };
const ok = (out: unknown): Reply => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] } });
let replies: Reply[] = [], calls: any[] = [];

const TODAY = localNow(240).day;
const PHOTO = { image: 'x'.repeat(400), mime: 'image/jpeg', note: '', scale: 'fork', day: TODAY, time: '13:05', slot: 'lunch' };

beforeAll(async () => {
  conn = await freshDb();
  for (const [name, pro] of [['pro', true], ['other', true], ['free', false]] as const) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    await grantFree(conn.db, u!.id);
    if (pro) await grant(conn.db, u!.id, 'pro', 'free');
    await conn.db.insert(s.profiles).values({ userId: u!.id, settings: { aiConsent: true } });
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const name of ['pro', 'other', 'free']) cookies[name] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: name, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
  fake = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      calls.push(JSON.parse(body));
      const r = replies.shift() ?? ok(LUNCH);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body ?? { error: { message: `HTTP ${r.status}` } }));
    });
  });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: `http://127.0.0.1:${(fake.address() as any).port}`, GEMINI_MODEL: 'test-model' });
}, 60000);
afterAll(async () => { delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_BASE_URL; delete process.env.GEMINI_MODEL; fake?.close(); await app?.close(); await conn?.pool.end(); });
beforeEach(() => { replies = []; calls = []; });

describe('фото еды в фоне', () => {
  it('фото сразу становится черновиком в очереди, а воркер его разбирает', async () => {
    const r = await as('pro', 'POST', '/api/food/drafts', PHOTO);
    expect(r.statusCode).toBe(201);
    const draft = r.json();
    expect(draft).toMatchObject({ state: 'queued', day: TODAY, time: '13:05', slot: 'lunch' });
    expect(calls).toHaveLength(0);

    await runJobsOnce(conn.db);

    const ready = (await as('pro', 'GET', `/api/food/drafts/${draft.id}`)).json();
    expect(ready.state).toBe('ready');
    expect(ready.items.map((i: any) => i.name)).toEqual(['Гречка', 'Котлета']);
    expect(ready.comment).toBe('Учёл масло.');
    expect(calls).toHaveLength(1);
  });

  it('доступ и проверки как у распознавания: без Pro — 402, без ключа — 503, не картинка — 400, чужой — 404', async () => {
    expect((await as('free', 'POST', '/api/food/drafts', PHOTO)).statusCode).toBe(402);
    delete process.env.GEMINI_API_KEY;
    expect((await as('pro', 'POST', '/api/food/drafts', PHOTO)).statusCode).toBe(503);
    process.env.GEMINI_API_KEY = 'test-key';
    expect((await as('pro', 'POST', '/api/food/drafts', { ...PHOTO, mime: 'image/gif' })).statusCode).toBe(400);
    expect((await as('pro', 'POST', '/api/food/drafts', { ...PHOTO, image: 'x' })).statusCode).toBe(400);
    const mine = (await as('pro', 'POST', '/api/food/drafts', PHOTO)).json();
    expect((await as('other', 'GET', `/api/food/drafts/${mine.id}`)).statusCode).toBe(404);
    expect((await as('other', 'GET', '/api/food/drafts')).json().items).toEqual([]);
  });

  it('лимит ИИ списывается один раз — при отправке фото', async () => {
    const used = async () => (await as('other', 'GET', '/api/ai/quota')).json().kinds.food.used;
    const before = await used();
    await as('other', 'POST', '/api/food/drafts', PHOTO);
    expect(await used()).toBe(before + 1);
    await runJobsOnce(conn.db);
    expect(await used()).toBe(before + 1);
  });
});

describe('черновик в дне еды', () => {
  const day = () => as('pro', 'GET', `/api/food/day?day=${TODAY}`).then(r => r.json());
  const fresh = async (who = 'pro') => { const d = (await as(who, 'POST', '/api/food/drafts', PHOTO)).json(); await runJobsOnce(conn.db); return d; };
  beforeEach(async () => { for (const d of (await as('pro', 'GET', '/api/food/drafts')).json().items) await as('pro', 'DELETE', `/api/food/drafts/${d.id}`); });

  it('готовый черновик виден в дне, его калории входят в итоги как предварительные', async () => {
    const before = await day();
    const d = await fresh();
    const f = await day();
    expect(f.drafts.map((x: any) => x.id)).toContain(d.id);
    expect(f.drafts[0].image).toBeUndefined();
    expect(f.totals.draft.kcal).toBe(450);
    expect(f.totals.kcal).toBe(before.totals.kcal + 450);
    const stats = (await as('pro', 'GET', '/api/stats/food?days=7')).json();
    expect(stats.rows.find((r: any) => r.day === TODAY).kcal).toBe(before.totals.kcal + 450);
  });

  it('подтверждение записывает приёмы со временем фото, убирает черновик и не задваивает калории', async () => {
    const before = await day();
    const d = await fresh();
    const r = await as('pro', 'POST', '/api/food/meals/batch', { draftId: d.id, day: TODAY, time: '13:40', slot: 'lunch', source: 'photo',
      items: [{ name: 'Гречка', kcal: 220, protein: 8, fat: 2, carbs: 43 }, { name: 'Котлета', kcal: 230, protein: 15, fat: 15, carbs: 8 }] });
    expect(r.statusCode).toBe(201);
    expect(r.json().items.every((m: any) => m.time === '13:05' && m.source === 'photo')).toBe(true);
    expect((await as('pro', 'GET', `/api/food/drafts/${d.id}`)).statusCode).toBe(404);
    const f = await day();
    expect(f.drafts).toEqual([]);
    expect(f.totals.draft.kcal).toBe(0);
    expect(f.totals.kcal).toBe(before.totals.kcal + 450);
  });

  it('удаление черновика убирает его калории; чужой удалить нельзя', async () => {
    const before = await day();
    const d = await fresh();
    expect((await as('other', 'DELETE', `/api/food/drafts/${d.id}`)).statusCode).toBe(404);
    expect((await as('pro', 'DELETE', `/api/food/drafts/${d.id}`)).statusCode).toBe(200);
    expect((await day()).totals.kcal).toBe(before.totals.kcal);
  });
});
