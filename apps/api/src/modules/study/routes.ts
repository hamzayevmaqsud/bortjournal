/**
 * Учёба (раздел Pro): конспекты (файлы PDF и Word, текст, ссылки, Obsidian), дневник занятий и минуты.
 * Вопросы с вариантами ответа — только по конспектам, для которых их попросили; повторение по интервалам.
 */
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays } from '@bortjournal/core';
import { requireUser } from '../../core/auth.js';
import { requireFeature } from '../../core/billing.js';
import { userContext } from '../../core/context.js';
import { recordEvent, removeEvents } from '../../core/events.js';
import { aiEnabled, gemini } from '../../core/gemini.js';
import { bad, dayParam, HttpError, hmParam, idParam, notFound, uid } from '../../core/http.js';
import { users } from '../../core/schema.js';
import type { DB, Tx } from '../../db/index.js';
import { obsFor } from './obsidian.js';
import { dbDiary, dbNote, dbSearch, noteView, obsidianSyncRoutes } from './obsidian-sync.js';
import { takeAi } from '../../core/ai-quota.js';
import { answer, answersByDay, isRunning, present, queueOf, removeSrsOf, startQuestions } from './mc.js';
import { extractFile, extractLink, MAX_FILE, MAX_TEXT } from './extract.js';
import { materials, questions, quizzes, studySessions, studyTime } from './schema.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';

