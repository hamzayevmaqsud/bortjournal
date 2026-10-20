import type { AppModule } from '../../core/module.js';
import { importStudy, verifyStudy } from './legacy.js';

export const studyModule: AppModule = { name: 'study', importLegacy: importStudy, verifyLegacy: verifyStudy };
