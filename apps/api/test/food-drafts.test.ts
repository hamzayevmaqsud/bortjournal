/** Фото еды в фоне: черновик приёма, разбор воркером, подтверждение, уточнения, сбои. Gemini — поддельный */
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { runJobsOnce } from '../src/worker.js';
import { dueNudges } from '../src/core/reminders.js';
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
// устройство для Web Push: свои ключи, сервер-приёмник; расшифровка по RFC 8291 — проверяем сам текст напоминания
process.env.PUSH_ALLOW_ANY = '1';
process.env.VAPID_FILE = path.join(os.tmpdir(), `bj-vapid-drafts-${process.pid}.json`);
const device = crypto.createECDH('prime256v1'); device.generateKeys();
const deviceAuth = crypto.randomBytes(16);
let pushSrv: http.Server, pushUrl = '', pushes: Array<{ title: string; body: string; url: string }> = [];
const hmac = (k: Buffer, d: Buffer) => crypto.createHmac('sha256', k).update(d).digest();
function decrypt(buf: Buffer) {
  const salt = buf.subarray(0, 16), idlen = buf[20]!, asPublic = buf.subarray(21, 21 + idlen), body = buf.subarray(21 + idlen);
  const shared = device.computeSecret(asPublic), uaPublic = device.getPublicKey();
  const ikm = hmac(hmac(deviceAuth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16), nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

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
  pushSrv = http.createServer((req, res) => { const parts: Buffer[] = []; req.on('data', c => parts.push(c)); req.on('end', () => { pushes.push(decrypt(Buffer.concat(parts))); res.writeHead(201).end(); }); });
  await new Promise<void>(r => pushSrv.listen(0, '127.0.0.1', r));
  pushUrl = `http://127.0.0.1:${(pushSrv.address() as any).port}/push`;
  Object.assign(process.env, { GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: `http://127.0.0.1:${(fake.address() as any).port}`, GEMINI_MODEL: 'test-model', GEMINI_RETRY_MS: '0' });
}, 60000);
afterAll(async () => { delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_BASE_URL; delete process.env.GEMINI_MODEL; delete process.env.GEMINI_RETRY_MS; fake?.close(); pushSrv?.close(); await app?.close(); await conn?.pool.end(); });
beforeEach(() => { replies = []; calls = []; pushes = []; });

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
    const r = await as('pro', 'POST', '/api/food/meals/batch', { draftId: d.id, day: TODAY, time: '13:40', source: 'photo',
      items: [{ name: 'Гречка', kcal: 220, protein: 8, fat: 2, carbs: 43 }, { name: 'Котлета', kcal: 230, protein: 15, fat: 15, carbs: 8 }] });
    expect(r.statusCode).toBe(201);
    expect(r.json().items.every((m: any) => m.time === '13:05' && m.source === 'photo' && m.slot === 'lunch')).toBe(true);
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

describe('оповещение о готовности', () => {
  beforeAll(async () => {
    const r = await as('pro', 'POST', '/api/push/subscribe', { endpoint: pushUrl, keys: { p256dh: device.getPublicKey().toString('base64url'), auth: deviceAuth.toString('base64url') } });
    expect(r.statusCode).toBe(200);
  });

  it('разобранное фото — напоминание «Фото разобрано» со ссылкой на черновик', async () => {
    const d = (await as('pro', 'POST', '/api/food/drafts', PHOTO)).json();
    await runJobsOnce(conn.db);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.title).toBe('Фото разобрано');
    expect(pushes[0]!.body).toContain('450 ккал');
    expect(pushes[0]!.url).toContain(d.id);
  });

  it('если у ИИ есть вопрос — напоминание говорит об этом', async () => {
    replies = [ok({ ...LUNCH, questions: [{ text: 'На чём жарили?', options: ['Масло', 'Без масла'] }] })];
    await as('pro', 'POST', '/api/food/drafts', PHOTO);
    await runJobsOnce(conn.db);
    expect(pushes[0]!.title).toBe('Фото разобрано, есть вопрос');
    expect(pushes[0]!.body).toContain('На чём жарили?');
  });
});

describe('уточнения', () => {
  it('ответ на вопрос возвращает черновик в очередь, воркер пересчитывает с ответом, лимит не тратится', async () => {
    replies = [ok({ ...LUNCH, questions: [{ text: 'На чём жарили?', options: ['Масло', 'Без масла'] }] })];
    const d = (await as('other', 'POST', '/api/food/drafts', PHOTO)).json();
    await runJobsOnce(conn.db);
    const used = (await as('other', 'GET', '/api/ai/quota')).json().kinds.food.used;

    const r = await as('other', 'POST', `/api/food/drafts/${d.id}/answers`, { answers: ['На чём жарили? — Без масла'] });
    expect(r.statusCode).toBe(200);
    expect(r.json().state).toBe('queued');
    expect((await as('other', 'POST', `/api/food/drafts/${d.id}/answers`, { answers: ['ещё'] })).statusCode).toBe(409);

    replies = [ok({ ...LUNCH, items: [LUNCH.items[0]], comment: 'Без масла легче.' })];
    await runJobsOnce(conn.db);
    expect(calls.at(-1).contents[0].parts.at(-1).text).toContain('Без масла');
    const after = (await as('other', 'GET', `/api/food/drafts/${d.id}`)).json();
    expect(after).toMatchObject({ state: 'ready', comment: 'Без масла легче.', questions: [] });
    expect((await as('other', 'GET', '/api/ai/quota')).json().kinds.food.used).toBe(used);
  });
  it('пока идёт пересчёт после ответа, калории черновика остаются в итогах дня', async () => {
    replies = [ok({ ...LUNCH, questions: [{ text: 'На чём жарили?', options: ['Масло', 'Без масла'] }] })];
    const d = (await as('pro', 'POST', '/api/food/drafts', PHOTO)).json();
    await runJobsOnce(conn.db);
    await as('pro', 'POST', `/api/food/drafts/${d.id}/answers`, { answers: ['На чём жарили? — Масло'] });
    const f = (await as('pro', 'GET', `/api/food/day?day=${TODAY}`)).json();
    expect(f.drafts.find((x: any) => x.id === d.id).state).toBe('queued');
    expect(f.totals.draft.kcal).toBeGreaterThanOrEqual(450);
    await as('pro', 'DELETE', `/api/food/drafts/${d.id}`);
  });
});

