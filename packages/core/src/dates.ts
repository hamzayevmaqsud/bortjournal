/** Даты как строки «ГГГГ-ММ-ДД» в поясе пользователя — без сюрпризов с UTC */
export const z = (n: number) => String(n).padStart(2, '0');
export const ymdOf = (d: Date) => `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`;
export const parseDay = (s: string) => new Date(s + 'T12:00:00Z');
export function addDays(day: string, n: number) { const d = parseDay(day); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); }
export const diffDays = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 864e5);
export const weekday = (day: string) => parseDay(day).getUTCDay();
/** «сегодня» и текущее время у пользователя со смещением tz минут от UTC */
export function localNow(tzOffset: number, now = Date.now()) {
  const d = new Date(now + tzOffset * 60000);
  return { day: ymdOf(d), hm: `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
/** настоящая дата ГГГГ-ММ-ДД: 2026-02-31 и 0000-01-01 — нет (база такие не примет) */
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && +s.slice(0, 4) >= 1900 && +s.slice(0, 4) <= 2200 && (d => !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s)(new Date(s + 'T12:00:00Z'));
