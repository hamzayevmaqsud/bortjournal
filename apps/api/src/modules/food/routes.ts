import type { FastifyInstance } from 'fastify';
import { DRINKS } from '@bortjournal/core';
import { bad, dayParam, guard, hmParam, idParam, notFound, uid } from '../../core/http.js';
import type { DB } from '../../db/index.js';
import { addDrink, dayFood, deleteEntry } from './service.js';

export async function foodRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = guard(db, 'food');
  app.get('/day', { preHandler }, async req => dayFood(db, uid(req), dayParam((req.query as any).day)));
  app.post('/drinks', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ml = Math.round(Number(b.ml)), type = String(b.type ?? 'water');
    if (!(ml > 0 && ml <= 5000)) throw bad('Объём — от 1 до 5000 мл.');
    if (!DRINKS[type] || type === 'custom') throw bad('Неизвестный напиток.');
    return reply.code(201).send(await addDrink(db, uid(req), { day: dayParam(b.day), time: hmParam(b.time), type, ml }));
  });
  app.delete('/entries/:id', { preHandler }, async (req, reply) => {
    if (!(await deleteEntry(db, uid(req), idParam((req.params as any).id)))) return notFound(reply);
    return { ok: true };
  });
}
