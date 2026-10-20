/**
 * Тарифы. Базовый — навсегда бесплатно: ручной подсчёт калорий, вода, шаги и вес, задачи.
 * Pro — всё остальное. После регистрации 7 дней Pro бесплатно.
 * Оплата пока имитируется: «покупка» выдаёт доступ без денег (источник web).
 */
export const TRIAL_DAYS = 7;

export const FEATURES = {
  base: [
    ['food.manual', 'Подсчёт калорий вручную', 'приёмы пищи, БЖУ, свои блюда'],
    ['water', 'Вода и напитки', 'норма воды и кольцо дня'],
    ['steps', 'Шаги и вес', 'цель по шагам, вес по дням'],
    ['tasks', 'Задачи', 'на сегодня и любой день']
  ],
  pro: [
    ['food.ai', 'Фото и описание еды', 'ИИ считает калории и БЖУ'],
    ['food.search', 'Поиск по базе продуктов', '«гречка 200», плов, кутабы'],
    ['goal', 'Цель и прогноз', 'план калорий, срок, вехи'],
    ['gym', 'Зал', 'подходы, иконки, рекорды, планы'],
    ['study', 'Учёба и вопросы', 'дневник, повторение, Obsidian'],
    ['budget', 'Бюджет', 'сколько можно потратить сегодня'],
    ['books', 'Книги', 'полка, цитаты, цель года'],
    ['plans', 'Цели и повторы', 'неделя–год, повторяющиеся задачи'],
    ['stats', 'Статистика и итог недели', 'оценка дня, календарь, рекорды'],
    ['awards', 'Достижения', '19 наград по 4 ступени'],
    ['reminders', 'Напоминания', 'вода, еда, задачи, тренировки']
  ]
} as const;
export type ProFeature = (typeof FEATURES.pro)[number][0];

export const PRICES = {
  month: { id: 'month', title: 'Месяц', price: 4.99, per: 'в месяц', days: 30 },
  year: { id: 'year', title: 'Год', price: 39.99, per: 'в год', days: 365, note: '3,33 $ в месяц · −33%' }
} as const;
export type PriceId = keyof typeof PRICES;

export interface Subscription {
  pro: boolean;
  source: 'trial' | 'web' | 'apple' | 'google' | 'free' | null;
  expiresAt: string | null;
  daysLeft: number | null;
  plan: PriceId | null;
  autoRenew: boolean;
}
