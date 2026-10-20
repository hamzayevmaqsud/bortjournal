/**
 * Учёба и вопросы (раздел Pro): дневник занятий (свои записи и правки конспектов Obsidian), минуты, порция вопросов дня
 * с интервальным повторением, проверка ответа ИИ, конспекты Obsidian (поиск, чтение, шпаргалки, пересборка вопросов).
 */
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays } from '@bortjournal/core';
import { requireUser } from '../../core/auth.js';
import { requireFeature } from '../../core/billing.js';
import { userContext } from '../../core/context.js';
import { recordEvent, removeEvents } from '../../core/events.js';
import { aiEnabled, gemini } from '../../core/gemini.js';
import { bad, dayParam, hmParam, idParam, notFound, uid } from '../../core/http.js';
import { users } from '../../core/schema.js';
import type { DB, Tx } from '../../db/index.js';
import { allCards, buildQuiz, dueCards, grade, hash, itemOf, QUIZ_SIZE, rng, shuffle, soonest, stateOf, type QuizItem, type Session, type SrsState } from './cards.js';
import { obsFor } from './obsidian.js';
import { quizzes, srsCards, studySessions, studyTime } from './schema.js';

const lines = (t: unknown) => String(t ?? '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 60).map(x => x.slice(0, 500));
const qaOf = (t: unknown) => lines(t).map(l => { const m = l.split(/\s*(?:=>|->|—>|::)\s*/); return m.length >= 2 ? { q: m[0]!, a: m.slice(1).join(' ') } : null; }).filter(Boolean) as Array<{ q: string; a: string }>;
const CHECK_SCHEMA = { type: 'OBJECT', properties: { score: { type: 'NUMBER' }, verdict: { type: 'STRING', enum: ['good', 'hard', 'again'] }, feedback: { type: 'STRING' }, missing: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['score', 'verdict', 'feedback', 'missing'] };

async function username(db: Tx, userId: string) { const [u] = await db.select({ n: users.username }).from(users).where(eq(users.id, userId)); return u?.n ?? ''; }
async function world(db: Tx, userId: string) {
  const ss = await db.select().from(studySessions).where(eq(studySessions.userId, userId)).orderBy(desc(studySessions.day), desc(studySessions.time));
  const sessions: Session[] = ss.map(s => ({ id: s.legacyId ?? s.id, day: s.day, topic: s.topic, category: s.category, theses: s.theses, qa: s.qa }));
  const obs = obsFor(await username(db, userId)), state = obs ? obs.publicState() : null;
  const srs = new Map<string, SrsState>((await db.select().from(srsCards).where(eq(srsCards.userId, userId))).map(r => [r.cardKey, { interval: r.intervalDays, ease: r.ease, reps: r.reps, due: r.dueOn, last: r.lastOn }]));
  return { ss, sessions, obs, state, srs, cards: allCards(sessions, state?.notes ?? []) };
}
const saveQuiz = (db: Tx, userId: string, day: string, items: QuizItem[], source = 'local') =>
  db.insert(quizzes).values({ userId, day, items, source }).onConflictDoUpdate({ target: [quizzes.userId, quizzes.day], set: { items, source } });
const sessionEvent = (userId: string, s: typeof studySessions.$inferSelect) => ({ userId, module: 'study' as const, kind: 'session', refId: s.id, day: s.day, time: s.time, title: s.topic, value: s.minutes || null, unit: 'min' });

export async function studyRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const preHandler = [requireUser, requireFeature(db, 'study')];
  const ctx = async (userId: string) => userContext(db, userId);

  app.get('/overview', { preHandler }, async req => {
    const userId = uid(req), { today, norms } = await ctx(userId), w = await world(db, userId);
    const times = await db.select().from(studyTime).where(eq(studyTime.userId, userId));
    const timeBy = new Map(times.map(t => [t.key, t]));
    const minOn = (d: string) => w.ss.filter(s => s.day === d).reduce((a, s) => a + s.minutes, 0) + times.filter(t => t.day === d).reduce((a, t) => a + t.minutes, 0);
    const d30 = Array.from({ length: 30 }, (_, k) => addDays(today, k - 29));
    const diary = [
      ...(w.state?.diary ?? []).map((e: any) => ({ src: 'obs', id: e.id, day: e.date, at: e.at, title: e.title, kind: e.kind, added: e.added, changed: e.changed, noteId: e.noteId, link: w.state.notes.find((n: any) => n.id === e.noteId)?.link ?? null, minutes: timeBy.get(e.id)?.minutes ?? null })),
      ...w.ss.map(s => ({ src: 'manual', id: s.id, day: s.day, at: s.time, title: s.topic, category: s.category, minutes: s.minutes, time: s.time, theses: s.theses, qa: s.qa }))
    ].sort((a: any, b: any) => b.day.localeCompare(a.day) || String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 120);
    const notes = (w.state?.notes ?? []).map((n: any) => {
      const secs = n.sections.filter((s: any) => !s.skip);
      return { id: n.id, rel: n.rel, title: n.title, tags: n.tags, date: n.date, link: n.link, cheat: !!n.cheat, tasks: (n.tasks ?? []).filter((t: any) => !t.done).map((t: any) => t.text),
        sections: secs.map((s: any) => ({ key: s.key, h: s.h, questions: s.questions === null ? null : s.questions.length, error: s.qError ?? null })),
        questions: secs.reduce((a: number, s: any) => a + (s.questions?.length ?? 0), 0), due: w.cards.filter(c => c.noteId === n.id && stateOf(c, w.srs).due <= today).length };
    });
    const allMin = w.ss.reduce((a, s) => a + s.minutes, 0) + times.reduce((a, t) => a + t.minutes, 0);
    return {
      today, goal: norms.study, obs: w.state ? { enabled: true, vault: w.state.vaultName, folder: w.state.folder, lastSync: w.state.lastSync, error: w.state.error, queue: w.state.queue, ai: aiEnabled() } : { enabled: false },
      kpi: { notes: notes.length, sections: notes.reduce((a: number, n: any) => a + n.sections.length, 0), questions: notes.reduce((a: number, n: any) => a + n.questions, 0) + w.cards.filter(c => c.type !== 'obs').length, due: dueCards(w.cards, w.srs, today).length, week: d30.slice(-7).reduce((a, d) => a + minOn(d), 0), all: allMin, sessions: w.ss.length },
      days: d30.map(d => ({ day: d, minutes: minOn(d) })), diary, notes, categories: [...new Set([...w.ss.map(s => s.category).filter(Boolean), 'C#', 'Unity', 'Алгоритмы', 'Архитектура', 'Web', 'Git', 'Математика', 'Английский'])]
    };
  });

  /* ---------- занятия ---------- */
  const sessionBody = (b: any) => {
    const topic = String(b?.topic ?? '').trim().slice(0, 200); if (!topic) throw bad('Напиши тему занятия.');
    const minutes = b?.minutes === '' || b?.minutes == null ? 0 : Math.round(Number(b.minutes)); if (!(minutes >= 0 && minutes <= 1440)) throw bad('Минут — от 0 до 1440.');
    return { day: dayParam(b?.day), time: hmParam(b?.time), topic, category: String(b?.category ?? '').trim().slice(0, 40) || null, minutes, theses: lines(b?.theses), qa: qaOf(b?.qa) };
  };
  app.post('/sessions', { preHandler }, async (req, reply) => {
    const v = sessionBody(req.body);
    const s = await db.transaction(async tx => { const [r] = await tx.insert(studySessions).values({ userId: uid(req), ...v }).returning(); await recordEvent(tx, sessionEvent(uid(req), r!)); return r!; });
    return reply.code(201).send(s);
  });
  app.put('/sessions/:id', { preHandler }, async (req, reply) => {
    const v = sessionBody(req.body), id = idParam((req.params as any).id);
    const s = await db.transaction(async tx => { const [r] = await tx.update(studySessions).set({ ...v, updatedAt: new Date() }).where(and(eq(studySessions.userId, uid(req)), eq(studySessions.id, id))).returning(); if (r) await recordEvent(tx, sessionEvent(uid(req), r)); return r; });
    return s ?? notFound(reply);
  });
  app.delete('/sessions/:id', { preHandler }, async (req, reply) => {
    const id = idParam((req.params as any).id), r = await db.delete(studySessions).where(and(eq(studySessions.userId, uid(req)), eq(studySessions.id, id))).returning({ id: studySessions.id });
    if (!r.length) return notFound(reply);
    await removeEvents(db, uid(req), [id]); return { ok: true };
  });
  // минуты к записи дневника конспектов
  app.put('/time', { preHandler }, async req => {
    const b = (req.body ?? {}) as any, key = String(b.key ?? '').slice(0, 80), minutes = Math.round(Number(b.minutes) || 0);
    if (!key) throw bad('Нет записи.');
    if (!(minutes >= 0 && minutes <= 1440)) throw bad('Минут — от 0 до 1440.');
    if (!minutes) { await db.delete(studyTime).where(and(eq(studyTime.userId, uid(req)), eq(studyTime.key, key))); return { ok: true }; }
    await db.insert(studyTime).values({ userId: uid(req), key, day: dayParam(b.day), minutes }).onConflictDoUpdate({ target: [studyTime.userId, studyTime.key], set: { minutes, day: dayParam(b.day) } });
    return { ok: true };
  });

  /* ---------- вопросы дня ---------- */
  app.get('/quiz', { preHandler }, async req => {
    const userId = uid(req), { today } = await ctx(userId), w = await world(db, userId);
    let [q] = await db.select().from(quizzes).where(and(eq(quizzes.userId, userId), eq(quizzes.day, today)));
    if (!q) { const due = dueCards(w.cards, w.srs, today); if (due.length) { const items = buildQuiz(today, due); await saveQuiz(db, userId, today, items); q = { userId, day: today, items, source: 'local' }; } }
    const hist = await db.select().from(quizzes).where(and(eq(quizzes.userId, userId), gte(quizzes.day, addDays(today, -13)), lte(quizzes.day, today))).orderBy(asc(quizzes.day));
    const items = (q?.items ?? []) as QuizItem[], have = new Set(items.map(i => i.cardId));
    const next = soonest(w.cards, w.srs, today, 1)[0];
    return {
      today, items, total: w.cards.length, due: dueCards(w.cards, w.srs, today).filter(c => !have.has(c.id)).length, ai: aiEnabled(),
      next: next ? { topic: next.c.topic, due: next.st.due } : null,
      history: Array.from({ length: 14 }, (_, k) => addDays(today, k - 13)).map(d => { const its = ((hist.find(h => h.day === d)?.items ?? []) as QuizItem[]).filter(i => i.result); return { day: d, answered: its.length, good: its.filter(i => i.result === 'good').length }; })
    };
  });
  // ещё порция / досрочно / по одному конспекту
  app.post('/quiz/more', { preHandler }, async req => {
    const userId = uid(req), { today } = await ctx(userId), w = await world(db, userId), b = (req.body ?? {}) as { mode?: string; noteId?: string };
    const [q] = await db.select().from(quizzes).where(and(eq(quizzes.userId, userId), eq(quizzes.day, today)));
    const items = (q?.items ?? []) as QuizItem[], have = new Set(items.map(i => i.cardId));
    let add: QuizItem[] = [];
    if (b.mode === 'note' && b.noteId) {
      const pool = w.cards.filter(c => c.noteId === b.noteId && !have.has(c.id));
      if (!pool.length) throw bad(have.size ? 'Все вопросы этого конспекта уже в сегодняшних.' : 'Вопросы по этому конспекту ещё готовятся.');
      const r = rng(hash(today + b.noteId + items.length)); add = shuffle(pool, r).slice(0, QUIZ_SIZE).map(c => itemOf(c, r));
      await saveQuiz(db, userId, today, [...items.filter(i => i.result), ...add]); return { added: add.length };
    }
    if (b.mode === 'early') add = buildQuiz(`${today}:early`, soonest(w.cards, w.srs, today, 5).map(x => x.c));
    else add = buildQuiz(`${today}:${items.length}`, dueCards(w.cards, w.srs, today).filter(c => !have.has(c.id)));
    if (!add.length) throw bad('Повторять пока нечего.');
    await saveQuiz(db, userId, today, [...items, ...add]); return { added: add.length };
  });
  app.post('/quiz/grade', { preHandler }, async (req, reply) => {
    const userId = uid(req), { today } = await ctx(userId), b = (req.body ?? {}) as { index?: number; grade?: string; answer?: string; check?: unknown };
    const g = b.grade as 'good' | 'hard' | 'again'; if (!['good', 'hard', 'again'].includes(g)) throw bad('Оценка: good, hard или again.');
    const [q] = await db.select().from(quizzes).where(and(eq(quizzes.userId, userId), eq(quizzes.day, today))); if (!q) return notFound(reply);
    const items = q.items as QuizItem[], it = items[Number(b.index)]; if (!it) return notFound(reply);
    const w = await world(db, userId), card = w.cards.find(c => c.id === it.cardId);
    const now = new Date(), hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    Object.assign(it, { result: g, revealed: true, at: hm, ...(b.answer ? { answer: String(b.answer).slice(0, 3000) } : {}), ...(b.check ? { check: b.check } : {}) });
    const st = grade(card ? stateOf(card, w.srs) : { interval: 0, ease: 2.5, reps: 0, due: today }, g, today);
    await db.transaction(async tx => {
      await tx.update(quizzes).set({ items }).where(and(eq(quizzes.userId, userId), eq(quizzes.day, today)));
      await tx.insert(srsCards).values({ userId, cardKey: it.cardId, intervalDays: st.interval, ease: st.ease, reps: st.reps, dueOn: st.due, lastOn: today })
        .onConflictDoUpdate({ target: [srsCards.userId, srsCards.cardKey], set: { intervalDays: st.interval, ease: st.ease, reps: st.reps, dueOn: st.due, lastOn: today } });
    });
    return { item: it, next: st };
  });
  // проверка ответа ИИ: суть, а не формулировки
  app.post('/quiz/check', { preHandler, bodyLimit: 64 * 1024 }, async (req, reply) => {
    if (!aiEnabled()) return reply.code(503).send({ error: 'Проверка ответа не настроена: на сервере нет ключа ИИ.' });
    const b = (req.body ?? {}) as Record<string, unknown>, answer = String(b.answer ?? '').trim().slice(0, 3000);
    if (!answer) throw bad('Напиши ответ.');
    const plain = (h: unknown) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[m]!)).replace(/\s+/g, ' ').trim();
    const obs = obsFor(await username(db, uid(req)));
    if (obs && b.noteId) return obs.check({ question: plain(b.question).slice(0, 600), reference: plain(b.reference).slice(0, 1500), answer, noteId: b.noteId, key: b.key, context: '' });
    const prompt = `Проверь ответ ученика на вопрос для повторения. Пиши по-русски, на «ты», дружелюбно и конкретно.
Оценка score от 0 до 100: суть верна — 75 и выше (verdict "good"), частично — 40–74 ("hard"), неверно или пусто — ниже 40 ("again"). Формулировки не важны, важна суть. «Не знаю» и пустой ответ — again.
feedback — 1–2 предложения: что верно и что главное поправить. missing — до 3 коротких пунктов, чего не хватило (пусто, если всё есть).
Вопрос: ${plain(b.question).slice(0, 600)}
Эталон: ${plain(b.reference).slice(0, 1500)}
Материал (контекст): ${String(b.context ?? '').slice(0, 6000)}
Ответ ученика: ${answer}`;
    const out = await gemini([{ text: prompt }], CHECK_SCHEMA, { timeout: 45e3 }), score = Math.max(0, Math.min(100, Math.round(Number(out?.score) || 0)));
    return { score, verdict: ['good', 'hard', 'again'].includes(out?.verdict) ? out.verdict : score >= 75 ? 'good' : score >= 40 ? 'hard' : 'again', feedback: String(out?.feedback ?? '').slice(0, 500), missing: (Array.isArray(out?.missing) ? out.missing : []).slice(0, 3).map((x: unknown) => String(x).slice(0, 200)) };
  });

  /* ---------- Obsidian (только владелец хранилища) ---------- */
  const obsOr404 = async (req: any, reply: any) => { const o = obsFor(await username(db, uid(req))); if (!o) reply.code(404).send({ error: 'Obsidian не подключён.' }); return o; };
  app.post('/obsidian/sync', { preHandler }, async (req, reply) => { const o = await obsOr404(req, reply); if (!o) return; await o.sync(); return { ok: true }; });
  app.get('/obsidian/search', { preHandler }, async (req, reply) => { const o = await obsOr404(req, reply); if (!o) return; return { hits: await o.search(String((req.query as any).q ?? '').slice(0, 200)) }; });
  app.get('/obsidian/library', { preHandler }, async (req, reply) => { const o = await obsOr404(req, reply); if (!o) return; return { notes: await o.listLibrary() }; });
  app.get('/obsidian/note', { preHandler }, async (req, reply) => { const o = await obsOr404(req, reply); if (!o) return; return o.readNote(String((req.query as any).rel ?? '')); });
  app.post('/obsidian/regen', { preHandler }, async (req, reply) => { const o = await obsOr404(req, reply); if (!o) return; const b = (req.body ?? {}) as any; o.regen(String(b.noteId ?? ''), b.key ? String(b.key) : null); return { ok: true }; });
  app.post('/obsidian/cheatsheet', { preHandler }, async (req, reply) => {
    const o = await obsOr404(req, reply); if (!o) return;
    if (!aiEnabled()) return reply.code(503).send({ error: 'Нет ключа ИИ.' });
    return o.cheatsheet(String((req.body as any)?.noteId ?? ''));
  });
  app.get('/obsidian/cheatsheet', { preHandler }, async (req, reply) => { const o = await obsOr404(req, reply); if (!o) return; return o.readCheat(String((req.query as any).id ?? '')); });
}
