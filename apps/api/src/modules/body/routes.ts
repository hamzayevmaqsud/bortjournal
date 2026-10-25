import { and, asc, eq, gte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays } from '@bortjournal/core';
import { bad, dayParam, guard, uid } from '../../core/http.js';
import { syncNorms } from '../../core/goal.js';
import type { DB } from '../../db/index.js';
import { bodyDays } from './schema.js';
import { setBodyDay } from './service.js';

export async function bodyRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = guard(db, 'base');
  // вес и/или шаги за день; пустое значение — стереть
  app.put('/day', { preHandler }, async req => {
    const b = (req.body ?? {}) as Record<string, unknown>, day = dayParam(b.day);
    const v: { weightKg?: number | null; steps?: number | null } = {};
    if ('weightKg' in b) { const w = b.weightKg === null || b.weightKg === '' ? null : Number(String(b.weightKg).replace(',', '.')); if (w !== null && !(w >= 20 && w <= 400)) throw bad('Вес — от 20 до 400 кг.'); v.weightKg = w === null ? null : Math.round(w * 10) / 10; }
    if ('steps' in b) { const s = b.steps === null || b.steps === '' ? null : Math.round(Number(b.steps)); if (s !== null && !(s >= 0 && s <= 200000)) throw bad('Шаги — от 0 до 200 000.'); v.steps = s; }
    await setBodyDay(db, uid(req), day, v);
    // вес и шаги меняют план — нормы дня пересчитываются здесь, а не при открытии «Цели»
    const recalculated = await syncNorms(db, uid(req));
    return { ok: true, recalculated };
  });
  app.get('/history', { preHandler }, async req => {
    const q = req.query as { to?: string; days?: string }, to = dayParam(q.to), days = Math.min(400, Math.max(7, Number(q.days) || 30));
    const rows = await db.select({ day: bodyDays.day, weightKg: bodyDays.weightKg, steps: bodyDays.steps }).from(bodyDays)
      .where(and(eq(bodyDays.userId, uid(req)), gte(bodyDays.day, addDays(to, -days + 1)))).orderBy(asc(bodyDays.day));
    return { items: rows.filter(r => r.day <= to) };
  });
}
