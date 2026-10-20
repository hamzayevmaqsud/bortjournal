/** Учёба: занятие → карточки (тезисы, вопрос→ответ, «вспомни тему»), порция дня, оценки SM-2, «ещё», минуты, проверка без ключа */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { allCards, buildQuiz, grade, hash } from '../src/modules/study/cards.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '';
const H = { host: 'localhost' }, today = localNow(240).day;
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });

beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'student', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  await grantFree(conn.db, u!.id); await grant(conn.db, u!.id, 'pro', 'free');
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'student', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('карточки', () => {
  it('id как в старом журнале — по тексту тезиса', () => {
    const cards = allCards([{ id: 'abc', day: '2026-10-01', topic: 'C#', category: null, theses: ['Делегат — это тип метода', 'event запрещает вызов извне'], qa: [{ q: 'Func?', a: 'возвращает' }] }]);
    expect(cards.map(c => c.id)).toEqual([`abc:t${hash('Делегат — это тип метода').toString(36)}`, `abc:t${hash('event запрещает вызов извне').toString(36)}`, `abc:a${hash('Func?').toString(36)}`, 'abc:sum']);
    // одна и та же дата — одна и та же порция
    expect(buildQuiz('2026-10-02', cards).map(i => i.cardId)).toEqual(buildQuiz('2026-10-02', cards).map(i => i.cardId));
  });
  it('интервалы: помню 2 → 5 → ×лёгкость, не помню — завтра', () => {
    let st = { interval: 0, ease: 2.5, reps: 0, due: today };
    st = grade(st, 'good', today); expect(st).toMatchObject({ interval: 2, reps: 1, due: addDays(today, 2) });
    st = grade(st, 'good', today); expect(st.interval).toBe(5);
    st = grade(st, 'good', today); expect(st.interval).toBe(13); // 5 × 2,6
    st = grade(st, 'again', today); expect(st).toMatchObject({ interval: 1, reps: 0, due: addDays(today, 1) });
  });
});

describe('учёба', () => {
  it('занятие вчера → сегодня вопросы', async () => {
    const r = await req('POST', '/api/study/sessions', { day: addDays(today, -1), time: '19:00', topic: 'Делегаты в C#', category: 'C#', minutes: 45,
      theses: 'Делегат — это тип, описывающий сигнатуру метода\nevent запрещает вызывать делегат извне класса', qa: 'Чем Action отличается от Func? => Func возвращает значение' });
    expect(r.statusCode).toBe(201);
    const q = (await req('GET', '/api/study/quiz')).json();
    expect(q.items).toHaveLength(4); expect(q.total).toBe(4);
    expect(q.items.every((i: any) => i.result === null)).toBe(true);
    // повторный запрос — та же порция
    expect((await req('GET', '/api/study/quiz')).json().items.map((i: any) => i.cardId)).toEqual(q.items.map((i: any) => i.cardId));
    expect((await req('GET', `/api/today?day=${today}`)).json().parts.study.quiz).toMatchObject({ left: 4, total: 4 });
  });
  it('оценка двигает повторение и считается на «Сегодня»', async () => {
    const g = (await req('POST', '/api/study/quiz/grade', { index: 0, grade: 'good' })).json();
    expect(g.next).toMatchObject({ interval: 2, due: addDays(today, 2) });
    expect((await req('GET', '/api/study/quiz')).json().items[0].result).toBe('good');
    expect((await req('GET', `/api/today?day=${today}`)).json().parts.study.quiz.left).toBe(3);
    expect((await req('POST', '/api/study/quiz/grade', { index: 1, grade: 'wat' })).statusCode).toBe(400);
  });
  it('«ещё» — нечего; досрочно — из ближайших', async () => {
    expect((await req('POST', '/api/study/quiz/more', {})).statusCode).toBe(400);
    expect((await req('POST', '/api/study/quiz/more', { mode: 'early' })).json().added).toBe(1);
  });
  it('минуты, обзор, проверка без ключа', async () => {
    await req('PUT', '/api/study/time', { key: 'obs-entry-1', day: today, minutes: 30 });
    const o = (await req('GET', '/api/study/overview')).json();
    expect(o.kpi).toMatchObject({ sessions: 1, week: 75, all: 75 });
    expect(o.obs.enabled).toBe(false);
    expect(o.diary[0]).toMatchObject({ src: 'manual', title: 'Делегаты в C#' });
    expect((await req('POST', '/api/study/quiz/check', { answer: 'тип', question: 'x', reference: 'y' })).statusCode).toBe(503);
  });
});
