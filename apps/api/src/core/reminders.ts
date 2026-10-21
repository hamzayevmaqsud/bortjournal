/**
 * Напоминания (бесплатно всем). Устройства подписываются на Web Push; раз в минуту сервер спрашивает у модулей
 * их подсказки (AppModule.remind) и добавляет свои: серия под угрозой и итог недели. Каждый ключ уходит не чаще
 * раза в день (вода — не чаще раза в every минут), журнал отправленного — reminder_log.
 * Если есть что-то ко времени, вода подождёт — не засыпаем уведомлениями.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, hasFeature, localNow, weekday } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { MODULES_LIST } from '../modules/index.js';
import { requireUser } from './auth.js';
import { subscription } from './billing.js';
import { bad, uid } from './http.js';
import type { Nudge } from './module.js';
import { endpointOk, sendPush, vapid, type PushMessage } from './push.js';
import { profiles, pushSubscriptions, reminderLog, users } from './schema.js';
import { activeDays } from './today.js';

/** виды напоминаний — их можно выключить по отдельности */
export const REMIND_KINDS = ['water', 'food', 'tasks', 'gym', 'quiz', 'streak', 'review'] as const;
export type RemindSettings = { off?: boolean; lead?: number } & Partial<Record<(typeof REMIND_KINDS)[number], boolean>>;
const WINDOW = 30;
const plural = (n: number, a: string, b: string, c: string) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c; };

/** что пора отправить пользователю прямо сейчас (без учёта уже отправленного) */
export async function dueNudges(db: DB, userId: string, at = Date.now()): Promise<{ today: string; list: Nudge[] }> {
  const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
  const now = localNow(u?.tz ?? 0, at), min = now.minutes;
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  const settings = (p?.settings ?? {}) as Record<string, any>, R: RemindSettings = settings.remind ?? {};
  if (R.off) return { today: now.day, list: [] };
  const sub = await subscription(db, userId);
  const allowed = new Set<string>(['food', 'body', 'plans', ...(['gym', 'study', 'budget', 'books'] as const).filter(k => hasFeature(sub, k))]);
  const ctx = { db, userId, day: now.day, now, settings, profile: p ?? null, min };
  const list = (await Promise.all(MODULES_LIST.filter(m => m.remind && allowed.has(m.name)).map(m => m.remind!(ctx)))).flat();
  const days = await activeDays(db, userId, now.day);
  // серия: вечером, если сегодня ещё пусто, а подряд перед этим — хотя бы 2 дня
  let d = addDays(now.day, -1), n = 0; while (days.has(d) && n < 400) { n++; d = addDays(d, -1); }
  if (n >= 2 && !days.has(now.day)) list.push({ key: 'streak', kind: 'streak', title: `Серия ${n} ${plural(n, 'день', 'дня', 'дней')} под угрозой`, body: 'Запиши что-нибудь до полуночи — приём пищи, шаги или занятие.', url: '/#today', at: 21 * 60 });
  // итог недели: воскресенье, 19:00, если за неделю что-то было
  if (weekday(now.day) === 0 && [0, 1, 2, 3, 4, 5, 6].some(k => days.has(addDays(now.day, -k)))) list.push({ key: 'review', kind: 'review', title: 'Итог недели готов', body: 'Что получилось, что нет и лучший день — загляни на минуту.', url: '/#stats', at: 19 * 60 });
  return { today: now.day, list: list.filter(x => R[x.kind as keyof RemindSettings] !== false && (x.at === undefined || (min >= x.at && min < x.at + WINDOW))) };
}

async function pushTo(db: DB, userId: string, msg: PushMessage) {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  let sent = 0;
  for (const s of subs) {
    try {
      const r = await sendPush(s, msg);
      if (r.ok) sent++;
      if (r.gone) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    } catch { /* устройство недоступно — попробуем в следующий раз */ }
  }
  return sent;
}

