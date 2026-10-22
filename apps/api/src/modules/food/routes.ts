import type { FastifyInstance } from 'fastify';
import { DRINKS } from '@bortjournal/core';
import { bad, dayParam, guard, hmParam, HttpError, idParam, notFound, uid } from '../../core/http.js';
import type { DB } from '../../db/index.js';
import { addDrink, addMeal, dayFood, deleteEntry, myFoods, updateDrink, updateMeal, type MealInput } from './service.js';
import { aiEnabled, recognizeFood } from './ai.js';
import { answerDraft, createDraft, deleteDraft, getDraft, listDrafts, retryDraft, takeReadyDraft } from './drafts.js';
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
    const draftId = b.draftId === undefined || b.draftId === null ? null : idParam(b.draftId);
    const rows = await db.transaction(async tx => {
      // подтверждение черновика приёма: день и время — как у фото, черновик забирается в той же транзакции
      const from = draftId ? await takeReadyDraft(tx, uid(req), draftId) : null;
      if (draftId && !from) throw new HttpError(404, 'Черновик не найден или ещё не разобран.');
      const list = items.map(it => mealBody({ ...(it as object), day: from?.day ?? b.day, time: from ? from.time : b.time, slot: from?.slot ?? b.slot, source: from ? 'photo' : b.source }));
      const out = []; for (const m of list) out.push(await addMeal(tx, uid(req), m)); return out;
    });
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

  // Pro: фото еды в фоне — черновик приёма, разбирает воркер
  app.post('/drafts', { preHandler: pro, bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    if (!aiEnabled()) return reply.code(503).send({ error: 'Распознавание не настроено: на сервере нет ключа ИИ.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const mime = String(b.mime ?? ''), image = typeof b.image === 'string' ? b.image : '';
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw bad('Нужна картинка JPEG, PNG или WebP.');
    if (image.length < 100 || image.length > 11e6) throw bad('Фото пустое или слишком большое.');
    await takeAi(db, uid(req), 'food');
    const draft = await createDraft(db, uid(req), { day: dayParam(b.day), time: hmParam(b.time), slot: SLOTS.has(String(b.slot)) ? String(b.slot) : null,
      image, mime, note: String(b.note ?? '').trim().slice(0, 300), scale: String(b.scale ?? '').slice(0, 20) });
    return reply.code(201).send(draft);
  });
  app.get('/drafts', { preHandler: pro }, async req => ({ items: await listDrafts(db, uid(req)) }));
  app.get('/drafts/:id', { preHandler: pro }, async (req, reply) => (await getDraft(db, uid(req), idParam((req.params as any).id))) ?? notFound(reply));
  app.post('/drafts/:id/answers', { preHandler: pro }, async (req, reply) => {
    const raw = (req.body as { answers?: unknown } | undefined)?.answers, answers = (Array.isArray(raw) ? raw : []).slice(0, 8).map(a => String(a).slice(0, 200)).filter(Boolean);
    if (!answers.length) throw bad('Нужен хотя бы один ответ.');
    const r = await answerDraft(db, uid(req), idParam((req.params as any).id), answers);
    if (r.ok) return r.draft;
    return r.reason === 'missing' ? notFound(reply) : reply.code(409).send({ error: 'Фото ещё разбирается — ответить можно, когда разбор готов.' });
  });
  app.post('/drafts/:id/retry', { preHandler: pro }, async (req, reply) => {
    const r = await retryDraft(db, uid(req), idParam((req.params as any).id));
    if (r.ok) return r.draft;
    return r.reason === 'missing' ? notFound(reply) : reply.code(409).send({ error: 'Повторить можно только неудавшийся разбор.' });
  });
  app.delete('/drafts/:id', { preHandler: pro }, async (req, reply) => (await deleteDraft(db, uid(req), idParam((req.params as any).id))) ? { ok: true } : notFound(reply));

  app.delete('/entries/:id', { preHandler }, async (req, reply) => {
    if (!(await deleteEntry(db, uid(req), idParam((req.params as any).id)))) return notFound(reply);
    return { ok: true };
  });
}
