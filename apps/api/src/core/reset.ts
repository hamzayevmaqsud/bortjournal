/**
 * Восстановление пароля. «Забыли пароль?» — по логину или почте; письмо со ссылкой уходит через Gmail или Resend
 * (см. mail.ts), если почта у аккаунта есть. Ответ всегда одинаковый — по нему не узнать,
 * есть ли такой аккаунт. Пока почта не подключена, админ делает ссылку в админке и пересылает человеку сам.
 * Ссылка живёт 30 минут и срабатывает один раз; после сброса все устройства выходят.
 */
import crypto from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import { isAdmin } from './admin.js';
import { hashPassword, startSession } from './auth.js';
import { clientIp, sweepEvery } from './client-ip.js';
import { bad, idParam, notFound } from './http.js';
import { mailEnabled, sendMail } from './mail.js';
import { passwordResets, sessions, users } from './schema.js';
import { publicBase } from './tokens.js';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const TTL = 30 * 60e3;

async function makeLink(db: DB, req: FastifyRequest, userId: string) {
  const raw = crypto.randomBytes(24).toString('base64url');
  await db.insert(passwordResets).values({ tokenHash: sha(raw), userId, expiresAt: new Date(Date.now() + TTL) });
  return `${publicBase(req)}/#reset=${raw}`;
}
async function sendResetMail(to: string, link: string) {
  await sendMail(to, 'Lumi: новый пароль', `Кто-то (надеемся, ты) попросил сменить пароль в Lumi.\n\nОткрой ссылку, чтобы задать новый пароль — она работает 30 минут:\n${link}\n\nЕсли это был не ты — просто ничего не делай, пароль останется прежним.`);
}

export async function resetRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const hits = new Map<string, number[]>();
  const limited = (k: string) => { const now = Date.now(), list = (hits.get(k) ?? []).filter(t => now - t < 3600e3); hits.set(k, [...list, now]); return list.length >= 5; };
  sweepEvery(hits, (list, now) => !list.some(t => now - t < 3600e3));

  app.post('/api/auth/forgot', async (req, reply) => {
    const login = String((req.body as { login?: unknown } | undefined)?.login ?? '').trim().toLowerCase().slice(0, 200);
    if (login.length < 3) throw bad('Напиши логин или почту.');
    if (limited(`ip:${clientIp(req)}`) || limited(`l:${login}`)) return reply.code(429).send({ error: 'Слишком много попыток. Попробуй через час.' });
    const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(sql`lower(${users.username}) = ${login} or lower(${users.email}) = ${login}`).limit(1);
    if (u?.email && mailEnabled()) {
      try { await sendResetMail(u.email, await makeLink(db, req, u.id)); } catch (e) { req.log.warn({ err: (e as Error).message }, 'сброс пароля: письмо не ушло'); }
    }
    return { ok: true, mail: mailEnabled(), message: mailEnabled() ? 'Если у аккаунта указана почта, мы отправили на неё ссылку. Проверь «Входящие» и «Спам».' : 'Письма пока не отправляются. Напиши в бета-группу или разработчику — он пришлёт ссылку для нового пароля.' };
  });

  app.post('/api/auth/reset', async (req, reply: FastifyReply) => {
    const b = (req.body ?? {}) as { token?: unknown; password?: unknown }, raw = String(b.token ?? ''), password = String(b.password ?? '');
    if (password.length < 8 || password.length > 512) return reply.code(400).send({ error: 'Пароль — не короче 8 символов.' });
    const [r] = await db.select().from(passwordResets).where(and(eq(passwordResets.tokenHash, sha(raw)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, sql`now()`)));
    if (!r) return reply.code(400).send({ error: 'Ссылка устарела или уже использована. Попроси новую.' });
    await db.transaction(async tx => {
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.tokenHash, r.tokenHash));
      await tx.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, r.userId));
      await tx.delete(sessions).where(eq(sessions.userId, r.userId));
    });
    await startSession(db, req, reply, r.userId);
    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, r.userId));
    return { ok: true, username: u?.username };
  });

  // админ: ссылка для сброса — переслать человеку в мессенджере, пока почта не подключена
  app.post('/api/admin/users/:id/reset-link', async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    const [me] = await db.select({ username: users.username, isAdmin: users.isAdmin }).from(users).where(eq(users.id, req.userId));
    if (!isAdmin(me)) return reply.code(404).send({ error: 'Нет такого метода.' });
    const id = idParam((req.params as { id?: string }).id);
    const [u] = await db.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, id));
    if (!u) return notFound(reply);
    return { link: await makeLink(db, req, u.id), username: u.username, minutes: TTL / 60e3 };
  });
}
