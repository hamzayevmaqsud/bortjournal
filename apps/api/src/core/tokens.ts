/**
 * Личные ключи для внешних клиентов: «Команды» iPhone (запись голосом, kind = capture) и подписка календаря (calendar).
 * Ключ показывается один раз; в базе — sha256. Новый ключ того же вида заменяет старый (старый перестаёт работать).
 */
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DB, Tx } from '../db/index.js';
import { isHttps, requireUser } from './auth.js';
import { bad } from './http.js';
import { apiTokens } from './schema.js';

export const TOKEN_KINDS = ['capture', 'calendar', 'obsidian'] as const;
const PREFIX: Record<TokenKind, string> = { capture: 'c', calendar: 'l', obsidian: 'o' };
export type TokenKind = (typeof TOKEN_KINDS)[number];
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** чей это ключ (и отметить, что им пользовались) */
export async function userByToken(db: Tx, raw: string | undefined, kind: TokenKind) {
  if (!raw || !/^bj[a-z]_[A-Za-z0-9_-]{20,}$/.test(raw)) return null;
  const [t] = await db.select().from(apiTokens).where(and(eq(apiTokens.tokenHash, sha(raw)), eq(apiTokens.kind, kind)));
  if (!t) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, t.id));
  return t.userId;
}
/** вход по ключу из заголовка Authorization: Bearer … — если нет cookie-сессии */
export const bearerOf = (req: FastifyRequest) => /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
export const publicBase = (req: FastifyRequest) => (process.env.PUBLIC_URL ?? '').replace(/\/$/, '') || `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;

export async function tokenRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const kindOf = (v: unknown): TokenKind => { if (!(TOKEN_KINDS as readonly unknown[]).includes(v)) throw bad('Неверный вид ключа.'); return v as TokenKind; };
  app.get('/api/tokens', { preHandler: requireUser }, async req => {
    const rows = await db.select().from(apiTokens).where(eq(apiTokens.userId, req.userId!));
    return Object.fromEntries(TOKEN_KINDS.map(k => { const r = rows.find(x => x.kind === k); return [k, r ? { createdAt: r.createdAt, lastUsedAt: r.lastUsedAt } : null]; }));
  });
  app.post('/api/tokens/:kind', { preHandler: requireUser }, async req => {
    const kind = kindOf((req.params as { kind?: string }).kind), raw = `bj${PREFIX[kind]}_${crypto.randomBytes(24).toString("base64url")}`;
    await db.delete(apiTokens).where(and(eq(apiTokens.userId, req.userId!), eq(apiTokens.kind, kind)));
    await db.insert(apiTokens).values({ userId: req.userId!, kind, tokenHash: sha(raw) });
    const base = publicBase(req);
    return kind === 'calendar'
      ? { token: raw, url: `${base}/api/plans/calendar/${raw}.ics`, webcal: `${base.replace(/^https?:/, 'webcal:')}/api/plans/calendar/${raw}.ics` }
      : kind === 'obsidian' ? { token: raw, url: base }
      : { token: raw, url: `${base}/api/plans/capture` };
  });
  app.delete('/api/tokens/:kind', { preHandler: requireUser }, async req => {
    await db.delete(apiTokens).where(and(eq(apiTokens.userId, req.userId!), eq(apiTokens.kind, kindOf((req.params as { kind?: string }).kind))));
    return { ok: true };
  });
}
