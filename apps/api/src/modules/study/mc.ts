/**
 * Вопросы с вариантами ответа — только по конспектам, для которых их попросили (materials.quiz).
 * Составляет ИИ по кускам текста в фоне; прогресс — quizDone из quizTotal. Повторение — тот же интервальный
 * алгоритм (study_srs, ключ «q:<id>»): верно — интервал растёт, неверно — вопрос вернётся завтра.
 * В день: всё, что пора повторить, и до 10 новых вопросов (кнопка «ещё» добавляет новые).
 */
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AI, aiEnabled, gemini } from '../../core/gemini.js';
import type { DB, Tx } from '../../db/index.js';
import { grade, hash, rng, shuffle, type SrsState } from './cards.js';
import { chunksOf } from './extract.js';
import { answers, materials, questions, srsCards } from './schema.js';

export const NEW_PER_DAY = 10;
const Q_SCHEMA = { type: 'OBJECT', properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  q: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } }, correct: { type: 'INTEGER' }, explain: { type: 'STRING' } }, required: ['q', 'options', 'correct', 'explain'] } } }, required: ['questions'] };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const keyOf = (id: string) => `q:${id}`;

/** проверка вопроса от ИИ: 4 разных непустых варианта, номер верного в пределах */
export function cleanQuestion(x: any): { q: string; options: string[]; correct: number; explain: string | null } | null {
  const q = String(x?.q ?? '').trim().slice(0, 500), options = (Array.isArray(x?.options) ? x.options : []).map((o: unknown) => String(o ?? '').trim().slice(0, 300));
  const correct = Number(x?.correct);
  if (q.length < 8 || options.length !== 4 || options.some((o: string) => !o) || new Set(options.map((o: string) => o.toLowerCase())).size !== 4) return null;
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) return null;
  if (options.some((o: string) => /^(все|ни один|никакой)( из)? (вариант|ответ)/i.test(o))) return null;
  return { q, options, correct, explain: String(x?.explain ?? '').trim().slice(0, 500) || null };
}

const running = new Set<string>();
/** составить вопросы по конспекту (в фоне; продолжает с того куска, где остановился) */
export function startQuestions(db: DB, materialId: string, log: (m: string) => void = () => {}) {
  if (running.has(materialId)) return;
  running.add(materialId);
  void generate(db, materialId).catch(e => log(`вопросы ${materialId}: ${(e as Error).message}`)).finally(() => running.delete(materialId));
}
export const isRunning = (id: string) => running.has(id);

async function generate(db: DB, materialId: string) {
  const [m] = await db.select().from(materials).where(eq(materials.id, materialId));
  if (!m) return;
  if (!aiEnabled()) { await db.update(materials).set({ quizStatus: 'error', quizError: 'На сервере нет ключа ИИ — вопросы составить не получится.' }).where(eq(materials.id, materialId)); return; }
  const parts = chunksOf(m.text);
  if (!parts.length) { await db.update(materials).set({ quizStatus: 'error', quizError: 'В конспекте слишком мало текста для вопросов.' }).where(eq(materials.id, materialId)); return; }
  await db.update(materials).set({ quizStatus: 'working', quizError: null, quizTotal: parts.length, updatedAt: new Date() }).where(eq(materials.id, materialId));
  for (let i = m.quizDone; i < parts.length; i++) {
    const part = parts[i]!, n = Math.max(2, Math.min(8, Math.round(part.length / 800)));
    const prompt = `Составь ${n} вопросов для повторения с 4 вариантами ответа по фрагменту учебного конспекта.
Правила:
- вопросы только по содержанию фрагмента и проверяют понимание сути (понятия, причины, отличия, применение), а не мелкие формулировки или номера страниц;
- ровно один верный вариант; неверные — правдоподобные, той же длины и стиля, без «все/ни один из вариантов»;
- язык — как у конспекта (обычно русский); варианты без букв и номеров в начале;
- correct — номер верного варианта от 0 до 3; explain — одно короткое предложение, почему верный ответ верен.
Материал: ${m.title}
Фрагмент ${i + 1} из ${parts.length}:
${part}`;
    let out: any = null;
    for (let attempt = 0; attempt < 4 && !out; attempt++) {
      try { out = await gemini([{ text: prompt }], Q_SCHEMA, AI.quiz); }
      catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 429 && attempt < 3) { await wait(30e3 * (attempt + 1)); continue; }
        await db.update(materials).set({ quizStatus: 'error', quizError: (e as Error).message.slice(0, 300), updatedAt: new Date() }).where(eq(materials.id, materialId));
        return;
      }
    }
    const qs = (Array.isArray(out?.questions) ? out.questions : []).map(cleanQuestion).filter(Boolean).slice(0, 10) as Array<NonNullable<ReturnType<typeof cleanQuestion>>>;
    await db.transaction(async tx => {
      // конспект могли удалить или перезапустить, пока ИИ думал
      const [still] = await tx.select({ id: materials.id }).from(materials).where(eq(materials.id, materialId));
      if (!still) return;
      if (qs.length) await tx.insert(questions).values(qs.map(q => ({ userId: m.userId, materialId, chunk: i, ...q })));
      await tx.update(materials).set({ quizDone: i + 1, updatedAt: new Date() }).where(eq(materials.id, materialId));
    });
  }
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(questions).where(eq(questions.materialId, materialId));
  await db.update(materials).set(c?.n ? { quizStatus: 'ready', quizError: null } : { quizStatus: 'error', quizError: 'ИИ не смог составить вопросы по этому тексту.' }).where(eq(materials.id, materialId));
}

