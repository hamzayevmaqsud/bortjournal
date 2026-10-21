/**
 * Запись голосом: фраза → задача (с датой и временем) или заметка; вход по личному ключу «Команд»;
 * подписка календаря (.ics) с напоминанием за 15 минут; напоминание о задаче за 15 минут; заметки.
 * ИИ — локальный сервер: отдаёт заранее заданный разбор.
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import { dueNudges } from '../src/core/reminders.js';
import { icsOf } from '../src/modules/plans/capture.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, ai: http.Server, cookie = '', userId = '';
let reply: Record<string, unknown> = {}, lastPrompt = '', lastAudio = false;
const H = { host: 'localhost' }, TZ = 240, today = localNow(TZ).day;
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = { cookie }) => app.inject({ method, url, payload: payload as any, headers: { ...H, ...headers } });

beforeAll(async () => {
  ai = http.createServer((r, res) => { let b = ''; r.on('data', c => b += c); r.on('end', () => {
    const parts = JSON.parse(b).contents[0].parts; lastPrompt = parts.find((p: any) => p.text).text; lastAudio = !!parts[0].inline_data;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] })); }); });
  await new Promise<void>(ok => ai.listen(0, '127.0.0.1', ok));
  Object.assign(process.env, { GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: `http://127.0.0.1:${(ai.address() as { port: number }).port}`, PUBLIC_URL: 'https://journal.example' });
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'voice', passwordHash: await hashPassword('secret12'), tzOffset: TZ }).returning();
  userId = u!.id; await grantFree(conn.db, userId);
  await conn.db.insert(s.profiles).values({ userId, heightCm: 180, settings: {} });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'voice', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); ai?.close(); delete process.env.GEMINI_API_KEY; delete process.env.PUBLIC_URL; });

describe('запись голосом', () => {
  let key = '';
  it('без входа и без ключа — нельзя; ключ «Команд» создаётся и показывается один раз', async () => {
    expect((await req('POST', '/api/plans/capture', { text: 'x' }, {})).statusCode).toBe(401);
    const t = (await req('POST', '/api/tokens/capture')).json();
    expect(t.token).toMatch(/^bjc_/); expect(t.url).toBe('https://journal.example/api/plans/capture');
    key = t.token;
    expect((await req('GET', '/api/tokens')).json().capture).toMatchObject({ lastUsedAt: null });
    expect((await req('POST', '/api/plans/capture', { text: 'x' }, { authorization: 'Bearer bjc_wrongwrongwrongwrongwrong' })).statusCode).toBe(401);
  });
  it('«завтра в 3 позвонить Анару» → задача на завтра 15:00 по ключу, ИИ знает «сейчас»', async () => {
    reply = { heard: 'Завтра в 3 позвонить Анару', kind: 'task', title: 'Позвонить Анару', day: addDays(today, 1), time: '15:00', details: null };
    const r = await req('POST', '/api/plans/capture', { text: 'Завтра в 3 позвонить Анару' }, { authorization: `Bearer ${key}` });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ kind: 'task', task: { title: 'Позвонить Анару', day: addDays(today, 1), time: '15:00' }, message: 'Задача «Позвонить Анару» — завтра, 15:00. Напомню за 15 минут.' });
    expect(lastPrompt).toContain(today);
    expect((await req('GET', '/api/tokens')).json().capture.lastUsedAt).not.toBeNull();
    const list = (await req('GET', `/api/plans/tasks?from=${addDays(today, 1)}&to=${addDays(today, 1)}`)).json().items;
    expect(list.find((t: any) => t.title === 'Позвонить Анару')).toBeTruthy();
  });
  it('время без даты: если уже прошло — завтра; мусор от ИИ отбрасывается', async () => {
    reply = { heard: 'в 00:01 таблетка', kind: 'task', title: 'Таблетка', day: null, time: '00:01' };
    expect((await req('POST', '/api/plans/capture', { text: 'в 00:01 таблетка' })).json().task.day).toBe(addDays(today, 1));
    reply = { heard: 'встреча', kind: 'task', title: 'Встреча', day: '1999-01-01', time: '25:99' };
    expect((await req('POST', '/api/plans/capture', { text: 'встреча' })).json().task).toMatchObject({ day: null, time: null });
  });
  it('мысль без срока → заметка; запись голоса уходит ИИ как аудио', async () => {
    reply = { heard: 'идея: сделать виджет', kind: 'note', title: 'Идея: сделать виджет для воды', day: null, time: null, details: 'на экран блокировки' };
    const r = (await req('POST', '/api/plans/capture', { audio: 'A'.repeat(400), mime: 'audio/mp4' })).json();
    expect(lastAudio).toBe(true);
    expect(r).toMatchObject({ kind: 'note', heard: 'идея: сделать виджет', note: { text: 'Идея: сделать виджет для воды\nна экран блокировки' } });
    const notes = (await req('GET', '/api/plans/notes')).json().items;
    expect(notes[0]).toMatchObject({ source: 'voice', done: false });
    expect((await req('PUT', `/api/plans/notes/${notes[0].id}`, { done: true })).json().done).toBe(true);
    expect((await req('DELETE', `/api/plans/notes/${notes[0].id}`)).json()).toEqual({ ok: true });
    expect((await req('POST', '/api/plans/capture', {})).statusCode).toBe(400);
  });
  it('без ключа ИИ — фраза сохраняется заметкой', async () => {
    const k = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
    expect((await req('POST', '/api/plans/capture', { text: 'купить батарейки' })).json()).toMatchObject({ kind: 'note', note: { text: 'купить батарейки' } });
    process.env.GEMINI_API_KEY = k;
  });
  it('напоминание о задаче — за 15 минут (настраивается)', async () => {
    await req('POST', '/api/plans/tasks', { title: 'Созвон', day: today, time: '18:00' });
    const at = (hm: string) => Date.parse(`${today}T${hm}:00Z`) - TZ * 60e3;
    expect((await dueNudges(conn.db, userId, at('17:45'))).list.find(x => x.kind === 'tasks')).toMatchObject({ title: 'Через 15 мин: Созвон', body: 'В 18:00 — Созвон' });
    expect((await dueNudges(conn.db, userId, at('17:40'))).list.filter(x => x.kind === 'tasks')).toHaveLength(0);
    expect((await req('PUT', '/api/push/settings', { lead: 30 })).json().lead).toBe(30);
    expect((await dueNudges(conn.db, userId, at('17:31'))).list.find(x => x.kind === 'tasks')?.title).toBe('Через 30 мин: Созвон');
    expect((await req('PUT', '/api/push/settings', { lead: 500 })).statusCode).toBe(400);
    await req('PUT', '/api/push/settings', { lead: 15 });
  });
});

describe('календарь', () => {
  it('подписка: ключ в адресе, задачи с датой, время в UTC, напоминание за 15 минут', async () => {
    const t = (await req('POST', '/api/tokens/calendar')).json();
    expect(t.webcal).toMatch(/^webcal:\/\/journal\.example\/api\/plans\/calendar\/bjl_.+\.ics$/);
    const path = new URL(t.url).pathname;
    const r = await app.inject({ method: 'GET', url: path, headers: H });
    expect(r.headers['content-type']).toMatch(/text\/calendar/);
    const ics = r.body;
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain('SUMMARY:Позвонить Анару');
    expect(ics).toContain(`DTSTART:${addDays(today, 1).replace(/-/g, '')}T110000Z`); // 15:00 при UTC+4
    expect(ics).toContain('TRIGGER:-PT15M');
    expect((await app.inject({ method: 'GET', url: '/api/plans/calendar/bjl_nope_nope_nope_nope_nope.ics', headers: H })).statusCode).toBe(404);
    // новый ключ — старая ссылка больше не работает
    await req('POST', '/api/tokens/calendar');
    expect((await app.inject({ method: 'GET', url: path, headers: H })).statusCode).toBe(404);
  });
  it('формат: экранирование, задача без времени — на весь день, длинные строки переносятся', () => {
    const ics = icsOf([{ id: 'a', title: 'Купить: хлеб, молоко; сыр', day: '2026-10-22', time: null, done: false, note: 'строка 1\nстрока 2' }, { id: 'b', title: 'Очень '.repeat(30), day: '2026-10-22', time: '09:30', done: true, note: null }], 240, 15);
    expect(ics).toContain('SUMMARY:Купить: хлеб\\, молоко\\; сыр');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261022');
    expect(ics).toContain('DESCRIPTION:строка 1\\nстрока 2');
    expect(ics).toContain('DTSTART:20261022T053000Z');
    expect(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(ics.match(/BEGIN:VALARM/g)).toBeNull(); // сделанная — без напоминания, без времени — тоже
  });
});
