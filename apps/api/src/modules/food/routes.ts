import type { FastifyInstance } from 'fastify';
import { DRINKS } from '@bortjournal/core';
import { bad, dayParam, guard, hmParam, idParam, notFound, uid } from '../../core/http.js';
import type { DB } from '../../db/index.js';
import { addDrink, addMeal, dayFood, deleteEntry, myFoods, updateDrink, updateMeal, type MealInput } from './service.js';
import { aiEnabled, recognizeFood } from './ai.js';
import { takeAi } from '../../core/ai-quota.js';
import { requireUser } from '../../core/auth.js';
import { requireFeature } from '../../core/billing.js';
import { searchCatalog } from './catalog.js';
import { foodAnalysis } from './analysis.js';
import { userContext } from '../../core/context.js';

const SLOTS = new Set(['breakfast', 'lunch', 'dinner', 'snack']), SOURCES = new Set(['manual', 'photo', 'text', 'db']);
const n = (v: unknown, hi: number, name: string) => { const x = Number(String(v ?? 0).replace(',', '.')); if (!Number.isFinite(x) || x < 0 || x > hi) throw bad(`${name}: от 0 до ${hi}.`); return Math.round(x * 10) / 10; };
const opt = (v: unknown, hi: number, name: string) => (v === undefined || v === null || v === '' ? null : n(v, hi, name));

function mealBody(b: Record<string, unknown>): MealInput {
  const name = String(b.name ?? '').trim().slice(0, 200);
  if (!name) throw bad('Напиши, что ел.');
  return { day: dayParam(b.day), time: hmParam(b.time), slot: SLOTS.has(String(b.slot)) ? String(b.slot) : null, name,
    kcal: Math.round(n(b.kcal, 10000, 'Калории')), protein: n(b.protein, 1000, 'Белки'), fat: n(b.fat, 1000, 'Жиры'), carbs: n(b.carbs, 2000, 'Углеводы'),
    fiber: opt(b.fiber, 300, 'Клетчатка'), sugar: opt(b.sugar, 1000, 'Сахар'), salt: opt(b.salt, 100, 'Соль'),
    source: SOURCES.has(String(b.source)) ? String(b.source) : 'manual' };
}
function drinkBody(b: Record<string, unknown>) {
  const ml = Math.round(Number(b.ml)), type = String(b.type ?? 'water');
  if (!(ml > 0 && ml <= 5000)) throw bad('Объём — от 1 до 5000 мл.');
  if (!Object.hasOwn(DRINKS, type)) throw bad('Неизвестный напиток.');
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
  // несколько позиций за раз (фото, описание, поиск) — все или ничего
  app.post('/meals/batch', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>, items = Array.isArray(b.items) ? b.items : [];
    if (!items.length || items.length > 20) throw bad('Нужно от 1 до 20 позиций.');
    const list = items.map(it => mealBody({ ...(it as object), day: b.day, time: b.time, slot: b.slot, source: b.source }));
    const rows = await db.transaction(async tx => { const out = []; for (const m of list) out.push(await addMeal(tx, uid(req), m)); return out; });
    return reply.code(201).send({ items: rows });
  });

  // Pro: справочник продуктов + свои блюда
  const pro = [requireUser, requireFeature(db, 'food')];
  app.get('/search', { preHandler: pro }, async req => {
    const q = String((req.query as any).q ?? '').trim().slice(0, 60);
    if (q.length < 2) return { mine: [], catalog: [] };
    return { mine: await myFoods(db, uid(req), q), catalog: searchCatalog(q) };
  });

  // Pro: анализ — календарь питания, нутриенты, баланс БЖУ, время еды, отчёт недели, чем закрыть норму
  app.get('/analysis', { preHandler: pro }, async req => {
    const q = req.query as { day?: string; month?: string }, ctx = await userContext(db, uid(req));
    return foodAnalysis(db, uid(req), ctx, q.day ? dayParam(q.day) : ctx.today, q.month);
  });

  // Pro: еда по фото или описанию
  app.post('/recognize', { preHandler: pro, bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    if (!aiEnabled()) return reply.code(503).send({ error: 'Распознавание не настроено: на сервере нет ключа ИИ.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const mime = String(b.mime ?? ''), image = typeof b.image === 'string' && b.image.length > 0 ? b.image : null, note = String(b.note ?? '').trim().slice(0, 300);
    if (image) {
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw bad('Нужна картинка JPEG, PNG или WebP.');
      if (image.length < 100 || image.length > 11e6) throw bad('Фото пустое или слишком большое.');
    } else if (note.length < 2) throw bad('Опиши, что съел, или добавь фото.');
    await takeAi(db, uid(req), 'food');
    return recognizeFood({ image, mime, note, scale: String(b.scale ?? ''), answers: (Array.isArray(b.answers) ? b.answers : []).slice(0, 8).map(a => String(a).slice(0, 200)) });
  });

  app.delete('/entries/:id', { preHandler }, async (req, reply) => {
    if (!(await deleteEntry(db, uid(req), idParam((req.params as any).id)))) return notFound(reply);
    return { ok: true };
  });
}
