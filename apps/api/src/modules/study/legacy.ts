/** Перенос учёбы: занятия, карточки повторения, порции вопросов, минуты по конспектам */
import { count, eq, sql } from 'drizzle-orm';
import { recordEvents } from '../../core/events.js';
import { dict, hm, isDay, list, num, optStr, str, uniqById } from '../../core/legacy.js';
import type { ImportCheck, ImportContext, LegacyState } from '../../core/module.js';
import { upsertByLegacy } from '../../db/upsert.js';
import { quizzes, srsCards, studySessions, studyTime } from './schema.js';

const validSessions = (st: LegacyState) => uniqById(list(st.study)).filter(s => isDay(s?.date) && str(s?.topic));
// минуты к записи дневника: раньше — число, теперь — { m, d }
const timeOf = (v: any) => (v && typeof v === 'object' ? { minutes: Math.round(num(v.m)), day: isDay(v.d) ? v.d : null } : { minutes: Math.round(num(v)), day: null });

export async function importStudy({ db, userId, warn }: ImportContext, st: LegacyState) {
  const ss = validSessions(st);
  const ids = await upsertByLegacy(db, studySessions, ss.map(s => ({
    userId, legacyId: String(s.id), day: s.date, time: hm(s.time), topic: str(s.topic, 200), category: optStr(s.category, 60), minutes: Math.round(num(s.minutes)),
    theses: list(s.notes).map(n => str(n, 2000)).filter(Boolean), qa: list(s.qa).filter(q => str(q?.q)).map(q => ({ q: str(q.q, 600), a: str(q.a, 2000) }))
  })));
  for (const [cardKey, c] of Object.entries(dict(st.srs))) {
    if (!isDay(c?.due)) { warn(`учёба: карточка ${cardKey} без даты повторения`); continue; }
    const v = { intervalDays: Math.max(0, Math.round(num(c.interval))), ease: num(c.ease) || 2.5, reps: Math.round(num(c.reps)), dueOn: c.due, lastOn: isDay(c.last) ? c.last : null };
    await db.insert(srsCards).values({ userId, cardKey: cardKey.slice(0, 300), ...v }).onConflictDoUpdate({ target: [srsCards.userId, srsCards.cardKey], set: v });
  }
  for (const [day, q] of Object.entries(dict(st.quizzes))) {
    if (!isDay(day)) continue;
    const v = { items: list(q?.items), source: optStr(q?.source) };
    await db.insert(quizzes).values({ userId, day, ...v }).onConflictDoUpdate({ target: [quizzes.userId, quizzes.day], set: v });
  }
  for (const [key, raw] of Object.entries(dict(st.studyTime))) {
    const v = timeOf(raw); if (!v.minutes) continue;
    await db.insert(studyTime).values({ userId, key: key.slice(0, 300), ...v }).onConflictDoUpdate({ target: [studyTime.userId, studyTime.key], set: v });
  }
  await recordEvents(db, ss.map(s => ({ userId, module: 'study' as const, kind: 'session', refId: ids.get(String(s.id)), day: s.date, time: hm(s.time), title: str(s.topic, 200), value: Math.round(num(s.minutes)), unit: 'min' })));
}

export async function verifyStudy({ db, userId }: ImportContext, st: LegacyState): Promise<ImportCheck[]> {
  const ss = validSessions(st);
  const [s] = await db.select({ n: count(), min: sql<number>`coalesce(sum(${studySessions.minutes}), 0)::int` }).from(studySessions).where(eq(studySessions.userId, userId));
  const [c] = await db.select({ n: count() }).from(srsCards).where(eq(srsCards.userId, userId));
  const [q] = await db.select({ n: count() }).from(quizzes).where(eq(quizzes.userId, userId));
  return [
    { name: 'занятий', source: ss.length, db: s!.n },
    { name: 'минут учёбы', source: ss.reduce((a, x) => a + Math.round(num(x.minutes)), 0), db: Number(s!.min) },
    { name: 'карточек повторения', source: Object.values(dict(st.srs)).filter(x => isDay(x?.due)).length, db: c!.n },
    { name: 'дней с вопросами', source: Object.keys(dict(st.quizzes)).filter(isDay).length, db: q!.n }
  ];
}
