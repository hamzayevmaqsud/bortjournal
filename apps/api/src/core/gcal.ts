/**
 * Google Календарь (спека: .scratch/google-calendar/spec.md).
 * Подключение — OAuth с правами на свой календарь «Lumi» (calendar.app.created) и чтение событий (calendar.events.readonly).
 * Синхронизация (воркер, раз в 5 минут): пункты модулей (AppModule.calendarItems) → события календаря «Lumi»
 * по отпечатку содержимого; события основного календаря → gcal_events для ленты дня.
 * Токены и id календаря — только зашифрованными (secret-box).
 */
import crypto from 'node:crypto';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { addDays, hasFeature, localNow } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { MODULES_LIST } from '../modules/index.js';
import { requireUser } from './auth.js';
import { subscription } from './billing.js';
import type { CalendarItem } from './module.js';
import { gcalEvents, gcalLinks, integrations, users } from './schema.js';
import { seal, sign, unseal } from './secret-box.js';
import { publicBase } from './tokens.js';

const PROVIDER = 'google-calendar';
const SCOPES = ['https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.events.readonly'];
const EVERY_MS = 5 * 60e3, BACK = 7, AHEAD = 60;
const env = (k: string) => process.env[k]?.trim() || '';
const available = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));
const API = () => env('GCAL_API_URL') || 'https://www.googleapis.com/calendar/v3';
const TOKEN = () => env('GOOGLE_TOKEN_URL') || 'https://oauth2.googleapis.com/token';
const AUTH = () => env('GOOGLE_AUTH_URL') || 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE = () => env('GOOGLE_REVOKE_URL') || 'https://oauth2.googleapis.com/revoke';

interface Secret { refresh: string; access: string; exp: number; calendarId: string; lastSync?: number | null; error?: string | null }
class GoogleError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const REVOKED = 'Доступ к календарю отозван — подключи заново в профиле.';

async function form(url: string, body: Record<string, string>) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
async function gapi(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(API() + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const json = r.status === 204 ? null : await r.json().catch(() => null) as any;
  if (r.status >= 400 && r.status !== 404 && r.status !== 410) throw new GoogleError(r.status, json?.error?.message ?? `Google ответил ${r.status}`);
  return { status: r.status, json };
}

const rowOf = async (db: Tx, userId: string) => (await db.select().from(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, PROVIDER))))[0];
const save = (db: Tx, id: string, s: Secret, status = 'active') => db.update(integrations).set({ secretEnc: seal(s), status }).where(eq(integrations.id, id));

