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
import { localNow } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { startTrial, subscription } from './billing.js';
import { modulesOf } from './entitlements.js';
import { isAdmin } from './admin.js';
import { clientIp, sweepEvery } from './client-ip.js';
import { authIdentities, profiles, sessions, users, userVisits } from './schema.js';

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
// пороги за 15 минут: логин с этого адреса — 10, логин отовсюду — 100, весь адрес — 50
// (адрес общий у офиса или мобильного оператора: подбор одного аккаунта не должен закрывать вход остальным)
const LIMIT = (k: string) => k.startsWith('u:') ? 100 : k.startsWith('ip:') ? 50 : 10;
const tooMany = (...keys: string[]) => keys.some(k => { const f = fails.get(k); return !!f && f.until > Date.now() && f.n >= LIMIT(k); });
sweepEvery(fails, (f, now) => f.until <= now);
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
      .where(and(eq(sessions.tokenHash, sha(t)), gt(sessions.expiresAt, sql`now()`), sql`${users.deletedAt} is null`, sql`(${users.demoUntil} is null or ${users.demoUntil} > now())`)).limit(1);
    if (s) req.userId = s.userId;
  };
}

/** логины demo-… — только для демо без регистрации: ни войти, ни занять их нельзя */
export const isDemoName = (username: string) => /^demo-/i.test(username);

/** слабый пароль: короче 8, только одна цифра или буква повтором, подряд идущие цифры, из списка самых частых */
const COMMON = new Set(['password', 'password1', 'qwertyui', 'qwerty123', 'qwertyuiop', '1q2w3e4r', '1qaz2wsx', 'iloveyou', 'abcd1234', 'aa123456', 'zaq12wsx', 'parol123', 'baku1234', 'azerbaijan']);
export function passwordProblem(p: string): string | null {
  if (p.length < 8 || p.length > 512) return 'Пароль — не короче 8 символов.';
  const low = p.toLowerCase();
  if (/^(.)\1+$/.test(p) || /^\d+$/.test(p) && ('01234567890123456789'.includes(p) || '98765432109876543210'.includes(p)) || COMMON.has(low))
    return 'Пароль слишком простой — его подберут за секунды. Добавь буквы или сделай длиннее.';
  if (/^\d+$/.test(p) && p.length < 10) return 'Только из цифр — нужно хотя бы 10 цифр или добавь буквы.';
  return null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Проверка логина, пароля и почты для нового аккаунта (регистрация и сохранение демо).
 * Почта обязательна — по ней восстанавливается пароль. Вместо логина можно написать почту:
 * тогда она и есть почта для восстановления, а логин придумывается из её начала (ali.valiyev@… → ali.valiyev).
 * password2 — повтор пароля: если прислан, должен совпасть. except — свой id: при сохранении демо своя почта не считается занятой
 */
export async function newAccount(db: Tx, body: Record<string, unknown>, except?: string): Promise<{ username: string; password: string; email: string } | { status: number; error: string }> {
  const login = String(body.username ?? '').trim(), password = String(body.password ?? '');
  const byMail = login.includes('@');
  const email = (byMail ? login : String(body.email ?? '')).trim().toLowerCase();
  if (byMail ? !EMAIL_RE.test(email) : !/^[A-Za-z0-9._-]{3,32}$/.test(login)) return { status: 400, error: byMail ? 'Почта выглядит неверно.' : 'Логин: 3–32 символа — латиница, цифры, точка, дефис или подчёркивание. Или напиши почту.' };
  if (!byMail && isDemoName(login)) return { status: 400, error: 'Логины на «demo-» заняты под демо — выбери другой.' };
  const weak = passwordProblem(password); if (weak) return { status: 400, error: weak };
  if (body.password2 !== undefined && String(body.password2) !== password) return { status: 400, error: 'Пароли не совпадают.' };
  if (!email) return { status: 400, error: 'Укажи почту — по ней восстановим пароль, если забудешь.' };
  if (!EMAIL_RE.test(email) || email.length > 200) return { status: 400, error: 'Почта выглядит неверно.' };
  const notMe = except ? sql`${users.id} <> ${except}` : sql`true`;
  const [mailTaken] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${email}`, notMe)).limit(1);
  if (mailTaken) return { status: 409, error: 'На эту почту уже есть аккаунт — войди или восстанови пароль.' };
  if (byMail) return { username: await freeUsername(db, email.split('@')[0]!), password, email };
  const [taken] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.username}) = lower(${login})`, notMe)).limit(1);
  if (taken) return { status: 409, error: 'Такой логин уже занят.' };
  return { username: login, password, email };
}

