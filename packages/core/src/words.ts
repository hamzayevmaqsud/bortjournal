/** Русские числа в тексте: склонение по числу и порядковые («третий день») — общие для API и фронта */

/** 1 день, 2 дня, 5 дней; 11–14 — всегда «дней» */
export const plural = (n: number, one: string, few: string, many: string) => {
  const m = Math.abs(Math.trunc(n)) % 100, k = m % 10;
  return m > 10 && m < 20 ? many : k > 1 && k < 5 ? few : k === 1 ? one : many;
};
/** «5 дней» — число и слово в нужной форме */
export const nWord = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;

const ORD = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый'];
/** порядковое мужского рода словом до десяти, дальше — «11-й» */
export const ordinal = (n: number) => ORD[n] ?? `${n}-й`;
