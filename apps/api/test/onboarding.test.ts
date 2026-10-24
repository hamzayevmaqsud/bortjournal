/** Анкета по целям: цели → разделы, нормы по формулам и правка руками, привычки, напоминания, повтор анкеты, старый клиент, советы по целям */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { computePlan, habitsFor, remindKinds, sectionsFor } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grantFree } from '../src/core/entitlements.js';
import { GOAL_BOOST, rankTips, tipInput, type Area, type TipInput } from '../src/core/insights.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const H = { host: 'localhost' }, TZ = 240;
const ids: Record<string, string> = {}, cookies: Record<string, string> = {};
const as = (name: string) => (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: cookies[name]! } });
const settingsOf = async (name: string) => (await conn.db.select().from(s.profiles).where(eq(s.profiles.userId, ids[name]!)))[0]?.settings as Record<string, any>;

beforeAll(async () => {
  conn = await freshDb();
  for (const name of ['slim', 'reader', 'redo', 'old', 'bad']) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: TZ }).returning();
    ids[name] = u!.id; await grantFree(conn.db, u!.id);
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const name of Object.keys(ids)) cookies[name] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: name, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('анкета: цели → разделы, привычки, напоминания', () => {
  it('разделы и подсказки выводятся из целей', () => {
    expect(sectionsFor(['weight'])).toEqual(['food', 'water', 'steps']);
    expect(sectionsFor(['muscle', 'books'])).toEqual(['food', 'gym', 'books']);
    expect(sectionsFor(['money', 'plans', 'routine'])).toEqual(['tasks', 'budget']);
    expect(sectionsFor([])).toEqual(['food', 'water', 'steps', 'tasks']);
    // первые три подсказки — по одной на цель
    expect(habitsFor(['water', 'books', 'routine']).slice(0, 3).map(h => h.title)).toEqual(['Стакан воды после пробуждения', '10 страниц перед сном', 'Медитация 5 минут']);
    expect(habitsFor(['weight', 'muscle', 'move', 'routine']).length).toBe(6);
    // напоминания — только к выбранным разделам и времени суток
    expect(remindKinds(['books'], ['evening'])).toMatchObject({ tip: true, streak: true, review: true, water: false, food: false, quiz: false });
    expect(remindKinds(['water', 'study'], ['morning', 'day'])).toMatchObject({ quiz: true, water: true, food: false, tip: false });
  });

  it('похудеть: тело → план по формулам, нормы поправлены руками, привычки созданы, напоминания и цели сохранены', async () => {
    const r = as('slim');
    const body = { sex: 'f', age: 34, height: 168, weight: '82,5', activity: 'light', steps: 6000, goal: 'lose', pace: 'mid', target: 70 };
    const res = await r('POST', '/api/profile/onboarding', {
      name: '  Аня ', goals: ['weight', 'water', 'nonsense'], ...body, norms: { water: 2500 },
      habits: [{ title: 'Стакан воды после пробуждения', icon: '💧', color: 'water' }, { title: 'Овощи к обеду и ужину', icon: '🥗', color: 'steps' }],
      remind: { kinds: remindKinds(sectionsFor(['weight', 'water']), ['day', 'evening']) }
    });
    expect(res.statusCode).toBe(200);
    const plan = computePlan({ sex: 'f', age: 34, height: 168, goal: 'lose', pace: 'mid', steps: 6000 }, 82.5, 'light', 6000);
    expect(res.json().plan).toMatchObject({ kcal: plan.kcal, protein: plan.protein, water: 2500, steps: 8000 });
    expect(res.json().plan.weeks).toBeGreaterThan(0);
    expect(res.json().habits).toEqual(['Стакан воды после пробуждения', 'Овощи к обеду и ужину']);
    const st = await settingsOf('slim');
    expect(st).toMatchObject({ name: 'Аня', goals: ['weight', 'water'], sections: ['food', 'water', 'steps'], kcal: plan.kcal, protein: plan.protein, water: 2500, steps: 8000, onboarded: true });
    expect(st.remind).toMatchObject({ water: true, food: true, tip: true, quiz: false, gym: false });
    const [p] = await conn.db.select().from(s.profiles).where(eq(s.profiles.userId, ids.slim!));
    expect(p).toMatchObject({ sex: 'f', heightCm: 168, goal: 'lose', targetKg: 70, startWeightKg: 82.5 });
    expect((await r('GET', '/api/habits')).json().items.map((h: any) => [h.title, h.icon, h.color])).toEqual([['Стакан воды после пробуждения', '💧', 'water'], ['Овощи к обеду и ужину', '🥗', 'steps']]);
    // вес — в «Тело», приветствие — по имени
    const t = (await r('GET', '/api/today')).json();
    expect(t.name).toBe('Аня');
    expect(t.parts.body.weight.kg).toBe(82.5);
  });

  it('калории поправлены руками — углеводы добирают разницу', async () => {
    const r = as('redo');
    const res = await r('POST', '/api/profile/onboarding', { goals: ['muscle'], sex: 'm', age: 25, height: 180, weight: 70, activity: 'mod', goal: 'gain', norms: { kcal: 3000, protein: 150 } });
    expect(res.statusCode).toBe(200);
    const st = await settingsOf('redo');
    expect(st).toMatchObject({ kcal: 3000, protein: 150, sections: ['food', 'gym'], goals: ['muscle'] });
    expect(st.carbs).toBe(Math.round((3000 - 150 * 4 - st.fat * 9) / 4 / 5) * 5);
  });

  it('без еды — тело не нужно: разделы, привычки и напоминания сохраняются, профиль тела не трогаем', async () => {
    const r = as('reader');
    const res = await r('POST', '/api/profile/onboarding', { goals: ['books', 'money'], habits: [{ title: '10 страниц перед сном', icon: '📖', color: 'books' }], remind: { off: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan).toBeNull();
    const st = await settingsOf('reader');
    expect(st).toMatchObject({ goals: ['money', 'books'], sections: ['budget', 'books'], onboarded: true, name: null, remind: { off: true } });
    expect(st.kcal).toBeUndefined();
    const [p] = await conn.db.select().from(s.profiles).where(eq(s.profiles.userId, ids.reader!));
    expect(p!.heightCm).toBeNull();
    // /api/me: анкета пройдена — второй раз не покажется
    expect((await r('GET', '/api/me')).json().profile.settings.onboarded).toBe(true);
  });

  it('разделы, выбранные руками, важнее целей; повтор анкеты не дублирует привычки', async () => {
    const r = as('reader');
    const res = await r('POST', '/api/profile/onboarding', { goals: ['books'], sections: ['books', 'tasks'], name: 'Боря', habits: [{ title: '10 страниц перед сном' }, { title: 'План на завтра с вечера' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().habits).toEqual(['План на завтра с вечера']);
    expect(await settingsOf('reader')).toMatchObject({ sections: ['tasks', 'books'], goals: ['books'], name: 'Боря', remind: { off: true } });
    expect((await r('GET', '/api/habits')).json().items).toHaveLength(2);
  });

  it('ошибка в данных — ничего не сохраняется', async () => {
    const r = as('bad');
    expect((await r('POST', '/api/profile/onboarding', { goals: ['weight'], sex: 'm', age: 30, height: 90, weight: 80 })).statusCode).toBe(400);
    expect((await r('POST', '/api/profile/onboarding', { goals: ['books'], habits: [{ title: '' }] })).statusCode).toBe(400);
    expect((await r('POST', '/api/profile/onboarding', { goals: 'books' })).statusCode).toBe(400);
    expect((await r('POST', '/api/profile/onboarding', { goals: ['books'], norms: { water: 50 } })).statusCode).toBe(400);
    expect(await settingsOf('bad')).toBeUndefined();
    expect((await r('GET', '/api/habits')).json().items).toEqual([]);
  });

  it('старый клиент без целей: как раньше, пол обязателен', async () => {
    const r = as('old');
    expect((await r('POST', '/api/profile/onboarding', { age: 30, height: 180, weight: 80 })).statusCode).toBe(400);
    const res = await r('POST', '/api/profile/onboarding', { sex: 'm', age: 30, height: 180, weight: 80, goal: 'maintain', sections: ['food', 'tasks'], name: 'Олег' });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.kcal).toBeGreaterThan(1500);
    const st = await settingsOf('old');
    expect(st).toMatchObject({ sections: ['food', 'tasks'], name: 'Олег', onboarded: true });
    expect(st.goals).toBeUndefined();
    // цели можно поменять в профиле
    const put = await r('PUT', '/api/profile/settings', { goals: ['move', 'x'] });
    expect(put.json().settings.goals).toEqual(['move']);
  });
});

describe('советы по целям', () => {
  const N = { kcal: 2200, protein: 130, fat: 70, carbs: 250, water: 2300, steps: 10000, study: 60 };
  const ALL: Area[] = ['food', 'water', 'steps', 'tasks', 'gym', 'study', 'budget', 'books'];
  const input = (x: Partial<TipInput> = {}): TipInput => ({ day: '2026-10-21', minutes: 19 * 60, on: new Set(ALL), norms: N, today: {}, past: [], score: 0.5, perfectMonth: 0, streak: 0, ...x });
  // белок отстаёт сильнее, чем вода: без целей главный — белок
  const today = { meals: 2, kcal: 1500, protein: 60, waterMl: 1000, steps: 9000 };

  it('цель поднимает свои советы выше', () => {
    expect(rankTips(input({ today }))[0]!.key).toBe('protein');
    const w = rankTips(input({ today, goals: new Set(['water']) }));
    expect(w[0]!.key).toBe('water');
    expect(w[0]!.weight - rankTips(input({ today }))[1]!.weight).toBe(GOAL_BOOST);
    // цель без своих советов ничего не меняет
    expect(rankTips(input({ today, goals: new Set(['money']) })).map(t => t.key)).toEqual(rankTips(input({ today })).map(t => t.key));
  });

  it('цели берутся из анкеты', async () => {
    expect([...(await tipInput(conn.db, ids.slim!)).goals!]).toEqual(['weight', 'water']);
    expect((await tipInput(conn.db, ids.bad!)).goals!.size).toBe(0);
  });
});