/** свободный логин из почты или имени: латиница, цифры, . _ -; занят — с числом на конце */
export async function freeUsername(db: DB | Tx, base: string) {
  let b = base.toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+|[._-]+$/g, '').slice(0, 24);
  if (b.length < 3) b = 'user';
  b = b.replace(/^demo-/, 'demo'); // demo-… — только для демо
  for (let i = 0; i < 50; i++) {
    const name = i ? `${b}${i < 10 ? i : crypto.randomInt(10, 9999)}` : b;
    const [t] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${name}`).limit(1);
    if (!t) return name;
  }
  return `${b}${crypto.randomBytes(3).toString('hex')}`;
}

/** файлы человека вне базы: оригиналы конспектов и свои обложки книг */
export function removeUserFiles(userId: string) {
  if (!/^[0-9a-f-]{36}$/.test(userId)) return;
  const data = fileURLToPath(new URL('../../../../data/', import.meta.url));
  for (const dir of [process.env.STUDY_FILES_DIR || path.join(data, 'study-files'), path.join(process.env.COVERS_DIR || path.join(data, 'covers-next'), 'u')])
    fs.rmSync(path.join(dir, userId), { recursive: true, force: true });
}

export async function authRoutes(app: FastifyInstance, { db }: { db: DB }) {

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = String(body.username ?? '').trim().toLowerCase().slice(0, 64), password = String(body.password ?? '').slice(0, 512);
    const ip = clientIp(req), keys = [`ip:${ip}`, `ui:${username}|${ip}`, `u:${username}`];
    if (tooMany(...keys)) return reply.code(429).send({ error: 'Слишком много попыток. Подожди 15 минут.' });
    // войти можно по логину или по почте
    const [u] = await db.select().from(users).where(and(sql`(lower(${users.username}) = ${username} or lower(${users.email}) = ${username})`, sql`${users.deletedAt} is null`)).limit(1);
    // demo-… без пароля и под вход не годятся — отвечаем как на неверный пароль
    if (!(await verifyPassword(password, u?.passwordHash)) || !u || isDemoName(u.username) || u.demoUntil) { fail(...keys); return reply.code(401).send({ error: 'Неверный логин или пароль.' }); }
    keys.forEach(k => fails.delete(k));
    await startSession(db, req, reply, u.id);
    return { username: u.username };
  });

  // регистрация: логин (или почта вместо логина), пароль, почта обязательна; сразу 7 дней Pro и вход
  const regs = new Map<string, { n: number; until: number }>();
  sweepEvery(regs, (r, now) => r.until <= now);
  app.post('/api/auth/register', async (req, reply) => {
    const ip = clientIp(req), r = regs.get(ip);
    if (r && r.until > Date.now() && r.n >= 5) return reply.code(429).send({ error: 'Слишком много регистраций с этого адреса. Попробуй через час.' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const acc = await newAccount(db, body);
    if ('error' in acc) return reply.code(acc.status).send({ error: acc.error });
    const { username, password, email } = acc;
    const tz = Number(body.tz);
    const userId = await db.transaction(async tx => {
      const [u] = await tx.insert(users).values({ username, email: email || null, passwordHash: await hashPassword(password), tzOffset: Number.isInteger(tz) && Math.abs(tz) <= 840 ? tz : 0 }).returning({ id: users.id });
      await tx.insert(profiles).values({ userId: u!.id, settings: { kcal: 2000, protein: 0, steps: 8000, study: 60, onboarded: false } });
      await startTrial(tx, u!.id);
      return u!.id;
    });
    // считаем только созданные аккаунты: ошибки в форме не съедают лимит
    regs.set(ip, r && r.until > Date.now() ? { n: r.n + 1, until: r.until } : { n: 1, until: Date.now() + 3600e3 });
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
    const [u] = await db.select({ hash: users.passwordHash, demo: users.demoUntil }).from(users).where(eq(users.id, req.userId));
    // у демо пароля нет и логин временный — сначала «Сохранить как аккаунт»
    if (u?.demo) return reply.code(400).send({ error: 'Это демо — сначала сохрани его как аккаунт.' });
    // вошёл через Google или Apple и пароля ещё нет — задаёт первый, текущий не нужен
    if (u?.hash && !(await verifyPassword(current, u.hash))) { fail(`pw:${req.userId}`); return reply.code(400).send({ error: 'Текущий пароль неверный.' }); }
    const weak = passwordProblem(next); if (weak) return reply.code(400).send({ error: `Новый пароль: ${weak[0]!.toLowerCase()}${weak.slice(1)}` });
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
    removeUserFiles(req.userId!);
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
    const KEEP = ['users', 'sessions', 'profiles', 'entitlements', 'push_subscriptions', 'api_tokens', 'auth_identities', 'password_resets', 'ai_usage', 'feedback', 'integrations', 'activity_weeks', 'gcal_links'];
    await db.transaction(async tx => {
      const t = await tx.execute<{ name: string }>(sql`select table_name as name from information_schema.columns where column_name = 'user_id' and table_schema = current_schema() order by table_name`);
      for (const { name } of t.rows) if (!KEEP.includes(name)) await tx.execute(sql`delete from ${sql.identifier(name)} where user_id = ${req.userId!}`);
    });
    removeUserFiles(req.userId!);
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    // GET ничего не меняет (часовой пояс — PUT /api/me/tz): иначе чужой сайт мог бы менять его ссылкой
    const [u] = await db.select({ username: users.username, isAdmin: users.isAdmin, tzOffset: users.tzOffset, seen: users.lastSeenAt, demoUntil: users.demoUntil }).from(users).where(eq(users.id, req.userId));
    if (!u!.seen || Date.now() - u!.seen.getTime() > 10 * 60e3) await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, req.userId));
    // заход за местный день — для админки; повторный за тот же день ничего не меняет
    await db.insert(userVisits).values({ userId: req.userId, day: localNow(u!.tzOffset).day }).onConflictDoNothing();
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, req.userId));
    return { username: u!.username, tzOffset: u!.tzOffset, admin: isAdmin(u), demo: !!u!.demoUntil, demoUntil: u!.demoUntil?.toISOString() ?? null, modules: await modulesOf(db, req.userId), subscription: await subscription(db, req.userId), profile: p ?? null };
  });

  // часовой пояс с устройства (минуты к UTC): по нему считаются «сегодня», «сейчас» и напоминания
  app.put('/api/me/tz', async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    const tz = Number((req.body as { tz?: unknown } | undefined)?.tz);
    if (!Number.isInteger(tz) || Math.abs(tz) > 840) return reply.code(400).send({ error: 'Часовой пояс — целое число минут, до ±840.' });
    await db.update(users).set({ tzOffset: tz }).where(and(eq(users.id, req.userId), sql`${users.tzOffset} <> ${tz}`));
    return { tzOffset: tz };
  });
}

/** preHandler для маршрутов, которым нужен вход */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
}
