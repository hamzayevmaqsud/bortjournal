/**
 * Вход и сессии. Пароль — scrypt (формат совместим со старым журналом), сессия — случайный токен
 * в httpOnly-cookie, в базе только sha256 от него. Неверный логин и неверный пароль отвечают
 * одинаково и за одинаковое время. Подбор ограничен по IP и по логину.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import { startTrial, subscription } from './billing.js';
import { modulesOf } from './entitlements.js';
import { profiles, sessions, users } from './schema.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
export const COOKIE = 'bj_sid';
const SESSION_DAYS = 60;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw: string, salt = crypto.randomBytes(16).toString('hex')) {
  const N = 16384, r = 8, p = 1;
  return `scrypt$${N}$${r}$${p}$${salt}$${(await scrypt(pw, salt, 64, { N, r, p })).toString('hex')}`;
}
const DUMMY = `scrypt$16384$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
export async function verifyPassword(pw: string, stored: string | null | undefined) {
  const [alg, N, r, p, salt, hash] = (stored ?? DUMMY).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const got = await scrypt(pw, salt, hash.length / 2, { N: +N!, r: +r!, p: +p!, maxmem: 64 * 1024 * 1024 });
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want) && !!stored;
}

/* подбор пароля: 10 неудач за 15 минут по IP и по логину */
const fails = new Map<string, { n: number; until: number }>();
const tooMany = (...keys: string[]) => keys.some(k => { const f = fails.get(k); return !!f && f.until > Date.now() && f.n >= 10; });
const fail = (...keys: string[]) => keys.forEach(k => { const f = fails.get(k); fails.set(k, f && f.until > Date.now() ? { n: f.n + 1, until: f.until } : { n: 1, until: Date.now() + 15 * 60e3 }); });

const isHttps = (req: FastifyRequest) => req.headers['x-forwarded-proto'] === 'https' || /\.ts\.net(:\d+)?$/.test(req.headers.host ?? '');
function setCookie(req: FastifyRequest, reply: FastifyReply, token: string, maxAge: number) {
  reply.header('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
}
const tokenOf = (req: FastifyRequest) => /(?:^|;\s*)bj_sid=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie ?? '')?.[1];

declare module 'fastify' { interface FastifyRequest { userId?: string } }

/**
 * Кто это — на каждом запросе. Вешается на корень приложения (не внутри плагина),
 * иначе Fastify изолирует хук, и маршруты модулей не увидят вошедшего пользователя.
 */
export function sessionHook(db: DB) {
  return async (req: FastifyRequest) => {
    const t = tokenOf(req); if (!t) return;
    const [s] = await db.select({ userId: sessions.userId }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha(t)), gt(sessions.expiresAt, sql`now()`), sql`${users.deletedAt} is null`)).limit(1);
    if (s) req.userId = s.userId;
  };
}

export async function authRoutes(app: FastifyInstance, { db }: { db: DB }) {

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = String(body.username ?? '').trim().toLowerCase().slice(0, 64), password = String(body.password ?? '').slice(0, 512);
    const keys = [`ip:${req.ip}`, `u:${username}`];
    if (tooMany(...keys)) return reply.code(429).send({ error: 'Слишком много попыток. Подожди 15 минут.' });
    const [u] = await db.select().from(users).where(and(sql`lower(${users.username}) = ${username}`, sql`${users.deletedAt} is null`)).limit(1);
    if (!(await verifyPassword(password, u?.passwordHash)) || !u) { fail(...keys); return reply.code(401).send({ error: 'Неверный логин или пароль.' }); }
    keys.forEach(k => fails.delete(k));
    const token = crypto.randomBytes(32).toString('base64url');
    await db.insert(sessions).values({ tokenHash: sha(token), userId: u.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200) });
    setCookie(req, reply, token, SESSION_DAYS * 86400);
    return { username: u.username };
  });

  // регистрация: логин, пароль, почта по желанию; сразу 7 дней Pro и вход
  const regs = new Map<string, { n: number; until: number }>();
  app.post('/api/auth/register', async (req, reply) => {
    const r = regs.get(req.ip);
    if (r && r.until > Date.now() && r.n >= 5) return reply.code(429).send({ error: 'Слишком много регистраций с этого адреса. Попробуй через час.' });
    regs.set(req.ip, r && r.until > Date.now() ? { n: r.n + 1, until: r.until } : { n: 1, until: Date.now() + 3600e3 });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = String(body.username ?? '').trim(), password = String(body.password ?? ''), email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return reply.code(400).send({ error: 'Логин: 3–32 символа — латиница, цифры, точка, дефис или подчёркивание.' });
    if (password.length < 8 || password.length > 512) return reply.code(400).send({ error: 'Пароль — не короче 8 символов.' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: 'Почта выглядит неверно.' });
    const taken = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${username})${email ? sql` or lower(${users.email}) = ${email}` : sql``}`).limit(1);
    if (taken.length) return reply.code(409).send({ error: 'Такой логин или почта уже заняты.' });
    const tz = Number(body.tz);
    const userId = await db.transaction(async tx => {
      const [u] = await tx.insert(users).values({ username, email: email || null, passwordHash: await hashPassword(password), tzOffset: Number.isInteger(tz) && Math.abs(tz) <= 840 ? tz : 0 }).returning({ id: users.id });
      await tx.insert(profiles).values({ userId: u!.id, settings: { kcal: 2000, protein: 0, steps: 8000, study: 60, onboarded: false } });
      await startTrial(tx, u!.id);
      return u!.id;
    });
    const token = crypto.randomBytes(32).toString('base64url');
    await db.insert(sessions).values({ tokenHash: sha(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200) });
    setCookie(req, reply, token, SESSION_DAYS * 86400);
    return reply.code(201).send({ username });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const t = tokenOf(req); if (t) await db.delete(sessions).where(eq(sessions.tokenHash, sha(t)));
    setCookie(req, reply, '', 0);
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    // часовой пояс приходит с устройства: по нему считаются «сегодня», «сейчас» и напоминания
    const tz = Number((req.query as { tz?: string }).tz);
    if (Number.isInteger(tz) && Math.abs(tz) <= 840) await db.update(users).set({ tzOffset: tz }).where(and(eq(users.id, req.userId), sql`${users.tzOffset} <> ${tz}`));
    const [u] = await db.select({ username: users.username, tzOffset: users.tzOffset }).from(users).where(eq(users.id, req.userId));
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, req.userId));
    return { username: u!.username, tzOffset: u!.tzOffset, modules: await modulesOf(db, req.userId), subscription: await subscription(db, req.userId), profile: p ?? null };
  });
}

/** preHandler для маршрутов, которым нужен вход */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
}
