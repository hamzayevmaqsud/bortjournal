import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, localNow } from '@bortjournal/core';
import { bad, dayParam, guard, idParam, notFound, uid } from '../../core/http.js';
import { users } from '../../core/schema.js';
import type { DB, Tx } from '../../db/index.js';
import { habits } from './schema.js';
import { addHabit, colorOf, habitHistory, habitOn, habitsOn, HABITS_LIMIT, iconOf, ownHabit, reorder, setCheck, titleOf } from './service.js';

/** «сегодня» у человека — по его часовому поясу */
const localToday = async (db: Tx, userId: string) => { const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId)); return localNow(u?.tz ?? 0).day; };

export async function habitsRoutes(app: FastifyInstance, { db }: { db: DB }) {
  // привычки бесплатны всем: достаточно войти
  const preHandler = guard(db, 'base');

  // список на день (по умолчанию — сегодня): отметка, серия, последние 7 дней
  app.get('/', { preHandler }, async req => {
    const q = req.query as { day?: string }, today = await localToday(db, uid(req));
    const day = q.day === undefined ? today : dayParam(q.day);
    return { day, today, limit: HABITS_LIMIT, items: await habitsOn(db, uid(req), day) };
  });

  // для статистики: привычки и отметки за период (до 400 дней)
  app.get('/history', { preHandler }, async req => {
    const q = req.query as { from?: string; to?: string }, to = dayParam(q.to ?? await localToday(db, uid(req))), from = dayParam(q.from ?? addDays(to, -29));
    if (from > to) throw bad('Начало периода позже конца.');
    if (from < addDays(to, -399)) throw bad('Период — не больше 400 дней.');
    return { from, to, ...await habitHistory(db, uid(req), from, to) };
  });

  app.post('/', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>, userId = uid(req);
    const h = await addHabit(db, userId, { title: titleOf(b.title), icon: iconOf(b.icon), color: colorOf(b.color) });
    return reply.code(201).send(await habitOn(db, userId, h, await localToday(db, userId)));
  });

  // порядок списка: ids сверху вниз
  app.put('/order', { preHandler }, async req => {
    const ids = (req.body as { ids?: unknown } | undefined)?.ids;
    if (!Array.isArray(ids) || ids.length > 100) throw bad('Нужен список привычек.');
    await reorder(db, uid(req), ids.map(idParam));
    return { ok: true };
  });

  // переименовать, сменить значок или цвет
  app.put('/:id', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>, userId = uid(req), id = idParam((req.params as { id: string }).id);
    const cur = await ownHabit(db, userId, id);
    if (!cur || cur.archivedAt) return notFound(reply);
    const set: { title?: string; icon?: string | null; color?: string | null } = {};
    if ('title' in b) set.title = titleOf(b.title);
    if ('icon' in b) set.icon = iconOf(b.icon);
    if ('color' in b) set.color = colorOf(b.color);
    let h = cur;
    if (Object.keys(set).length) [h] = await db.update(habits).set(set).where(and(eq(habits.userId, userId), eq(habits.id, id))).returning() as [typeof cur];
    return habitOn(db, userId, h, await localToday(db, userId));
  });

  // в архив: из списка и лимита уходит, отметки остаются в истории
  app.post('/:id/archive', { preHandler }, async (req, reply) => {
    const userId = uid(req), id = idParam((req.params as { id: string }).id);
    const cur = await ownHabit(db, userId, id);
    if (!cur) return notFound(reply);
    if (!cur.archivedAt) await db.update(habits).set({ archivedAt: new Date() }).where(and(eq(habits.userId, userId), eq(habits.id, id)));
    return { ok: true };
  });

  // отметка за день: done задаёт состояние, а не переключает — повтор из очереди телефона ничего не сломает
  app.put('/:id/check', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as { day?: unknown; done?: unknown }, userId = uid(req), id = idParam((req.params as { id: string }).id);
    if (typeof b.done !== 'boolean') throw bad('Нужно done: true или false.');
    const today = await localToday(db, userId), day = b.day === undefined || b.day === null ? today : dayParam(b.day);
    if (day > today) throw bad('Отметить можно только прошедший или сегодняшний день.');
    const h = await ownHabit(db, userId, id);
    if (!h || h.archivedAt) return notFound(reply);
    // давнее прошлое не отмечаем: не раньше чем за неделю до появления привычки (последние 7 дней можно дописать) и не старше года
    const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
    const born = localNow(u?.tz ?? 0, h.createdAt.getTime()).day;
    if (day < addDays(born, -7) || day < addDays(today, -365)) throw bad('Так давно отметить нельзя: привычки тогда ещё не было.');
    await setCheck(db, userId, id, day, b.done);
    const v = await habitOn(db, userId, h, day);
    return { id, day, done: v.done, streak: v.streak, last7: v.last7 };
  });
}
