/** Тарифы: Pro и «свой набор» — цена складывается из разделов, но всегда ниже Pro; доступ — только к выбранному */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customPrice, PACK_KEYS, PRICES } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '';
const H = { host: 'localhost' };
const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });

beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'buyer', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  await grantFree(conn.db, u!.id);
  await conn.db.insert(s.profiles).values({ userId: u!.id, sex: 'm', age: 30, heightCm: 180, goal: 'lose', startWeightKg: 90, settings: { kcal: 2000 } });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'buyer', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('цена своего набора', () => {
  it('один раздел — по своей цене, два — скидка 15%, три и больше — 25%', () => {
    expect(customPrice(['gym'], 'month')).toMatchObject({ price: 1.29, discount: 0 });
    expect(customPrice(['gym', 'budget'], 'month')).toMatchObject({ price: 1.94, list: 2.28, discount: 0.15 }); // 2,28 × 0,85
    expect(customPrice(['gym', 'budget', 'books'], 'month')).toMatchObject({ price: 2.45, discount: 0.25 }); // 3,27 × 0,75
    expect(customPrice(['gym'], 'year').price).toBe(9.99); // 1,29 × 8 ≈ 10 → «.99»
  });
  it('любой неполный набор дешевле Pro, экономия показывается; все разделы — это Pro', () => {
    for (const plan of ['month', 'year'] as const) {
      for (let mask = 1; mask < (1 << PACK_KEYS.length) - 1; mask++) {
        const q = customPrice(PACK_KEYS.filter((_, i) => mask & (1 << i)), plan);
        expect(q.price).toBeLessThan(PRICES[plan].price);
        expect(q.save).toBeGreaterThan(0);
      }
      expect(customPrice(PACK_KEYS, plan)).toMatchObject({ all: true, price: PRICES[plan].price });
    }
  });
});

describe('покупка своего набора', () => {
  it('цель и статистика бесплатны, еда Pro закрыта', async () => {
    expect((await req('GET', '/api/goal')).statusCode).toBe(200);
    expect((await req('GET', '/api/stats/overview')).statusCode).toBe(200);
    expect((await req('GET', '/api/awards')).statusCode).toBe(200);
    expect((await req('GET', '/api/food/search?q=гречка')).statusCode).toBe(402);
  });
  it('цену считает сервер', async () => {
    const q = (await req('GET', '/api/billing/quote?plan=month&features=gym,budget,goal')).json();
    expect(q).toMatchObject({ features: ['gym', 'budget'], price: 1.94, discount: 0.15, pro: 4.99 });
  });
  it('открывает только выбранное', async () => {
    const r = (await req('POST', '/api/billing/purchase', { plan: 'month', features: ['food'] })).json();
    expect(r.price).toBe(1.49);
    expect(r.subscription).toMatchObject({ pro: false, features: ['food'], plan: 'month', source: 'web' });
    expect((await req('GET', '/api/food/search?q=гречка')).statusCode).toBe(200);
    expect((await req('POST', '/api/billing/purchase', { plan: 'month', features: ['food', 'goal'] })).statusCode).toBe(400);
  });
  it('все разделы — это Pro', async () => {
    const r = (await req('POST', '/api/billing/purchase', { plan: 'year', features: PACK_KEYS })).json();
    expect(r.subscription).toMatchObject({ pro: true, features: null, plan: 'year' });
    expect(r.price).toBe(PRICES.year.price);
  });
});
