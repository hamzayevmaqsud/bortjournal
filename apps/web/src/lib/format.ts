/** числа везде одинаково: тысячи — через неразрывный пробел (и в «1 900», и в «12 345»), дробь — через запятую.
 *  Узкий U+202F в Rubik/Onest отсутствует — подставленный глиф почти нулевой ширины, цифры слипаются; U+00A0 есть во всех наших шрифтах */
const SEP = String.fromCharCode(0xA0);
export const num = (n: number, digits = 0, minDigits = 0) => {
  const s = n.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: minDigits, useGrouping: false });
  const [i = '', f] = s.split(',');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, SEP) + (f ? `,${f}` : '');
};
export const fmt = (n: number) => num(Math.round(n));
export const fmt1 = (n: number) => num(Math.round(n * 10) / 10, 1);
export const fmt2 = (n: number) => num(Math.round(n * 100) / 100, 2);
export const plural = (n: number, a: string, b: string, c: string) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; };
export const WDF = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const MONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const hmToMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h! * 60 + m!; };
export const minToHm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