const lines = (t: unknown) => String(t ?? '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 60).map(x => x.slice(0, 500));
const qaOf = (t: unknown) => lines(t).map(l => { const m = l.split(/\s*(?:=>|->|—>|::)\s*/); return m.length >= 2 ? { q: m[0]!, a: m.slice(1).join(' ') } : null; }).filter(Boolean) as Array<{ q: string; a: string }>;

async function username(db: Tx, userId: string) { const [u] = await db.select({ n: users.username }).from(users).where(eq(users.id, userId)); return u?.n ?? ''; }
async function world(db: Tx, userId: string) {
  const ss = await db.select().from(studySessions).where(eq(studySessions.userId, userId)).orderBy(desc(studySessions.day), desc(studySessions.time));
  const obs = obsFor(await username(db, userId)), state = obs ? obs.publicState() : null;
  return { ss, obs, state };
}
const FILES = () => process.env.STUDY_FILES_DIR || fileURLToPath(new URL('../../../../../data/study-files', import.meta.url));
const fileOf = (userId: string, name: string) => path.join(FILES(), userId, path.basename(name));
const pubMaterial = (m: typeof materials.$inferSelect, counts: Map<string, { n: number; due: number }>) => ({
  id: m.id, kind: m.kind, title: m.title, source: m.source, bytes: m.bytes, chars: m.text.length, hasFile: !!m.file, createdAt: m.createdAt,
  quiz: m.quiz, quizStatus: m.quizStatus, quizError: m.quizError, quizDone: m.quizDone, quizTotal: m.quizTotal, questions: counts.get(m.id)?.n ?? 0, due: counts.get(m.id)?.due ?? 0
});
const sessionEvent = (userId: string, s: typeof studySessions.$inferSelect) => ({ userId, module: 'study' as const, kind: 'session', refId: s.id, day: s.day, time: s.time, title: s.topic, value: s.minutes || null, unit: 'min' });

export async function studyRoutes(app: FastifyInstance, { db }: { db: DB }) {
  // вопросов у конспекта — все составленные (и у выключенных тоже); к повторению — из очереди дня
  const countsOf = async (userId: string, queue: Array<{ materialId: string }>) => {
    const rows = await db.select({ m: questions.materialId, n: sql<number>`count(*)::int` }).from(questions).where(eq(questions.userId, userId)).groupBy(questions.materialId);
    const c = new Map(rows.map(r => [r.m, { n: r.n, due: 0 }]));
    for (const x of queue) { const v = c.get(x.materialId); if (v) v.due++; }
    return c;
  };
  const preHandler = [requireUser, requireFeature(db, 'study')];
  await obsidianSyncRoutes(app, { db });
  const ctx = async (userId: string) => userContext(db, userId);

  app.get('/overview', { preHandler }, async req => {
    const userId = uid(req), { today, norms } = await ctx(userId), w = await world(db, userId);
    const times = await db.select().from(studyTime).where(eq(studyTime.userId, userId));
    const timeBy = new Map(times.map(t => [t.key, t]));
    const minOn = (d: string) => w.ss.filter(s => s.day === d).reduce((a, s) => a + s.minutes, 0) + times.filter(t => t.day === d).reduce((a, t) => a + t.minutes, 0);
    const d30 = Array.from({ length: 30 }, (_, k) => addDays(today, k - 29));
    // без чтения с диска заметки и их дневник — из базы (их присылает плагин)
    const plugin = !w.state, pdiary = plugin ? await dbDiary(db, userId) : [];
    const diary = [
      ...pdiary.map(e => ({ src: 'obs', ...e, minutes: timeBy.get(e.id)?.minutes ?? null })),
      ...(w.state?.diary ?? []).map((e: any) => ({ src: 'obs', id: e.id, day: e.date, at: e.at, title: e.title, kind: e.kind, added: e.added, changed: e.changed, noteId: e.noteId, link: w.state.notes.find((n: any) => n.id === e.noteId)?.link ?? null, minutes: timeBy.get(e.id)?.minutes ?? null })),
      ...w.ss.map(s => ({ src: 'manual', id: s.id, day: s.day, at: s.time, title: s.topic, category: s.category, minutes: s.minutes, time: s.time, theses: s.theses, qa: s.qa }))
    ].sort((a: any, b: any) => b.day.localeCompare(a.day) || String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 120);
    const mats = await db.select().from(materials).where(and(eq(materials.userId, userId), isNull(materials.archivedAt))).orderBy(desc(materials.createdAt));
    // конспект «завис» в работе после перезапуска сервера — продолжаем
    for (const m of mats) if (m.quizStatus === 'working' && !isRunning(m.id)) startQuestions(db, m.id, msg => req.log.warn(msg));
    const q = await queueOf(db, userId, today);
    const counts = await countsOf(userId, q.queue);
    const own = mats.filter(m => m.kind !== 'obsidian'), obsMat = new Map(mats.filter(m => m.kind === 'obsidian').map(m => [m.source, m]));
    const notes = plugin ? mats.filter(m => m.kind === 'obsidian').map(m => ({ ...noteView(m), material: pubMaterial(m, counts) })) : (w.state?.notes ?? []).map((n: any) => {
      const mm = obsMat.get(n.rel);
      return { id: n.id, rel: n.rel, title: n.title, tags: n.tags, date: n.date, link: n.link, cheat: !!n.cheat, tasks: (n.tasks ?? []).filter((t: any) => !t.done).map((t: any) => t.text),
        sections: n.sections.filter((s: any) => !s.skip).map((s: any) => ({ key: s.key, h: s.h })), material: mm ? pubMaterial(mm, counts) : null };
    });
    const allMin = w.ss.reduce((a, s) => a + s.minutes, 0) + times.reduce((a, t) => a + t.minutes, 0);
    return {
      today, goal: norms.study, ai: aiEnabled(), obs: w.state ? { enabled: true, vault: w.state.vaultName, folder: w.state.folder, lastSync: w.state.lastSync, error: w.state.error }
        : { enabled: false, plugin: true, notes: notes.length, lastSync: mats.filter(m => m.kind === 'obsidian').reduce<Date | null>((a, m) => !a || m.updatedAt > a ? m.updatedAt : a, null) },
      kpi: { materials: own.length + notes.length, questions: q.qs.length, due: q.queue.length, week: d30.slice(-7).reduce((a, d) => a + minOn(d), 0), all: allMin, sessions: w.ss.length },
      days: d30.map(d => ({ day: d, minutes: minOn(d) })), diary, materials: own.map(m => pubMaterial(m, counts)), notes,
      categories: [...new Set([...w.ss.map(s => s.category).filter(Boolean), 'C#', 'Unity', 'Алгоритмы', 'Архитектура', 'Web', 'Git', 'Математика', 'Английский'])]
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

  /* ---------- конспекты ---------- */
  const own = async (userId: string, id: string) => { const [m] = await db.select().from(materials).where(and(eq(materials.userId, userId), eq(materials.id, id))); return m; };
  const counts1 = async (userId: string, today: string) => countsOf(userId, (await queueOf(db, userId, today)).queue);
  const create = async (userId: string, v: { kind: string; title: string; source: string | null; text: string; bytes?: number | null }, file?: { buf: Buffer; ext: string }) => {
    if (v.text.trim().length < 30) throw bad('В конспекте почти нет текста.');
    const text = v.text.length > MAX_TEXT ? `${v.text.slice(0, MAX_TEXT)}\n\n…(конспект обрезан: слишком длинный)` : v.text;
    const [m] = await db.insert(materials).values({ userId, kind: v.kind, title: v.title.slice(0, 200), source: v.source?.slice(0, 1000) ?? null, text, bytes: v.bytes ?? null }).returning();
    if (file) {
      const name = `${m!.id}.${file.ext}`, dest = fileOf(userId, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, file.buf);
      await db.update(materials).set({ file: name }).where(eq(materials.id, m!.id)); m!.file = name;
    }
    return pubMaterial(m!, new Map());
  };
  // файл приходит телом запроса как есть: Content-Type application/octet-stream, имя — в заголовке X-File-Name
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_FILE + 1024 }, (_req, body, done) => done(null, body));
  app.post('/materials/upload', { preHandler, bodyLimit: MAX_FILE + 1024 }, async (req, reply) => {
    const buf = req.body as Buffer; if (!Buffer.isBuffer(buf)) throw bad('Отправь файл.');
    const rawName = String(req.headers['x-file-name'] ?? 'файл');
    let name = rawName; try { name = decodeURIComponent(rawName); } catch { /* имя без кодирования */ }
    name = name.slice(0, 200);
    const x = await extractFile(name, buf);
    return reply.code(201).send(await create(uid(req), { kind: x.kind, title: x.title, source: name, text: x.text, bytes: buf.length }, { buf, ext: x.ext }));
  });
  app.post('/materials/link', { preHandler }, async (req, reply) => {
    const x = await extractLink(String((req.body as { url?: unknown } | undefined)?.url ?? ''));
    return reply.code(201).send(await create(uid(req), { kind: 'link', title: x.title, source: x.url, text: x.text, bytes: x.buf?.length ?? null }, x.buf ? { buf: x.buf, ext: 'pdf' } : undefined));
  });
  app.post('/materials/text', { preHandler, bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const b = (req.body ?? {}) as { title?: unknown; text?: unknown }, text = String(b.text ?? '').replace(/\r/g, '').trim();
    const title = String(b.title ?? '').trim() || (/^#\s+(.+)$/m.exec(text)?.[1] ?? text.split('\n')[0]!).slice(0, 120);
    return reply.code(201).send(await create(uid(req), { kind: 'text', title, source: null, text }));
  });
  app.get('/materials/:id', { preHandler }, async (req, reply) => {
    const m = await own(uid(req), idParam((req.params as any).id)); if (!m) return notFound(reply);
    const { today } = await ctx(uid(req));
    return { ...pubMaterial(m, await counts1(uid(req), today)), text: m.text };
  });
  app.get('/materials/:id/file', { preHandler }, async (req, reply) => {
    const m = await own(uid(req), idParam((req.params as any).id)); if (!m?.file) return notFound(reply);
    const p2 = fileOf(uid(req), m.file); if (!fs.existsSync(p2)) return notFound(reply);
    const ext = path.extname(m.file).slice(1), type = ext === 'pdf' ? 'application/pdf' : ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain; charset=utf-8';
    const fname = encodeURIComponent((m.kind === 'link' ? m.title : m.source ?? m.title).replace(/\.[a-z0-9]{1,5}$/i, '') + '.' + ext);
    return reply.header('Content-Type', type).header('Content-Disposition', `inline; filename*=UTF-8''${fname}`).header('Cache-Control', 'private, max-age=3600').send(fs.createReadStream(p2));
  });
  app.put('/materials/:id', { preHandler }, async (req, reply) => {
    const title = String((req.body as { title?: unknown } | undefined)?.title ?? '').trim().slice(0, 200); if (!title) throw bad('Напиши название.');
    const r = await db.update(materials).set({ title, updatedAt: new Date() }).where(and(eq(materials.userId, uid(req)), eq(materials.id, idParam((req.params as any).id)))).returning({ id: materials.id });
    return r.length ? { ok: true } : notFound(reply);
  });
  app.delete('/materials/:id', { preHandler }, async (req, reply) => {
    const userId = uid(req), m = await own(userId, idParam((req.params as any).id)); if (!m) return notFound(reply);
    const qids = (await db.select({ id: questions.id }).from(questions).where(eq(questions.materialId, m.id))).map(x => x.id);
    await removeSrsOf(db, userId, qids);
    await db.delete(materials).where(eq(materials.id, m.id));
    if (m.file) fs.rmSync(fileOf(userId, m.file), { force: true });
    return { ok: true };
  });
  // вопросы по конспекту — только по просьбе. Выключить — вопросы остаются, но не попадают в повторение
  const quizOn = async (userId: string, m: typeof materials.$inferSelect, on: boolean, log: (s: string) => void) => {
    await db.update(materials).set({ quiz: on, updatedAt: new Date() }).where(eq(materials.id, m.id));
    if (on && (m.quizStatus === 'none' || m.quizStatus === 'error' || (m.quizStatus === 'working' && !isRunning(m.id)))) {
      if (!aiEnabled()) throw new HttpError(503, 'Вопросы составляет ИИ, а на сервере нет его ключа.');
      await takeAi(db, userId, 'questions');
      await db.update(materials).set({ quizStatus: 'working', quizError: null }).where(eq(materials.id, m.id));
      startQuestions(db, m.id, log);
    }
  };
  app.post('/materials/:id/quiz', { preHandler }, async (req, reply) => {
    const m = await own(uid(req), idParam((req.params as any).id)); if (!m) return notFound(reply);
    await quizOn(uid(req), m, !!(req.body as { on?: unknown } | undefined)?.on, s => req.log.warn(s));
    return { ok: true };
  });
  app.post('/materials/:id/quiz/regen', { preHandler }, async (req, reply) => {
    const userId = uid(req), m = await own(userId, idParam((req.params as any).id)); if (!m) return notFound(reply);
    if (isRunning(m.id)) throw bad('Вопросы как раз составляются — подожди.');
    const qids = (await db.select({ id: questions.id }).from(questions).where(eq(questions.materialId, m.id))).map(x => x.id);
    await removeSrsOf(db, userId, qids);
    await db.delete(questions).where(eq(questions.materialId, m.id));
    await db.update(materials).set({ quizStatus: 'none', quizDone: 0, quizTotal: 0, quizError: null }).where(eq(materials.id, m.id));
    await quizOn(userId, { ...m, quizStatus: 'none' }, true, s => req.log.warn(s));
    return { ok: true };
  });

  /* ---------- вопросы дня ---------- */
  app.get('/quiz', { preHandler }, async req => {
    const userId = uid(req), { today } = await ctx(userId), extra = Math.max(0, Math.min(100, Math.round(Number((req.query as any).extra) || 0)));
    const q = await queueOf(db, userId, today, extra), titles = new Map(q.mats.map(m => [m.id, m.title]));
    const hist = await answersByDay(db, userId, addDays(today, -13), today);
    const good = q.todayRows.filter(a => a.correct).length;
    return {
      today, current: q.queue[0] ? present(q.queue[0], titles.get(q.queue[0].materialId) ?? '', today) : null, left: q.queue.length,
      answered: q.todayRows.length, good, freshLeft: q.freshLeft, next: q.next, materials: q.mats.length, total: q.qs.length,
      history: Array.from({ length: 14 }, (_, k) => addDays(today, k - 13)).map(d => { const h = hist.find(x => x.day === d); return { day: d, answered: h?.n ?? 0, good: h?.good ?? 0 }; })
    };
  });
  app.post('/quiz/answer', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as { id?: unknown; choice?: unknown }, choice = Number(b.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) throw bad('Выбери вариант.');
    const { today } = await ctx(uid(req));
    const r = await answer(db, uid(req), today, idParam(b.id), choice);
    return r ?? notFound(reply);
  });

  /* ---------- Obsidian (только владелец хранилища) ---------- */
  const obsOr404 = async (req: any, reply: any) => { const o = obsFor(await username(db, uid(req))); if (!o) reply.code(404).send({ error: 'Obsidian не подключён.' }); return o; };
  app.post('/obsidian/sync', { preHandler }, async (req, reply) => { const o = await obsOr404(req, reply); if (!o) return; await o.sync(); return { ok: true }; });
  // поиск, читалка и вопросы: с диска у владельца хранилища, иначе — по заметкам, присланным плагином
  const disk = async (req: any) => obsFor(await username(db, uid(req)));
  app.get('/obsidian/search', { preHandler }, async req => {
    const q = String((req.query as any).q ?? '').slice(0, 200), o = await disk(req);
    return { hits: o ? await o.search(q) : await dbSearch(db, uid(req), q) };
  });
  app.get('/obsidian/library', { preHandler }, async req => { const o = await disk(req); return { notes: o ? await o.listLibrary() : [] }; });
  app.get('/obsidian/note', { preHandler }, async (req, reply) => {
    const rel = String((req.query as any).rel ?? ''), o = await disk(req);
    if (o) return o.readNote(rel);
    return (await dbNote(db, uid(req), rel)) ?? reply.code(404).send({ error: 'Заметка не найдена.' });
  });
  // вопросы по заметке Obsidian: заметка копируется в конспекты (с текущим текстом) и дальше — как любой конспект
  app.post('/obsidian/quiz', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as { rel?: unknown; on?: unknown }, rel = String(b.rel ?? ''), userId = uid(req);
    const o = await disk(req);
    if (!o) {
      const [m] = await db.select().from(materials).where(and(eq(materials.userId, userId), eq(materials.kind, 'obsidian'), eq(materials.source, rel), isNull(materials.archivedAt)));
      if (!m) return notFound(reply);
      await quizOn(userId, m, !!b.on, s => req.log.warn(s));
      return { ok: true, id: m.id };
    }
    const note = await o.readNote(rel).catch(() => null); if (!note?.markdown) return notFound(reply);
    let [m] = await db.select().from(materials).where(and(eq(materials.userId, userId), eq(materials.kind, 'obsidian'), eq(materials.source, rel)));
    if (!m) [m] = await db.insert(materials).values({ userId, kind: 'obsidian', title: String(note.title ?? rel).slice(0, 200), source: rel, text: String(note.markdown) }).returning();
    else if (b.on && m.quizStatus !== 'ready') { await db.update(materials).set({ text: String(note.markdown), title: String(note.title ?? m.title).slice(0, 200) }).where(eq(materials.id, m.id)); m.text = String(note.markdown); }
    await quizOn(userId, m!, !!b.on, s => req.log.warn(s));
    return { ok: true, id: m!.id };
  });
  app.post('/obsidian/cheatsheet', { preHandler }, async (req, reply) => {
    const o = await obsOr404(req, reply); if (!o) return;
    if (!aiEnabled()) return reply.code(503).send({ error: 'Нет ключа ИИ.' });
    await takeAi(db, uid(req), 'cheatsheet');
    return o.cheatsheet(String((req.body as any)?.noteId ?? ''));
  });
  app.get('/obsidian/cheatsheet', { preHandler }, async (req, reply) => { const o = await obsOr404(req, reply); if (!o) return; return o.readCheat(String((req.query as any).id ?? '')); });
}
