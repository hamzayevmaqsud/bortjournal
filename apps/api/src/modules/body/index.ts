import type { AppModule } from '../../core/module.js';
import { importBody, verifyBody } from './legacy.js';

export const bodyModule: AppModule = { name: 'body', importLegacy: importBody, verifyLegacy: verifyBody };
