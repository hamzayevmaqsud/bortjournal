import type { AppModule } from '../../core/module.js';
import { importPlans, verifyPlans } from './legacy.js';
import { plansCalendar, plansDaily, plansRemind, plansRoutes, plansToday, plansTotals } from './service.js';

export const plansModule: AppModule = { name: 'plans', remind: plansRemind, importLegacy: importPlans, verifyLegacy: verifyPlans, routes: plansRoutes, today: plansToday, daily: plansDaily, totals: plansTotals, calendarItems: plansCalendar };
