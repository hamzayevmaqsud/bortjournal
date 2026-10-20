import type { AppModule } from '../../core/module.js';
import { importFood, verifyFood } from './legacy.js';
import { foodRoutes } from './routes.js';
import { foodSeries, foodToday } from './service.js';

export const foodModule: AppModule = { name: 'food', importLegacy: importFood, verifyLegacy: verifyFood, routes: foodRoutes, today: foodToday };

/** для ядра: итоги еды по дням (цель, статистика) */
export { foodSeries };
