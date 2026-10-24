/** Реестр модулей. Снаружи модули доступны только отсюда */
import type { AppModule } from '../core/module.js';
import { bodyModule } from './body/index.js';
import { booksModule } from './books/index.js';
import { budgetModule } from './budget/index.js';
import { foodModule } from './food/index.js';
import { gymModule } from './gym/index.js';
import { habitsModule } from './habits/index.js';
import { plansModule } from './plans/index.js';
import { studyModule } from './study/index.js';

export const MODULES_LIST: AppModule[] = [foodModule, gymModule, studyModule, budgetModule, booksModule, plansModule, bodyModule, habitsModule];
