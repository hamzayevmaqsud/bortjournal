import type { FastifyInstance } from 'fastify';
import { DRINKS } from '@bortjournal/core';
import { bad, dayParam, guard, hmParam, idParam, notFound, uid } from '../../core/http.js';
import type { DB } from '../../db/index.js';
import { addDrink, addMeal, dayFood, deleteEntry, myFoods, updateDrink, updateMeal, type MealInput } from './service.js';

const SLOTS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const n = (v: unknown, hi: number, name: string) => { const x = Number(String(v ?? 0).replace(',', '.')); if (!Number.isFinite(x) || x < 0 || x > hi) throw bad(`${name}: от 0 до ${hi}.`); return Math.round(x * 10) / 10; };
const opt = (v: unknown, hi: number, name: string) => (v === undefined || v === null || v === '' ? null : n(v, hi, name));

function mealBody(b: Record<string, unknown>): MealInput {
  const name = String(b.name ?? '').trim().slice(0, 200);
  if (!name) throw bad('Напиши, что ел.');
  return { day: dayParam(b.day), time: hmParam(b.time), slot: SLOTS.has(String(b.slot)) ? String(b.slot) : null, name,
    kcal: Math.round(n(b.kcal, 10000, 'Калории')), protein: n(b.protein, 1000, 'Белки'), fat: n(b.fat, 1000, 'Жиры'), carbs: n(b.carbs, 2000, 'Углеводы'),
    fiber: opt(b.fiber, 300, 'Клетчатка'), sugar: opt(b.sugar, 1000, 'Сахар'), salt: opt(b.salt, 100, 'Соль') };
}
function drinkBody(b: Record<string, unknown>) {
  const ml = Math.round(Number(b.ml)), type = String(b.type ?? 'water');
  if (!(ml > 0 && ml <= 5000)) throw bad('Объём — от 1 до 5000 мл.');
  if (!DRINKS[type]) throw bad('Неизвестный напиток.');
  const custom = type === 'custom';
  return { day: dayParam(b.day), time: hmParam(b.time), type, ml, name: custom ? String(b.name ?? '').trim().slice(0, 60) || 'Напиток' : null,
    kcalPer100: custom ? n(b.kcalPer100, 1000, 'Калории на 100 мл') : null, sugarPer100: custom ? n(b.sugarPer100, 100, 'Сахар на 100 мл') : null };
}

export async function foodRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = guard(db, 'base');
  app.get('/day', { preHandler }, async req => dayFood(db, uid(req), dayParam((req.query as any).day)));
  app.get('/mine', { preHandler }, async req => ({ items: await myFoods(db, uid(req), String((req.query as any).q ?? '').trim().slice(0, 60)) }));
  app.post('/meals', { preHandler }, async (req, reply) => reply.code(201).send(await addMeal(db, uid(req), mealBody((req.body ?? {}) as any))));
  app.put('/meals/:id', { preHandler }, async (req, reply) => (await updateMeal(db, uid(req), idParam((req.params as any).id), mealBody((req.body ?? {}) as any))) ?? notFound(reply));
  app.post('/drinks', { preHandler }, async (req, reply) => reply.code(201).send(await addDrink(db, uid(req), drinkBody((req.body ?? {}) as any))));
  app.put('/drinks/:id', { preHandler }, async (req, reply) => (await updateDrink(db, uid(req), idParam((req.params as any).id), drinkBody((req.body ?? {}) as any))) ?? notFound(reply));
  app.delete('/entries/:id', { preHandler }, async (req, reply) => {
    if (!(await deleteEntry(db, uid(req), idParam((req.params as any).id)))) return notFound(reply);
    return { ok: true };
  });
}
