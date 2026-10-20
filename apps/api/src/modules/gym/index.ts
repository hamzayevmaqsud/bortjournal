import type { AppModule } from '../../core/module.js';
import { importGym, verifyGym } from './legacy.js';
import { gymToday } from './service.js';

export const gymModule: AppModule = { name: 'gym', importLegacy: importGym, verifyLegacy: verifyGym, today: gymToday };
