/** Внешний вид за уровень: закрытое не поставить, ручной уровень открывает всё, выбор в профиле, поздравление «Новый уровень» */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { lookOf } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', userId = '';
const H = { host: 'localhost' };
const r = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });

beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'painter', passwordHash: await hashPassword('secret12') }).returning();
  userId = u!.id; await grantFree(conn.db, userId);
  await conn.db.insert(s.profiles).values({ userId, settings: {} });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'painter', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('внешний вид за уровень', () => {
  it('новичок: уровень 1, открыт «Маяк», остальное с замком; закрытое не поставить', async () => {
    const st = (await r('GET', '/api/look')).json();
    expect(st).toMatchObject({ level: 1, seen: 1, fresh: [], look: { theme: 'lumi', streak: 'flame' } });
    expect(st.themes.filter((t: any) => t.open).map((t: any) => t.id)).toEqual(['lumi']);
    const no = await r('PUT', '/api/look', { theme: 'sea' });
    expect(no.statusCode).toBe(400); expect(no.json().error).toMatch(/уровне 2/);
    expect((await r('PUT', '/api/look', { theme: 'nope' })).statusCode).toBe(400);
    expect((await r('PUT', '/api/look', { streak: 'flame' })).statusCode).toBe(200); // первый вариант — всем
  });
  it('уровень 99 вручную: всё открыто, поздравление с тем, что открылось, выбор сохраняется в профиле', async () => {
    await conn.db.update(s.users).set({ levelOverride: 99 }).where(eq(s.users.id, userId));
    const st = (await r('GET', '/api/look')).json();
    expect(st.level).toBe(99);
    expect(st.themes.every((t: any) => t.open)).toBe(true);
    expect(st.fresh.map((f: any) => f.id)).toContain('neon');
    expect((await r('PUT', '/api/look', { theme: 'neon', streak: 'star', font: 'serif', celebrate: 'stars' })).json().look).toEqual({ theme: 'neon', streak: 'star', font: 'serif', celebrate: 'stars' });
    expect((await r('GET', '/api/me')).json().profile.settings.look.theme).toBe('neon');
    await r('POST', '/api/look/seen');
    expect((await r('GET', '/api/look')).json().fresh).toEqual([]);
  });
  it('уровень убрали — закрытое снова не действует (тема по умолчанию)', async () => {
    await conn.db.update(s.users).set({ levelOverride: null }).where(eq(s.users.id, userId));
    expect((await r('GET', '/api/look')).json().look).toMatchObject({ theme: 'lumi', streak: 'flame', font: 'sans' });
    expect(lookOf({ theme: 'sea', streak: 'star' }, 4)).toMatchObject({ theme: 'sea', streak: 'star' });
  });
});
