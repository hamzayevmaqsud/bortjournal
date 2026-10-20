import type { AppModule } from '../../core/module.js';
import { importStudy, verifyStudy } from './legacy.js';
import { studyRoutes } from './routes.js';
import { studyDaily, studyToday } from './service.js';

export const studyModule: AppModule = { name: 'study', importLegacy: importStudy, verifyLegacy: verifyStudy, today: studyToday, daily: studyDaily, routes: studyRoutes };