/** действующий access-токен; истёк — новый по refresh-токену; отозван — статус error и остановка */
async function accessToken(db: Tx, row: typeof integrations.$inferSelect, s: Secret, at: number) {
  if (s.exp - 60e3 > at) return s.access;
  const r = await form(TOKEN(), { grant_type: 'refresh_token', refresh_token: s.refresh, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET') });
  if (r.status === 400 || r.status === 401) { s.error = REVOKED; await save(db, row.id, s, 'error'); throw new GoogleError(401, REVOKED); }
  if (r.status >= 300 || !r.json.access_token) throw new GoogleError(r.status, 'Google не выдал токен');
  s.access = r.json.access_token; s.exp = at + (Number(r.json.expires_in) || 3600) * 1000;
  await save(db, row.id, s);
  return s.access;
}

/* ---------- события ---------- */
const offset = (tz: number) => `${tz < 0 ? '-' : '+'}${String(Math.floor(Math.abs(tz) / 60)).padStart(2, '0')}:${String(Math.abs(tz) % 60).padStart(2, '0')}`;
const localStamp = (day: string, hm: string, plusMin: number, tz: number) => {
  const d = new Date(Date.parse(`${day}T${hm}:00Z`) + plusMin * 60e3);
  return `${d.toISOString().slice(0, 19)}${offset(tz)}`;
};
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
function eventOf(it: CalendarItem, tz: number) {
  // кривое время (старые записи) — событие на весь день, а не падение всей синхронизации
  const timed = it.time && HM.test(it.time) ? { start: { dateTime: localStamp(it.day, it.time, 0, tz) }, end: { dateTime: localStamp(it.day, it.time, it.minutes ?? 30, tz) } }
    : { start: { date: it.day }, end: { date: addDays(it.day, 1) } };
  return { summary: `${it.done ? '✓ ' : ''}${it.title}`.slice(0, 300), description: 'Из Lumi', ...timed };
}
const hashOf = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('base64url').slice(0, 22);

/** событие основного календаря → день и время у человека */
function localOf(e: any, tz: number) {
  if (e.start?.date) return { day: String(e.start.date), time: null, minutes: null };
  const s = Date.parse(e.start?.dateTime), en = Date.parse(e.end?.dateTime);
  if (!Number.isFinite(s)) return null;
  const l = new Date(s + tz * 60e3).toISOString();
  return { day: l.slice(0, 10), time: l.slice(11, 16), minutes: Number.isFinite(en) ? Math.max(0, Math.round((en - s) / 60e3)) : null };
}

/** один проход синхронизации для человека. at — «сейчас» (тесты двигают время) */
export async function syncCalendar(db: DB, userId: string, at = new Date()) {
  const row = await rowOf(db, userId);
  if (!row?.secretEnc || row.status !== 'active') return 0;
  const s = unseal<Secret>(row.secretEnc), now = at.getTime();
  let token: string;
  try { token = await accessToken(db, row, s, now); }
  catch (e) { if (e instanceof GoogleError && e.message === REVOKED) return 0; throw e; }
  const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
  const tz = u?.tz ?? 0, today = localNow(tz, now).day, from = addDays(today, -BACK), to = addDays(today, AHEAD);
  const sub = await subscription(db, userId);
  const allowed = new Set<string>(['food', 'body', 'plans', ...(['gym', 'study', 'budget', 'books'] as const).filter(k => hasFeature(sub, k))]);
  const items: CalendarItem[] = [];
  for (const m of MODULES_LIST) if (m.calendarItems && allowed.has(m.name)) items.push(...await m.calendarItems(db, userId, from, to, today));

  let changes = 0;
  const cal = `/calendars/${encodeURIComponent(s.calendarId)}/events`;
  const links = new Map((await db.select().from(gcalLinks).where(eq(gcalLinks.userId, userId))).map(l => [l.key, l]));
  for (const it of items) {
    const body = eventOf(it, tz), hash = hashOf(body), l = links.get(it.key);
    links.delete(it.key);
    if (l && l.hash === hash) continue;
    let eventId = l?.eventId;
    if (l) { const r = await gapi(token, 'PATCH', `${cal}/${encodeURIComponent(l.eventId)}`, body); if (r.status === 404 || r.status === 410) eventId = undefined; }
    if (!eventId) eventId = (await gapi(token, 'POST', cal, body)).json?.id;
    if (!eventId) continue;
    await db.insert(gcalLinks).values({ userId, key: it.key, eventId, hash, day: it.day })
      .onConflictDoUpdate({ target: [gcalLinks.userId, gcalLinks.key], set: { eventId, hash, day: it.day } });
    changes++;
  }
  // пропавшие пункты в окне — событие удаляется; старше окна — остаются в календаре как история
  for (const l of links.values()) if (l.day >= from) {
    await gapi(token, 'DELETE', `${cal}/${encodeURIComponent(l.eventId)}`);
    await db.delete(gcalLinks).where(and(eq(gcalLinks.userId, userId), eq(gcalLinks.key, l.key)));
    changes++;
  }

  // события основного календаря — для ленты дня
  const q = new URLSearchParams({ timeMin: `${from}T00:00:00${offset(tz)}`, timeMax: `${addDays(to, 1)}T00:00:00${offset(tz)}`, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' });
  const got = (await gapi(token, 'GET', `/calendars/primary/events?${q}`)).json?.items ?? [];
  const rows = (got as any[]).filter(e => e?.id && e.status !== 'cancelled').map(e => ({ e, l: localOf(e, tz) })).filter(x => x.l && x.l.day >= from && x.l.day <= to)
    .map(({ e, l }) => ({ userId, eventId: String(e.id).slice(0, 200), day: l!.day, time: l!.time, minutes: l!.minutes, title: String(e.summary ?? 'Без названия').slice(0, 300) }));
  // пока шёл проход, человек мог отключить или переподключить календарь — тогда результат этого прохода не нужен
  const still = await rowOf(db, userId);
  let cur: Secret | null = null;
  try { cur = still?.secretEnc ? unseal<Secret>(still.secretEnc) : null; } catch { cur = null; }
  if (!still || still.status !== 'active' || cur?.calendarId !== s.calendarId || cur.refresh !== s.refresh) return changes;
  await db.transaction(async tx => {
    await tx.delete(gcalEvents).where(and(eq(gcalEvents.userId, userId), gte(gcalEvents.day, from), lte(gcalEvents.day, to)));
    if (rows.length) await tx.insert(gcalEvents).values(rows).onConflictDoNothing();
  });

  await save(db, row.id, { ...cur!, lastSync: now, error: null });
  return changes;
}

/** воркер: всем подключённым, кому пора (раз в 5 минут). Сбой одного не мешает остальным */
export async function workCalendars(db: DB, at = new Date()) {
  if (!available()) return 0;
  const rows = await db.select().from(integrations).where(and(eq(integrations.provider, PROVIDER), eq(integrations.status, 'active')));
  let n = 0;
  for (const row of rows) {
    let s: Secret;
    try { s = unseal<Secret>(row.secretEnc!); } catch { await db.update(integrations).set({ status: 'error' }).where(eq(integrations.id, row.id)); continue; }
    if (s.lastSync && at.getTime() - s.lastSync < EVERY_MS) continue;
    try { n += await syncCalendar(db, row.userId, at); }
    catch (e) {
      if (e instanceof GoogleError && e.message === REVOKED) continue;
      const cur = await rowOf(db, row.userId); if (!cur?.secretEnc || cur.status !== 'active') continue;
      // сбой сети или Google — запомнить и попробовать в следующий раз
      await save(db, cur.id, { ...unseal<Secret>(cur.secretEnc), lastSync: at.getTime(), error: 'Не получилось связаться с Google — попробую ещё раз.' });
    }
  }
  return n;
}

/* ---------- маршруты ---------- */
export async function gcalRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const redirectUri = (req: FastifyRequest) => `${publicBase(req)}/api/integrations/google-calendar/callback`;
  // возврат туда, откуда пришли: телефонная версия живёт на /m
  const back = (reply: FastifyReply, what: string, m: boolean) => reply.redirect(`${m ? '/m' : '/'}#profile?gcal=${what}`);

  app.get('/api/integrations', { preHandler: requireUser }, async req => {
    const row = await rowOf(db, req.userId!);
    let s: Secret | null = null;
    let broken = false;
    try { s = row?.secretEnc ? unseal<Secret>(row.secretEnc) : null; } catch { s = null; broken = true; }
    // ключ шифрования сменился или потерян — токены не прочитать
    const error = broken ? 'Ключ шифрования на сервере сменился — подключи календарь заново.' : s?.error ?? null;
    return { googleCalendar: { available: available(), connected: !!row, error, lastSync: s?.lastSync ? new Date(s.lastSync).toISOString() : null } };
  });

  app.get('/api/integrations/google-calendar/start', { preHandler: requireUser }, async (req, reply) => {
    if (!available()) return reply.code(503).send({ error: 'Google Календарь на этом сервере не настроен.' });
    const m = (req.query as { back?: string }).back === 'm' ? 1 : 0;
    const exp = Date.now() + 15 * 60e3, raw = `${req.userId}.${exp}.${m}`, state = `${raw}.${sign(raw)}`;
    const u = new URL(AUTH());
    for (const [k, v] of Object.entries({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })) u.searchParams.set(k, v);
    return reply.redirect(u.toString());
  });

  app.get('/api/integrations/google-calendar/callback', { preHandler: requireUser }, async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const [uid, exp, mb, mac] = String(q.state ?? '').split('.'), m = mb === '1';
    const fine = uid === req.userId && Number(exp) > Date.now() && mac === sign(`${uid}.${exp}.${mb}`);
    if (!fine) return reply.code(400).send({ error: 'Ссылка подключения устарела — начни заново из профиля.' });
    if (q.error || !q.code) return back(reply, 'denied', m);
    const t = await form(TOKEN(), { code: q.code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: redirectUri(req), grant_type: 'authorization_code' });
    if (t.status >= 300 || !t.json.access_token || !t.json.refresh_token) return back(reply, 'failed', m);
    const userId = req.userId!, old = await rowOf(db, userId);
    // переподключение: старый календарь «Lumi» убираем, связи начинаем заново
    if (old?.secretEnc) { try { await gapi(t.json.access_token, 'DELETE', `/calendars/${encodeURIComponent(unseal<Secret>(old.secretEnc).calendarId)}`); } catch { /* уже нет */ } }
    await db.delete(gcalLinks).where(eq(gcalLinks.userId, userId));
    const c = await gapi(t.json.access_token, 'POST', '/calendars', { summary: 'Lumi', description: 'Задачи и тренировки из Lumi. Lumi меняет этот календарь сам.' });
    if (!c.json?.id) return back(reply, 'failed', m);
    const secret: Secret = { refresh: t.json.refresh_token, access: t.json.access_token, exp: Date.now() + (Number(t.json.expires_in) || 3600) * 1000, calendarId: c.json.id, lastSync: null, error: null };
    const v = { status: 'active', scopes: SCOPES, consentAt: new Date(), secretEnc: seal(secret) };
    await db.insert(integrations).values({ userId, provider: PROVIDER, ...v }).onConflictDoUpdate({ target: [integrations.userId, integrations.provider], set: v });
    return back(reply, 'connected', m);
  });

  // отключить: календарь «Lumi» удалить, токен отозвать, всё своё стереть. Google недоступен — всё равно забываем доступ
  app.delete('/api/integrations/google-calendar', { preHandler: requireUser }, async req => {
    const userId = req.userId!, row = await rowOf(db, userId);
    if (row?.secretEnc) {
      try {
        const s = unseal<Secret>(row.secretEnc);
        const token = await accessToken(db, row, s, Date.now());
        await gapi(token, 'DELETE', `/calendars/${encodeURIComponent(s.calendarId)}`);
        await form(REVOKE(), { token: s.refresh });
      } catch { /* доступ уже отозван или Google недоступен */ }
    }
    await db.transaction(async tx => {
      await tx.delete(gcalLinks).where(eq(gcalLinks.userId, userId));
      await tx.delete(gcalEvents).where(eq(gcalEvents.userId, userId));
      await tx.delete(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, PROVIDER)));
    });
    return { ok: true };
  });
}