/** один проход: всем, у кого есть устройства, отправить то, что пора и ещё не отправлено */
export async function remindTick(db: DB, at = Date.now()) {
  const owners = await db.selectDistinct({ userId: pushSubscriptions.userId }).from(pushSubscriptions);
  let total = 0;
  for (const { userId } of owners) {
    const { today, list } = await dueNudges(db, userId, at);
    if (!list.length) continue;
    const log = new Map((await db.select().from(reminderLog).where(and(eq(reminderLog.userId, userId), eq(reminderLog.day, today), inArray(reminderLog.key, list.map(x => x.key))))).map(r => [r.key, r.sentAt.getTime()]));
    let fresh = list.filter(x => x.every ? !log.has(x.key) || at - log.get(x.key)! > x.every * 60e3 : !log.has(x.key));
    if (fresh.some(x => !x.every)) fresh = fresh.filter(x => !x.every);
    for (const x of fresh) {
      if (!(await pushTo(db, userId, { title: x.title, body: x.body, url: x.url, tag: x.key }))) continue;
      total++;
      await db.insert(reminderLog).values({ userId, key: x.key, day: today, sentAt: new Date(at) }).onConflictDoUpdate({ target: [reminderLog.userId, reminderLog.key, reminderLog.day], set: { sentAt: new Date(at) } });
    }
  }
  return total;
}

export function startReminders(db: DB, log: (m: string) => void) {
  const t = setInterval(() => { remindTick(db).catch(e => log(`напоминания: ${(e as Error).message}`)); }, 60e3);
  t.unref();
  return () => clearInterval(t);
}

export async function reminderRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const settingsOf = async (userId: string) => { const [p] = await db.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, userId)); return ((p?.s ?? {}) as Record<string, any>); };
  const view = async (userId: string) => {
    const R: RemindSettings = (await settingsOf(userId)).remind ?? {};
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    return { key: vapid().publicKey, devices: c?.n ?? 0, off: !!R.off, lead: Number.isFinite(Number(R.lead)) && R.lead !== undefined ? Number(R.lead) : 15, kinds: Object.fromEntries(REMIND_KINDS.map(k => [k, R[k] !== false])) };
  };
  app.get('/api/push', { preHandler: requireUser }, async req => view(uid(req)));
  app.post('/api/push/subscribe', { preHandler: requireUser }, async req => {
    const b = (req.body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = String(b.endpoint ?? ''), p256dh = b.keys?.p256dh, auth = b.keys?.auth;
    if (!endpointOk(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string' || endpoint.length > 1000) throw bad('Этот браузер не поддерживает напоминания.');
    await db.insert(pushSubscriptions).values({ userId: uid(req), endpoint, p256dh, auth }).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: uid(req), p256dh, auth } });
    return view(uid(req));
  });
  app.post('/api/push/unsubscribe', { preHandler: requireUser }, async req => {
    const endpoint = String((req.body as { endpoint?: unknown } | undefined)?.endpoint ?? '');
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, uid(req)), eq(pushSubscriptions.endpoint, endpoint)));
    return view(uid(req));
  });
  app.put('/api/push/settings', { preHandler: requireUser }, async req => {
    const b = (req.body ?? {}) as Record<string, unknown>, s = await settingsOf(uid(req)), R: RemindSettings = { ...(s.remind ?? {}) };
    if (typeof b.off === 'boolean') R.off = b.off;
    if (b.lead !== undefined) { const l = Math.round(Number(b.lead)); if (!(l >= 0 && l <= 120)) throw bad('За сколько минут напоминать: от 0 до 120.'); R.lead = l; }
    for (const k of REMIND_KINDS) if (typeof (b.kinds as any)?.[k] === 'boolean') R[k] = (b.kinds as any)[k];
    await db.update(profiles).set({ settings: { ...s, remind: R } }).where(eq(profiles.userId, uid(req)));
    return view(uid(req));
  });
  app.post('/api/push/test', { preHandler: requireUser }, async (req, reply) => {
    const n = await pushTo(db, uid(req), { title: 'Напоминания работают', body: 'Так будут выглядеть подсказки Бортжурнала.', url: '/#today', tag: 'test' });
    if (!n) return reply.code(400).send({ error: 'Не получилось отправить: на этом аккаунте нет рабочих устройств.' });
    return { sent: n };
  });
}
