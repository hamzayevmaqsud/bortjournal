/**
 * Экран «Сегодня»: сводки модулей (каждый отдаёт свою через AppModule.today),
 * лента событий дня для полос и серия. Модули с закрытым доступом в ответ не попадают.
 */
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hasFeature, addDays, isDay, localNow } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { MODULES_LIST } from '../modules/index.js';
import { requireUser } from './auth.js';
import { subscription } from './billing.js';
import { dayEvents } from './events.js';
import { bad } from './http.js';
import { events, profiles, users } from './schema.js';

/** дни с записями: еда, учёба, тренировка или шаги — как в старом журнале */
export async function activeDays(db: DB, userId: string, today: string) {
  const since = addDays(today, -400);
  const rows = await db.execute<{ day: string }>(sql`
    select distinct day::text as day from ${events} where ${events.userId} = ${userId} and ${events.kind} in ('meal', 'session', 'workout') and ${events.day} >= ${since}
    union select day::text from body_days where user_id = ${userId} and steps > 0 and day >= ${since}`);
  return new Set(rows.rows.map(r => r.day));
}
async function streak(db: DB, userId: string, today: string) {
  const days = await activeDays(db, userId, today);
  let d = days.has(today) ? today : addDays(today, -1), n = 0;
  while (days.has(d) && n < 400) { n++; d = addDays(d, -1); }
  return n;
}

export async function todayRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/today', { preHandler: requireUser }, async req => {
    const userId = req.userId!;
    const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
    const now = localNow(u!.tz);
    const q = (req.query as { day?: string }).day;
    if (q !== undefined && !isDay(q)) throw bad('Нужна дата в формате ГГГГ-ММ-ДД.');
    const day = q ?? now.day;
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    const settings = (p?.settings ?? {}) as Record<string, any>;
    // бесплатное — всем, платные разделы — только с Pro (пробным или купленным)
    const sub = await subscription(db, userId);
    const allowed = new Set<string>(['food', 'body', 'plans', ...(['gym', 'study', 'budget', 'books'] as const).filter(k => hasFeature(sub, k))]);
    const ctx = { db, userId, day, now, settings, profile: p ?? null };
    const parts: Record<string, unknown> = {};
    await Promise.all(MODULES_LIST.filter(m => m.today && allowed.has(m.name)).map(async m => { parts[m.name] = await m.today!(ctx); }));
    const evs = (await dayEvents(db, userId, day)).filter(e => allowed.has(e.module));
    return {
      day, now, isToday: day === now.day,
      name: settings.name || null,
      plan: { kcal: Number(settings.kcal) || 2200, protein: Number(settings.protein) || 0 },
      streak: await streak(db, userId, now.day),
      modules: [...allowed],
      subscription: sub,
      parts,
      events: evs.map(e => ({ id: e.refId, module: e.module, kind: e.kind, time: e.time, title: e.title, value: e.value, unit: e.unit, data: e.data }))
    };
  });
}
