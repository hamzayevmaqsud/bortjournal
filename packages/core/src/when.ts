/**
 * «Когда» из текста задачи на русском: «Позвонить маме завтра в 19:00» → день завтра, время 19:00, название «Позвонить маме».
 * Понимает: сегодня / завтра / послезавтра, «в пятницу», «через 3 дня», «через неделю», «25 октября», «25.10»;
 * время «в 19:00», «в 19.30», «в 19», «в 7 вечера», «в 9 утра», «в полдень», «19:30».
 * Без даты, но со временем — день остаётся тем, куда добавляют. Ничего не нашлось — текст как есть.
 */
import { addDays } from './dates.js';

const DOW: Array<[RegExp, number]> = [
  [/понедельник\w*|пн/, 1], [/вторник\w*|вт/, 2], [/сред[уаы]|ср/, 3], [/четверг\w*|чт/, 4],
  [/пятниц[уаы]|пт/, 5], [/суббот[уаы]|сб/, 6], [/воскресенье|воскресень[ея]|вс/, 0]
];
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const pad = (n: number) => String(n).padStart(2, '0');
const dowOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
/** граница слова для кириллицы (\b в JS её не видит) */
const B = '(?<![\\p{L}\\d])', E = '(?![\\p{L}\\d])';
const re = (src: string) => new RegExp(`${B}(?:${src})${E}`, 'iu');

export interface When { title: string; day: string | null; time: string | null }

export function parseWhen(text: string, today: string): When {
  let s = ` ${text} `, day: string | null = null, time: string | null = null;
  const cut = (m: RegExpExecArray) => { s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); };

  // время: «в 7 вечера», «в 9:30 утра», «в 19:00», «в 19.30», «в 19 часов», «в полдень», «19:30»
  let m = re('(?:в|к)\\s+полдень').exec(s);
  if (m) { time = '12:00'; cut(m); }
  if (!time && (m = re('(?:в|к|на)\\s+(\\d{1,2})(?:[:.](\\d{2}))?\\s*(утра|дня|вечера|ночи)').exec(s))) {
    let h = +m[1]!; const min = +(m[2] ?? 0), part = m[3]!.toLowerCase();
    if ((part === 'дня' || part === 'вечера') && h < 12) h += 12;
    if (part === 'ночи' && h === 12) h = 0;
    if (h < 24 && min < 60) { time = `${pad(h)}:${pad(min)}`; cut(m); }
  }
  if (!time && (m = re('(?:в|к|на)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(?:ч|час(?:а|ов)?))?').exec(s))) {
    const h = +m[1]!, min = +(m[2] ?? 0);
    if (h < 24 && min < 60) { time = `${pad(h)}:${pad(min)}`; cut(m); }
  }
  if (!time && (m = re('(\\d{1,2}):(\\d{2})').exec(s))) {
    const h = +m[1]!, min = +m[2]!;
    if (h < 24 && min < 60) { time = `${pad(h)}:${pad(min)}`; cut(m); }
  }

  // день
  if ((m = re('послезавтра').exec(s))) { day = addDays(today, 2); cut(m); }
  else if ((m = re('завтра').exec(s))) { day = addDays(today, 1); cut(m); }
  else if ((m = re('сегодня').exec(s))) { day = today; cut(m); }
  else if ((m = re('через\\s+неделю').exec(s))) { day = addDays(today, 7); cut(m); }
  else if ((m = re('через\\s+(\\d{1,3})\\s+(?:день|дня|дней)').exec(s))) { day = addDays(today, +m[1]!); cut(m); }
  else if ((m = re('(\\d{1,2})\\s+(январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*').exec(s))) {
    const d = +m[1]!, mon = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    day = nextDate(today, mon, d); if (day) cut(m);
  } else if ((m = re('(\\d{1,2})[./](\\d{1,2})').exec(s))) {
    day = nextDate(today, +m[2]!, +m[1]!); if (day) cut(m);
  } else {
    for (const [w, dow] of DOW) {
      const r = re(`(?:в|во)\\s+(?:${w.source})|(?:${w.source.split('|').filter(x => x.length > 2).join('|')})`).exec(s);
      if (r) { const shift = (dow - dowOf(today) + 7) % 7; day = addDays(today, shift); cut(r); break; }
    }
  }

  const title = s.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/^[\s,.\-–—]+|[\s,\-–—]+$/g, '').trim();
  return title && (day || time) ? { title, day, time } : { title: text.trim(), day: null, time: null };
}

/** ближайшая будущая (или сегодняшняя) дата с таким днём и месяцем; неверная дата — null */
function nextDate(today: string, month: number, dayOfMonth: number) {
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null;
  const y = +today.slice(0, 4);
  for (const year of [y, y + 1]) {
    const iso = `${year}-${pad(month)}-${pad(dayOfMonth)}`, d = new Date(`${iso}T12:00:00Z`);
    if (d.toISOString().slice(0, 10) !== iso) return null;
    if (iso >= today) return iso;
  }
  return null;
}
