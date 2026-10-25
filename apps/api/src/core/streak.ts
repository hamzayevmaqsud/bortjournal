/**
 * Серия — одна на всё приложение: «Сегодня», статистика, совет дня, итог недели и напоминания берут её отсюда.
 * Активный день — любая запись (hasAny по фактам модулей), день, который модуль сам считает активным
 * (фото еды в разборе, отметка привычки), или отмеченное настроение дня.
 *
 * Заморозка: пустой прошлый день закрывается заморозкой, если она есть, — серия не рвётся, но и не растёт.
 * В запасе до 2 заморозок, +1 за каждые 7 активных дней серии; больше 2 замороженных дней подряд не бывает.
 * Всё считается заново по дням за STREAK_WINDOW (те же дни — тот же ответ, сколько ни считай), а итог
 * кладётся в profiles.settings (freezes, frozenDays, freezeEarnedAt) — слиянием, не перезаписью настроек.
 */
import { eq, sql } from 'drizzle-orm';
import { addDays } from '@bortjournal/core';
import type { Tx } from '../db/index.js';
import { MODULES_LIST } from '../modules/index.js';
import type { DayFacts } from './module.js';
import { profiles } from './schema.js';
import { collect, hasAny } from './stats.js';

export const FREEZE_MAX = 2, FREEZE_EVERY = 7, FREEZE_RUN = 2, STREAK_WINDOW = 400, FROZEN_KEEP = 120;

export interface Streak {
  /** дней подряд с записями, сегодня — если уже есть запись */
  now: number;
  /** то же, но только до вчера включительно */
  upToYesterday: number;
  /** самая длинная серия за окно */
  best: number;
  /** заморозок в запасе */
  freezes: number;
  /** замороженные дни, по порядку */
  frozen: string[];
  /** когда получена последняя заморозка */
  earnedAt: string | null;
  /** вчерашний день спасла заморозка */
  usedYesterday: boolean;
}

/** серия и заморозки по дням [from, today]: чистая функция, сегодня не замораживается — он ещё идёт */
export function walkStreak(isActive: (d: string) => boolean, from: string, today: string): Streak {
  let run = 0, gap = 0, best = 0, freezes = 0, earnedAt: string | null = null;
  const frozen: string[] = [];
  const active = (d: string) => {
    run++; gap = 0; best = Math.max(best, run);
    if (run % FREEZE_EVERY === 0 && freezes < FREEZE_MAX) { freezes++; earnedAt = d; }
  };
  for (let d = from; d < today; d = addDays(d, 1)) {
    if (isActive(d)) active(d);
    else if (run > 0 && freezes > 0 && gap < FREEZE_RUN) { freezes--; gap++; frozen.push(d); }
    else { run = 0; gap = 0; }
  }
  const upToYesterday = run;
  if (isActive(today)) active(today);
  return { now: run, upToYesterday, best, freezes, frozen, earnedAt, usedYesterday: frozen.at(-1) === addDays(today, -1) };
}

/** активные дни за [from, to]; F — уже собранные факты (статистика собирает их и так) */
export async function activeSet(db: Tx, userId: string, from: string, to: string, F?: Map<string, DayFacts & { day: string }>) {
  F ??= await collect(db, userId, from, to);
  const days = new Set<string>();
  // настроение дня — тоже запись: collect кладёт его в факты
  for (const [d, f] of F) if (d >= from && d <= to && (hasAny(f) || f.mood)) days.add(d);
  // модули добавляют свои активные дни (фото еды, ждущее подтверждения, отметка привычки)
  for (const m of MODULES_LIST) if (m.activeDays) for (const d of await m.activeDays(db, userId, from)) if (d <= to) days.add(d);
  return days;
}

/** серия человека на его «сегодня»; persist — сохранить заморозки в настройки, если что-то поменялось */
export async function streakOf(db: Tx, userId: string, today: string, { F, persist = true }: { F?: Map<string, DayFacts & { day: string }>; persist?: boolean } = {}) {
  const from = addDays(today, -STREAK_WINDOW), days = await activeSet(db, userId, from, today, F);
  const s = walkStreak(d => days.has(d), from, today);
  if (persist) await saveFreezes(db, userId, s, today);
  return s;
}

async function saveFreezes(db: Tx, userId: string, s: Streak, today: string) {
  const keep = addDays(today, -FROZEN_KEEP), next = { freezes: s.freezes, frozenDays: s.frozen.filter(d => d >= keep), freezeEarnedAt: s.earnedAt };
  const [p] = await db.select({ f: sql<unknown>`${profiles.settings}->'freezes'`, d: sql<unknown>`${profiles.settings}->'frozenDays'`, e: sql<unknown>`${profiles.settings}->'freezeEarnedAt'` })
    .from(profiles).where(eq(profiles.userId, userId));
  if (!p) return;
  if (p.f === next.freezes && JSON.stringify(p.d ?? []) === JSON.stringify(next.frozenDays) && (p.e ?? null) === next.freezeEarnedAt) return;
  // слиянием: остальные настройки не трогаем, даже если их меняют в эту же секунду
  await db.execute(sql`update ${profiles} set settings = coalesce(settings, '{}'::jsonb) || ${JSON.stringify(next)}::jsonb where user_id = ${userId}`);
}
