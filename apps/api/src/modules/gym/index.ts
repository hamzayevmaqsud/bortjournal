import type { AppModule } from '../../core/module.js';
import { importGym, verifyGym } from './legacy.js';

export const gymModule: AppModule = { name: 'gym', importLegacy: importGym, verifyLegacy: verifyGym };
