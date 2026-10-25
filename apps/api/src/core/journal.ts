/**
 * «Как прошёл день?» — настроение 1–5 и короткая заметка дня (day_journal, общая для всех модулей).
 * Отмеченное настроение — запись: день становится активным для серии (core/streak.ts).
 * Будущий день отметить нельзя; «сегодня» — по часовому поясу человека.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { localNow } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { requireUser } from './auth.js';
import { bad, dayParam } from './http.js';
import { dayJournal, users } from './schema.js';

export const NOTE_MAX = 2000;

async function todayOf(db: DB, userId: string) {
  const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
  return localNow(u?.tz ?? 0).day;
}
/** настроение: не передано — не трогаем, null — стереть, иначе целое 1–5 */
function moodParam(v: unknown) {
  if (v === undefined || v === null) return v;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw bad('Настроение — от 1 до 5.');
  return v;
}
/** заметка: не передана — не трогаем, пустая — стереть */
function noteParam(v: unknown) {
  if (v === undefined || v === null) return v;
  if (typeof v !== 'string') throw bad('Заметка — это текст.');
  const s = v.replace(/\r\n/g, '\n').trim();
  if (s.length > NOTE_MAX) throw bad(`Заметка длиннее ${NOTE_MAX} знаков — сократи её.`);
  return s || null;
}

export async function journalRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/journal', { preHandler: requireUser }, async req => {
    const userId = req.userId!, today = await todayOf(db, userId), q = (req.query as { day?: string }).day;
    const day = q === undefined ? today : dayParam(q);
    const [r] = await db.select().from(dayJournal).where(and(eq(dayJournal.userId, userId), eq(dayJournal.day, day)));
    return { day, today, mood: r?.mood ?? null, note: r?.note ?? null };
  });

  app.put('/api/journal', { preHandler: requireUser }, async req => {
    const userId = req.userId!, b = (req.body ?? {}) as { day?: unknown; mood?: unknown; note?: unknown };
    const today = await todayOf(db, userId), day = b.day === undefined ? today : dayParam(b.day);
    if (day > today) throw bad('Этот день ещё не наступил.');
    const mood = moodParam(b.mood), note = noteParam(b.note);
    if (mood === undefined && note === undefined) throw bad('Нужно настроение или заметка.');
    const set: { mood?: number | null; note?: string | null } = {};
    if (mood !== undefined) set.mood = mood;
    if (note !== undefined) set.note = note;
    const [r] = await db.insert(dayJournal).values({ userId, day, ...set })
      .onConflictDoUpdate({ target: [dayJournal.userId, dayJournal.day], set }).returning();
    return { day, today, mood: r!.mood ?? null, note: r!.note ?? null };
  });
}
