/**
 * Тарифы. Базовый — навсегда бесплатно: ручной подсчёт калорий, вода, шаги и вес, задачи.
 * Pro — всё остальное. «Свой набор» — только выбранные разделы: цена складывается из разделов,
 * но всегда ниже Pro. После регистрации 7 дней Pro бесплатно.
 * Оплата пока имитируется: «покупка» выдаёт доступ без денег (источник web).
 */
export const TRIAL_DAYS = 7;

export const FEATURES = {
  base: [
    ['food.manual', 'Подсчёт калорий вручную', 'приёмы пищи, БЖУ, свои блюда'],
    ['water', 'Вода и напитки', 'норма воды и кольцо дня'],
    ['steps', 'Шаги и вес', 'цель по шагам, вес по дням'],
    ['tasks', 'Задачи', 'на сегодня и любой день'],
    ['goal', 'Цель и прогноз', 'план калорий, срок, вехи'],
    ['stats', 'Статистика и итог недели', 'оценка дня, календарь, рекорды'],
    ['awards', 'Достижения', '19 наград по 4 ступени'],
    ['reminders', 'Напоминания', 'вода, еда, задачи, тренировки']
  ],
  pro: [
    ['food.ai', 'Фото и описание еды', 'ИИ считает калории и БЖУ'],
    ['food.search', 'Поиск по базе продуктов', '«гречка 200», плов, кутабы'],
    ['gym', 'Зал', 'подходы, иконки, рекорды, планы'],
    ['study', 'Учёба и вопросы', 'дневник, повторение, Obsidian'],
    ['budget', 'Бюджет', 'сколько можно потратить сегодня'],
    ['books', 'Книги', 'полка, цитаты, цель года'],
    ['plans', 'Цели и повторы', 'неделя–год, повторяющиеся задачи']
  ]
} as const;
export type ProFeature = (typeof FEATURES.pro)[number][0];

export const PRICES = {
  month: { id: 'month', title: 'Месяц', price: 4.99, per: 'в месяц', days: 30 },
  year: { id: 'year', title: 'Год', price: 39.99, per: 'в год', days: 365, note: '3,33 $ в месяц · −33%' }
} as const;
export type PriceId = keyof typeof PRICES;

/**
 * Разделы для «своего набора»: цена в месяц. Год — как 8 месяцев (−33%, как у Pro).
 * Чем больше разделов, тем больше скидка на набор; любой неполный набор дешевле Pro.
 * Цель, статистика, достижения и напоминания — бесплатно для всех.
 */
export const PACKS = [
  { key: 'food', name: 'Еда Pro', hint: 'фото и описание с ИИ, справочник, анализ еды', icon: 'camera', month: 1.49 },
  { key: 'gym', name: 'Зал', hint: 'подходы, веса, рекорды, планы', icon: 'gym', month: 1.29 },
  { key: 'study', name: 'Учёба и вопросы', hint: 'дневник, повторение, Obsidian', icon: 'study', month: 1.29 },
  { key: 'budget', name: 'Бюджет', hint: 'сколько можно потратить сегодня', icon: 'money', month: 0.99 },
  { key: 'books', name: 'Книги', hint: 'полка, цитаты, цель года', icon: 'books', month: 0.99 },
  { key: 'plans', name: 'Цели и повторы', hint: 'неделя–год, повторяющиеся задачи', icon: 'repeat', month: 0.79 }
] as const;
export type PackKey = (typeof PACKS)[number]['key'];
export const PACK_KEYS = PACKS.map(p => p.key) as PackKey[];
/** скидка на набор по числу разделов: 2 — 15%, 3 и больше — 25% */
export const BUNDLE_DISCOUNT = (n: number) => n >= 3 ? 0.25 : n === 2 ? 0.15 : 0;
/** неполный набор всегда дешевле Pro хотя бы на столько */
export const CUSTOM_GAP = { month: 0.5, year: 4 } as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const yearOf = (month: number) => month ? Math.max(0.99, Math.round(month * 8) - 0.01) : 0;
/** цена одного раздела отдельно — за месяц или за год */
export const packPrice = (month: number, plan: PriceId) => plan === 'month' ? month : yearOf(month);
/**
 * цена своего набора: сумма разделов со скидкой за количество, но не дороже Pro за вычетом запаса.
 * list — без скидки; save — экономия против Pro за этот же период; all — выбраны все разделы (это уже Pro)
 */
export function customPrice(keys: readonly string[], plan: PriceId) {
  const picked = PACKS.filter(p => keys.includes(p.key)), n = picked.length;
  const all = n === PACKS.length, listMonth = round2(picked.reduce((a, p) => a + p.month, 0)), discount = BUNDLE_DISCOUNT(n);
  const month = round2(listMonth * (1 - discount)), list = plan === 'month' ? listMonth : yearOf(listMonth);
  const raw = plan === 'month' ? month : yearOf(month), cap = round2(PRICES[plan].price - CUSTOM_GAP[plan]);
  const price = !n ? 0 : all ? PRICES[plan].price : Math.min(raw, cap);
  return { price, list, discount, capped: !all && raw > cap, all, save: round2(PRICES[plan].price - price), toPro: round2(PRICES[plan].price - price) };
}

export interface Subscription {
  pro: boolean;
  source: 'trial' | 'web' | 'apple' | 'google' | 'free' | 'beta' | null;
  expiresAt: string | null;
  daysLeft: number | null;
  plan: PriceId | null;
  autoRenew: boolean;
  /** подписка была, но кончилась — платные разделы открыты на просмотр */
  ended?: boolean;
  /** закрытая бета: всё открыто бесплатно, оплаты нет */
  beta?: boolean;
  /** «свой набор»: какие разделы открыты; null — всё (Pro, пробный, навсегда) */
  features?: PackKey[] | null;
}
/** открыт ли раздел: весь Pro или он есть в своём наборе */
export const hasFeature = (s: Pick<Subscription, 'pro' | 'features'> | null | undefined, key: PackKey) => !!s && (s.pro || !!s.features?.includes(key));
