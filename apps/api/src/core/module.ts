/**
 * Контракт модуля. Модули общаются с остальным кодом только через свой index.ts,
 * который экспортирует объект AppModule. Внутренности модуля (schema, service, legacy)
 * снаружи не импортируются — это проверяет test/boundaries.test.ts.
 */
import type { FastifyInstance } from 'fastify';
import type { ModuleName } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';

/** Состояние пользователя в старом журнале (data/state/<user>.json → state). Поля необязательны и не проверены */
export type LegacyState = Record<string, any>;

export interface ImportContext {
  db: Tx;
  userId: string;
  /** записывает расхождение, не прерывая перенос */
  warn(msg: string): void;
}

/** Для проверки переноса: сколько было в старом журнале и сколько легло в базу */
export interface ImportCheck { name: string; source: number; db: number }

export interface AppModule {
  name: ModuleName;
  importLegacy?(ctx: ImportContext, state: LegacyState): Promise<void>;
  /** сверка после переноса — считает и источник, и базу */
  verifyLegacy?(ctx: ImportContext, state: LegacyState): Promise<ImportCheck[]>;
  routes?(app: FastifyInstance, deps: { db: DB }): Promise<void> | void;
}
