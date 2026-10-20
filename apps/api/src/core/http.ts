/** Общие мелочи для маршрутов модулей: проверка входа и доступа, разбор дня и id */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isDay, type ModuleName } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { requireUser } from './auth.js';
import { requireModule } from './entitlements.js';

/** preHandler'ы маршрута модуля: войти + иметь доступ к модулю */
export const guard = (db: DB, module: ModuleName) => [requireUser, requireModule(db, module)];

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const bad = (msg: string) => new HttpError(400, msg);

export const dayParam = (v: unknown) => { if (!isDay(v)) throw bad('Нужна дата в формате ГГГГ-ММ-ДД.'); return v; };
export const idParam = (v: unknown) => { const s = String(v ?? ''); if (!/^[0-9a-f-]{36}$/i.test(s)) throw bad('Неверный id.'); return s; };
export const hmParam = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
export const uid = (req: FastifyRequest) => req.userId!;
export const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'Запись не найдена.' });
