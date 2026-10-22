/** Google Календарь: подключение, задачи и тренировки в календаре «Lumi», события основного календаря в ленте дня */
import http from 'node:http';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import { syncCalendar } from '../src/core/gcal.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

type Call = { method: string; path: string; query: URLSearchParams; auth: string; body: any };
let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', userId = '';
let fake: http.Server, base = '', calls: Call[] = [], revoked = false, n = 0;
const primary: any[] = [];
const H = { host: 'localhost' };
const T = localNow(240).day, D = (k: number) => addDays(T, k);
const r = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });
const of = (method: string, re: RegExp) => calls.filter(c => c.method === method && re.test(c.path));

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x'), ct = String(req.headers['content-type'] ?? '');
      const body = !raw ? null : ct.includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
      calls.push({ method: req.method!, path: u.pathname, query: u.searchParams, auth: String(req.headers.authorization ?? ''), body });
      const send = (code: number, j?: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(j === undefined ? '' : JSON.stringify(j)); };
      if (u.pathname === '/token') {
        if (body.grant_type === 'authorization_code') return body.code === 'good' ? send(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: 'x' }) : send(400, { error: 'invalid_grant' });
        return revoked ? send(400, { error: 'invalid_grant' }) : send(200, { access_token: 'at2', expires_in: 3600 });
      }
      if (u.pathname === '/revoke') return send(200, {});
      if (u.pathname === '/calendar/v3/calendars' && req.method === 'POST') return send(200, { id: 'lumi-cal', summary: body.summary });
      if (u.pathname === '/calendar/v3/calendars/lumi-cal' && req.method === 'DELETE') return send(204);
      if (u.pathname === '/calendar/v3/calendars/lumi-cal/events' && req.method === 'POST') return send(200, { id: `ev${++n}` });
      if (/^\/calendar\/v3\/calendars\/lumi-cal\/events\/ev\d+$/.test(u.pathname)) return send(req.method === 'DELETE' ? 204 : 200, req.method === 'DELETE' ? undefined : { id: u.pathname.split('/').pop() });
      if (u.pathname === '/calendar/v3/calendars/primary/events') return send(200, { items: primary });
      send(404, { error: 'нет такого' });
    });
  });
  await new Promise<void>(ok => fake.listen(0, '127.0.0.1', () => ok()));
  base = `http://127.0.0.1:${(fake.address() as any).port}`;
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', GOOGLE_AUTH_URL: `${base}/auth`, GOOGLE_TOKEN_URL: `${base}/token`,
    GOOGLE_REVOKE_URL: `${base}/revoke`, GCAL_API_URL: `${base}/calendar/v3`, INTEGRATIONS_KEY: crypto.randomBytes(32).toString('base64')
  });
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'cal', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  userId = u!.id;
  await grantFree(conn.db, userId); await grant(conn.db, userId, 'pro', 'free');
  await conn.db.insert(s.profiles).values({ userId, settings: {} });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'cal', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => {
  await app?.close(); await conn?.pool.end(); fake?.close();
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_AUTH_URL', 'GOOGLE_TOKEN_URL', 'GOOGLE_REVOKE_URL', 'GCAL_API_URL', 'INTEGRATIONS_KEY']) delete process.env[k];
});

describe('подключение', () => {
  it('статус: доступно, не подключено', async () => {
    expect((await r('GET', '/api/integrations')).json()).toMatchObject({ googleCalendar: { available: true, connected: false } });
  });
  it('переход к Google с нужными правами; чужой state не принимается; код меняется на токены, создаётся календарь «Lumi», токены зашифрованы', async () => {
    const start = await r('GET', '/api/integrations/google-calendar/start');
    expect(start.statusCode).toBe(302);
    const loc = new URL(String(start.headers.location));
    expect(loc.origin + loc.pathname).toBe(`${base}/auth`);
    expect(loc.searchParams.get('scope')).toContain('calendar.app.created');
    expect(loc.searchParams.get('scope')).toContain('calendar.events.readonly');
    expect(loc.searchParams.get('access_type')).toBe('offline');
    const state = loc.searchParams.get('state')!;
    expect((await r('GET', `/api/integrations/google-calendar/callback?code=good&state=${state}x`)).statusCode).toBe(400);
    const cb = await r('GET', `/api/integrations/google-calendar/callback?code=good&state=${encodeURIComponent(state)}`);
    expect(cb.statusCode).toBe(302);
    expect(String(cb.headers.location)).toContain('gcal=connected');
    expect(of('POST', /\/calendars$/)[0]).toMatchObject({ auth: 'Bearer at1', body: { summary: 'Lumi' } });
    const [row] = await conn.db.select().from(s.integrations).where(eq(s.integrations.userId, userId));
    expect(row).toMatchObject({ provider: 'google-calendar', status: 'active' });
    expect(row!.secretEnc).toBeTruthy();
    expect(row!.secretEnc).not.toContain('rt1');
    expect((await r('GET', '/api/integrations')).json().googleCalendar).toMatchObject({ connected: true, error: null });
    // в выгрузку данных токены не попадают
    expect(JSON.stringify((await r('GET', '/api/export')).json())).not.toContain(row!.secretEnc!);
  });
});

