import type { AppModule } from '../../core/module.js';
import { importPlans, verifyPlans } from './legacy.js';

export const plansModule: AppModule = { name: 'plans', importLegacy: importPlans, verifyLegacy: verifyPlans };
