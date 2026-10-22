import type { AppModule } from '../../core/module.js';
import { importFood, verifyFood } from './legacy.js';
import { foodRoutes } from './routes.js';
import { workDrafts } from './drafts.js';
import { foodRemind, foodSeries, foodToday, topMeals } from './service.js';

export const foodModule: AppModule = {
  name: 'food', remind: foodRemind, importLegacy: importFood, verifyLegacy: verifyFood, routes: foodRoutes, today: foodToday, work: workDrafts,
  daily: async (db, userId, from, to) => (await foodSeries(db, userId, from, to)).map(({ day, meals, kcal, protein, fat, carbs, waterMl }) => ({ day, meals, kcal, protein, fat, carbs, waterMl }))
};

/** для ядра: итоги еды по дням (цель, статистика) */
export { foodSeries, topMeals };
