import type { AppModule } from '../../core/module.js';
import { habitsRoutes } from './routes.js';
import { habitDays } from './service.js';

/** Свои привычки: бесплатно всем; отмеченная привычка — активный день для общей серии */
export const habitsModule: AppModule = { name: 'habits', routes: habitsRoutes, activeDays: habitDays };
