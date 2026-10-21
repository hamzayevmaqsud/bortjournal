/** Еда Pro: справочник, распознавание (через поддельный Gemini — настоящий тесты не трогают) и запись нескольких позиций */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, fake: http.Server, seen: any[] = [];
const cookies: Record<string, string> = {};
const H = { host: 'localhost' };
const as = (who: string, method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: cookies[who]! } });

beforeAll(async () => {
  conn = await freshDb();
  for (const [name, pro] of [['pro', true], ['free', false]] as const) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    await grantFree(conn.db, u!.id);
    if (pro) await grant(conn.db, u!.id, 'pro', 'free');
    await conn.db.insert(s.profiles).values({ userId: u!.id, settings: { aiConsent: true } });
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const name of ['pro', 'free']) cookies[name] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: name, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
  // поддельный Gemini: отдаёт две позиции и один уточняющий вопрос
  fake = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(body) });
      const out = { is_food: true, comment: 'Учёл масло.', questions: [{ text: 'На чём жарили?', options: ['Масло', 'Без масла'] }],
        items: [{ name: 'Гречка', grams: 200, kcal: 220, protein: 8.4, fat: 2.2, carbs: 42.6, fiber: 4, sugar: 1, salt: 0.5, confidence: 'high', source: 'estimate' },
          { name: 'Котлета', grams: 100, kcal: 220, protein: 15, fat: 15, carbs: 8, fiber: 0, sugar: 0, salt: 1, confidence: 'wat', source: 'user' }] };
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
    });
  });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', r));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(fake.address() as any).port}`;
  process.env.GEMINI_MODEL = 'test-model';
}, 60000);
afterAll(async () => { delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_BASE_URL; delete process.env.GEMINI_MODEL; fake?.close(); await app?.close(); await conn?.pool.end(); });

describe('еда Pro', () => {
  it('без Pro поиск и распознавание закрыты — 402', async () => {
    expect((await as('free', 'GET', '/api/food/search?q=гречка')).statusCode).toBe(402);
    expect((await as('free', 'POST', '/api/food/recognize', { note: 'гречка' })).statusCode).toBe(402);
  });
  it('поиск находит в справочнике по другому названию и с «ё»', async () => {
    const r = (await as('pro', 'GET', '/api/food/search?q=гречневая')).json();
    expect(r.catalog[0]).toMatchObject({ name: 'Гречка варёная', kcal: 110, grams: 200 });
    expect((await as('pro', 'GET', '/api/food/search?q=тушеная говядина')).json().catalog[0].name).toBe('Говядина тушёная');
    expect((await as('pro', 'GET', '/api/food/search?q=г')).json()).toEqual({ mine: [], catalog: [] });
  });
  it('без ключа — понятная 503, с ключом — позиции и вопросы', async () => {
    delete process.env.GEMINI_API_KEY;
    expect((await as('pro', 'POST', '/api/food/recognize', { note: 'гречка с котлетой' })).statusCode).toBe(503);
    process.env.GEMINI_API_KEY = 'test-key';
    expect((await as('pro', 'POST', '/api/food/recognize', { note: '' })).statusCode).toBe(400);
    expect((await as('pro', 'POST', '/api/food/recognize', { image: 'x'.repeat(200), mime: 'image/gif' })).statusCode).toBe(400);
    const r = await as('pro', 'POST', '/api/food/recognize', { note: 'гречка с котлетой', scale: 'fork', answers: ['На чём жарили? — Масло'] });
    expect(r.statusCode).toBe(200);
    const out = r.json();
    expect(out.isFood).toBe(true);
    expect(out.items).toHaveLength(2);
    expect(out.items[1]).toMatchObject({ name: 'Котлета', confidence: 'medium', source: 'user' }); // неизвестное значение — к «medium»
    expect(out.questions[0].options).toEqual(['Масло', 'Без масла']);
    const sent = seen.at(-1)!;
    expect(sent.key).toBe('test-key');
    expect(sent.url).toContain('test-model');
    const text = sent.body.contents[0].parts[0].text as string;
    expect(text).toContain('вилка'); expect(text).toContain('гречка с котлетой'); expect(text).toContain('Масло');
  });
  it('несколько позиций записываются разом и попадают в день', async () => {
    const r = await as('pro', 'POST', '/api/food/meals/batch', { day: '2026-10-20', time: '13:00', slot: 'lunch', source: 'photo',
      items: [{ name: 'Гречка, 200 г', kcal: 220, protein: 8.4, fat: 2.2, carbs: 42.6, fiber: 4 }, { name: 'Котлета, 100 г', kcal: 220, protein: 15, fat: 15, carbs: 8 }] });
    expect(r.statusCode).toBe(201);
    expect(r.json().items.map((m: any) => m.source)).toEqual(['photo', 'photo']);
    const day = (await as('pro', 'GET', '/api/food/day?day=2026-10-20')).json();
    expect(day.totals.kcal).toBe(440);
    // ошибка в одной позиции — не записывается ничего
    expect((await as('pro', 'POST', '/api/food/meals/batch', { day: '2026-10-20', items: [{ name: 'Хлеб', kcal: 80 }, { name: '', kcal: 10 }] })).statusCode).toBe(400);
    expect((await as('pro', 'GET', '/api/food/day?day=2026-10-20')).json().meals).toHaveLength(2);
    // записанное попадает в «моё» и находится поиском
    expect((await as('pro', 'GET', '/api/food/search?q=котлета')).json().mine[0].name).toBe('Котлета, 100 г');
  });
  it('анализ дня: доли БЖУ, клетчатка из фото, календарь; без Pro — 402', async () => {
    expect((await as('free', 'GET', '/api/food/analysis?day=2026-10-20')).statusCode).toBe(402);
    const a = (await as('pro', 'GET', '/api/food/analysis?day=2026-10-20')).json();
    expect(a.totals).toMatchObject({ kcal: 440, fiber: 4, meals: 2 });
    expect(a.split.map((x: any) => x.key)).toEqual(['protein', 'fat', 'carbs']);
    expect(a.split.reduce((s: number, x: any) => s + x.pct, 0)).toBeGreaterThanOrEqual(99);
    expect(a.calendar.cells.find((c: any) => c.day === '2026-10-20').kcal).toBe(440);
    expect(a.timing.slots[1]).toMatchObject({ key: 'day', pct: 100 });
  });
});
