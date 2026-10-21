/** Сброс пароля: ответ одинаковый для любых логинов, ссылка от админа, одна попытка, 30 минут, все устройства выходят */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, admin = '', friendId = '';
const H = { host: 'localhost' };
const login = async (u: string, p: string) => app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: u, password: p } });
const ck = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0]!;

beforeAll(async () => {
  process.env.ADMIN_USERS = 'boss'; process.env.PUBLIC_URL = 'https://journal.example';
  conn = await freshDb();
  for (const [n, email] of [['boss', null], ['friend', 'friend@mail.az']] as const) {
    const [u] = await conn.db.insert(s.users).values({ username: n, email, passwordHash: await hashPassword('secret12') }).returning();
    await grantFree(conn.db, u!.id); if (n === 'friend') friendId = u!.id;
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
  admin = ck(await login('boss', 'secret12'));
}, 60000);
afterAll(async () => { delete process.env.ADMIN_USERS; delete process.env.PUBLIC_URL; await app?.close(); await conn?.pool.end(); });

describe('сброс пароля', () => {
  it('«Забыли пароль?» — одинаковый ответ для своего и несуществующего логина', async () => {
    const a = (await app.inject({ method: 'POST', url: '/api/auth/forgot', headers: H, payload: { login: 'friend@mail.az' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/auth/forgot', headers: H, payload: { login: 'nobody-here' } })).json();
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true, mail: false });
  });
  it('ссылка от админа: новый пароль, вход сразу, старые устройства вышли, второй раз не работает', async () => {
    const old = ck(await login('friend', 'secret12'));
    expect((await app.inject({ method: 'POST', url: `/api/admin/users/${friendId}/reset-link`, headers: { ...H, cookie: old } })).statusCode).toBe(404);
    const r = (await app.inject({ method: 'POST', url: `/api/admin/users/${friendId}/reset-link`, headers: { ...H, cookie: admin } })).json();
    expect(r.link).toMatch(/^https:\/\/journal\.example\/#reset=[\w-]{20,}$/);
    const token = r.link.split('#reset=')[1];
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset', headers: H, payload: { token, password: 'short' } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/reset', headers: H, payload: { token, password: 'brand-new-pass' } });
    expect(ok.json()).toEqual({ ok: true, username: 'friend' });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { ...H, cookie: ck(ok) } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { ...H, cookie: old } })).statusCode).toBe(401);
    expect((await login('friend', 'brand-new-pass')).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset', headers: H, payload: { token, password: 'another-pass-1' } })).statusCode).toBe(400);
  });
  it('просроченная ссылка не работает', async () => {
    const r = (await app.inject({ method: 'POST', url: `/api/admin/users/${friendId}/reset-link`, headers: { ...H, cookie: admin } })).json();
    await conn.db.update(s.passwordResets).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.passwordResets.userId, friendId));
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset', headers: H, payload: { token: r.link.split('#reset=')[1], password: 'brand-new-pass-2' } })).statusCode).toBe(400);
  });
});
