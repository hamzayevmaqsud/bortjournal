/**
 * Вход через Google и Apple: новый аккаунт, повторный вход, подделки (state, подпись, nonce), почта не присоединяет
 * чужой аккаунт, привязка и отвязка из профиля, пароль для аккаунта без пароля, удаление без пароля.
 * Провайдеры — локальный сервер со своими ключами (JWKS и обмен кода).
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const evil = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, string>), kid: 'k1', alg: 'RS256', use: 'sig' };
const jwt = (claims: Record<string, unknown>, key = privateKey) => {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url'), b = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${b}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${b}`), key).toString('base64url')}`;
};
let next: { claims: Record<string, unknown>; key?: crypto.KeyObject } | null = null, srv: http.Server;
let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: 'localhost' }, now = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    if (req.url?.startsWith('/jwks')) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] })); return; }
    if (req.url === '/token') { req.resume(); req.on('end', () => res.writeHead(next ? 200 : 400, { 'content-type': 'application/json' }).end(JSON.stringify(next ? { id_token: jwt(next.claims, next.key) } : { error: 'invalid_grant' }))); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'g-client', GOOGLE_CLIENT_SECRET: 'g-secret', APPLE_CLIENT_ID: 'az.test.web', AUTH_SECRET: 'x'.repeat(40),
    GOOGLE_JWKS_URL: `${base}/jwks-g`, APPLE_JWKS_URL: `${base}/jwks-a`, GOOGLE_TOKEN_URL: `${base}/token`, PUBLIC_URL: 'http://localhost' });
  conn = await freshDb();
  const [v] = await conn.db.insert(s.users).values({ username: 'victim', email: 'victim@mail.az', passwordHash: await hashPassword('secret12') }).returning();
  await grantFree(conn.db, v!.id);
  await conn.db.insert(s.profiles).values({ userId: v!.id, heightCm: 180, settings: {} });
  app = await buildApp({ db: conn.db, serveWeb: false });
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); srv?.close(); });

const cookieOf = (r: { headers: Record<string, unknown> }, name: string) => [r.headers['set-cookie']].flat().map(String).map(c => c.split(';')[0]!).find(c => c.startsWith(`${name}=`) && c.length > name.length + 1);
async function start(p: 'google' | 'apple', q = '', cookie = '') {
  const r = await app.inject({ method: 'GET', url: `/api/auth/${p}/start${q}`, headers: { ...H, cookie } });
  expect(r.statusCode).toBe(302);
  const u = new URL(String(r.headers.location));
  return { state: u.searchParams.get('state')!, nonce: u.searchParams.get('nonce')!, url: u, st: cookieOf(r, 'bj_oauth')! };
}
const google = async (claims: Record<string, unknown>, opt: { cookie?: string; q?: string; key?: crypto.KeyObject; badState?: boolean } = {}) => {
  const a = await start('google', opt.q, opt.cookie);
  next = { claims: { iss: 'https://accounts.google.com', aud: 'g-client', exp: now() + 600, nonce: a.nonce, ...claims }, key: opt.key };
  return app.inject({ method: 'GET', url: `/api/auth/google/callback?code=c1&state=${opt.badState ? 'nope' : a.state}`, headers: { ...H, cookie: [a.st, opt.cookie].filter(Boolean).join('; ') } });
};
const loc = (r: { headers: Record<string, unknown> }) => decodeURIComponent(String(r.headers.location));
const me = (cookie: string) => app.inject({ method: 'GET', url: '/api/account', headers: { ...H, cookie } }).then(r => r.json());

describe('вход через Google и Apple', () => {
  it('кнопки видны, когда ключи заданы; ссылка на Google собрана верно', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/providers', headers: H })).json()).toEqual({ google: true, apple: true, beta: false });
    const a = await start('google', '?back=/m');
    expect(a.url.origin + a.url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(a.url.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/google/callback');
    expect(a.url.searchParams.get('scope')).toBe('openid email profile');
  });
  let gCookie = '';
  it('первый вход через Google — новый аккаунт без пароля, с почтой и пробным Pro', async () => {
    const r = await google({ sub: 'g-111', email: 'Ali.Valiyev@gmail.com', email_verified: true, name: 'Ali Valiyev' });
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe('/');
    gCookie = cookieOf(r, 'bj_sid')!;
    const a = await me(gCookie);
    expect(a).toMatchObject({ username: 'ali.valiyev', email: 'ali.valiyev@gmail.com', hasPassword: false });
    expect(a.identities).toEqual([expect.objectContaining({ provider: 'google', email: 'ali.valiyev@gmail.com' })]);
    const m = (await app.inject({ method: 'GET', url: '/api/me', headers: { ...H, cookie: gCookie } })).json();
    expect(m.subscription.source).toBe('trial');
    expect(m.profile.settings.name).toBe('Ali Valiyev');
  });
  it('повторный вход — тот же аккаунт', async () => {
    const before = (await conn.db.select().from(s.users)).length;
    const r = await google({ sub: 'g-111', email: 'ali.valiyev@gmail.com', email_verified: true });
    expect((await me(cookieOf(r, 'bj_sid')!)).username).toBe('ali.valiyev');
    expect((await conn.db.select().from(s.users)).length).toBe(before);
  });
  it('подделки не проходят: state, подпись, nonce, чужой получатель', async () => {
    for (const r of [
      await google({ sub: 'g-x' }, { badState: true }),
      await google({ sub: 'g-x' }, { key: evil }),
      await google({ sub: 'g-x', nonce: 'other' }),
      await google({ sub: 'g-x', aud: 'someone-else' }),
      await google({ sub: 'g-x', exp: now() - 3600 })
    ]) { expect(r.statusCode).toBe(303); expect(loc(r)).toMatch(/#auth-error=/); expect(cookieOf(r, 'bj_sid')).toBeUndefined(); }
    expect(await conn.db.select().from(s.authIdentities).where(eq(s.authIdentities.subject, 'g-x'))).toHaveLength(0);
  });
  it('совпадение почты не открывает чужой аккаунт', async () => {
    const r = await google({ sub: 'g-victim', email: 'victim@mail.az', email_verified: true });
    const a = await me(cookieOf(r, 'bj_sid')!);
    expect(a.username).not.toBe('victim');
    expect(a.email).toBeNull(); // почта уже у другого аккаунта — новому не ставим
  });
  it('Apple: ответ формой, имя из первого входа, возврат на /m', async () => {
    const a = await start('apple', '?back=/m');
    expect(a.url.searchParams.get('response_mode')).toBe('form_post');
    const id = jwt({ iss: 'https://appleid.apple.com', aud: 'az.test.web', exp: now() + 600, nonce: a.nonce, sub: 'a-222', email: 'xyz@privaterelay.appleid.com', email_verified: 'true' });
    const form = new URLSearchParams({ state: a.state, code: 'c', id_token: id, user: JSON.stringify({ name: { firstName: 'Лейла', lastName: 'Ахмедова' } }) }).toString();
    const r = await app.inject({ method: 'POST', url: '/api/auth/apple/callback', payload: form, headers: { ...H, 'content-type': 'application/x-www-form-urlencoded', cookie: a.st } });
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe('/m');
    const m = (await app.inject({ method: 'GET', url: '/api/me', headers: { ...H, cookie: cookieOf(r, 'bj_sid')! } })).json();
    expect(m.profile.settings.name).toBe('Лейла Ахмедова');
    expect(m.username).toBe('xyz');
  });
  it('привязка Google к своему аккаунту и вход через него', async () => {
    const victim = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'victim', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
    expect(loc(await google({ sub: 'g-111' }, { cookie: victim, q: '?link=1' }))).toMatch(/уже привязан к другому журналу/);
    const r = await google({ sub: 'g-555', email: 'v@gmail.com', email_verified: true }, { cookie: victim, q: '?link=1' });
    expect(loc(r)).toMatch(/#auth-ok=Google привязан/);
    expect((await me(victim)).identities.map((i: any) => i.provider)).toEqual(['google']);
    const again = await google({ sub: 'g-555' });
    expect((await me(cookieOf(again, 'bj_sid')!)).username).toBe('victim');
    // отвязать можно — пароль остаётся
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/identities/google', headers: { ...H, cookie: victim } })).json()).toEqual({ ok: true });
  });
  it('без пароля: последний способ не отвязать; первый пароль без текущего; удаление по логину', async () => {
    const del = (body: unknown) => app.inject({ method: 'POST', url: '/api/account/delete', payload: body as any, headers: { ...H, cookie: gCookie } });
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/identities/google', headers: { ...H, cookie: gCookie } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/auth/password', payload: { next: 'brandnew12' }, headers: { ...H, cookie: gCookie } })).json()).toMatchObject({ ok: true });
    expect((await me(gCookie)).hasPassword).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'ali.valiyev', password: 'brandnew12' } })).statusCode).toBe(200);
    // теперь пароль есть — удаление требует его
    expect((await del({ confirm: 'ali.valiyev' })).statusCode).toBe(400);
    expect((await del({ password: 'brandnew12' })).json()).toEqual({ ok: true });
    expect(await conn.db.select().from(s.authIdentities).where(eq(s.authIdentities.subject, 'g-111'))).toHaveLength(0);
  });
});
