/** Бюджет: настройка, «сколько можно сегодня», перенос остатка на завтра, доход, категории, удаление */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { budgetPeriod, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '';
const H = { host: 'localhost' }, today = localNow(240).day;
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });

beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'saver', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  await grantFree(conn.db, u!.id); await grant(conn.db, u!.id, 'pro', 'free');
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'saver', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('бюджет', () => {
  it('без настроек — предложение настроить', async () => {
    expect((await req('GET', '/api/budget/overview')).json()).toMatchObject({ configured: false });
    expect((await req('PUT', '/api/budget/settings', { amount: 0 })).statusCode).toBe(400);
  });
  it('лимит дня, трата, «12,5+3», категории', async () => {
    await req('PUT', '/api/budget/settings', { amount: '1500', startDay: 1, savings: 0, currency: '₼' });
    const p = budgetPeriod(today, 1), left = Math.round((Date.parse(p.to) - Date.parse(today)) / 864e5) + 1;
    const o0 = (await req('GET', '/api/budget/overview')).json();
    expect(o0.allow).toBeCloseTo(1500 / left, 1);
    const e = (await req('POST', '/api/budget/entries', { day: today, kind: 'out', category: 'cafe', amount: '12,5+3', note: 'Кофе' })).json();
    expect(e.amount).toBe(15.5);
    const o = (await req('GET', '/api/budget/overview')).json();
    expect(o.today).toBe(15.5);
    expect(o.leftToday).toBeCloseTo(o0.allow - 15.5, 2);
    expect(o.byCat[0]).toMatchObject({ key: 'cafe', sum: 15.5 });
    expect(o.ops[0]).toMatchObject({ note: 'Кофе', category: 'cafe' });
    // доход в периоде увеличивает сумму
    await req('POST', '/api/budget/entries', { day: today, kind: 'in', category: 'gift', amount: 100 });
    expect((await req('GET', '/api/budget/overview')).json().total).toBe(1600);
    expect((await req('DELETE', `/api/budget/entries/${e.id}`)).statusCode).toBe(200);
    expect((await req('GET', '/api/budget/overview')).json().today).toBe(0);
  });
});
