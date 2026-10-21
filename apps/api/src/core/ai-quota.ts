/**
 * Учёт обращений к ИИ: лимит на человека в его местный день по видам и общий дневной потолок на весь сервер,
 * чтобы расходы на Gemini не вышли из-под контроля. Перед первым обращением нужно согласие:
 * фото и тексты уходят в Google Gemini (это написано в политике конфиденциальности).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { localNow } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { requireUser } from './auth.js';
import { HttpError } from './http.js';
import { aiUsage, profiles, users } from './schema.js';

export const AI_KINDS = { food: 'распознаваний еды', questions: 'наборов вопросов', capture: 'голосовых записей', cheatsheet: 'шпаргалок' } as const;
export type AiKind = keyof typeof AI_KINDS;
const DEFAULTS: Record<AiKind, number> = { food: 15, questions: 5, capture: 60, cheatsheet: 5 };
export const limitOf = (k: AiKind) => { const v = Number(process.env[`AI_LIMIT_${k.toUpperCase()}`]); return Number.isFinite(v) && v > 0 ? v : DEFAULTS[k]; };
const serverCap = () => { const v = Number(process.env.AI_DAILY_CAP); return Number.isFinite(v) && v > 0 ? v : 2000; };

/** нужно согласие на ИИ — клиент покажет экран согласия */
export class ConsentError extends HttpError { constructor() { super(428, 'Сначала разреши ИИ-помощника: фото и тексты для разбора уходят в Google Gemini.'); } }

async function dayOf(db: Tx, userId: string) { const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId)); return localNow(u?.tz ?? 0).day; }

/** взять одно обращение к ИИ: проверить согласие, лимит человека и общий потолок; иначе — понятная ошибка */
export async function takeAi(db: Tx, userId: string, kind: AiKind) {
  const [p] = await db.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, userId));
  if (!(p?.s as Record<string, unknown> | undefined)?.aiConsent) throw new ConsentError();
  const day = await dayOf(db, userId);
  const [all] = await db.select({ n: sql<number>`coalesce(sum(${aiUsage.count}), 0)::int` }).from(aiUsage).where(eq(aiUsage.day, day));
  if ((all?.n ?? 0) >= serverCap()) throw new HttpError(429, 'ИИ на сегодня перегружен — попробуй завтра или запиши вручную.');
  const [row] = await db.insert(aiUsage).values({ userId, day, kind, count: 1 })
    .onConflictDoUpdate({ target: [aiUsage.userId, aiUsage.day, aiUsage.kind], set: { count: sql`${aiUsage.count} + 1` } }).returning({ n: aiUsage.count });
  if (row!.n > limitOf(kind)) {
    await db.update(aiUsage).set({ count: sql`${aiUsage.count} - 1` }).where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, day), eq(aiUsage.kind, kind)));
    throw new HttpError(429, `На сегодня лимит ${AI_KINDS[kind]} исчерпан (${limitOf(kind)} в день). Завтра — снова.`);
  }
  return { left: limitOf(kind) - row!.n };
}

export async function aiQuotaRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/ai/quota', { preHandler: requireUser }, async req => {
    const day = await dayOf(db, req.userId!);
    const rows = await db.select().from(aiUsage).where(and(eq(aiUsage.userId, req.userId!), eq(aiUsage.day, day)));
    const [p] = await db.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, req.userId!));
    return { consent: !!(p?.s as Record<string, unknown> | undefined)?.aiConsent, kinds: Object.fromEntries((Object.keys(AI_KINDS) as AiKind[]).map(k => { const used = rows.find(r => r.kind === k)?.count ?? 0; return [k, { used, limit: limitOf(k), left: Math.max(0, limitOf(k) - used) }]; })) };
  });
}
