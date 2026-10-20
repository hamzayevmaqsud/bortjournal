/**
 * Общие понятия продукта. Здесь нет зависимостей — пакет импортируют и API, и фронт.
 */

/** Модули продукта. Доступ к каждому — через entitlements. */
export const MODULES = ['food', 'gym', 'study', 'budget', 'books', 'plans', 'body'] as const;
export type ModuleName = (typeof MODULES)[number];

export const MODULE_TITLES: Record<ModuleName, string> = {
  food: 'Еда', gym: 'Зал', study: 'Учёба', budget: 'Бюджет', books: 'Книги', plans: 'Планы', body: 'Тело и шаги'
};

/** Откуда у человека доступ к модулю. */
export const ENTITLEMENT_SOURCES = ['free', 'trial', 'web', 'apple', 'google'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/** Модули, которые бесплатны всем; остальные — по подписке, когда подключим оплату. */
export const FREE_MODULES: readonly ModuleName[] = MODULES;

export const isModule = (x: unknown): x is ModuleName => typeof x === 'string' && (MODULES as readonly string[]).includes(x);

export * from './dates.js';
export * from './drinks.js';
export * from './budget.js';
