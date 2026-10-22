/** Импорт файла выгрузки старого журнала в свой аккаунт: записи добавляются со сверкой, анкета и доступ не портятся */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { hashPassword } from '../src/core/auth.js';
import { grantFree, hasModule } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', userId = '';
const H = { host: 'localhost' };
const r = (payload: unknown) => app.inject({ method: 'POST', url: '/api/account/import', payload: payload as any, headers: { ...H, cookie } });
const OLD = {
  settings: { kcal: 2100, water: 2500 },
  profile: {},
  meals: [{ id: 'm1', date: '2026-10-12', time: '9:05', name: 'Овсянка', kcal: 350, p: 12, f: 7, c: 60, slot: 'breakfast' }],
  drinks: [{ id: 'd1', date: '2026-10-12', time: '10:00', type: 'water', ml: 250 }],
  study: [{ id: 's1', date: '2026-10-12', time: '20:00', topic: 'Kubernetes', category: 'DevOps', minutes: 45, notes: [], qa: [] }],
  days: { '2026-10-12': { note: 'Хороший день', mood: 4 } }
};

beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'mover', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  userId = u!.id;
  await grantFree(conn.db, userId);
  await conn.db.insert(s.profiles).values({ userId, heightCm: 180, sex: 'm', settings: { onboarded: true, aiConsent: true, kcal: 1800 } });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'mover', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('импорт выгрузки старого журнала', () => {
  it('не выгрузка старого журнала — 400, ничего не записано', async () => {
    expect((await r({ hello: 'world' })).statusCode).toBe(400);
    expect((await r({ format: 'bortjournal-export', version: 1 })).statusCode).toBe(400);
  });

  it('записи переносятся со сверкой; анкета и свои настройки остаются, настройки файла добавляются', async () => {
    // своя запись, сделанная до импорта, сверке не мешает и остаётся
    expect((await app.inject({ method: 'POST', url: '/api/food/meals', headers: { ...H, cookie }, payload: { day: '2026-10-20', name: 'Своё', kcal: 100 } })).statusCode).toBe(201);
    const res = await r(OLD);
    expect(res.statusCode).toBe(200);
    const rep = res.json();
    expect(rep.ok).toBe(true);
    expect(rep.checks.length).toBeGreaterThan(0);
    expect((await conn.db.select({ n: count() }).from(s.meals).where(eq(s.meals.userId, userId)))[0]!.n).toBe(2);
    expect((await conn.db.select({ n: count() }).from(s.studySessions).where(eq(s.studySessions.userId, userId)))[0]!.n).toBe(1);
    const [p] = await conn.db.select().from(s.profiles).where(eq(s.profiles.userId, userId));
    expect(p).toMatchObject({ heightCm: 180, sex: 'm' });
    expect(p!.settings).toMatchObject({ onboarded: true, aiConsent: true, kcal: 2100, water: 2500 });
  });

  it('файл не даёт Pro и не задваивает записи при повторе; выгрузку можно обернуть в { state }', async () => {
    expect(await hasModule(conn.db, userId, 'pro')).toBe(false);
    expect((await r({ rev: 3, state: OLD })).json().ok).toBe(true);
    expect((await conn.db.select({ n: count() }).from(s.meals).where(eq(s.meals.userId, userId)))[0]!.n).toBe(2);
    expect((await conn.db.select({ n: count() }).from(s.drinks).where(eq(s.drinks.userId, userId)))[0]!.n).toBe(1);
  });
});
