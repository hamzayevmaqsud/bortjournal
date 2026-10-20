import type { AppModule } from '../../core/module.js';
import { importBooks, verifyBooks } from './legacy.js';
import { booksToday } from './service.js';

export const booksModule: AppModule = { name: 'books', importLegacy: importBooks, verifyLegacy: verifyBooks, today: booksToday };
