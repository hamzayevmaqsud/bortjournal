import type { AppModule } from '../../core/module.js';
import { importBody, verifyBody } from './legacy.js';
import { bodyRoutes } from './routes.js';
import { bodySeries, bodyToday, setBodyDay } from './service.js';

export const bodyModule: AppModule = { name: 'body', importLegacy: importBody, verifyLegacy: verifyBody, today: bodyToday, routes: bodyRoutes };

/** для ядра: записать вес/шаги дня (анкета), ряд по дням (цель, статистика) */
export { bodySeries, setBodyDay };
