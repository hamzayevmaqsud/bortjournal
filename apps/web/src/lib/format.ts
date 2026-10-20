export const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
export const fmt2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
export const plural = (n: number, a: string, b: string, c: string) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; };
export const WDF = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const MONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const hmToMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h! * 60 + m!; };
export const minToHm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
