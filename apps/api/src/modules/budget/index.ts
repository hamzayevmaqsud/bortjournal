import type { AppModule } from '../../core/module.js';
import { importBudget, verifyBudget } from './legacy.js';

export const budgetModule: AppModule = { name: 'budget', importLegacy: importBudget, verifyLegacy: verifyBudget };