/* ---------- вопросы дня ---------- */
interface Q { id: string; materialId: string; chunk: number; q: string; options: string[]; correct: number; explain: string | null; createdAt: Date }
async function state(db: Tx, userId: string, today: string) {
  const mats = await db.select({ id: materials.id, title: materials.title, createdAt: materials.createdAt }).from(materials).where(and(eq(materials.userId, userId), eq(materials.quiz, true), isNull(materials.archivedAt)));
  const ids = mats.map(m => m.id);
  const qs: Q[] = ids.length ? await db.select().from(questions).where(inArray(questions.materialId, ids)).orderBy(asc(questions.chunk), asc(questions.createdAt)) : [];
  const srs = new Map<string, SrsState>((await db.select().from(srsCards).where(and(eq(srsCards.userId, userId), sql`${srsCards.cardKey} like 'q:%'`))).map(r => [r.cardKey, { interval: r.intervalDays, ease: r.ease, reps: r.reps, due: r.dueOn, last: r.lastOn }]));
  const first = new Map((await db.select({ q: answers.questionId, d: sql<string>`min(${answers.day})::text` }).from(answers).where(eq(answers.userId, userId)).groupBy(answers.questionId)).filter(r => r.q).map(r => [r.q!, r.d]));
  const todayRows = await db.select().from(answers).where(and(eq(answers.userId, userId), eq(answers.day, today)));
  return { mats, qs, srs, first, todayRows };
}
/** очередь на сегодня: пора повторить + новые (до 10 + extra за день) */
export async function queueOf(db: Tx, userId: string, today: string, extra = 0) {
  const s = await state(db, userId, today), doneToday = new Set(s.todayRows.map(a => a.questionId));
  const order = new Map(s.mats.map(m => [m.id, m.createdAt.getTime()]));
  const due = s.qs.filter(q => { const st = s.srs.get(keyOf(q.id)); return st && st.due <= today && !doneToday.has(q.id); })
    .sort((a, b) => s.srs.get(keyOf(a.id))!.due.localeCompare(s.srs.get(keyOf(b.id))!.due));
  const fresh = s.qs.filter(q => !s.srs.has(keyOf(q.id)) && !s.first.has(q.id)).sort((a, b) => order.get(a.materialId)! - order.get(b.materialId)! || a.chunk - b.chunk);
  const newToday = [...s.first.values()].filter(d => d === today).length;
  const allow = Math.max(0, NEW_PER_DAY + extra - newToday);
  const later = s.qs.map(q => s.srs.get(keyOf(q.id))?.due).filter((d): d is string => !!d && d > today).sort()[0] ?? null;
  return { ...s, queue: [...due, ...fresh.slice(0, allow)], due: due.length, freshLeft: Math.max(0, fresh.length - allow), next: later };
}
/** вопрос для экрана: варианты перемешаны (одинаково весь день), верный не раскрываем */
export const present = (q: Q, title: string, today: string) => ({ id: q.id, q: q.q, material: title, options: shuffle(q.options.map((text, i) => ({ i, text })), rng(hash(q.id + today))) });

export async function answer(db: DB, userId: string, today: string, id: string, choice: number) {
  const [q] = await db.select().from(questions).where(and(eq(questions.id, id), eq(questions.userId, userId)));
  if (!q) return null;
  const correct = choice === q.correct;
  // на вопрос отвечают один раз в день: повтор (двойной тап, повторная отправка) не двигает интервал и не считается
  const [already] = await db.select({ c: answers.correct }).from(answers).where(and(eq(answers.userId, userId), eq(answers.questionId, id), eq(answers.day, today)));
  if (already) { const [st] = await db.select({ due: srsCards.dueOn }).from(srsCards).where(and(eq(srsCards.userId, userId), eq(srsCards.cardKey, keyOf(id)))); return { correct: already.c, correctIndex: q.correct, explain: q.explain, next: st?.due ?? today, repeat: true }; }
  const [r] = await db.select().from(srsCards).where(and(eq(srsCards.userId, userId), eq(srsCards.cardKey, keyOf(id))));
  const st = grade(r ? { interval: r.intervalDays, ease: r.ease, reps: r.reps, due: r.dueOn } : { interval: 0, ease: 2.5, reps: 0, due: today }, correct ? 'good' : 'again', today);
  await db.transaction(async tx => {
    await tx.insert(answers).values({ userId, questionId: id, day: today, correct });
    await tx.insert(srsCards).values({ userId, cardKey: keyOf(id), intervalDays: st.interval, ease: st.ease, reps: st.reps, dueOn: st.due, lastOn: today })
      .onConflictDoUpdate({ target: [srsCards.userId, srsCards.cardKey], set: { intervalDays: st.interval, ease: st.ease, reps: st.reps, dueOn: st.due, lastOn: today } });
  });
  return { correct, correctIndex: q.correct, explain: q.explain, next: st.due };
}
/** ответы по дням: всего и верно */
export async function answersByDay(db: Tx, userId: string, from: string, to: string) {
  return db.select({ day: answers.day, n: sql<number>`count(*)::int`, good: sql<number>`count(*) filter (where ${answers.correct})::int` }).from(answers)
    .where(and(eq(answers.userId, userId), gte(answers.day, from), lte(answers.day, to))).groupBy(answers.day);
}
export const removeSrsOf = (db: Tx, userId: string, ids: string[]) => ids.length ? db.delete(srsCards).where(and(eq(srsCards.userId, userId), inArray(srsCards.cardKey, ids.map(keyOf)))) : Promise.resolve();
