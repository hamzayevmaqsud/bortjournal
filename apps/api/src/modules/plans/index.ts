import type { AppModule } from '../../core/module.js';
import { importPlans, verifyPlans } from './legacy.js';
import { plansDaily, plansRoutes, plansToday, plansTotals } from './service.js';

export const plansModule: AppModule = { name: 'plans', importLegacy: importPlans, verifyLegacy: verifyPlans, routes: plansRoutes, today: plansToday, daily: plansDaily, totals: plansTotals };