describe('сбои и «Повторить»', () => {
  const later = (sec: number) => new Date(Date.now() + sec * 1000);
  const get = (id: string) => as('other', 'GET', `/api/food/drafts/${id}`).then(r => r.json());

  it('ИИ недоступен: три попытки с паузой, потом «не удался»; «Повторить» не тратит лимит', async () => {
    // перегрузка (503): внутри попытки — ещё один быстрый повтор, поэтому запросов вдвое больше попыток
    replies = Array.from({ length: 6 }, () => ({ status: 503 }));
    const d = (await as('other', 'POST', '/api/food/drafts', PHOTO)).json();
    const used = (await as('other', 'GET', '/api/ai/quota')).json().kinds.food.used;

    await runJobsOnce(conn.db);
    expect(await get(d.id)).toMatchObject({ state: 'queued', attempts: 1 });
    await runJobsOnce(conn.db);
    expect(calls).toHaveLength(2); // пауза ещё не прошла
    await runJobsOnce(conn.db, later(60));
    expect(await get(d.id)).toMatchObject({ state: 'queued', attempts: 2 });
    await runJobsOnce(conn.db, later(600));
    const failed = await get(d.id);
    expect(failed.state).toBe('failed');
    expect(failed.error).toBeTruthy();
    expect(calls).toHaveLength(6);

    expect((await as('other', 'POST', `/api/food/drafts/${d.id}/retry`)).json()).toMatchObject({ state: 'queued', attempts: 0 });
    await runJobsOnce(conn.db);
    expect((await get(d.id)).state).toBe('ready');
    expect((await as('other', 'GET', '/api/ai/quota')).json().kinds.food.used).toBe(used);
  });

  it('«не еда» и отказ по содержимому — сразу «не удался», без повторов', async () => {
    replies = [ok({ is_food: false, items: [], questions: [], comment: 'На фото кот, а не еда.' })];
    const a = (await as('other', 'POST', '/api/food/drafts', PHOTO)).json();
    await runJobsOnce(conn.db);
    expect(await get(a.id)).toMatchObject({ state: 'failed', error: 'На фото кот, а не еда.' });

    replies = [{ status: 400 }];
    const b = (await as('other', 'POST', '/api/food/drafts', PHOTO)).json();
    await runJobsOnce(conn.db);
    expect(await get(b.id)).toMatchObject({ state: 'failed', attempts: 1 });
  });

  it('«Повторить» есть только у неудавшегося черновика', async () => {
    const d = (await as('other', 'POST', '/api/food/drafts', PHOTO)).json();
    expect((await as('other', 'POST', `/api/food/drafts/${d.id}/retry`)).statusCode).toBe(409);
    expect((await as('pro', 'POST', `/api/food/drafts/${d.id}/retry`)).statusCode).toBe(404);
  });

  it('черновик, зависший в «разбирается» после падения воркера, снова берётся в работу', async () => {
    const d = (await as('other', 'POST', '/api/food/drafts', PHOTO)).json();
    // имитируем упавший воркер: черновик взят в работу 10 минут назад и не закончен
    await conn.db.update(s.drafts).set({ state: 'working', attempts: 1, startedAt: new Date(Date.now() - 10 * 60e3) }).where(eq(s.drafts.id, d.id));
    await runJobsOnce(conn.db);
    expect(await get(d.id)).toMatchObject({ state: 'ready', attempts: 2 });
  });
});

describe('черновик для серии и напоминаний', () => {
  let uid = '';
  beforeAll(async () => {
    const [u] = await conn.db.insert(s.users).values({ username: 'lonely', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    uid = u!.id; await grantFree(conn.db, uid); await grant(conn.db, uid, 'pro', 'free');
    await conn.db.insert(s.profiles).values({ userId: uid, settings: { aiConsent: true } });
    cookies.lonely = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'lonely', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
  });
  // момент «сегодня в hh:mm» по местному времени (пояс +4)
  const at = (hm: string) => Date.parse(`${TODAY}T${hm}:00Z`) - 240 * 60e3;

  it('пока фото не подтверждено, день уже активен и напоминания «не ел» нет', async () => {
    expect((await dueNudges(conn.db, uid, at('13:35'))).list.map(x => x.key)).toContain('food');
    expect((await as('lonely', 'GET', '/api/today')).json().streak).toBe(0);

    await as('lonely', 'POST', '/api/food/drafts', PHOTO); // ещё в очереди — не разобрано

    expect((await dueNudges(conn.db, uid, at('13:35'))).list.map(x => x.key)).not.toContain('food');
    expect((await as('lonely', 'GET', '/api/today')).json().streak).toBe(1);
  });
});
