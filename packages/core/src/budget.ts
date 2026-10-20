/**
 * Бюджет «по мотивам Budget OK»: сумма на период делится на оставшиеся дни.
 * Потратил меньше — завтра на день больше, перерасход — меньше. Доходы в периоде добавляются.
 */
import { addDays, diffDays, parseDay, z } from './dates.js';

export function budgetPeriod(day: string, startDay: number) {
  const st = Math.min(28, Math.max(1, Math.round(startDay) || 1)), d = parseDay(day);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() - (d.getUTCDate() < st ? 1 : 0);
  if (m < 0) { m += 12; y -= 1; }
  const from = `${y}-${z(m + 1)}-${z(st)}`;
  const ny = m === 11 ? y + 1 : y, nm = (m + 1) % 12;
  const to = addDays(`${ny}-${z(nm + 1)}-${z(st)}`, -1);
  return { from, to, days: diffDays(from, to) + 1 };
}

export interface MoneyEntry { day: string; kind: 'in' | 'out' | string; amount: number }
export function budgetDay(day: string, settings: { amount: number; startDay: number; savings: number }, entries: MoneyEntry[]) {
  const p = budgetPeriod(day, settings.startDay);
  const inP = entries.filter(x => x.day >= p.from && x.day <= p.to);
  const outs = inP.filter(x => x.kind !== 'in');
  const sum = (xs: MoneyEntry[]) => xs.reduce((a, x) => a + x.amount, 0);
  const income = sum(inP.filter(x => x.kind === 'in'));
  const total = settings.amount + income - settings.savings;
  const before = sum(outs.filter(x => x.day < day)), today = sum(outs.filter(x => x.day === day)), spent = sum(outs);
  const daysLeft = diffDays(day, p.to) + 1, allow = Math.max(0, (total - before) / daysLeft);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    ...p, total: round(total), income: round(income), spent: round(spent), today: round(today), daysLeft,
    allow: round(allow), leftToday: round(allow - today), leftPeriod: round(total - spent),
    tomorrow: daysLeft > 1 ? round(Math.max(0, (total - before - today) / (daysLeft - 1))) : null
  };
}

/** категории операций: ключ, название, цвет */
export const MONEY_CATS: Record<'out' | 'in', Array<[key: string, name: string, color: string]>> = {
  out: [['food', 'Продукты', '#D9622B'], ['cafe', 'Кафе', '#B5891E'], ['transport', 'Транспорт', '#4D7B78'], ['home', 'Дом и счета', '#2F3B4F'],
    ['shop', 'Покупки', '#8E2F22'], ['health', 'Здоровье', '#3C5B38'], ['fun', 'Отдых', '#C0794F'], ['other', 'Другое', '#A19682']],
  in: [['salary', 'Зарплата', '#3C5B38'], ['side', 'Подработка', '#4D7B78'], ['gift', 'Подарок', '#B5891E'], ['other', 'Другое', '#A19682']]
};
export const CURRENCIES = ['₼', '₽', '$', '€', '₸', '₺', '£'];
export const moneyCat = (kind: string, key: string) => MONEY_CATS[kind === 'in' ? 'in' : 'out'].find(c => c[0] === key) ?? ['other', 'Другое', '#A19682'] as [string, string, string];
/** «12,5+3» — как в калькуляторе */
export const parseAmount = (v: unknown) => Math.round(String(v ?? '').split('+').reduce((a, x) => a + (Number(x.replace(',', '.').trim()) || 0), 0) * 100) / 100;
