/**
 * Обратная связь и админка беты.
 * «Написать разработчику» — отзыв с контекстом (экран, версия, устройство); если задан Telegram-бот
 * (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID), отзыв сразу приходит и туда; если подключена почта и задан ADMIN_EMAIL — и на почту.
 * Админка (флаг users.is_admin или логины из ADMIN_USERS): пользователи и их активность, подписки и покупки, расход ИИ, регистрации, отзывы. Демо без регистрации в ней не считаются.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { customPrice, PRICES, type PriceId } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { requireUser } from './auth.js';
import { betaOn } from './billing.js';
import { bad, idParam, notFound } from './http.js';
import { mailEnabled, sendMail } from './mail.js';
import { feedback, users } from './schema.js';

/** админ — по флагу в базе (users.is_admin) или по логину из ADMIN_USERS */
export const isAdmin = (u?: { username?: string | null; isAdmin?: boolean | null } | null) => !!u && (!!u.isAdmin || isAdminName(u.username));
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
    // и на почту админа (ADMIN_EMAIL), если почта подключена
    if (process.env.ADMIN_EMAIL && mailEnabled()) void sendMail(process.env.ADMIN_EMAIL, `Lumi: отзыв от @${u?.username ?? '?'}`, `${text}\n\nЭкран: ${context.screen || '—'}\nУстройство: ${context.device}`).catch(e => req.log.warn({ err: (e as Error).message }, 'отзыв: письмо не ушло'));
    return reply.code(201).send({ ok: true });
  });

  const admin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) return reply.code(401).send({ error: 'Нужно войти.' });
    const [u] = await db.select({ username: users.username, isAdmin: users.isAdmin }).from(users).where(eq(users.id, req.userId));
    if (!isAdmin(u)) return reply.code(404).send({ error: 'Нет такого метода.' });
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
      where u.demo_until is null
      order by u.last_seen_at desc nulls last, u.created_at desc limit 500`)).rows;
    const since = sql`current_date - 13`;
    const signups = (await db.execute<{ day: string; n: number }>(sql`select created_at::date::text as day, count(*)::int as n from users where created_at::date >= ${since} and demo_until is null group by 1 order by 1`)).rows;
    const active = (await db.execute<{ day: string; n: number }>(sql`select day::text as day, count(distinct user_id)::int as n from events where day >= ${since} and day <= current_date and user_id in (select id from users where demo_until is null) group by 1 order by 1`)).rows;
    // заходили по дням: открыли приложение хоть раз за день (не только те, кто что-то записал)
    const visits = (await db.execute<{ day: string; n: number }>(sql`select v.day::text as day, count(*)::int as n from user_visits v join users u on u.id = v.user_id where v.day >= ${since} and u.demo_until is null group by 1 order by 1`)).rows;
    // демо без регистрации живут сутки (потом удаляются), поэтому это «открывали демо за последние сутки»
    const [demo] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from users where demo_until is not null`)).rows;
    // подписки и покупки (без демо): пробный период, купленный Pro и свои наборы; цены — по прейскуранту
    const paid = (await db.execute<{ source: string; plan: string | null; features: string[] | null; active: boolean; autoRenew: boolean; createdAt: string }>(sql`
      select e.source, e.plan, e.features, (e.expires_at is null or e.expires_at > now()) as active, e.auto_renew as "autoRenew", e.created_at as "createdAt"
      from entitlements e join users u on u.id = e.user_id
      where u.demo_until is null and e.module = 'pro' and e.source in ('web', 'apple', 'google')`)).rows;
    const [trial] = (await db.execute<{ active: number; ever: number }>(sql`
      select count(*) filter (where e.expires_at > now())::int as active, count(*)::int as ever
      from entitlements e join users u on u.id = e.user_id where u.demo_until is null and e.module = 'pro' and e.source = 'trial'`)).rows;
    const priceOf = (r: { plan: string | null; features: string[] | null }) => { const plan: PriceId = r.plan === 'year' ? 'year' : 'month'; return r.features?.length ? customPrice(r.features, plan).price : PRICES[plan].price; };
    const live = paid.filter(r => r.active), round = (n: number) => Math.round(n * 100) / 100;
    const purchases = (await db.execute<{ day: string; n: number }>(sql`
      select e.created_at::date::text as day, count(*)::int as n from entitlements e join users u on u.id = e.user_id
      where u.demo_until is null and e.module = 'pro' and e.source in ('web', 'apple', 'google') and e.created_at::date >= ${since} group by 1 order by 1`)).rows;
    const billing = {
      beta: betaOn(), trialActive: trial?.active ?? 0, trialEver: trial?.ever ?? 0,
      buyersEver: paid.length, active: live.length, month: live.filter(r => r.plan !== 'year').length, year: live.filter(r => r.plan === 'year').length,
      custom: live.filter(r => r.features?.length).length, cancelled: live.filter(r => !r.autoRenew).length, expired: paid.length - live.length,
      bySource: Object.fromEntries(['web', 'apple', 'google'].map(k => [k, live.filter(r => r.source === k).length])),
      // выручка в месяц: месячные — их цена, годовые — цена / 12; оценка, без возвратов и комиссий магазинов
      mrr: round(live.reduce((a, r) => a + (r.plan === 'year' ? priceOf(r) / 12 : priceOf(r)), 0)),
      boughtTotal: round(paid.reduce((a, r) => a + priceOf(r), 0))
    };
    // как входят: пароль, Google, Apple (у человека может быть несколько способов)
    const [logins] = (await db.execute<{ password: number; google: number; apple: number }>(sql`
      select count(*) filter (where u.password_hash is not null)::int as password,
        count(*) filter (where exists (select 1 from auth_identities a where a.user_id = u.id and a.provider = 'google'))::int as google,
        count(*) filter (where exists (select 1 from auth_identities a where a.user_id = u.id and a.provider = 'apple'))::int as apple
      from users u where u.demo_until is null`)).rows;
    // с каких устройств сидят: по открытым сессиям, человек считается один раз на тип устройства
    const agents = (await db.execute<{ userId: string; ua: string | null }>(sql`
      select distinct s.user_id as "userId", s.user_agent as ua from sessions s join users u on u.id = s.user_id where u.demo_until is null and s.expires_at > now()`)).rows;
    const kindOf = (ua: string | null) => !ua ? 'другое' : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'другое';
    const devices: Record<string, number> = {};
    for (const k of new Set(agents.map(a => `${a.userId}|${kindOf(a.ua)}`))) { const kind = k.split('|')[1]!; devices[kind] = (devices[kind] ?? 0) + 1; }
    const ai = (await db.execute<{ day: string; kind: string; n: number }>(sql`select day::text as day, kind, sum(count)::int as n from ai_usage where day >= ${since} group by 1, 2 order by 1`)).rows;
    const fb = await db.select({ id: feedback.id, text: feedback.text, context: feedback.context, done: feedback.done, createdAt: feedback.createdAt, username: users.username })
      .from(feedback).leftJoin(users, eq(users.id, feedback.userId)).orderBy(feedback.done, desc(feedback.createdAt)).limit(200);
    const dayAgo = Date.now() - 864e5, weekAgo = Date.now() - 7 * 864e5, monthAgo = Date.now() - 30 * 864e5, nowAgo = Date.now() - 15 * 60e3;
    const seenAfter = (t: number) => people.filter(p => p.lastSeenAt && Date.parse(p.lastSeenAt) > t).length;
    // какие разделы выбирают в анкете; возвращаются ли: из тех, кто с нами больше недели, сколько заходили за последние 7 дней
    const sections: Record<string, number> = {};
    for (const p of people) if (Array.isArray(p.sections)) for (const k of p.sections) sections[k] = (sections[k] ?? 0) + 1;
    const old = people.filter(p => Date.parse(p.createdAt) < weekAgo), back = old.filter(p => p.lastSeenAt && Date.parse(p.lastSeenAt) > weekAgo).length;
    return {
      totals: { users: people.length, online: seenAfter(nowAgo), active1: seenAfter(dayAgo), active7: seenAfter(weekAgo), active30: seenAfter(monthAgo), demo1: demo?.n ?? 0,
        onboarded: people.filter(p => p.onboarded).length, ai7: people.reduce((a, p) => a + (p.ai7 ?? 0), 0), feedbackNew: fb.filter(f => !f.done).length },
      retention: { cohort: old.length, back }, billing, purchases, logins, devices, sections,
      people, signups, active, visits, ai, feedback: fb
    };
  });
  app.post('/api/admin/feedback/:id/done', { preHandler: admin }, async (req, reply) => {
    const r = await db.update(feedback).set({ done: sql`not ${feedback.done}` }).where(eq(feedback.id, idParam((req.params as { id?: string }).id))).returning({ id: feedback.id, done: feedback.done });
    return r[0] ?? notFound(reply);
  });
}
