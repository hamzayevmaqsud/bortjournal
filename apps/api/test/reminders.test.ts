/** Напоминания: подписка устройства, что и когда уходит, без повторов, выключатели, вода не чаще раза в 2,5 часа */
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import { dueNudges, remindTick } from '../src/core/reminders.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

process.env.PUSH_ALLOW_ANY = '1';
process.env.VAPID_FILE = path.join(os.tmpdir(), `bj-vapid-${process.pid}.json`);

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', uid = '', srv: http.Server, endpoint = '';
const got: Array<{ auth: string; enc: string; len: number }> = [];
const H = { host: 'localhost' }, TZ = 240, today = localNow(TZ).day;
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });
// момент «сегодня в hh:mm» по местному времени пользователя
const at = (hm: string) => Date.parse(`${today}T${hm}:00Z`) - TZ * 60e3;

beforeAll(async () => {
  srv = http.createServer((r, res) => { const parts: Buffer[] = []; r.on('data', c => parts.push(c)); r.on('end', () => { got.push({ auth: String(r.headers.authorization), enc: String(r.headers['content-encoding']), len: Buffer.concat(parts).length }); res.writeHead(r.url === '/gone' ? 410 : 201).end(); }); });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  endpoint = `http://127.0.0.1:${(srv.address() as { port: number }).port}/push`;
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'nudge', passwordHash: await hashPassword('secret12'), tzOffset: TZ }).returning();
  await conn.db.insert(s.profiles).values({ userId: u!.id, heightCm: 180, settings: { water: 2000 } });
  uid = u!.id; await grantFree(conn.db, u!.id); await grant(conn.db, u!.id, 'pro', 'free');
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'nudge', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); srv?.close(); });

const keys = () => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return { p256dh: e.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }; };

describe('напоминания', () => {
  it('ключ сервера и подписка устройства', async () => {
    const v0 = (await req('GET', '/api/push')).json();
    expect(v0.key).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(v0.devices).toBe(0);
    expect((await req('POST', '/api/push/subscribe', { endpoint: 'ftp://x', keys: keys() })).statusCode).toBe(400);
    const v = (await req('POST', '/api/push/subscribe', { endpoint, keys: keys() })).json();
    expect(v.devices).toBe(1);
    expect(v.kinds).toMatchObject({ water: true, food: true, tasks: true });
  });
  it('тест уходит зашифрованным и подписанным', async () => {
    got.length = 0;
    expect((await req('POST', '/api/push/test')).json()).toEqual({ sent: 1 });
    expect(got[0]).toMatchObject({ enc: 'aes128gcm' });
    expect(got[0]!.auth).toMatch(/^vapid t=.+, k=/);
    expect(got[0]!.len).toBeGreaterThan(100);
  });
  it('в 13:40 — задача ко времени и «записать обед», вода ждёт; второй раз то же не уходит', async () => {
    await req('POST', '/api/plans/tasks', { title: 'Позвонить', day: today, time: '13:30' });
    got.length = 0;
    expect(await remindTick(conn.db, at('13:40'))).toBe(2);
    expect((await dueNudges(conn.db, uid, at('13:41'))).list.map(x => x.key).sort()).toEqual(['food', expect.stringMatching(/^tasks:/), 'water']);
    // ко времени уже отправлено — теперь очередь воды, она одна
    expect(await remindTick(conn.db, at('13:45'))).toBe(1);
    expect(await remindTick(conn.db, at('13:50'))).toBe(0);
  });
  it('вода — когда отстаёшь, не чаще раза в 2,5 часа', async () => {
    await req('POST', '/api/food/meals', { day: today, time: '13:00', name: 'Суп', kcal: 300, protein: 10, fat: 10, carbs: 30 });
    expect(await remindTick(conn.db, at('16:00'))).toBe(0);
    expect(await remindTick(conn.db, at('16:20'))).toBe(1);
    expect(await remindTick(conn.db, at('17:40'))).toBe(0);
    // выпил — догнал график: не напоминает
    await req('POST', '/api/food/drinks', { day: today, time: '17:50', type: 'water', ml: 1800 });
    expect(await remindTick(conn.db, at('20:30'))).toBe(0);
  });
  it('выключатели: вид и все сразу', async () => {
    await req('POST', '/api/plans/tasks', { title: 'Вечер', day: today, time: '20:00' });
    expect((await req('PUT', '/api/push/settings', { kinds: { tasks: false } })).json().kinds.tasks).toBe(false);
    expect((await dueNudges(conn.db, uid, at('20:05'))).list.map(x => x.key)).toEqual([]);
    expect(await remindTick(conn.db, at('20:05'))).toBe(0);
    await req('PUT', '/api/push/settings', { kinds: { tasks: true }, off: true });
    expect(await remindTick(conn.db, at('20:06'))).toBe(0);
    await req('PUT', '/api/push/settings', { off: false });
    expect(await remindTick(conn.db, at('20:07'))).toBe(1);
  });
  it('устройство, которого больше нет, удаляется', async () => {
    await req('POST', '/api/push/subscribe', { endpoint: endpoint.replace('/push', '/gone'), keys: keys() });
    expect((await req('GET', '/api/push')).json().devices).toBe(2);
    await req('POST', '/api/push/test');
    expect((await req('GET', '/api/push')).json().devices).toBe(1);
    expect((await req('POST', '/api/push/unsubscribe', { endpoint })).json().devices).toBe(0);
  });
});
