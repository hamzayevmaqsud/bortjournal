/**
 * Ошибки из QA-ревью — каждая воспроизводится здесь и больше не должна вернуться:
 * перенос задачи повтора, неверные даты и время, тип напитка из прототипа, кривой id, повторный ответ на вопрос,
 * покупка во время пробного периода, блокировка входа в чужой аккаунт, IPv4 внутри IPv6 в ссылках, файлы после удаления.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addDays, isDay, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { startTrial } from '../src/core/billing.js';
import { grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { privateIp } from '../src/modules/study/extract.js';
import { answer } from '../src/modules/study/mc.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', userId = '';
const H = { host: 'localhost' }, today = localNow(240).day;
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, c = cookie) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: c } });
const login = (u: string, p: string, ip = '10.0.0.1') => app.inject({ method: 'POST', url: '/api/auth/login', headers: H, remoteAddress: ip, payload: { username: u, password: p } });

beforeAll(async () => {
  process.env.STUDY_FILES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bj-qa-'));
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'qa', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  userId = u!.id; await grantFree(conn.db, userId); await startTrial(conn.db, userId);
  await conn.db.insert(s.profiles).values({ userId, heightCm: 180, settings: {} });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await login('qa', 'secret12')).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('ввод', () => {
  it('даты: 31 февраля и нулевой год — не даты', async () => {
    expect(isDay('2026-02-31')).toBe(false); expect(isDay('0000-01-01')).toBe(false); expect(isDay('2026-02-28')).toBe(true);
    expect((await req('POST', '/api/food/meals', { day: '2026-02-31', name: 'Суп', kcal: 100, protein: 1, fat: 1, carbs: 1 })).statusCode).toBe(400);
  });
  it('время вне суток не сохраняется; кривой id — 400, а не 500', async () => {
    expect((await req('POST', '/api/plans/tasks', { title: 'Т', day: today, time: '25:61' })).json().time).toBeNull();
    expect((await req('DELETE', `/api/plans/tasks/${'-'.repeat(36)}`)).statusCode).toBe(400);
  });
  it('тип напитка из прототипа объекта — отклоняется, итоги дня не ломаются', async () => {
    for (const type of ['constructor', 'toString', '__proto__']) expect((await req('POST', '/api/food/drinks', { day: today, type, ml: 200 })).statusCode).toBe(400);
    expect((await req('GET', '/api/today')).json().parts.food.waterMl).toEqual(expect.any(Number));
  });
  it('ссылки: IPv4 внутри IPv6 в любой записи — внутренний адрес', () => {
    for (const ip of ['::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:a00:1', '64:ff9b::7f00:1', '::7f00:1']) expect(privateIp(ip)).toBe(true);
    expect(privateIp('::ffff:808:808')).toBe(false);
  });
});

describe('задачи повтора', () => {
  it('перенос задачи повтора на другой день: без ошибки, без дубля, выходит из повтора', async () => {
    await conn.db.insert(s.entitlements).values({ userId, module: 'pro', source: 'free' }).onConflictDoNothing();
    const sid = (await req('POST', '/api/plans/series', { title: 'Зарядка', rule: { kind: 'daily' } })).json().id;
    const list = async () => (await req('GET', `/api/plans/tasks?from=${today}&to=${addDays(today, 13)}`)).json().items as any[];
    const t = (await list()).find(x => x.seriesId === sid && x.day === today);
    const r = await req('PUT', `/api/plans/tasks/${t.id}`, { title: 'Зарядка', day: addDays(today, 1), time: null, prio: false, note: '' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ day: addDays(today, 1), seriesId: null, repeat: false });
    const after = await list();
    expect(after.filter(x => x.title === 'Зарядка' && x.day === today)).toHaveLength(0); // повтор не вернул исходный день
    expect(after.filter(x => x.title === 'Зарядка' && x.day === addDays(today, 1))).toHaveLength(2); // перенесённая + повтор завтрашнего дня
    // без даты — тоже без дубля
    const t2 = after.find(x => x.seriesId === sid && x.day === addDays(today, 2));
    await req('PUT', `/api/plans/tasks/${t2.id}`, { title: 'Зарядка', day: null, prio: false, note: '' });
    expect((await list()).filter(x => x.title === 'Зарядка' && x.day === addDays(today, 2))).toHaveLength(0);
  });
  it('правка задачи без поля goalId не отвязывает её от цели', async () => {
    const g = (await req('POST', '/api/plans/goals', { period: 'month', periodKey: today.slice(0, 7), title: 'Цель' })).json().id;
    const t = (await req('POST', '/api/plans/tasks', { title: 'К цели', day: today, goalId: g })).json();
    expect((await req('PUT', `/api/plans/tasks/${t.id}`, { title: 'К цели!', day: today })).json().goalId).toBe(g);
  });
});

describe('учёба', () => {
  it('повторный ответ в тот же день не двигает интервал', async () => {
    const [m] = await conn.db.insert(s.materials).values({ userId, kind: 'text', title: 'M', text: 'x'.repeat(100), quiz: true }).returning();
    const [q] = await conn.db.insert(s.questions).values({ userId, materialId: m!.id, chunk: 0, q: 'Вопрос?', options: ['a', 'b', 'c', 'd'], correct: 0 }).returning();
    const a1 = await answer(conn.db, userId, today, q!.id, 0);
    const a2 = await answer(conn.db, userId, today, q!.id, 0), a3 = await answer(conn.db, userId, today, q!.id, 0);
    expect(a2!.next).toBe(a1!.next); expect(a3!.next).toBe(a1!.next);
    expect(await conn.db.select().from(s.answers).where(eq(s.answers.questionId, q!.id))).toHaveLength(1);
  });
});

describe('аккаунт и подписка', () => {
  it('покупка во время пробного периода: видна сразу, повтор продлевает', async () => {
    const [u] = await conn.db.insert(s.users).values({ username: 'buyer', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    await grantFree(conn.db, u!.id); await startTrial(conn.db, u!.id);
    const c = String((await login('buyer', 'secret12', '10.0.0.9')).headers['set-cookie']).split(';')[0]!;
    expect((await req('GET', '/api/me', undefined, c)).json().subscription.source).toBe('trial');
    const p1 = (await req('POST', '/api/billing/purchase', { plan: 'year', features: ['gym'] }, c)).json();
    expect(p1.subscription).toMatchObject({ source: 'web', plan: 'year', features: ['gym'] });
    const p2 = (await req('POST', '/api/billing/purchase', { plan: 'year', features: ['gym'] }, c)).json();
    expect(Date.parse(p2.subscription.expiresAt) - Date.parse(p1.subscription.expiresAt)).toBeGreaterThan(360 * 864e5);
  });
  it('чужие неверные пароли с другого адреса не закрывают вход владельцу', async () => {
    for (let i = 0; i < 12; i++) await login('qa', 'wrong-password', '203.0.113.7');
    expect((await login('qa', 'wrong-password', '203.0.113.7')).statusCode).toBe(429);
    expect((await login('qa', 'secret12', '198.51.100.20')).statusCode).toBe(200);
  });
  it('удаление аккаунта стирает и загруженные файлы', async () => {
    const [u] = await conn.db.insert(s.users).values({ username: 'leaver', passwordHash: await hashPassword('secret12') }).returning();
    await grantFree(conn.db, u!.id); await conn.db.insert(s.entitlements).values({ userId: u!.id, module: 'pro', source: 'free' }).onConflictDoNothing();
    const c = String((await login('leaver', 'secret12', '10.0.0.5')).headers['set-cookie']).split(';')[0]!;
    const r = await app.inject({ method: 'POST', url: '/api/study/materials/upload', payload: Buffer.from('# Конспект\n\n' + 'текст '.repeat(20)), headers: { ...H, cookie: c, 'content-type': 'application/octet-stream', 'x-file-name': 'a%ZZ.md' } });
    expect(r.statusCode).toBe(201); // битое имя файла — не 500
    const dir = path.join(process.env.STUDY_FILES_DIR!, u!.id);
    expect(fs.readdirSync(dir)).toHaveLength(1);
    expect((await req('POST', '/api/account/delete', { password: 'secret12' }, c)).json()).toEqual({ ok: true });
    expect(fs.existsSync(dir)).toBe(false);
  });
});
