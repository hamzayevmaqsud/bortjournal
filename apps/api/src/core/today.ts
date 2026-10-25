/**
 * Экран «Сегодня»: сводки модулей (каждый отдаёт свою через AppModule.today),
 * лента событий дня для полос и серия. Модули с закрытым доступом в ответ не попадают.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hasFeature, addDays, isDay, localNow } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { MODULES_LIST } from '../modules/index.js';
import { requireUser } from './auth.js';
import { subscription } from './billing.js';
import { dayEvents } from './events.js';
import { bad } from './http.js';
import { journalRoutes } from './journal.js';
import { gcalEvents, integrations, profiles, users } from './schema.js';
import { activeSet, FREEZE_MAX, STREAK_WINDOW, streakOf } from './streak.js';

/** дни с записями за окно серии — то же определение, что у серии (core/streak.ts) */
export const activeDays = (db: DB, userId: string, today: string) => activeSet(db, userId, addDays(today, -STREAK_WINDOW), today);

export async function todayRoutes(app: FastifyInstance, { db }: { db: DB }) {
  // «Как прошёл день?» — часть экрана «Сегодня»; маршруты регистрируются здесь же
  await journalRoutes(app, { db });
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
    const allowed = new Set<string>(['food', 'body', 'plans', 'habits', ...(['gym', 'study', 'budget', 'books'] as const).filter(k => hasFeature(sub, k))]);
    const ctx = { db, userId, day, now, settings, profile: p ?? null };
    const parts: Record<string, unknown> = {};
    await Promise.all(MODULES_LIST.filter(m => m.today && allowed.has(m.name)).map(async m => { parts[m.name] = await m.today!(ctx); }));
    const evs = (await dayEvents(db, userId, day)).filter(e => allowed.has(e.module));
    // события Google Календаря (если подключён): сначала на весь день, потом по времени
    const cal = await db.select({ id: gcalEvents.eventId, title: gcalEvents.title, time: gcalEvents.time, minutes: gcalEvents.minutes }).from(gcalEvents)
      .where(and(eq(gcalEvents.userId, userId), eq(gcalEvents.day, day), sql`exists (select 1 from ${integrations} i where i.user_id = ${userId} and i.provider = 'google-calendar')`)).orderBy(sql`${gcalEvents.time} asc nulls first`, asc(gcalEvents.title));
    const st = await streakOf(db, userId, now.day);
    return {
      day, now, isToday: day === now.day,
      name: settings.name || null,
      plan: { kcal: Number(settings.kcal) || 2200, protein: Number(settings.protein) || 0 },
      streak: st.now,
      // заморозки серии: сколько в запасе, спасла ли вчерашний день, замороженные дни за последние 2 недели
      freeze: { left: st.freezes, max: FREEZE_MAX, usedYesterday: st.usedYesterday, frozen: st.frozen.filter(d => d >= addDays(now.day, -14)) },
      modules: [...allowed],
      subscription: sub,
      parts,
      calendar: cal,
      events: evs.map(e => ({ id: e.refId, module: e.module, kind: e.kind, time: e.time, title: e.title, value: e.value, unit: e.unit, data: e.data }))
    };
  });
}
