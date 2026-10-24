import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { addDays } from '@bortjournal/core';
import { bad } from '../../core/http.js';
import type { Tx } from '../../db/index.js';
import { habitChecks, habits } from './schema.js';

/** сколько привычек можно вести одновременно (архив не считается) */
export const HABITS_LIMIT = 20;
/** цвета точек и галочек — ключи токенов палитры */
export const HABIT_COLORS = ['orange', 'water', 'steps', 'gym', 'money', 'books', 'quiz', 'study'] as const;

export const titleOf = (v: unknown) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!t) throw bad('Напиши название привычки.');
  if ([...t].length > 60) throw bad('Название привычки — до 60 символов.');
  return t;
};
export const iconOf = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!s || s.length > 16 || /\s/.test(s)) throw bad('Значок — один эмодзи или короткий знак.');
  return s;
};
export const colorOf = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  if (!(HABIT_COLORS as readonly string[]).includes(String(v))) throw bad('Неизвестный цвет.');
  return String(v);
};

/** серия на день: отмечен — считаем с него, нет — со вчера (день ещё не потерян) */
export const streakOf = (days: Set<string>, day: string) => {
  let d = days.has(day) ? day : addDays(day, -1), n = 0;
  while (days.has(d) && n < 400) { n++; d = addDays(d, -1); }
  return n;
};

export type HabitRow = typeof habits.$inferSelect;
const pub = (h: HabitRow, days: Set<string>, day: string) => ({
  id: h.id, title: h.title, icon: h.icon, color: h.color, sort: h.sort,
  done: days.has(day), streak: streakOf(days, day),
  /** последние 7 дней по день включительно: [день−6 … день] */
  last7: Array.from({ length: 7 }, (_, i) => days.has(addDays(day, i - 6)))
});

/** отмеченные дни привычек за [from, to] */
async function checksOf(db: Tx, userId: string, ids: string[], from: string, to: string) {
  const m = new Map<string, Set<string>>(ids.map(id => [id, new Set()]));
  if (!ids.length) return m;
  const rows = await db.select({ habitId: habitChecks.habitId, day: habitChecks.day }).from(habitChecks)
    .where(and(eq(habitChecks.userId, userId), inArray(habitChecks.habitId, ids), gte(habitChecks.day, from), lte(habitChecks.day, to)));
  for (const r of rows) m.get(r.habitId)?.add(r.day);
  return m;
}

export const activeHabits = (db: Tx, userId: string) => db.select().from(habits)
  .where(and(eq(habits.userId, userId), isNull(habits.archivedAt))).orderBy(asc(habits.sort), asc(habits.createdAt));

/** список привычек на день: отметка, серия и последние 7 дней */
export async function habitsOn(db: Tx, userId: string, day: string) {
  const hs = await activeHabits(db, userId);
  const checks = await checksOf(db, userId, hs.map(h => h.id), addDays(day, -400), day);
  return hs.map(h => pub(h, checks.get(h.id)!, day));
}
export async function habitOn(db: Tx, userId: string, h: HabitRow, day: string) {
  const checks = await checksOf(db, userId, [h.id], addDays(day, -400), day);
  return pub(h, checks.get(h.id)!, day);
}

export async function ownHabit(db: Tx, userId: string, id: string) {
  const [h] = await db.select().from(habits).where(and(eq(habits.userId, userId), eq(habits.id, id)));
  return h ?? null;
}

/** новая привычка в конец списка; лимит и повтор названия проверяются здесь */
export async function addHabit(db: Tx, userId: string, v: { title: string; icon?: string | null; color?: string | null }) {
  const hs = await activeHabits(db, userId);
  if (hs.length >= HABITS_LIMIT) throw bad(`Можно вести до ${HABITS_LIMIT} привычек. Убери лишнюю в архив.`);
  if (hs.some(h => h.title.toLowerCase() === v.title.toLowerCase())) throw bad('Такая привычка уже есть.');
  const color = v.color ?? HABIT_COLORS[hs.length % HABIT_COLORS.length]!;
  const [h] = await db.insert(habits).values({ userId, title: v.title, icon: v.icon ?? null, color, sort: hs.reduce((a, x) => Math.max(a, x.sort + 1), 0) }).returning();
  return h!;
}

/** отметить или снять отметку за день — повтор того же запроса ничего не меняет */
export async function setCheck(db: Tx, userId: string, habitId: string, day: string, done: boolean) {
  if (done) await db.insert(habitChecks).values({ habitId, userId, day }).onConflictDoNothing();
  else await db.delete(habitChecks).where(and(eq(habitChecks.habitId, habitId), eq(habitChecks.userId, userId), eq(habitChecks.day, day)));
}

/** дни с хотя бы одной отмеченной привычкой — для общей серии */
export async function habitDays(db: Tx, userId: string, since: string) {
  const rows = await db.selectDistinct({ day: habitChecks.day }).from(habitChecks).where(and(eq(habitChecks.userId, userId), gte(habitChecks.day, since)));
  return rows.map(r => r.day);
}

/** история за период — для статистики: привычки (и архивные с отметками) и все отметки */
export async function habitHistory(db: Tx, userId: string, from: string, to: string) {
  const checks = await db.select({ habitId: habitChecks.habitId, day: habitChecks.day }).from(habitChecks)
    .where(and(eq(habitChecks.userId, userId), gte(habitChecks.day, from), lte(habitChecks.day, to))).orderBy(asc(habitChecks.day));
  const used = new Set(checks.map(c => c.habitId));
  const hs = (await db.select().from(habits).where(eq(habits.userId, userId)).orderBy(asc(habits.sort), asc(habits.createdAt)))
    .filter(h => !h.archivedAt || used.has(h.id));
  return {
    habits: hs.map(h => ({ id: h.id, title: h.title, icon: h.icon, color: h.color, archived: !!h.archivedAt })),
    checks
  };
}

/** порядок: ids — свои активные привычки сверху вниз */
export async function reorder(db: Tx, userId: string, ids: string[]) {
  const hs = await activeHabits(db, userId), mine = new Set(hs.map(h => h.id));
  if (ids.some(id => !mine.has(id)) || new Set(ids).size !== ids.length) throw bad('Неверный порядок привычек.');
  // не названные в списке — после названных, в прежнем порядке
  const rest = hs.filter(h => !ids.includes(h.id)).map(h => h.id);
  const all = [...ids, ...rest];
  for (const [i, id] of all.entries()) await db.update(habits).set({ sort: i }).where(and(eq(habits.userId, userId), eq(habits.id, id), sql`${habits.sort} <> ${i}`));
}