describe('синхронизация', () => {
  let a = '', b = '';
  it('задачи с датой — события в «Lumi»: со временем по поясу человека, без времени — на весь день; тренировки по плану', async () => {
    a = (await r('POST', '/api/plans/tasks', { title: 'Позвонить врачу', day: D(0), time: '09:30' })).json().id;
    b = (await r('POST', '/api/plans/tasks', { title: 'Оплатить интернет', day: D(1) })).json().id;
    await r('POST', '/api/plans/tasks', { title: 'Когда-нибудь', day: null });
    const wd = new Date(`${D(2)}T12:00:00Z`).getUTCDay();
    await conn.db.insert(s.workoutPlans).values({ userId, name: 'Грудь', weekdays: [wd], time: '19:00', exercises: [] });
    calls = [];
    await syncCalendar(conn.db, userId);
    const posts = of('POST', /lumi-cal\/events$/);
    const ev = (t: string) => posts.find(c => c.body.summary === t)?.body;
    expect(ev('Позвонить врачу')).toMatchObject({ start: { dateTime: `${D(0)}T09:30:00+04:00` }, end: { dateTime: `${D(0)}T10:00:00+04:00` } });
    expect(ev('Оплатить интернет')).toMatchObject({ start: { date: D(1) }, end: { date: D(2) } });
    expect(ev('Зал: Грудь')).toMatchObject({ start: { dateTime: `${D(2)}T19:00:00+04:00` }, end: { dateTime: `${D(2)}T20:00:00+04:00` } });
    expect(posts.some(c => c.body.summary === 'Когда-нибудь')).toBe(false);
    expect(posts.every(c => c.auth === 'Bearer at1')).toBe(true);
  });

  it('без изменений — событий не трогаем; сделано — «✓», удалено — событие удаляется', async () => {
    calls = [];
    await syncCalendar(conn.db, userId);
    expect(calls.filter(c => c.path.includes('lumi-cal'))).toHaveLength(0);
    await r('POST', `/api/plans/tasks/${a}/toggle`);
    await r('DELETE', `/api/plans/tasks/${b}`);
    await syncCalendar(conn.db, userId);
    expect(of('PATCH', /lumi-cal\/events\/ev\d+$/).map(c => c.body.summary)).toEqual(['✓ Позвонить врачу']);
    expect(of('DELETE', /lumi-cal\/events\/ev\d+$/)).toHaveLength(1);
  });

  it('события основного календаря — в «Сегодня»: со временем и на весь день', async () => {
    primary.push(
      { id: 'p1', summary: 'Стоматолог', start: { dateTime: `${D(0)}T14:00:00+04:00` }, end: { dateTime: `${D(0)}T15:30:00+04:00` } },
      { id: 'p2', summary: 'ДР мамы', start: { date: D(0) }, end: { date: D(1) } },
      { id: 'p3', status: 'cancelled', summary: 'Отменили', start: { dateTime: `${D(0)}T16:00:00+04:00` }, end: { dateTime: `${D(0)}T17:00:00+04:00` } }
    );
    await syncCalendar(conn.db, userId);
    const cal = (await r('GET', `/api/today?day=${D(0)}`)).json().calendar;
    expect(cal).toEqual([{ id: 'p2', title: 'ДР мамы', time: null, minutes: null }, { id: 'p1', title: 'Стоматолог', time: '14:00', minutes: 90 }]);
    expect((await r('GET', `/api/today?day=${D(1)}`)).json().calendar).toEqual([]);
  });

  it('access-токен истёк — берётся новый по refresh-токену', async () => {
    calls = [];
    await syncCalendar(conn.db, userId, new Date(Date.now() + 2 * 3600e3));
    expect(of('POST', /^\/token$/)[0]?.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt1', client_id: 'cid' });
    expect(calls.filter(c => c.path.includes('/calendar/')).every(c => c.auth === 'Bearer at2')).toBe(true);
  });

  it('доступ отозван — статус «подключи заново», синхронизация не идёт', async () => {
    revoked = true;
    await syncCalendar(conn.db, userId, new Date(Date.now() + 5 * 3600e3));
    const st = (await r('GET', '/api/integrations')).json().googleCalendar;
    expect(st).toMatchObject({ connected: true });
    expect(st.error).toMatch(/подключи заново/);
    calls = [];
    await syncCalendar(conn.db, userId, new Date(Date.now() + 6 * 3600e3));
    expect(calls).toHaveLength(0);
    revoked = false;
  });
});

describe('отключение', () => {
  it('календарь «Lumi» удаляется, токен отзывается, связи и события стираются', async () => {
    calls = [];
    expect((await r('DELETE', '/api/integrations/google-calendar')).json()).toEqual({ ok: true });
    expect(of('DELETE', /\/calendars\/lumi-cal$/)).toHaveLength(1);
    expect(of('POST', /^\/revoke$/)).toHaveLength(1);
    expect(await conn.db.select().from(s.integrations).where(eq(s.integrations.userId, userId))).toHaveLength(0);
    expect(await conn.db.select().from(s.gcalLinks).where(eq(s.gcalLinks.userId, userId))).toHaveLength(0);
    expect((await r('GET', `/api/today?day=${D(0)}`)).json().calendar).toEqual([]);
  });
});
