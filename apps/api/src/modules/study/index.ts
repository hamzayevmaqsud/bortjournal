import type { AppModule } from '../../core/module.js';
import { importStudy, verifyStudy } from './legacy.js';
import { studyToday } from './service.js';

export const studyModule: AppModule = { name: 'study', importLegacy: importStudy, verifyLegacy: verifyStudy, today: studyToday };
