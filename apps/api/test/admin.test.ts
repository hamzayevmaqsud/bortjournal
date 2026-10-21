/** Отзывы и админка: отзыв с контекстом, админка только для ADMIN_USERS, активность и расход ИИ, отметка «разобрано» */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: 'localhost' }, c: Record<string, string> = {};
const as = (who: string) => (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: c[who]!, 'user-agent': 'Mozilla/5.0 (iPhone) Safari' } });

beforeAll(async () => {
  process.env.ADMIN_USERS = 'Boss, other';
  conn = await freshDb();
  for (const n of ['boss', 'tester']) {
    const [u] = await conn.db.insert(s.users).values({ username: n, passwordHash: await hashPassword('secret12') }).returning();
    await grantFree(conn.db, u!.id);
    await conn.db.insert(s.profiles).values({ userId: u!.id, settings: { onboarded: true, sections: ['tasks'] } });
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const n of ['boss', 'tester']) c[n] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: n, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { delete process.env.ADMIN_USERS; await app?.close(); await conn?.pool.end(); });

describe('отзывы и админка', () => {
  it('/api/me знает админа и отмечает, когда заходил', async () => {
    expect((await as('boss')('GET', '/api/me')).json().admin).toBe(true);
    expect((await as('tester')('GET', '/api/me')).json().admin).toBe(false);
    expect((await conn.db.select().from(s.users)).every(u => u.lastSeenAt)).toBe(true);
  });
  it('отзыв: с контекстом; пустой — нельзя', async () => {
    expect((await as('tester')('POST', '/api/feedback', { text: 'ок' })).statusCode).toBe(400);
    expect((await as('tester')('POST', '/api/feedback', { text: 'Кнопка «Фото» не открывает галерею', screen: 'food', version: 'beta-1' })).statusCode).toBe(201);
  });
  it('админка — только админу; видны люди, их записи и отзывы', async () => {
    expect((await as('tester')('GET', '/api/admin/overview')).statusCode).toBe(404);
    await as('tester')('POST', '/api/plans/tasks', { title: 'Задача', day: '2026-10-21' });
    const o = (await as('boss')('GET', '/api/admin/overview')).json();
    expect(o.totals).toMatchObject({ users: 2, onboarded: 2, feedbackNew: 1 });
    expect(o.people.find((p: any) => p.username === 'tester')).toMatchObject({ tasks: 1, sections: ['tasks'] });
    const f = o.feedback[0];
    expect(f).toMatchObject({ username: 'tester', done: false, context: { screen: 'food', version: 'beta-1' } });
    expect(f.context.device).toMatch(/iPhone/);
    expect((await as('boss')('POST', `/api/admin/feedback/${f.id}/done`)).json().done).toBe(true);
    expect((await as('boss')('GET', '/api/admin/overview')).json().totals.feedbackNew).toBe(0);
  });
});
