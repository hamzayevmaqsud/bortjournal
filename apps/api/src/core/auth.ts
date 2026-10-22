/**
 * Вход и сессии. Пароль — scrypt (формат совместим со старым журналом), сессия — случайный токен
 * в httpOnly-cookie, в базе только sha256 от него. Неверный логин и неверный пароль отвечают
 * одинаково и за одинаковое время. Подбор ограничен по IP и по логину.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import { startTrial, subscription } from './billing.js';
import { modulesOf } from './entitlements.js';
import { isAdminName } from './admin.js';
import { authIdentities, profiles, sessions, users } from './schema.js';

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
// по логину отдельно от адреса — порог высокий: иначе любой мог бы закрыть вход в чужой аккаунт десятком неверных паролей
const tooMany = (...keys: string[]) => keys.some(k => { const f = fails.get(k); return !!f && f.until > Date.now() && f.n >= (k.startsWith('u:') ? 100 : 10); });
const fail = (...keys: string[]) => keys.forEach(k => { const f = fails.get(k); fails.set(k, f && f.until > Date.now() ? { n: f.n + 1, until: f.until } : { n: 1, until: Date.now() + 15 * 60e3 }); });

const isHttps = (req: FastifyRequest) => req.headers['x-forwarded-proto'] === 'https' || /\.ts\.net(:\d+)?$/.test(req.headers.host ?? '');
function setCookie(req: FastifyRequest, reply: FastifyReply, token: string, maxAge: number) {
  reply.header('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
}
const tokenOf = (req: FastifyRequest) => /(?:^|;\s*)bj_sid=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie ?? '')?.[1];

declare module 'fastify' { interface FastifyRequest { userId?: string } }

/** открыть сессию: cookie на 60 дней, в базе — только хеш токена */
export async function startSession(db: DB, req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ tokenHash: sha(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200) });
  setCookie(req, reply, token, SESSION_DAYS * 86400);
}
export { isHttps };

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
    const keys = [`ip:${req.ip}`, `ui:${username}|${req.ip}`, `u:${username}`];
    if (tooMany(...keys)) return reply.code(429).send({ error: 'Слишком много попыток. Подожди 15 минут.' });
    const [u] = await db.select().from(users).where(and(sql`lower(${users.username}) = ${username}`, sql`${users.deletedAt} is null`)).limit(1);
    if (!(await verifyPassword(password, u?.passwordHash)) || !u) { fail(...keys); return reply.code(401).send({ error: 'Неверный логин или пароль.' }); }
    keys.forEach(k => fails.delete(k));
    await startSession(db, req, reply, u.id);
    return { username: u.username };
  });

  // регистрация: логин, пароль, почта по желанию; сразу 7 дней Pro и вход
  const regs = new Map<string, { n: number; until: number }>();
  app.post('/api/auth/register', async (req, reply) => {
    const r = regs.get(req.ip);
    if (r && r.until > Date.now() && r.n >= 5) return reply.code(429).send({ error: 'Слишком много регистраций с этого адреса. Попробуй через час.' });
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
    // считаем только созданные аккаунты: ошибки в форме не съедают лимит
    regs.set(req.ip, r && r.until > Date.now() ? { n: r.n + 1, until: r.until } : { n: 1, until: Date.now() + 3600e3 });
    await startSession(db, req, reply, userId);
    return reply.code(201).send({ username });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const t = tokenOf(req); if (t) await db.delete(sessions).where(eq(sessions.tokenHash, sha(t)));
    setCookie(req, reply, '', 0);
    return { ok: true };
  });

  // смена пароля: нужен текущий; остальные устройства выходят, это остаётся
  app.post('/api/auth/password', async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    const b = (req.body ?? {}) as { current?: unknown; next?: unknown };
    const current = String(b.current ?? '').slice(0, 512), next = String(b.next ?? '');
    if (tooMany(`pw:${req.userId}`)) return reply.code(429).send({ error: 'Слишком много попыток. Подожди 15 минут.' });
    const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, req.userId));
    // вошёл через Google или Apple и пароля ещё нет — задаёт первый, текущий не нужен
    if (u?.hash && !(await verifyPassword(current, u.hash))) { fail(`pw:${req.userId}`); return reply.code(400).send({ error: 'Текущий пароль неверный.' }); }
    if (next.length < 8 || next.length > 512) return reply.code(400).send({ error: 'Новый пароль — не короче 8 символов.' });
    if (u?.hash && next === current) return reply.code(400).send({ error: 'Новый пароль совпадает с текущим.' });
    await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, req.userId));
    const t = tokenOf(req);
    const out = await db.delete(sessions).where(and(eq(sessions.userId, req.userId), t ? sql`${sessions.tokenHash} <> ${sha(t)}` : sql`true`)).returning({ h: sessions.tokenHash });
    return { ok: true, signedOut: out.length };
  });

  /* ---------- аккаунт: почта, устройства, удаление ---------- */
  const need = (req: FastifyRequest, reply: FastifyReply) => { if (!req.userId) { reply.code(401).send({ error: 'Нужно войти.' }); return false; } return true; };
  app.get('/api/account', async (req, reply) => {
    if (!need(req, reply)) return;
    const [u] = await db.select({ username: users.username, email: users.email, createdAt: users.createdAt, tzOffset: users.tzOffset, hash: users.passwordHash }).from(users).where(eq(users.id, req.userId!));
    const ids = await db.select({ provider: authIdentities.provider, email: authIdentities.email, createdAt: authIdentities.createdAt }).from(authIdentities).where(eq(authIdentities.userId, req.userId!));
    const { hash, ...rest } = u!;
    return { ...rest, hasPassword: !!hash, identities: ids };
  });
  app.put('/api/account', async (req, reply) => {
    if (!need(req, reply)) return;
    const email = String((req.body as { email?: unknown } | undefined)?.email ?? '').trim().toLowerCase().slice(0, 200);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: 'Почта выглядит неверно.' });
    if (email) {
      const [t] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${email}`, sql`${users.id} <> ${req.userId}`)).limit(1);
      if (t) return reply.code(409).send({ error: 'Эта почта уже у другого аккаунта.' });
    }
    await db.update(users).set({ email: email || null }).where(eq(users.id, req.userId!));
    return { email: email || null };
  });
  // устройства: id — начало хеша сессии (сам токен не раскрываем)
  app.get('/api/account/sessions', async (req, reply) => {
    if (!need(req, reply)) return;
    const cur = tokenOf(req), mine = cur ? sha(cur) : '';
    const rows = await db.select().from(sessions).where(and(eq(sessions.userId, req.userId!), sql`${sessions.expiresAt} > now()`)).orderBy(sql`${sessions.createdAt} desc`);
    return { items: rows.map(r => ({ id: r.tokenHash.slice(0, 16), current: r.tokenHash === mine, userAgent: r.userAgent, createdAt: r.createdAt })) };
  });
  app.delete('/api/account/sessions/:id', async (req, reply) => {
    if (!need(req, reply)) return;
    const id = String((req.params as { id?: string }).id ?? '');
    if (!/^[0-9a-f]{16}$/.test(id)) return reply.code(400).send({ error: 'Неверное устройство.' });
    const cur = tokenOf(req), mine = cur ? sha(cur) : '';
    if (mine.startsWith(id)) return reply.code(400).send({ error: 'Это устройство — для выхода нажми «Выйти».' });
    const out = await db.delete(sessions).where(and(eq(sessions.userId, req.userId!), sql`left(${sessions.tokenHash}, 16) = ${id}`)).returning({ h: sessions.tokenHash });
    return out.length ? { ok: true } : reply.code(404).send({ error: 'Устройство уже вышло.' });
  });
  app.post('/api/account/sessions/others', async (req, reply) => {
    if (!need(req, reply)) return;
    const cur = tokenOf(req);
    const out = await db.delete(sessions).where(and(eq(sessions.userId, req.userId!), cur ? sql`${sessions.tokenHash} <> ${sha(cur)}` : sql`true`)).returning({ h: sessions.tokenHash });
    return { signedOut: out.length };
  });
  // удалить аккаунт: нужен пароль; все записи удаляются вместе с ним (каскадом) и без возврата
  app.post('/api/account/delete', async (req, reply) => {
    if (!need(req, reply)) return;
    const b = (req.body ?? {}) as { password?: unknown; confirm?: unknown }, password = String(b.password ?? '').slice(0, 512);
    if (tooMany(`del:${req.userId}`)) return reply.code(429).send({ error: 'Слишком много попыток. Подожди 15 минут.' });
    const [u] = await db.select({ hash: users.passwordHash, username: users.username }).from(users).where(eq(users.id, req.userId!));
    // без пароля (вход через Google/Apple) подтверждение — логин
    const ok = u?.hash ? await verifyPassword(password, u.hash) : String(b.confirm ?? '').trim().toLowerCase() === u?.username.toLowerCase();
    if (!ok) { fail(`del:${req.userId}`); return reply.code(400).send({ error: u?.hash ? 'Пароль неверный.' : 'Логин не совпадает.' }); }
    await db.delete(users).where(eq(users.id, req.userId!));
    // загруженные файлы конспектов — тоже (записи в базе ушли каскадом)
    const filesDir = process.env.STUDY_FILES_DIR || fileURLToPath(new URL('../../../../data/study-files', import.meta.url));
    if (/^[0-9a-f-]{36}$/.test(req.userId!)) fs.rmSync(path.join(filesDir, req.userId!), { recursive: true, force: true });
    setCookie(req, reply, '', 0);
    return { ok: true };
  });

  // стереть все записи, оставив аккаунт: вход, анкету, подписку, устройства, ключи и счётчик ИИ.
  // Таблицы с записями находятся по столбцу user_id — новый модуль не забудется; дочерние уходят каскадом
  app.post('/api/account/wipe', async (req, reply) => {
    if (!need(req, reply)) return;
    const b = (req.body ?? {}) as { password?: unknown; confirm?: unknown }, password = String(b.password ?? '').slice(0, 512);
    if (tooMany(`wipe:${req.userId}`)) return reply.code(429).send({ error: 'Слишком много попыток. Подожди 15 минут.' });
    const [u] = await db.select({ hash: users.passwordHash, username: users.username }).from(users).where(eq(users.id, req.userId!));
    const ok = u?.hash ? await verifyPassword(password, u.hash) : String(b.confirm ?? '').trim().toLowerCase() === u?.username.toLowerCase();
    if (!ok) { fail(`wipe:${req.userId}`); return reply.code(400).send({ error: u?.hash ? 'Пароль неверный.' : 'Логин не совпадает.' }); }
    const KEEP = ['users', 'sessions', 'profiles', 'entitlements', 'push_subscriptions', 'api_tokens', 'auth_identities', 'password_resets', 'ai_usage', 'feedback', 'integrations', 'activity_weeks'];
    await db.transaction(async tx => {
      const t = await tx.execute<{ name: string }>(sql`select table_name as name from information_schema.columns where column_name = 'user_id' and table_schema = current_schema() order by table_name`);
      for (const { name } of t.rows) if (!KEEP.includes(name)) await tx.execute(sql`delete from ${sql.identifier(name)} where user_id = ${req.userId!}`);
    });
    const data = fileURLToPath(new URL('../../../../data/', import.meta.url));
    if (/^[0-9a-f-]{36}$/.test(req.userId!)) for (const dir of [process.env.STUDY_FILES_DIR || path.join(data, 'study-files'), path.join(process.env.COVERS_DIR || path.join(data, 'covers-next'), 'u')])
      fs.rmSync(path.join(dir, req.userId!), { recursive: true, force: true });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    // часовой пояс приходит с устройства: по нему считаются «сегодня», «сейчас» и напоминания
    const tz = Number((req.query as { tz?: string }).tz);
    if (Number.isInteger(tz) && Math.abs(tz) <= 840) await db.update(users).set({ tzOffset: tz }).where(and(eq(users.id, req.userId), sql`${users.tzOffset} <> ${tz}`));
    const [u] = await db.select({ username: users.username, tzOffset: users.tzOffset, seen: users.lastSeenAt }).from(users).where(eq(users.id, req.userId));
    if (!u!.seen || Date.now() - u!.seen.getTime() > 10 * 60e3) await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, req.userId));
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, req.userId));
    return { username: u!.username, tzOffset: u!.tzOffset, admin: isAdminName(u!.username), modules: await modulesOf(db, req.userId), subscription: await subscription(db, req.userId), profile: p ?? null };
  });
}

/** preHandler для маршрутов, которым нужен вход */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
}
