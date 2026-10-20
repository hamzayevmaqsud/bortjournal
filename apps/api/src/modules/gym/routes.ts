import type { FastifyInstance } from 'fastify';
import { GYM_GROUPS, KIND_NAMES } from '@bortjournal/core';
import { requireUser } from '../../core/auth.js';
import { requireFeature } from '../../core/billing.js';
import { userContext } from '../../core/context.js';
import { bad, dayParam, hmParam, idParam, notFound, uid } from '../../core/http.js';
import type { DB } from '../../db/index.js';
import { addExercise, deletePlan, deleteWorkout, dropLive, exerciseInfo, getLive, gymOverview, hints, putLive, savePlan, saveWorkout, workoutBody } from './workouts.js';

export async function gymRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = [requireUser, requireFeature(db, 'gym')];
  app.get('/overview', { preHandler }, async req => gymOverview(db, uid(req), (await userContext(db, uid(req))).today));
  app.get('/exercise/:key', { preHandler }, async (req, reply) => (await exerciseInfo(db, uid(req), String((req.params as any).key).slice(0, 120))) ?? notFound(reply));
  app.get('/hints', { preHandler }, async req => {
    const q = req.query as { keys?: string; skip?: string };
    return hints(db, uid(req), String(q.keys ?? '').split(',').filter(Boolean).slice(0, 40), q.skip && /^[0-9a-f-]{36}$/.test(q.skip) ? q.skip : undefined);
  });

  app.post('/workouts', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const r = await db.transaction(async tx => { const out = await saveWorkout(tx, uid(req), workoutBody(b, dayParam(b.day), hmParam)); if (b.fromLive) await dropLive(tx, uid(req)); return out; });
    return reply.code(201).send(r);
  });
  app.put('/workouts/:id', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const r = await db.transaction(async tx => { const out = await saveWorkout(tx, uid(req), workoutBody(b, dayParam(b.day), hmParam), idParam((req.params as any).id)); if (out && b.fromLive) await dropLive(tx, uid(req)); return out; });
    return r ?? notFound(reply);
  });
  app.delete('/workouts/:id', { preHandler }, async (req, reply) => (await deleteWorkout(db, uid(req), idParam((req.params as any).id))) ? { ok: true } : notFound(reply));

  // идущая тренировка — черновик в базе: начал на телефоне, видно на компьютере
  app.get('/live', { preHandler }, async req => ({ live: (await getLive(db, uid(req)))?.data ?? null }));
  app.put('/live', { preHandler, bodyLimit: 256 * 1024 }, async req => { await putLive(db, uid(req), (req.body as any)?.live ?? null); return { ok: true }; });
  app.delete('/live', { preHandler }, async req => { await dropLive(db, uid(req)); return { ok: true }; });

  const planBody = (b: any) => {
    const name = String(b?.name ?? '').trim().slice(0, 40); if (!name) throw bad('Назови план.');
    const weekdays = (Array.isArray(b?.weekdays) ? b.weekdays : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6);
    const exercises = (Array.isArray(b?.exercises) ? b.exercises : []).slice(0, 30).map((e: any) => ({ exerciseKey: typeof e?.key === 'string' && !e.key.startsWith('n:') ? e.key.slice(0, 80) : null, name: String(e?.name ?? '').slice(0, 80), sets: Math.max(1, Math.min(12, Math.round(Number(e?.sets) || 3))) })).filter((e: any) => e.name);
    if (!exercises.length) throw bad('В плане нужно хотя бы одно упражнение.');
    return { name, weekdays: [...new Set<number>(weekdays)], time: hmParam(b?.time), exercises };
  };
  app.post('/plans', { preHandler }, async (req, reply) => reply.code(201).send(await savePlan(db, uid(req), planBody(req.body))));
  app.put('/plans/:id', { preHandler }, async (req, reply) => (await savePlan(db, uid(req), planBody(req.body), idParam((req.params as any).id))) ?? notFound(reply));
  app.delete('/plans/:id', { preHandler }, async (req, reply) => (await deletePlan(db, uid(req), idParam((req.params as any).id))) ? { ok: true } : notFound(reply));

  app.post('/exercises', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>, name = String(b.name ?? '').trim().slice(0, 60);
    if (!name) throw bad('Назови упражнение.');
    const group = String(b.group) in GYM_GROUPS ? String(b.group) : 'full', kind = (String(b.kind) in KIND_NAMES ? String(b.kind) : 'w') as 'w' | 'bw' | 't' | 'c';
    return reply.code(201).send(await addExercise(db, uid(req), { name, group, kind, icon: String(b.icon ?? 'dumbbell').slice(0, 30), equip: b.equip ? String(b.equip).slice(0, 20) : null }));
  });
}
