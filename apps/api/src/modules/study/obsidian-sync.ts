/**
 * Приём заметок от плагина Obsidian (ADR-0001). Плагин ходит с личным ключом вида obsidian в Authorization: Bearer.
 * Заметка = конспект kind 'obsidian', source = путь в хранилище. Удалённая заметка становится архивной;
 * та же заметка, присланная снова, оживает вместе с вопросами. Дописанные и изменённые разделы ## пишутся в дневник.
 */
import { and, count, desc, eq, ilike, isNull, max, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { localNow } from '@bortjournal/core';
import { requireFeature } from '../../core/billing.js';
import { bad, HttpError, uid } from '../../core/http.js';
import { users } from '../../core/schema.js';
import { bearerOf, userByToken } from '../../core/tokens.js';
import type { DB, Tx } from '../../db/index.js';
import { MAX_TEXT } from './extract.js';
import { materials, noteLog } from './schema.js';

export const MAX_NOTE = 1_000_000;
const FRONT = /^---\n[\s\S]*?\n---\n?/;
const H2 = /^##\s+(.+?)\s*#*\s*$/;

const pathOf = (v: unknown) => {
  const p = typeof v === 'string' ? v.replace(/\\/g, '/').replace(/^\/+/, '').trim() : '';
  if (!p || p.length > 1000 || p.split('/').includes('..')) throw bad('Нужен путь заметки в хранилище.');
  return p;
};
const titleOf = (title: unknown, md: string, p: string) =>
  (typeof title === 'string' && title.trim() ? title.trim() : /^#\s+(.+?)\s*$/m.exec(md.replace(FRONT, ''))?.[1] ?? p.split('/').pop()!.replace(/\.md$/i, '')).slice(0, 200);

/** разделы ## заметки: заголовок → текст (### и глубже — часть раздела); вводная до первого ## не считается */
export function sectionsOf(md: string) {
  const out = new Map<string, string>();
  let h: string | null = null, buf: string[] = [];
  const flush = () => { if (h !== null) out.set(h, `${out.get(h) ?? ''}\n${buf.join('\n')}`.trim()); };
  for (const line of md.replace(FRONT, '').split('\n')) {
    const m = H2.exec(line);
    if (m) { flush(); h = m[1]!.slice(0, 200); buf = []; } else buf.push(line);
  }
  flush();
  return out;
}
const tasksOf = (md: string) => [...md.matchAll(/^\s*[-*]\s+\[ \]\s+(.+)$/gm)].map(m => m[1]!.trim()).slice(0, 30);
const tagsOf = (md: string) => [...new Set([...md.replace(FRONT, '').matchAll(/(?:^|\s)#([\p{L}][\p{L}\p{N}_/-]*)/gmu)].map(m => m[1]!))].slice(0, 12);
/** текст без разметки Markdown — для выдержек */
const plain = (md: string) => md.split('\n')
  .map(l => l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '').replace(/^\s*>\s?(?:\[![^\]]+\]\s*)?/, ''))
  .join(' ').replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
export const obsidianLink =(rel: string) => `obsidian://open?file=${encodeURIComponent(rel.replace(/\.md$/i, ''))}`;

/** записать в дневник дописанные и изменённые разделы; за день — одна запись на конспект */
async function logSections(db: Tx, userId: string, materialId: string, before: string | null, after: string) {
  const a = sectionsOf(after), b = before === null ? new Map<string, string>() : sectionsOf(before);
  const added = [...a.keys()].filter(k => !b.has(k)), changed = [...a.keys()].filter(k => b.has(k) && b.get(k) !== a.get(k));
  if (!added.length && !changed.length) return;
  const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
  const now = localNow(u?.tz ?? 0);
  const [prev] = await db.select().from(noteLog).where(and(eq(noteLog.materialId, materialId), eq(noteLog.day, now.day)));
  if (!prev) { await db.insert(noteLog).values({ userId, materialId, day: now.day, time: now.hm, kind: before === null ? 'new' : 'edit', added, changed }); return; }
  const add2 = [...new Set([...prev.added, ...added])], ch2 = [...new Set([...prev.changed, ...changed])].filter(k => !add2.includes(k));
  if (add2.length === prev.added.length && ch2.length === prev.changed.length) return;
  await db.update(noteLog).set({ added: add2, changed: ch2, time: now.hm }).where(eq(noteLog.id, prev.id));
}

/* ---------- для обзора, читалки и поиска, когда Obsidian не читается с диска ---------- */
export const noteView = (m: typeof materials.$inferSelect) => ({
  id: m.id, rel: m.source ?? '', title: m.title, tags: tagsOf(m.text), date: m.updatedAt.toISOString().slice(0, 10), link: obsidianLink(m.source ?? ''), cheat: false,
  tasks: tasksOf(m.text), sections: [...sectionsOf(m.text).keys()].map(h => ({ key: h, h }))
});
export async function dbDiary(db: Tx, userId: string) {
  const rows = await db.select({ e: noteLog, title: materials.title, rel: materials.source }).from(noteLog).innerJoin(materials, eq(materials.id, noteLog.materialId))
    .where(eq(noteLog.userId, userId)).orderBy(desc(noteLog.day), desc(noteLog.time)).limit(200);
  return rows.map(({ e, title, rel }) => ({ id: e.id, day: e.day, at: e.time, title, kind: e.kind, added: e.added, changed: e.changed, noteId: e.materialId, rel, link: obsidianLink(rel ?? '') }));
}
export async function dbNote(db: Tx, userId: string, rel: string) {
  const [m] = await db.select().from(materials).where(and(eq(materials.userId, userId), eq(materials.kind, 'obsidian'), eq(materials.source, rel), isNull(materials.archivedAt)));
  if (!m) return null;
  return { rel, title: m.title, tags: tagsOf(m.text), date: m.updatedAt.toISOString().slice(0, 10), link: obsidianLink(rel), noteId: null, cheat: null, markdown: m.text.replace(FRONT, ''), sections: [...sectionsOf(m.text).keys()] };
}
/** поиск по заголовку и тексту без учёта регистра; выдержка вокруг первого совпадения и раздел, где оно */
export async function dbSearch(db: Tx, userId: string, q: string, limit = 40) {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const like = `%${needle.replace(/[\\%_]/g, c => `\\${c}`)}%`, low = needle.toLowerCase();
  const rows = await db.select().from(materials)
    .where(and(eq(materials.userId, userId), eq(materials.kind, 'obsidian'), isNull(materials.archivedAt), or(ilike(materials.text, like), ilike(materials.title, like)))).limit(200);
  return rows.map(m => {
    const text = m.text.replace(FRONT, ''), lower = text.toLowerCase(), at = lower.indexOf(low);
    // выдержка — только из раздела, где нашлось, и без разметки Markdown
    const head = at < 0 ? undefined : [...text.slice(0, at).matchAll(/^##\s+(.+?)\s*#*\s*$/gm)].pop();
    const from = head ? head.index! + head[0].length : 0, next = text.slice(Math.max(0, at)).search(/^##\s/m);
    const to = at < 0 || next < 0 ? text.length : at + next, sec = text.slice(from, to), p = Math.max(0, at - from);
    const start = Math.max(0, p - 80), end = Math.min(sec.length, p + needle.length + 120);
    const score = (m.title.toLowerCase().includes(low) ? 10 : 0) + lower.split(low).length - 1;
    const snippet = (start ? '…' : '') + plain(sec.slice(start, end)) + (end < sec.length ? '…' : '');
    return { rel: m.source ?? '', title: m.title, h: head?.[1] ?? null, snippet, score, link: obsidianLink(m.source ?? ''), study: true };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function obsidianSyncRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const byKey = async (req: FastifyRequest, reply: FastifyReply) => {
    const u = await userByToken(db, bearerOf(req), 'obsidian');
    if (!u) return reply.code(401).send({ error: 'Ключ не подошёл — создай ключ Obsidian в профиле Lumi.' });
    req.userId = u;
  };
  const preHandler = [byKey, requireFeature(db, 'study')];
  const note = async (userId: string, source: string) =>
    (await db.select().from(materials).where(and(eq(materials.userId, userId), eq(materials.kind, 'obsidian'), eq(materials.source, source))))[0];

  app.put('/obsidian/notes', { preHandler, bodyLimit: MAX_NOTE * 2 }, async req => {
    const b = (req.body ?? {}) as { path?: unknown; title?: unknown; markdown?: unknown };
    const source = pathOf(b.path), md = typeof b.markdown === 'string' ? b.markdown.replace(/\r/g, '') : '';
    if (md.length > MAX_NOTE) throw new HttpError(413, 'Заметка больше 1 МБ — Lumi её не примет.');
    const text = md.length > MAX_TEXT ? md.slice(0, MAX_TEXT) : md, title = titleOf(b.title, md, source), userId = uid(req);
    return db.transaction(async tx => {
      const [m] = await tx.select().from(materials).where(and(eq(materials.userId, userId), eq(materials.kind, 'obsidian'), eq(materials.source, source))).for('update');
      if (!m) {
        const [n] = await tx.insert(materials).values({ userId, kind: 'obsidian', title, source, text, bytes: Buffer.byteLength(md) }).returning({ id: materials.id });
        await logSections(tx, userId, n!.id, null, text);
        return { id: n!.id, status: 'created' };
      }
      const restored = !!m.archivedAt;
      if (!restored && m.text === text && m.title === title) return { id: m.id, status: 'unchanged' };
      await tx.update(materials).set({ title, text, bytes: Buffer.byteLength(md), archivedAt: null, updatedAt: new Date() }).where(eq(materials.id, m.id));
      if (m.text !== text) await logSections(tx, userId, m.id, m.text, text);
      return { id: m.id, status: restored ? 'restored' : 'updated' };
    });
  });

  app.post('/obsidian/rename', { preHandler }, async (req, reply) => {
    const b = (req.body ?? {}) as { from?: unknown; to?: unknown }, from = pathOf(b.from), to = pathOf(b.to), userId = uid(req);
    const m = await note(userId, from);
    if (!m) return reply.code(404).send({ error: 'Такой заметки в Lumi нет — пришли её целиком.' });
    if (from === to) return { id: m.id };
    if (await note(userId, to)) return reply.code(409).send({ error: 'По новому пути уже есть конспект.' });
    // название из имени файла переезжает вместе с ним; заданное заголовком # — остаётся
    const base = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '');
    await db.update(materials).set({ source: to, ...(m.title === base(from) ? { title: base(to).slice(0, 200) } : {}), updatedAt: new Date() }).where(eq(materials.id, m.id));
    return { id: m.id };
  });

  app.delete('/obsidian/notes', { preHandler }, async (req, reply) => {
    const m = await note(uid(req), pathOf((req.query as { path?: unknown }).path));
    if (!m) return reply.code(404).send({ error: 'Такой заметки в Lumi нет.' });
    if (!m.archivedAt) await db.update(materials).set({ archivedAt: new Date() }).where(eq(materials.id, m.id));
    return { id: m.id, archived: true };
  });

  app.get('/obsidian/status', { preHandler }, async req => {
    const [r] = await db.select({ notes: count(), lastSync: max(materials.updatedAt) }).from(materials)
      .where(and(eq(materials.userId, uid(req)), eq(materials.kind, 'obsidian'), isNull(materials.archivedAt)));
    return { notes: r?.notes ?? 0, lastSync: r?.lastSync ?? null };
  });
}
