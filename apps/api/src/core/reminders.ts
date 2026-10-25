/**
 * Напоминания (бесплатно всем). Устройства подписываются на Web Push; раз в минуту сервер спрашивает у модулей
 * их подсказки (AppModule.remind) и добавляет свои: серия под угрозой, совет на вечер и итог недели. Каждый ключ уходит не чаще
 * раза в день (вода — не чаще раза в every минут), журнал отправленного — reminder_log.
 * Если есть что-то ко времени, вода подождёт — не засыпаем уведомлениями.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, hasFeature, localNow, nWord, weekday } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { MODULES_LIST } from '../modules/index.js';
import { requireUser } from './auth.js';
import { subscription } from './billing.js';
import { bad, uid } from './http.js';
import type { Nudge } from './module.js';
import { dayTips, weekRecap } from './insights.js';
import { endpointOk, pushToUser, vapid } from './push.js';
import { profiles, pushSubscriptions, reminderLog, users } from './schema.js';
import { activeSet, streakOf } from './streak.js';

/** виды напоминаний — их можно выключить по отдельности */
export const REMIND_KINDS = ['water', 'food', 'tasks', 'gym', 'quiz', 'streak', 'tip', 'review'] as const;
export type RemindSettings = { off?: boolean; lead?: number } & Partial<Record<(typeof REMIND_KINDS)[number], boolean>>;
const WINDOW = 30, TIP_AT = 20 * 60 + 40, REVIEW_AT = 19 * 60, STREAK_AT = 21 * 60;
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
  // серия (общая, с заморозками): вечером, если сегодня ещё пусто, а подряд перед этим — хотя бы 2 дня. Считаем только в своё окно
  if (min >= STREAK_AT && min < STREAK_AT + WINDOW) {
    const st = await streakOf(db, userId, now.day), n = st.upToYesterday;
    if (n >= 2 && st.now === n) list.push({ key: 'streak', kind: 'streak', title: `Серия ${n} ${plural(n, 'день', 'дня', 'дней')} под угрозой`, body: 'Запиши что-нибудь до полуночи — приём пищи, шаги или занятие.', url: '/#today', at: STREAK_AT });
  }
  // пробный Pro кончается: за 2 дня и накануне, в 19:00
  if (sub.source === 'trial' && (sub.daysLeft === 2 || sub.daysLeft === 1)) list.push({ key: `trial:${sub.daysLeft}`, kind: 'trial', title: sub.daysLeft === 1 ? 'Завтра заканчивается пробный Pro' : 'Пробный Pro — ещё 2 дня', body: 'Еда, вода, шаги, задачи, цель и статистика останутся бесплатными. Остальное — по подписке или своим набором.', url: '/#more', at: 19 * 60 });
  // совет и итог считать дорого — только в своё окно и пока не отправлены сегодня
  const fresh = async (key: string, from: number) => min >= from && min < from + WINDOW && !(await db.select({ k: reminderLog.key }).from(reminderLog).where(and(eq(reminderLog.userId, userId), eq(reminderLog.key, key), eq(reminderLog.day, now.day)))).length;
  // совет на вечер: 20:40, если есть что сказать (текст — тот, что уже показан в журнале, новых обращений к ИИ нет)
  if (R.tip !== false && await fresh('tip', TIP_AT)) {
    const { tip } = await dayTips(db, userId, { at });
    if (tip) list.push({ key: 'tip', kind: 'tip', title: tip.tone === 'good' ? 'Хороший день' : 'Совет на вечер', body: tip.text, url: '/#today', at: TIP_AT });
  }
  // итог недели: воскресенье, 19:00, если за неделю что-то было
  if (R.review !== false && weekday(now.day) === 0 && await fresh('review', REVIEW_AT) && (await activeSet(db, userId, addDays(now.day, -6), now.day)).size > 0) {
    const w = await weekRecap(db, userId, now.day, at);
    list.push({ key: 'review', kind: 'review', title: `Итог недели готов: ${w.score}%${w.streak ? ` · серия ${nWord(w.streak, 'день', 'дня', 'дней')}` : ''}`, body: w.focus ? `Фокус на следующую неделю: ${w.focus[0]!.toLowerCase()}${w.focus.slice(1)}.` : 'Что получилось, что нет и лучший день — загляни на минуту.', url: '/#week', at: REVIEW_AT });
  }
  return { today: now.day, list: list.filter(x => R[x.kind as keyof RemindSettings] !== false && (x.at === undefined || (min >= x.at && min < x.at + WINDOW))) };
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
      if (!(await pushToUser(db, userId, { title: x.title, body: x.body, url: x.url, tag: x.key }))) continue;
      total++;
      await db.insert(reminderLog).values({ userId, key: x.key, day: today, sentAt: new Date(at) }).onConflictDoUpdate({ target: [reminderLog.userId, reminderLog.key, reminderLog.day], set: { sentAt: new Date(at) } });
    }
  }
  return total;
}

/** замок проходов в базе: при нескольких репликах API напоминания шлёт одна */
export const REMIND_LOCK = 8_400_001;
/** проход под замком; замок занят (идёт проход в другом процессе) — null */
export async function remindTickLocked(db: DB, at = Date.now()) {
  return db.transaction(async tx => {
    const r = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${REMIND_LOCK}) as ok`);
    return r.rows[0]?.ok ? remindTick(db, at) : null;
  });
}

export function startReminders(db: DB, log: (m: string) => void) {
  // прошлый проход ещё идёт (много устройств, медленный push) — новый не начинаем
  let running = false;
  const t = setInterval(() => {
    if (running) return;
    running = true;
    remindTickLocked(db).catch(e => log(`напоминания: ${(e as Error).message}`)).finally(() => { running = false; });
  }, 60e3);
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
    const b = (req.body ?? {}) as Record<string, unknown>;
    // читаем и пишем под блокировкой строки: параллельная правка других настроек не потеряется
    await db.transaction(async tx => {
      const [p] = await tx.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, uid(req))).for('update');
      const R: RemindSettings = { ...(((p?.s ?? {}) as Record<string, any>).remind ?? {}) };
      if (typeof b.off === 'boolean') R.off = b.off;
      if (b.lead !== undefined) { const l = Math.round(Number(b.lead)); if (!(l >= 0 && l <= 120)) throw bad('За сколько минут напоминать: от 0 до 120.'); R.lead = l; }
      for (const k of REMIND_KINDS) if (typeof (b.kinds as any)?.[k] === 'boolean') R[k] = (b.kinds as any)[k];
      await tx.update(profiles).set({ settings: sql`${profiles.settings} || ${JSON.stringify({ remind: R })}::jsonb` }).where(eq(profiles.userId, uid(req)));
    });
    return view(uid(req));
  });
  app.post('/api/push/test', { preHandler: requireUser }, async (req, reply) => {
    const n = await pushToUser(db, uid(req), { title: 'Напоминания работают', body: 'Так будут выглядеть подсказки Lumi.', url: '/#today', tag: 'test' });
    if (!n) return reply.code(400).send({ error: 'Не получилось отправить: на этом аккаунте нет рабочих устройств.' });
    return { sent: n };
  });
}
