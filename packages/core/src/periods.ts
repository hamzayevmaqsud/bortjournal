/**
 * Периоды целей и правила повторов (как в старом журнале).
 * Ключ периода: неделя — дата понедельника «2026-10-19», месяц «2026-10», квартал «2026-Q4», год «2026».
 * Цель вкладывается в цель следующего уровня: неделя → месяц → квартал → год.
 */
import { addDays, parseDay, ymdOf, z } from './dates.js';

export const PERIOD_KINDS = ['week', 'month', 'quarter', 'year'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const PERIOD_NAMES: Record<PeriodKind, string> = { week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' };
/** «цель на …» */
export const PERIOD_ACC: Record<PeriodKind, string> = { week: 'неделю', month: 'месяц', quarter: 'квартал', year: 'год' };
export const PERIOD_PARENT: Record<PeriodKind, PeriodKind | null> = { week: 'month', month: 'quarter', quarter: 'year', year: null };
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export const mondayOf = (d: string) => addDays(d, -((parseDay(d).getUTCDay() + 6) % 7));
export function periodKey(kind: PeriodKind, d: string) {
  const dt = parseDay(d), y = dt.getUTCFullYear(), m = dt.getUTCMonth();
  return kind === 'week' ? mondayOf(d) : kind === 'month' ? `${y}-${z(m + 1)}` : kind === 'quarter' ? `${y}-Q${Math.floor(m / 3) + 1}` : `${y}`;
}
/** первый и последний день периода */
export function periodRange(kind: PeriodKind, key: string): [string, string] {
  if (kind === 'week') return [key, addDays(key, 6)];
  if (kind === 'month') { const [y, m] = key.split('-').map(Number); return [`${key}-01`, ymdOf(new Date(Date.UTC(y!, m!, 0, 12)))]; }
  if (kind === 'quarter') { const [y, q] = key.split('-Q').map(Number); return [`${y}-${z((q! - 1) * 3 + 1)}-01`, ymdOf(new Date(Date.UTC(y!, q! * 3, 0, 12)))]; }
  return [`${key}-01-01`, `${key}-12-31`];
}
export const isPeriodKey = (kind: unknown, key: unknown): kind is PeriodKind => {
  if (typeof key !== 'string') return false;
  if (kind === 'week') return /^\d{4}-\d{2}-\d{2}$/.test(key) && mondayOf(key) === key;
  if (kind === 'month') return /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
  if (kind === 'quarter') return /^\d{4}-Q[1-4]$/.test(key);
  if (kind === 'year') return /^\d{4}$/.test(key);
  return false;
};
/** сдвиг даты на n периодов */
export function shiftPeriod(kind: PeriodKind, d: string, n: number) {
  if (kind === 'week') return addDays(d, 7 * n);
  const dt = parseDay(d), months = kind === 'month' ? n : kind === 'quarter' ? 3 * n : 12 * n;
  return ymdOf(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months, 1, 12)));
}
export function periodLabel(kind: PeriodKind, key: string) {
  const [a, b] = periodRange(kind, key), da = parseDay(a), db = parseDay(b);
  if (kind === 'week') return da.getUTCMonth() === db.getUTCMonth() ? `${da.getUTCDate()}–${db.getUTCDate()} ${MONG[db.getUTCMonth()]}` : `${da.getUTCDate()} ${MONG[da.getUTCMonth()]} – ${db.getUTCDate()} ${MONG[db.getUTCMonth()]}`;
  if (kind === 'month') return `${MONTHS[da.getUTCMonth()]![0]!.toUpperCase()}${MONTHS[da.getUTCMonth()]!.slice(1)} ${da.getUTCFullYear()}`;
  if (kind === 'quarter') return `${key.split('-Q')[1]} квартал ${da.getUTCFullYear()}`;
  return `${key} год`;
}

/* ---------- повторяющиеся задачи ---------- */
export const REPEAT_KINDS = ['daily', 'weekdays', 'days', 'weekly', 'monthly'] as const;
export type RepeatKind = (typeof REPEAT_KINDS)[number];
export const REPEAT_NAMES: Record<RepeatKind, string> = { daily: 'Каждый день', weekdays: 'По будням', days: 'По дням недели', weekly: 'Каждую неделю', monthly: 'Каждый месяц' };
export interface RepeatRule { kind: RepeatKind; days?: number[] }
export interface SeriesLike { rule: RepeatRule; startOn: string; endOn?: string | null; skipDays?: string[] }
/** порядок дней недели от понедельника; 0 — воскресенье */
export const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/** попадает ли день в правило серии */
export function repeatHits(s: SeriesLike, d: string) {
  if (d < s.startOn || (s.endOn && d > s.endOn) || (s.skipDays ?? []).includes(d)) return false;
  const wd = parseDay(d).getUTCDay(), r = s.rule;
  if (r.kind === 'daily') return true;
  if (r.kind === 'weekdays') return wd >= 1 && wd <= 5;
  if (r.kind === 'days') return (r.days ?? []).includes(wd);
  if (r.kind === 'weekly') return wd === parseDay(s.startOn).getUTCDay();
  if (r.kind === 'monthly') {
    const dom = parseDay(s.startOn).getUTCDate(), dd = parseDay(d), last = new Date(Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + 1, 0, 12)).getUTCDate();
    return dd.getUTCDate() === Math.min(dom, last);
  }
  return false;
}
export function repeatText(s: SeriesLike) {
  const r = s.rule;
  if (r.kind === 'days') return [...(r.days ?? [])].sort((a, b) => WD_ORDER.indexOf(a) - WD_ORDER.indexOf(b)).map(x => WD[x]).join(', ');
  if (r.kind === 'weekly') return `каждый ${WD[parseDay(s.startOn).getUTCDay()]}`;
  if (r.kind === 'monthly') return `${parseDay(s.startOn).getUTCDate()}-го числа`;
  return REPEAT_NAMES[r.kind].toLowerCase();
}
