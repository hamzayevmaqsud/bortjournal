/**
 * Карточки повторения и порция вопросов дня — те же правила, что в старом журнале, чтобы история повторения
 * перенеслась без потерь: id карточек (по тексту тезиса), детерминированный выбор (seed — дата), интервалы SM-2.
 * Карточки: тезисы занятий («заполни пропуск» / «раскрой мысль»), пары вопрос→ответ, «вспомни тему», вопросы
 * из разделов конспектов Obsidian.
 */
import { addDays } from '@bortjournal/core';

export const QUIZ_SIZE = 6;
const STOP = new Set(['через', 'потому', 'чтобы', 'когда', 'можно', 'нужно', 'этого', 'этому', 'очень', 'также', 'только', 'после', 'перед', 'между', 'своей', 'своих', 'которые', 'который', 'которая', 'например', 'будет', 'может', 'всегда', 'иначе', 'нельзя', 'должен', 'должна', 'these', 'those', 'which', 'where', 'there', 'their', 'about', 'should', 'would', 'could', 'because']);
const QKIND: Record<string, string> = { fact: 'Факт', why: 'Почему так', compare: 'Сравни', practice: 'Практика' };
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const human = (d: string) => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`;
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed: number) { let x = seed || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
export function shuffle<T>(arr: T[], r: () => number) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; }
const noteShort = (t: string) => String(t).replace(/\s*[—–-]\s*конспект.*$/i, '').replace(/\s*\(.*\)\s*$/, '').trim() || t;

export interface Session { id: string; day: string; topic: string; category: string | null; theses: string[]; qa: Array<{ q: string; a: string }> }
export interface Card { id: string; type: 'thesis' | 'qa' | 'summary' | 'obs'; topic: string; date: string; text?: string; q?: string; a?: string; qkind?: string; theses?: string[]; noteId?: string; key?: string }
export interface SrsState { interval: number; ease: number; reps: number; due: string; last?: string | null }
export interface QuizItem { cardId: string; kind: string; meta: string; q: string; a: string; result: 'good' | 'hard' | 'again' | null; revealed?: boolean; noteId: string | null; key: string | null; at?: string; answer?: string; check?: unknown }

export function allCards(sessions: Session[], obsNotes: any[] = []): Card[] {
  const cards: Card[] = [];
  for (const s of sessions) {
    // id карточки — по тексту: правка одной строки не сдвигает историю повторения других
    for (const t of s.theses) cards.push({ id: `${s.id}:t${hash(t).toString(36)}`, type: 'thesis', topic: s.topic, date: s.day, text: t });
    for (const p of s.qa) cards.push({ id: `${s.id}:a${hash(p.q).toString(36)}`, type: 'qa', topic: s.topic, date: s.day, q: p.q, a: p.a });
    if (s.theses.length >= 2) cards.push({ id: `${s.id}:sum`, type: 'summary', topic: s.topic, date: s.day, theses: s.theses });
  }
  for (const n of obsNotes) for (const sec of n.sections ?? []) for (const q of sec.questions ?? [])
    cards.push({ id: `${n.id}:${sec.key}:${q.id}`, type: 'obs', topic: `${noteShort(n.title)} · ${sec.h}`, date: sec.updated || sec.first || n.date, q: q.q, a: q.a, qkind: q.kind, noteId: n.id, key: sec.key });
  return cards;
}
export const stateOf = (c: Card, srs: Map<string, SrsState>): SrsState => srs.get(c.id) ?? { interval: 0, ease: 2.5, reps: 0, due: addDays(c.date, 1) };
export const dueCards = (cards: Card[], srs: Map<string, SrsState>, day: string) => cards.map(c => ({ c, st: stateOf(c, srs) })).filter(x => x.st.due <= day).sort((a, b) => a.st.due.localeCompare(b.st.due)).map(x => x.c);
export const soonest = (cards: Card[], srs: Map<string, SrsState>, day: string, n: number) => cards.map(c => ({ c, st: stateOf(c, srs) })).filter(x => x.st.due > day).sort((a, b) => a.st.due.localeCompare(b.st.due)).slice(0, n);

function question(c: Card, r: () => number) {
  const when = `${c.topic} · ${human(c.date)}`;
  if (c.type === 'obs') return { q: esc(c.q), a: esc(c.a), kind: QKIND[c.qkind ?? ''] ?? 'Вопрос', meta: c.topic };
  if (c.type === 'qa') return { q: esc(c.q), a: esc(c.a), kind: 'Вопрос из конспекта', meta: when };
  if (c.type === 'summary') return { q: `Что ты изучал по теме «${esc(c.topic)}»? Назови главное своими словами.`, a: `<ul>${c.theses!.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`, kind: 'Вспомни тему', meta: when };
  const words = c.text!.split(/\s+/);
  const cand = words.map((w, i) => ({ w, i, clean: w.replace(/[^\p{L}\p{N}#+.]/gu, '') })).filter(x => x.clean.length >= 5 && !STOP.has(x.clean.toLowerCase()));
  if (words.length >= 4 && cand.length) {
    cand.sort((a, b) => b.clean.length - a.clean.length);
    const pick = cand[Math.floor(r() * Math.min(3, cand.length))]!;
    const q = words.map((w, i) => i === pick.i ? `<mark class="blank">${'_'.repeat(Math.min(10, Math.max(4, pick.clean.length)))}</mark>${esc(w.slice(w.indexOf(pick.clean) + pick.clean.length))}` : esc(w)).join(' ');
    const a = words.map((w, i) => i === pick.i ? `<mark class="hl">${esc(w)}</mark>` : esc(w)).join(' ');
    return { q, a, kind: 'Заполни пропуск', meta: when };
  }
  const head = words.slice(0, Math.max(1, Math.min(3, Math.ceil(words.length / 2) - (words.length <= 3 ? 1 : 0)))).join(' ');
  return { q: `Раскрой тезис по теме «${esc(c.topic)}»: «${esc(head)}…»`, a: esc(c.text), kind: 'Раскрой мысль', meta: when };
}
export const itemOf = (c: Card, r: () => number): QuizItem => { const q = question(c, r); return { cardId: c.id, kind: q.kind, meta: q.meta, q: q.q, a: q.a, result: null, revealed: false, noteId: c.noteId ?? null, key: c.key ?? null }; };
/** порция дня: перемешано детерминированно по дате — открой на телефоне или компьютере, вопросы одни и те же */
export const buildQuiz = (seed: string, pool: Card[], size = QUIZ_SIZE) => { const r = rng(hash(seed)); return shuffle(pool, r).slice(0, size).map(c => itemOf(c, r)); };

/** оценка ответа: «не помню» — снова завтра, «частично» — чуть дальше, «помню» — 2, 5, дальше × лёгкость */
export function grade(st: SrsState, g: 'good' | 'hard' | 'again', today: string): SrsState {
  let { interval, ease, reps } = st;
  if (g === 'again') { interval = 1; ease = Math.max(1.3, ease - 0.2); reps = 0; }
  else if (g === 'hard') { interval = Math.max(1, Math.round(interval * 1.2) || 1); ease = Math.max(1.3, ease - 0.05); reps++; }
  else { interval = reps === 0 ? 2 : reps === 1 ? 5 : Math.round(interval * ease); ease = Math.min(3, ease + 0.05); reps++; }
  return { interval, ease: Math.round(ease * 100) / 100, reps, due: addDays(today, interval), last: today };
}
