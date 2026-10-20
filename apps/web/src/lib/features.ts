/** Какой раздел «своего набора» открывает кнопка: названия кнопок и разделов → ключ. Цель, статистика, достижения и напоминания — бесплатно */
import { hasFeature, type PackKey } from '@bortjournal/core';
import type { Subscription } from './api';

const OF: Record<string, PackKey> = {
  'Фото и описание еды': 'food', 'Описание еды': 'food', 'Поиск еды': 'food', 'Поиск по базе продуктов': 'food', 'Анализ еды': 'food',
  'Зал': 'gym', 'Учёба': 'study', 'Учёба и вопросы': 'study', 'Бюджет': 'budget', 'Трата': 'budget', 'Книги': 'books', 'Чтение': 'books',
  'Цели и повторы': 'plans'
};
// бесплатные разделы — открыты всем
const FREE = new Set(['goal', 'stats', 'awards', 'reminders', 'Цель и прогноз', 'Цель и план', 'Статистика', 'Статистика и итог недели', 'Достижения', 'Итог недели', 'Напоминания']);
export const featureOf = (what: string): PackKey | null => OF[what] ?? null;
/** открыт ли раздел по названию кнопки или по ключу */
export const can = (sub: Subscription | null | undefined, what: string) => { if (FREE.has(what)) return true; const k = (OF[what] ?? what) as PackKey; return hasFeature(sub, k); };
