import type { AppModule } from '../../core/module.js';
import { importGym, verifyGym } from './legacy.js';
import { gymRoutes } from './routes.js';
import { gymDaily, gymRemind, gymToday } from './service.js';

export const gymModule: AppModule = { name: 'gym', remind: gymRemind, importLegacy: importGym, verifyLegacy: verifyGym, today: gymToday, daily: gymDaily, routes: gymRoutes };
