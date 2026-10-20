/** Какой раздел «своего набора» открывает кнопка: названия кнопок и разделов → ключ. Пусто — нужен весь Pro */
import { hasFeature, type PackKey } from '@bortjournal/core';
import type { Subscription } from './api';

const OF: Record<string, PackKey> = {
  'Фото и описание еды': 'food', 'Описание еды': 'food', 'Поиск еды': 'food', 'Поиск по базе продуктов': 'food', 'Анализ еды': 'food',
  'Цель и прогноз': 'goal', 'Цель и план': 'goal',
  'Статистика': 'stats', 'Статистика и итог недели': 'stats', 'Достижения': 'stats', 'Итог недели': 'stats',
  'Зал': 'gym', 'Учёба': 'study', 'Учёба и вопросы': 'study', 'Бюджет': 'budget', 'Трата': 'budget', 'Книги': 'books', 'Чтение': 'books',
  'Цели и повторы': 'plans', 'Напоминания': 'reminders'
};
export const featureOf = (what: string): PackKey | null => OF[what] ?? null;
/** открыт ли раздел по названию кнопки или по ключу */
export const can = (sub: Subscription | null | undefined, what: string) => { const k = (OF[what] ?? what) as PackKey; return hasFeature(sub, k); };
