/** Общие мелочи для маршрутов модулей: проверка входа и доступа, разбор дня и id */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isDay } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { requireUser } from './auth.js';
import { requirePro } from './billing.js';

/** preHandler'ы маршрута: base — достаточно войти (бесплатный тариф), pro — нужен Pro */
export const guard = (db: DB, tier: 'base' | 'pro') => tier === 'pro' ? [requireUser, requirePro(db)] : [requireUser];

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const bad = (msg: string) => new HttpError(400, msg);

export const dayParam = (v: unknown) => { if (!isDay(v)) throw bad('Нужна дата в формате ГГГГ-ММ-ДД.'); return v; };
export const idParam = (v: unknown) => { const s = String(v ?? ''); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw bad('Неверный id.'); return s; };
export const hmParam = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
export const uid = (req: FastifyRequest) => req.userId!;
export const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'Запись не найдена.' });

/** период статистики: 7, 30, 90 или 365 дней */
export const statDays = (v: unknown) => { const x = Number(v ?? 30); if (![7, 30, 90, 365].includes(x)) throw bad('Период: 7, 30, 90 или 365 дней.'); return x; };
