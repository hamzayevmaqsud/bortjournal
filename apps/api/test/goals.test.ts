/** Цели и повторы: периоды, вложенность, прогресс по задачам и подцелям, серии задач, пропуск дня, доступ по набору */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow, mondayOf, periodKey, periodLabel, periodRange, repeatHits, shiftPeriod } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', free = '';
const H = { host: 'localhost' }, today = localNow(240).day;
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, c = cookie) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: c } });
const login = async (u: string) => String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: u, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;

beforeAll(async () => {
  conn = await freshDb();
  for (const [name, pro] of [['planner', true], ['basic', false]] as const) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    await grantFree(conn.db, u!.id); if (pro) await grant(conn.db, u!.id, 'pro', 'free');
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = await login('planner'); free = await login('basic');
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('периоды', () => {
  it('ключи, границы, подписи', () => {
    expect(periodKey('week', '2026-10-22')).toBe('2026-10-19');
    expect(periodKey('quarter', '2026-10-22')).toBe('2026-Q4');
    expect(periodRange('month', '2026-02')).toEqual(['2026-02-01', '2026-02-28']);
    expect(periodRange('quarter', '2026-Q4')).toEqual(['2026-10-01', '2026-12-31']);
    expect(periodLabel('week', '2026-10-26')).toBe('26 октября – 1 ноября');
    expect(shiftPeriod('month', '2026-01-31', 1)).toBe('2026-02-01');
  });
  it('правила повтора', () => {
    const base = { startOn: '2026-01-31', skipDays: ['2026-02-02'] };
    expect(repeatHits({ ...base, rule: { kind: 'weekdays' } }, '2026-02-02')).toBe(false); // пропущен
    expect(repeatHits({ ...base, rule: { kind: 'weekdays' } }, '2026-02-03')).toBe(true);
    expect(repeatHits({ ...base, rule: { kind: 'monthly' } }, '2026-02-28')).toBe(true); // 31-го → последний день февраля
    expect(repeatHits({ ...base, rule: { kind: 'days', days: [6] } }, '2026-02-07')).toBe(true);
  });
});

describe('цели', () => {
  let month = '', week = '';
  it('без набора «Цели и повторы» — закрыто, задачи — бесплатно', async () => {
    expect((await req('GET', `/api/plans/goals?from=${today}&to=${today}`, undefined, free)).statusCode).toBe(402);
    expect((await req('POST', '/api/plans/tasks', { title: 'Купить хлеб', day: today }, free)).statusCode).toBe(201);
  });
  it('цель месяца и вложенная цель недели', async () => {
    expect((await req('POST', '/api/plans/goals', { period: 'week', periodKey: addDays(mondayOf(today), 1), title: 'x' })).statusCode).toBe(400);
    month = (await req('POST', '/api/plans/goals', { period: 'month', periodKey: periodKey('month', today), title: 'Сдать экзамен' })).json().id;
    // неделя вкладывается только в месяц
    const year = (await req('POST', '/api/plans/goals', { period: 'year', periodKey: periodKey('year', today), title: 'Год' })).json().id;
    expect((await req('POST', '/api/plans/goals', { period: 'week', periodKey: mondayOf(today), title: 'x', parentId: year })).statusCode).toBe(400);
    week = (await req('POST', '/api/plans/goals', { period: 'week', periodKey: mondayOf(today), title: 'Прочитать главу', parentId: month })).json().id;
    const items = (await req('GET', `/api/plans/goals?from=${today}&to=${today}`)).json().items;
    expect(items.map((g: any) => g.period).sort()).toEqual(['month', 'week', 'year']);
  });
  it('прогресс: задачи цели и подцели', async () => {
    const t1 = (await req('POST', '/api/plans/tasks', { title: 'Глава 1', day: today, goalId: week })).json();
    await req('POST', '/api/plans/tasks', { title: 'Глава 2', day: today, goalId: week });
    await req('POST', `/api/plans/tasks/${t1.id}/toggle`);
    const g = async () => Object.fromEntries((await req('GET', `/api/plans/goals?from=${today}&to=${today}`)).json().items.map((x: any) => [x.id, x]));
    expect((await g())[week]).toMatchObject({ progress: 50, tasks: 2, tasksDone: 1 });
    expect((await g())[month]).toMatchObject({ progress: 50, kids: 1 });
    await req('POST', `/api/plans/goals/${week}/toggle`);
    expect((await g())[month].progress).toBe(100);
    // чужую цель к задаче не привязать
    const other = (await req('POST', '/api/plans/tasks', { title: 'Чужая', day: today, goalId: week }, free)).json();
    expect(other.goalId).toBeNull();
  });
  it('удаление цели оставляет задачи и подцели', async () => {
    await req('DELETE', `/api/plans/goals/${month}`);
    const items = (await req('GET', `/api/plans/goals?from=${today}&to=${today}`)).json().items;
    expect(items.find((x: any) => x.id === week).parentId).toBeNull();
  });
});

describe('повторы', () => {
  let sid = '';
  const tasksAhead = async () => (await req('GET', `/api/plans/tasks?from=${today}&to=${addDays(today, 13)}`)).json().items.filter((t: any) => t.seriesId === sid);
  it('серия создаёт задачи на 14 дней вперёд, без дублей', async () => {
    expect((await req('POST', '/api/plans/series', { title: 'Зарядка', rule: { kind: 'days' } })).statusCode).toBe(400);
    const r = (await req('POST', '/api/plans/series', { title: 'Зарядка', time: '07:30', rule: { kind: 'daily' } })).json();
    sid = r.id;
    expect(r).toMatchObject({ made: 14, text: 'каждый день' });
    expect((await tasksAhead()).length).toBe(14);
    expect((await tasksAhead()).length).toBe(14); // повторный запрос не плодит
    expect((await tasksAhead())[0]).toMatchObject({ repeat: true, time: '07:30' });
  });
  it('удалить одну — повтор её не вернёт', async () => {
    const t = (await tasksAhead()).find((x: any) => x.day === addDays(today, 2));
    await req('DELETE', `/api/plans/tasks/${t.id}`);
    const left = await tasksAhead();
    expect(left.length).toBe(13);
    expect(left.some((x: any) => x.day === addDays(today, 2))).toBe(false);
  });
  it('правка серии меняет будущие несделанные, сделанные остаются', async () => {
    const first = (await tasksAhead())[0];
    await req('POST', `/api/plans/tasks/${first.id}/toggle`);
    await req('PUT', `/api/plans/series/${sid}`, { title: 'Зарядка 15 минут', rule: { kind: 'weekdays' } });
    const now = await tasksAhead();
    expect(now.find((x: any) => x.id === first.id)).toMatchObject({ title: 'Зарядка', done: true });
    expect(now.filter((x: any) => !x.done).every((x: any) => x.title === 'Зарядка 15 минут')).toBe(true);
    expect(now.filter((x: any) => !x.done).every((x: any) => { const wd = new Date(x.day + 'T12:00Z').getUTCDay(); return wd >= 1 && wd <= 5; })).toBe(true);
  });
  it('удалить все повторы', async () => {
    expect((await req('DELETE', `/api/plans/series/${sid}`)).json().ok).toBe(true);
    const items = (await req('GET', `/api/plans/tasks?from=${today}&to=${addDays(today, 13)}`)).json().items;
    expect(items.filter((t: any) => t.title.startsWith('Зарядка') && !t.done)).toEqual([]);
    expect(items.filter((t: any) => t.title === 'Зарядка' && t.done).length).toBe(1);
  });
});

describe('прогресс с повторами', () => {
  it('будущие задачи повтора не считаются: сделал сегодняшнюю — 100%', async () => {
    const g = (await req('POST', '/api/plans/goals', { period: 'week', periodKey: mondayOf(today), title: 'Зарядка всю неделю' })).json().id;
    const sid = (await req('POST', '/api/plans/series', { title: 'Зарядка утром', rule: { kind: 'daily' }, goalId: g })).json().id;
    const t = (await req('GET', `/api/plans/tasks?from=${today}&to=${today}`)).json().items.find((x: any) => x.seriesId === sid);
    await req('POST', `/api/plans/tasks/${t.id}/toggle`);
    const goal = (await req('GET', `/api/plans/goals?from=${today}&to=${today}`)).json().items.find((x: any) => x.id === g);
    expect(goal).toMatchObject({ progress: 100, tasks: 1, tasksDone: 1 });
  });
});
