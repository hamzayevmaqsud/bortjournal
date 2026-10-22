/**
 * Обратная связь и админка беты.
 * «Написать разработчику» — отзыв с контекстом (экран, версия, устройство); если задан Telegram-бот
 * (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID), отзыв сразу приходит и туда.
 * Админка (логины из ADMIN_USERS через запятую): пользователи и их активность, расход ИИ, регистрации, отзывы.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import { requireUser } from './auth.js';
import { bad, idParam, notFound } from './http.js';
import { feedback, users } from './schema.js';

export const isAdminName = (username: string | undefined | null) => !!username && (process.env.ADMIN_USERS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(username.toLowerCase());
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

async function telegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }) }).catch(() => {});
}

export async function adminRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const sent = new Map<string, number[]>();
  app.post('/api/feedback', { preHandler: requireUser }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>, text = String(b.text ?? '').trim().slice(0, 4000);
    if (text.length < 3) throw bad('Напиши пару слов — что понравилось или что мешает.');
    // не больше 10 отзывов в час от одного человека
    const now = Date.now(), recent = (sent.get(req.userId!) ?? []).filter(t => now - t < 3600e3);
    if (recent.length >= 10) return reply.code(429).send({ error: 'Слишком много сообщений подряд — попробуй через час.' });
    sent.set(req.userId!, [...recent, now]);
    const context = { screen: clip(b.screen, 60), version: clip(b.version, 40), device: clip(req.headers['user-agent'], 200), theme: clip(b.theme, 20), size: clip(b.size, 20) };
    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, req.userId!));
    await db.insert(feedback).values({ userId: req.userId!, text, context });
    void telegram(`Lumi — отзыв от @${u?.username ?? '?'} (${context.screen || 'экран ?'})\n\n${text}\n\n${context.device}`);
    return reply.code(201).send({ ok: true });
  });

  const admin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, req.userId));
    if (!isAdminName(u?.username)) return reply.code(404).send({ error: 'Нет такого метода.' });
  };
  app.get('/api/admin/overview', { preHandler: admin }, async () => {
    const people = (await db.execute<Record<string, any>>(sql`
      select u.id, u.username, u.email, u.created_at as "createdAt", u.last_seen_at as "lastSeenAt",
        (p.settings ->> 'onboarded') = 'true' as onboarded, p.settings -> 'sections' as sections,
        (select count(*)::int from food_meals m where m.user_id = u.id) as meals,
        (select count(*)::int from food_drinks d where d.user_id = u.id) as drinks,
        (select count(*)::int from plan_tasks t where t.user_id = u.id) as tasks,
        (select count(*)::int from gym_workouts w where w.user_id = u.id) as workouts,
        (select count(*)::int from study_materials s where s.user_id = u.id) as materials,
        (select count(*)::int from budget_entries b where b.user_id = u.id) as spends,
        (select coalesce(sum(a.count), 0)::int from ai_usage a where a.user_id = u.id and a.day >= current_date - 6) as ai7,
        (select count(distinct e.day)::int from events e where e.user_id = u.id and e.day between current_date - 6 and current_date) as days7
      from users u left join profiles p on p.user_id = u.id
      order by u.last_seen_at desc nulls last, u.created_at desc limit 500`)).rows;
    const since = sql`current_date - 13`;
    const signups = (await db.execute<{ day: string; n: number }>(sql`select created_at::date::text as day, count(*)::int as n from users where created_at::date >= ${since} group by 1 order by 1`)).rows;
    const active = (await db.execute<{ day: string; n: number }>(sql`select day::text as day, count(distinct user_id)::int as n from events where day >= ${since} and day <= current_date group by 1 order by 1`)).rows;
    const ai = (await db.execute<{ day: string; kind: string; n: number }>(sql`select day::text as day, kind, sum(count)::int as n from ai_usage where day >= ${since} group by 1, 2 order by 1`)).rows;
    const fb = await db.select({ id: feedback.id, text: feedback.text, context: feedback.context, done: feedback.done, createdAt: feedback.createdAt, username: users.username })
      .from(feedback).leftJoin(users, eq(users.id, feedback.userId)).orderBy(feedback.done, desc(feedback.createdAt)).limit(200);
    const dayAgo = Date.now() - 864e5, weekAgo = Date.now() - 7 * 864e5;
    return {
      totals: { users: people.length, active1: people.filter(p => p.lastSeenAt && Date.parse(p.lastSeenAt) > dayAgo).length, active7: people.filter(p => p.lastSeenAt && Date.parse(p.lastSeenAt) > weekAgo).length,
        onboarded: people.filter(p => p.onboarded).length, ai7: people.reduce((a, p) => a + (p.ai7 ?? 0), 0), feedbackNew: fb.filter(f => !f.done).length },
      people, signups, active, ai, feedback: fb
    };
  });
  app.post('/api/admin/feedback/:id/done', { preHandler: admin }, async (req, reply) => {
    const r = await db.update(feedback).set({ done: sql`not ${feedback.done}` }).where(eq(feedback.id, idParam((req.params as { id?: string }).id))).returning({ id: feedback.id, done: feedback.done });
    return r[0] ?? notFound(reply);
  });
}
