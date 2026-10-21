/**
 * Вход через Google и Apple (OpenID Connect, переход на страницу провайдера и обратно — без их скриптов на нашей странице).
 * Google: код авторизации → обмен на id_token (нужен секрет клиента). Apple: id_token приходит сразу POST-формой.
 * Подпись id_token проверяем сами по открытым ключам провайдера (JWKS), плюс издатель, получатель, срок и nonce.
 *
 * Аккаунт по совпадению почты НЕ присоединяется: почта в журнале не подтверждена, иначе кто-то мог бы заранее
 * зарегистрировать чужую почту и потом видеть чужие записи. Новый вход создаёт новый аккаунт; привязать Google
 * или Apple к своему аккаунту можно из профиля (link) — тогда id пользователя едет в подписанной cookie состояния.
 *
 * Настройка (.env): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET; APPLE_CLIENT_ID (Services ID для веба); PUBLIC_URL — адрес,
 * зарегистрированный у провайдеров как redirect. Пока ключей нет, кнопки не показываются.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import { isHttps, requireUser, startSession } from './auth.js';
import { startTrial } from './billing.js';
import { authIdentities, profiles, users } from './schema.js';

type ProviderId = 'google' | 'apple';
const NAMES: Record<ProviderId, string> = { google: 'Google', apple: 'Apple' };
const env = (k: string) => process.env[k]?.trim() || '';
const enabled = (p: ProviderId) => p === 'google' ? !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')) : !!env('APPLE_CLIENT_ID');
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/* ---------- секрет для подписи cookie состояния ---------- */
let secret: Buffer | null = null;
function authSecret() {
  if (secret) return secret;
  if (env('AUTH_SECRET')) return (secret = Buffer.from(env('AUTH_SECRET')));
  const file = env('AUTH_SECRET_FILE') || fileURLToPath(new URL('../../../../data/auth-secret', import.meta.url));
  try { secret = fs.readFileSync(file); if (secret.length >= 32) return secret; } catch { /* создадим */ }
  secret = crypto.randomBytes(48);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
interface State { p: ProviderId; s: string; n: string; back: string; link?: string; exp: number }
const sign = (v: string) => b64u(crypto.createHmac('sha256', authSecret()).update(v).digest());
const pack = (st: State) => { const v = b64u(JSON.stringify(st)); return `${v}.${sign(v)}`; };
function unpack(raw: string | undefined): State | null {
  const [v, sig] = String(raw ?? '').split('.');
  if (!v || !sig) return null;
  const want = Buffer.from(sign(v)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try { const st = JSON.parse(Buffer.from(v, 'base64url').toString()) as State; return st.exp > Date.now() ? st : null; } catch { return null; }
}
const STATE_COOKIE = 'bj_oauth';
// Apple возвращает POST с другого сайта — cookie состояния должна ехать и туда: SameSite=None (только по https)
const stateCookie = (req: FastifyRequest, value: string, maxAge: number) => `${STATE_COOKIE}=${value}; Path=/api/auth; HttpOnly; Max-Age=${maxAge}; ${isHttps(req) ? 'SameSite=None; Secure' : 'SameSite=Lax'}`;
const readState = (req: FastifyRequest) => /(?:^|;\s*)bj_oauth=([A-Za-z0-9_.-]+)/.exec(req.headers.cookie ?? '')?.[1];

/* ---------- проверка id_token ---------- */
const JWKS: Record<ProviderId, () => string> = { google: () => env('GOOGLE_JWKS_URL') || 'https://www.googleapis.com/oauth2/v3/certs', apple: () => env('APPLE_JWKS_URL') || 'https://appleid.apple.com/auth/keys' };
const ISS: Record<ProviderId, string[]> = { google: ['https://accounts.google.com', 'accounts.google.com'], apple: ['https://appleid.apple.com'] };
const keyCache = new Map<string, { at: number; keys: Array<Record<string, string>> }>();
async function keysOf(url: string, force = false) {
  const c = keyCache.get(url);
  if (c && !force && Date.now() - c.at < 3600e3) return c.keys;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`ключи провайдера: ${r.status}`);
  const keys = ((await r.json()) as { keys: Array<Record<string, string>> }).keys ?? [];
  keyCache.set(url, { at: Date.now(), keys });
  return keys;
}
export interface Claims { sub: string; email?: string; email_verified?: boolean | string; name?: string; nonce?: string; aud: string; iss: string; exp: number }
export async function verifyIdToken(p: ProviderId, token: string, audiences: string[], nonce: string): Promise<Claims> {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) throw new Error('неверный токен');
  const head = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg?: string; kid?: string };
  if (head.alg !== 'RS256') throw new Error('неверный алгоритм подписи');
  let jwk = (await keysOf(JWKS[p]())).find(k => k.kid === head.kid);
  if (!jwk) jwk = (await keysOf(JWKS[p](), true)).find(k => k.kid === head.kid);
  if (!jwk) throw new Error('ключ подписи не найден');
  const key = crypto.createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKeyInput["key"], format: "jwk" });
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), key, Buffer.from(s, 'base64url'))) throw new Error('подпись не сходится');
  const c = JSON.parse(Buffer.from(b, 'base64url').toString()) as Claims;
  if (!ISS[p].includes(c.iss)) throw new Error('чужой издатель');
  if (!audiences.includes(c.aud)) throw new Error('токен выдан другому приложению');
  if (!c.exp || c.exp * 1000 < Date.now() - 60e3) throw new Error('токен просрочен');
  if (c.nonce !== nonce) throw new Error('nonce не совпадает');
  if (!c.sub) throw new Error('нет id пользователя');
  return c;
}

