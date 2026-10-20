import type { AppModule } from '../../core/module.js';
import { importBudget, verifyBudget } from './legacy.js';
import { budgetDaily, budgetToday } from './service.js';

export const budgetModule: AppModule = { name: 'budget', importLegacy: importBudget, verifyLegacy: verifyBudget, today: budgetToday, daily: budgetDaily };
