import type { AppModule } from '../../core/module.js';
import { importStudy, verifyStudy } from './legacy.js';
import { studyRoutes } from './routes.js';
import { studyDaily, studyRemind, studyToday } from './service.js';

export const studyModule: AppModule = { name: 'study', remind: studyRemind, importLegacy: importStudy, verifyLegacy: verifyStudy, today: studyToday, daily: studyDaily, routes: studyRoutes };