/* ---------- новый аккаунт из входа через провайдера ---------- */
async function freeUsername(db: DB, base: string) {
  let b = base.toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+|[._-]+$/g, '').slice(0, 24);
  if (b.length < 3) b = 'user';
  for (let i = 0; i < 50; i++) {
    const name = i ? `${b}${i < 10 ? i : crypto.randomInt(10, 9999)}` : b;
    const [t] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${name}`).limit(1);
    if (!t) return name;
  }
  return `${b}${crypto.randomBytes(3).toString('hex')}`;
}

export async function oauthRoutes(app: FastifyInstance, { db }: { db: DB }) {
  // Apple присылает ответ формой (application/x-www-form-urlencoded)
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); } catch (e) { done(e as Error); }
  });
  const base = (req: FastifyRequest) => env('PUBLIC_URL').replace(/\/$/, '') || `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
  const redirectUri = (req: FastifyRequest, p: ProviderId) => `${base(req)}/api/auth/${p}/callback`;
  const backOf = (v: unknown) => (v === '/m' ? '/m' : '/');
  const toApp = (reply: FastifyReply, back: string, err?: string, note?: string) =>
    reply.header('Cache-Control', 'no-store').redirect(`${back}${err ? `#auth-error=${encodeURIComponent(err)}` : note ? `#auth-ok=${encodeURIComponent(note)}` : ''}`, 303);

  app.get('/api/auth/providers', async () => ({ google: enabled('google'), apple: enabled('apple') }));

  app.get('/api/auth/:p/start', async (req, reply) => {
    const p = (req.params as { p: string }).p as ProviderId, q = req.query as { back?: string; link?: string };
    if (p !== 'google' && p !== 'apple') return reply.code(404).send({ error: 'Нет такого способа входа.' });
    const back = backOf(q.back);
    if (!enabled(p)) return toApp(reply, back, `Вход через ${NAMES[p]} пока не настроен.`);
    if (q.link && !req.userId) return toApp(reply, back, 'Чтобы привязать, сначала войди в журнал.');
    const st: State = { p, s: b64u(crypto.randomBytes(18)), n: b64u(crypto.randomBytes(18)), back, link: q.link ? req.userId : undefined, exp: Date.now() + 10 * 60e3 };
    reply.header('Set-Cookie', stateCookie(req, pack(st), 600)).header('Cache-Control', 'no-store');
    const u = p === 'google'
      ? new URL(env('GOOGLE_AUTH_URL') || 'https://accounts.google.com/o/oauth2/v2/auth')
      : new URL(env('APPLE_AUTH_URL') || 'https://appleid.apple.com/auth/authorize');
    const common = { client_id: env(p === 'google' ? 'GOOGLE_CLIENT_ID' : 'APPLE_CLIENT_ID'), redirect_uri: redirectUri(req, p), state: st.s, nonce: st.n };
    const extra = p === 'google' ? { response_type: 'code', scope: 'openid email profile', prompt: 'select_account' } : { response_type: 'code id_token', response_mode: 'form_post', scope: 'name email' };
    for (const [k, v] of Object.entries({ ...common, ...extra })) u.searchParams.set(k, v);
    return reply.redirect(u.toString(), 302);
  });

  const finish = async (req: FastifyRequest, reply: FastifyReply, p: ProviderId, params: Record<string, string | undefined>) => {
    const st = unpack(readState(req));
    reply.header('Set-Cookie', stateCookie(req, '', 0));
    const back = st?.back ?? '/';
    if (!st || st.p !== p || params.state !== st.s) return toApp(reply, back, 'Вход устарел или открыт в другом окне. Попробуй ещё раз.');
    if (params.error) return toApp(reply, back, params.error === 'access_denied' || params.error === 'user_cancelled_authorize' ? 'Вход отменён.' : `${NAMES[p]} не пустил: ${params.error}`);
    let claims: Claims;
    try {
      let idToken = params.id_token;
      if (p === 'google') {
        if (!params.code) throw new Error('нет кода');
        const r = await fetch(env('GOOGLE_TOKEN_URL') || 'https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
          body: new URLSearchParams({ code: params.code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: redirectUri(req, p), grant_type: 'authorization_code' })
        });
        if (!r.ok) throw new Error(`обмен кода: ${r.status}`);
        idToken = ((await r.json()) as { id_token?: string }).id_token;
      }
      if (!idToken) throw new Error('нет id_token');
      const auds = p === 'google' ? [env('GOOGLE_CLIENT_ID')] : [env('APPLE_CLIENT_ID'), env('APPLE_BUNDLE_ID')].filter(Boolean);
      claims = await verifyIdToken(p, idToken, auds, st.n);
    } catch (e) {
      req.log.warn({ provider: p, err: (e as Error).message }, 'oauth: вход не прошёл проверку');
      return toApp(reply, back, `Не получилось войти через ${NAMES[p]}. Попробуй ещё раз.`);
    }
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    const email = verified && claims.email ? claims.email.toLowerCase().slice(0, 200) : null;
    const [found] = await db.select().from(authIdentities).where(and(eq(authIdentities.provider, p), eq(authIdentities.subject, claims.sub)));

    // привязка к уже вошедшему пользователю (из профиля)
    if (st.link) {
      if (found && found.userId !== st.link) return toApp(reply, back, `Этот аккаунт ${NAMES[p]} уже привязан к другому журналу.`);
      if (!found) {
        const [mine] = await db.select({ id: authIdentities.id }).from(authIdentities).where(and(eq(authIdentities.userId, st.link), eq(authIdentities.provider, p)));
        if (mine) return toApp(reply, back, `К журналу уже привязан другой аккаунт ${NAMES[p]} — сначала отвяжи его.`);
        await db.insert(authIdentities).values({ userId: st.link, provider: p, subject: claims.sub, email });
      }
      return toApp(reply, back, undefined, `${NAMES[p]} привязан — теперь можно входить через него.`);
    }
    if (found) { await startSession(db, req, reply, found.userId); return toApp(reply, back); }

    // первый вход — новый аккаунт без пароля
    let name = claims.name ?? '';
    if (p === 'apple' && params.user) { try { const u = JSON.parse(params.user) as { name?: { firstName?: string; lastName?: string } }; name = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(' '); } catch { /* имени нет */ } }
    const username = await freeUsername(db, email?.split('@')[0] ?? name.replace(/\s+/g, '.') ?? 'user');
    const emailFree = email ? !(await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1)).length : false;
    const userId = await db.transaction(async tx => {
      const [u] = await tx.insert(users).values({ username, email: emailFree ? email : null, passwordHash: null }).returning({ id: users.id });
      await tx.insert(profiles).values({ userId: u!.id, settings: { kcal: 2000, protein: 0, steps: 8000, study: 60, onboarded: false, ...(name.trim() ? { name: name.trim().slice(0, 40) } : {}) } });
      await tx.insert(authIdentities).values({ userId: u!.id, provider: p, subject: claims.sub, email });
      await startTrial(tx, u!.id);
      return u!.id;
    });
    await startSession(db, req, reply, userId);
    return toApp(reply, back);
  };
  app.get('/api/auth/google/callback', async (req, reply) => finish(req, reply, 'google', req.query as Record<string, string>));
  app.post('/api/auth/apple/callback', async (req, reply) => finish(req, reply, 'apple', (req.body ?? {}) as Record<string, string>));

  // отвязать: нельзя убрать последний способ входа
  app.delete('/api/auth/identities/:p', { preHandler: requireUser }, async (req, reply) => {
    const p = (req.params as { p: string }).p, userId = req.userId!;
    const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    const ids = await db.select({ provider: authIdentities.provider }).from(authIdentities).where(eq(authIdentities.userId, userId));
    if (!ids.some(i => i.provider === p)) return reply.code(404).send({ error: 'Такой способ входа не привязан.' });
    if (!u?.hash && ids.length < 2) return reply.code(400).send({ error: 'Это единственный способ входа. Сначала задай пароль или привяжи другой.' });
    await db.delete(authIdentities).where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, p)));
    return { ok: true };
  });
}
