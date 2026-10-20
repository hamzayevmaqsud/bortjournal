import type { AppModule } from '../../core/module.js';
import { importFood, verifyFood } from './legacy.js';

export const foodModule: AppModule = { name: 'food', importLegacy: importFood, verifyLegacy: verifyFood };
