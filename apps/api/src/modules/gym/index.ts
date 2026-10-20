import type { AppModule } from '../../core/module.js';
import { importGym, verifyGym } from './legacy.js';
import { gymRoutes } from './routes.js';
import { gymDaily, gymToday } from './service.js';

export const gymModule: AppModule = { name: 'gym', importLegacy: importGym, verifyLegacy: verifyGym, today: gymToday, daily: gymDaily, routes: gymRoutes };
