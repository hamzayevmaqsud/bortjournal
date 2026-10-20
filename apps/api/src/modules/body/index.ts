import type { AppModule } from '../../core/module.js';
import { importBody, verifyBody } from './legacy.js';
import { bodyRoutes } from './routes.js';
import { bodyToday, setBodyDay } from './service.js';

export const bodyModule: AppModule = { name: 'body', importLegacy: importBody, verifyLegacy: verifyBody, today: bodyToday, routes: bodyRoutes };

/** для ядра (анкета): записать вес/шаги дня */
export { setBodyDay };
