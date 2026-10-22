/**
 * Запись голосом и календарь.
 * POST /capture — фраза текстом (из «Команд» iPhone или из приложения) или запись голоса; ИИ решает, что это:
 * задача (есть дата или время, «напомни», «запланируй») или заметка. Без ключа ИИ — всегда заметка.
 * Вход — обычная сессия или личный ключ (Authorization: Bearer …) из профиля.
 * GET /calendar/<ключ>.ics — подписка для «Календаря» iPhone: задачи с датой, напоминание за N минут.
 * Заметки: «Входящие» в «Планах».
 */
import { and, asc, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { addDays, isDay, localNow, parseDay } from '@bortjournal/core';
import { recordEvent } from '../../core/events.js';
import { aiEnabled, gemini } from '../../core/gemini.js';
import { ConsentError, takeAi } from '../../core/ai-quota.js';
import { bad, idParam, notFound, uid } from '../../core/http.js';
import { profiles, users } from '../../core/schema.js';
import { bearerOf, userByToken } from '../../core/tokens.js';
import type { DB } from '../../db/index.js';
import { notes, tasks } from './schema.js';

const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const SCHEMA = { type: 'OBJECT', properties: {
  heard: { type: 'STRING' }, kind: { type: 'STRING', enum: ['task', 'note'] }, title: { type: 'STRING' },
  day: { type: 'STRING', nullable: true }, time: { type: 'STRING', nullable: true }, details: { type: 'STRING', nullable: true }
}, required: ['heard', 'kind', 'title'] };
export const leadOf = (settings: Record<string, any> | null | undefined) => { const v = Number(settings?.remind?.lead); return Number.isFinite(v) && v >= 0 && v <= 120 ? v : 15; };
const dayWords = (day: string, today: string) => day === today ? 'сегодня' : day === addDays(today, 1) ? 'завтра' : day === addDays(today, 2) ? 'послезавтра' : `${parseDay(day).getUTCDate()} ${MONG[parseDay(day).getUTCMonth()]}`;

export interface Parsed { heard: string; kind: 'task' | 'note'; title: string; day: string | null; time: string | null; details: string | null }
/** разобрать фразу; ИИ получает «сейчас» пользователя, чтобы понимать «завтра», «в пятницу», «через час» */
export async function parsePhrase(input: { text?: string; audio?: { data: string; mime: string } }, now: { day: string; hm: string }): Promise<Parsed> {
  const text = (input.text ?? '').trim();
  if (!aiEnabled()) { if (!text) throw bad('Распознавание голоса не настроено: на сервере нет ключа ИИ.'); return { heard: text, kind: 'note', title: text.slice(0, 500), day: null, time: null, details: null }; }
  const prompt = `Ты разбираешь короткую голосовую запись для личного ежедневника.
Сейчас у пользователя: ${now.day} (${WD[parseDay(now.day).getUTCDay()]}), ${now.hm}.
${input.audio ? 'Сначала распознай речь из аудио (обычно русский) и запиши дословно в heard.' : `Фраза: «${text.slice(0, 1000)}». heard — эта фраза.`}
Реши, что это:
- kind "task" — если нужно что-то сделать к сроку, есть дата или время, или слова «напомни», «запланируй», «не забыть», «встреча», «позвонить завтра»;
- kind "note" — мысль, идея, факт без срока.
title — коротко и по делу, без «напомни мне», «запиши», с заглавной буквы (до 120 знаков).
day — дата в формате ГГГГ-ММ-ДД, если она названа или понятна («завтра», «в пятницу», «15-го»), иначе null. Ближайшая подходящая дата в будущем.
time — ЧЧ:ММ в 24-часовом формате, если названо время («в 3 дня» = 15:00, «в полвосьмого вечера» = 19:30, «через час» — от текущего времени), иначе null.
details — подробности, если они не влезли в title, иначе null.`;
  const parts: unknown[] = input.audio ? [{ inline_data: { mime_type: input.audio.mime, data: input.audio.data } }, { text: prompt }] : [{ text: prompt }];
  const out = await gemini(parts, SCHEMA, { timeout: 45e3 });
  const heard = String(out?.heard ?? text).trim().slice(0, 1000);
  if (!heard) throw bad('Ничего не расслышал. Попробуй ещё раз.');
  let day = isDay(out?.day) && out.day >= addDays(now.day, -1) && out.day <= addDays(now.day, 400) ? out.day as string : null;
  const time = typeof out?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(out.time) ? out.time as string : null;
  let kind: Parsed['kind'] = out?.kind === 'task' || day || time ? 'task' : 'note';
  // время без даты: сегодня, а если уже прошло — завтра
  if (time && !day) day = time > now.hm ? now.day : addDays(now.day, 1);
  const title = String(out?.title ?? '').trim().slice(0, 200) || heard.slice(0, 200);
  if (kind === 'note' && !title) kind = 'note';
  return { heard, kind, title, day, time, details: String(out?.details ?? '').trim().slice(0, 2000) || null };
}

/* ---------- календарь ---------- */
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line: string) {
  const b = Buffer.from(line); if (b.length <= 74) return line;
  const out: string[] = []; let cur = '';
  for (const ch of line) { if (Buffer.byteLength(cur + ch) > (out.length ? 73 : 74)) { out.push(cur); cur = ''; } cur += ch; }
  return [...out, cur].join('\r\n ');
}
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** местные дата и время пользователя → момент UTC (tz — смещение в минутах) */
const atUtc = (day: string, hm: string, tz: number) => new Date(Date.parse(`${day}T${hm}:00Z`) - tz * 60e3);
export function icsOf(list: Array<{ id: string; title: string; day: string; time: string | null; done: boolean; note: string | null }>, tz: number, lead: number) {
  const now = utcStamp(new Date()), L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bortjournal//Plans//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Lumi', 'X-PUBLISHED-TTL:PT15M', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M'];
  for (const t of list) {
    L.push('BEGIN:VEVENT', `UID:${t.id}@bortjournal`, `DTSTAMP:${now}`, `SUMMARY:${icsText((t.done ? '✓ ' : '') + t.title)}`);
    if (t.time) { const s = atUtc(t.day, t.time.slice(0, 5), tz); L.push(`DTSTART:${utcStamp(s)}`, `DTEND:${utcStamp(new Date(s.getTime() + 30 * 60e3))}`); }
    else L.push(`DTSTART;VALUE=DATE:${t.day.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(t.day, 1).replace(/-/g, '')}`);
    if (t.note) L.push(`DESCRIPTION:${icsText(t.note)}`);
    if (t.time && !t.done && lead > 0) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(t.title)}`, `TRIGGER:-PT${lead}M`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

export async function captureRoutes(app: FastifyInstance, { db }: { db: DB }) {
  // сессия или личный ключ «Команд»
  const who = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.userId) return;
    const u = await userByToken(db, bearerOf(req), 'capture');
    if (!u) return reply.code(401).send({ error: 'Нужен вход или ключ записи из настроек.', message: 'Ключ не подошёл — создай новый в настройках Lumi.' });
    req.userId = u;
  };
  const nowOf = async (userId: string) => { const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId)); return { ...localNow(u?.tz ?? 0), tz: u?.tz ?? 0 }; };

  app.post('/capture', { preHandler: who, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const b = (req.body ?? {}) as { text?: unknown; audio?: unknown; mime?: unknown };
    const text = typeof b.text === 'string' ? b.text : '', audio = typeof b.audio === 'string' && b.audio.length > 100 ? b.audio : null;
    if (!text.trim() && !audio) throw bad('Скажи или напиши, что записать.');
    if (audio && audio.length > 7 * 1024 * 1024) throw bad('Запись слишком длинная — до минуты.');
    const mime = typeof b.mime === 'string' && /^audio\/[a-z0-9.+-]+(;.*)?$/i.test(b.mime) ? b.mime.split(';')[0]! : 'audio/mp4';
    const userId = uid(req), now = await nowOf(userId);
    // без согласия на ИИ или сверх лимита фраза не теряется — сохраняем заметкой как есть
    let viaAi = aiEnabled(), why = '';
    if (viaAi) try { await takeAi(db, userId, 'capture'); } catch (e) { viaAi = false; why = e instanceof ConsentError ? ' Чтобы журнал сам ставил задачи со временем, разреши ИИ-помощника в профиле.' : ` ${(e as Error).message}`; }
    if (!viaAi && !text.trim()) throw bad(why.trim() || 'Распознавание голоса не настроено: на сервере нет ключа ИИ.');
    const p = viaAi ? await parsePhrase({ text, audio: audio ? { data: audio, mime } : undefined }, now) : { heard: text.trim(), kind: 'note' as const, title: text.trim().slice(0, 500), day: null, time: null, details: null };
    const [prof] = await db.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, userId));
    const lead = leadOf(prof?.s as Record<string, any>);
    if (p.kind === 'task') {
      const [t] = await db.insert(tasks).values({ userId, title: p.title, day: p.day, time: p.day ? p.time : null, note: p.details, createdOn: now.day }).returning();
      if (t!.day) await recordEvent(db, { userId, module: 'plans', kind: 'task', refId: t!.id, day: t!.day, time: t!.time, title: t!.title, value: 0, unit: 'done' });
      const when = t!.day ? `${dayWords(t!.day, now.day)}${t!.time ? `, ${t!.time.slice(0, 5)}` : ''}` : 'без даты';
      return reply.code(201).send({ kind: 'task', heard: p.heard, task: { id: t!.id, title: t!.title, day: t!.day, time: t!.time },
        message: `Задача «${t!.title}» — ${when}.${t!.time && lead ? ` Напомню за ${lead} минут.` : ''}` });
    }
    const [n] = await db.insert(notes).values({ userId, text: p.details ? `${p.title}\n${p.details}` : p.title, source: audio || req.headers.authorization ? 'voice' : 'manual' }).returning();
    return reply.code(201).send({ kind: 'note', heard: p.heard, note: { id: n!.id, text: n!.text }, message: `Заметка записана: «${n!.text.slice(0, 80)}».${why}` });
  });

  /* ---------- заметки ---------- */
  app.get('/notes', { preHandler: who }, async req => ({ items: await db.select().from(notes).where(eq(notes.userId, uid(req))).orderBy(asc(notes.done), desc(notes.createdAt)).limit(200) }));
  app.post('/notes', { preHandler: who }, async (req, reply) => {
    const text = String((req.body as { text?: unknown } | undefined)?.text ?? '').trim().slice(0, 4000); if (!text) throw bad('Напиши заметку.');
    const [n] = await db.insert(notes).values({ userId: uid(req), text }).returning();
    return reply.code(201).send(n);
  });
  app.put('/notes/:id', { preHandler: who }, async (req, reply) => {
    const b = (req.body ?? {}) as { text?: unknown; done?: unknown }, set: Partial<typeof notes.$inferInsert> = {};
    if (typeof b.text === 'string') { const t = b.text.trim().slice(0, 4000); if (!t) throw bad('Заметка пустая.'); set.text = t; }
    if (typeof b.done === 'boolean') set.done = b.done;
    const [n] = await db.update(notes).set(set).where(and(eq(notes.userId, uid(req)), eq(notes.id, idParam((req.params as any).id)))).returning();
    return n ?? notFound(reply);
  });
  app.delete('/notes/:id', { preHandler: who }, async (req, reply) => {
    const r = await db.delete(notes).where(and(eq(notes.userId, uid(req)), eq(notes.id, idParam((req.params as any).id)))).returning({ id: notes.id });
    return r.length ? { ok: true } : notFound(reply);
  });

  /* ---------- календарь (ключ в адресе — календари не умеют cookie) ---------- */
  app.get('/calendar/:file', async (req, reply) => {
    const raw = String((req.params as { file?: string }).file ?? '').replace(/\.ics$/, '');
    const userId = await userByToken(db, raw, 'calendar');
    if (!userId) return reply.code(404).send('Нет такого календаря.');
    const now = await nowOf(userId);
    const [prof] = await db.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, userId));
    const list = await db.select({ id: tasks.id, title: tasks.title, day: tasks.day, time: tasks.time, done: tasks.done, note: tasks.note }).from(tasks)
      .where(and(eq(tasks.userId, userId), isNotNull(tasks.day), gte(tasks.day, addDays(now.day, -30)), lte(tasks.day, addDays(now.day, 180)))).orderBy(asc(tasks.day));
    return reply.header('Content-Type', 'text/calendar; charset=utf-8').header('Cache-Control', 'no-store')
      .send(icsOf(list.map(t => ({ ...t, day: t.day! })), now.tz, leadOf(prof?.s as Record<string, any>)));
  });
}
