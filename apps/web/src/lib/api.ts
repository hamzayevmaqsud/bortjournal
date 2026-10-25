/**
 * Запросы к API. Ошибка несёт текст для человека и код ответа.
 * Без сети: последние ответы GET берутся из памяти телефона, а ежедневные записи (еда, вода, шаги, задачи, траты,
 * подходы, минуты учёбы, отметки привычек) встают в очередь и уходят сами, когда связь вернётся. У каждой записи свой ключ
 * (Idempotency-Key): если ответ потерялся и запрос ушёл повторно, сервер не создаст дубль.
 */
import { applyTheme } from './theme';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

const OFFLINE = 'Нет связи с сервером. Проверь интернет и Tailscale.';
const OFFLINE_MARK = '__offline';
/** ответ взят из копии на телефоне (нет сети) */
export const fromCache = (x: unknown) => !!x && typeof x === 'object' && (x as Record<string, unknown>)[OFFLINE_MARK] === true;
// какие записи можно отложить: всё, что не требует ответа сервера прямо сейчас (не ИИ, не поиск, не оплата, не ответы на вопросы)
const QUEUEABLE = /^\/api\/(food\/(meals|drinks|entries)|body\/day|plans\/(tasks|goals|notes)|budget\/entries|gym\/(live|workouts)|study\/(time|sessions)|books\/[^/]+\/(progress|quotes)|habits\/[^/]+\/check|journal$)/;
/*
 * Очередь и копии ответов принадлежат человеку: owner — логин последнего вошедшего на этом устройстве.
 * Запись уходит на сервер, только если сейчас вошёл тот же человек (проверяем /api/me перед отправкой);
 * копии ответов читаются только для него. Так записи одного не попадут в аккаунт другого на общем телефоне.
 */
const OUTBOX = 'bj-outbox', CACHE = 'bj-cache', OWNER = 'bj-owner', CACHE_MAX = 40;
interface Pending { path: string; method: string; body?: unknown; key: string; at: number; owner: string }
const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* память переполнена — без кэша */ } };
const uuid = () => (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const notify = () => dispatchEvent(new Event('bj-outbox'));
const owner = () => { try { return localStorage.getItem(OWNER) ?? ''; } catch { return ''; } };
/** кто вошёл на этом устройстве — вызывается, когда пришёл /api/me */
export function setOwner(username: string) {
  const u = username.toLowerCase();
  if (u === owner()) return;
  try { localStorage.setItem(OWNER, u); } catch { /* без памяти */ }
  notify();
}
const mine = () => read<Pending[]>(OUTBOX, []).filter(p => p.owner && p.owner === owner());
/** логин сменился (демо сохранено как аккаунт) — очередь и копии ответов переходят к новому логину */
export function renameOwner(username: string) {
  const from = owner(), to = username.toLowerCase();
  if (!from || from === to) return;
  write(OUTBOX, read<Pending[]>(OUTBOX, []).map(p => p.owner === from ? { ...p, owner: to } : p));
  write(CACHE, Object.fromEntries(Object.entries(read<Cache>(CACHE, {})).map(([k, v]) => [k.startsWith(`${from}|`) ? `${to}|${k.slice(from.length + 1)}` : k, v])));
  try { localStorage.setItem(OWNER, to); } catch { /* без памяти */ }
  notify();
}

/** сколько записей этого человека ждут отправки */
export const pendingCount = () => owner() ? mine().length : 0;
type Cache = Record<string, { at: number; data: unknown }>;
function remember(path: string, data: unknown) {
  const o = owner(); if (!o || !path.startsWith('/api/') || path.includes('search')) return;
  const c = read<Cache>(CACHE, {});
  c[`${o}|${path}`] = { at: Date.now(), data };
  const keys = Object.keys(c).sort((a, b) => c[b]!.at - c[a]!.at);
  for (const k of keys.slice(CACHE_MAX)) delete c[k];
  write(CACHE, c);
}
const cached = (path: string) => { const o = owner(); return o ? read<Cache>(CACHE, {})[`${o}|${path}`]?.data : undefined; };
/** выйти из аккаунта — стереть копии ответов и очередь этого человека (чужие не трогаем) */
export const forgetLocal = () => {
  const o = owner();
  write(OUTBOX, read<Pending[]>(OUTBOX, []).filter(p => p.owner !== o));
  write(CACHE, Object.fromEntries(Object.entries(read<Cache>(CACHE, {})).filter(([k]) => !k.startsWith(`${o}|`))));
  try { localStorage.removeItem(OWNER); } catch { /* нет доступа */ }
  // тема прошлого человека не переходит к следующему на этом устройстве
  applyTheme('system'); dispatchEvent(new Event('lumi-theme'));
  notify();
};

async function send(path: string, method: string, body: unknown, key?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  return fetch(path, { method, credentials: 'same-origin', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

/** шлюз (Cloudflare, прокси) ответил вместо приложения: 502–504, 520–530 */
const GATEWAY = (s: number) => s === 502 || s === 503 || s === 504 || (s >= 520 && s <= 530);
/** ответ не от приложения: ошибка шлюза без нашего {error} или страница прокси вместо JSON — для очереди это «нет сети» */
const notOurs = (r: Response, data: unknown) => !r.ok && (data === null || (GATEWAY(r.status) && typeof (data as { error?: unknown }).error !== 'string'));
const readBody = async (r: Response): Promise<unknown> => { const t = await r.text().catch(() => ''); if (!t) return {}; try { return JSON.parse(t); } catch { return null; } };

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET', key = method === 'GET' ? undefined : uuid();
  let r: Response | null = null, data: unknown = null;
  try { r = await send(path, method, opts.body, key); data = await readBody(r); if (notOurs(r, data)) r = null; } catch { r = null; }
  if (!r) {
    // сети нет или сервер недоступен: GET — из копии, запись — в очередь с тем же ключом (если дошла, сервер не задвоит)
    if (method === 'GET') {
      const c = cached(path);
      // копия без сети помечена: экран не затирает ею то, что человек только что записал
      if (c !== undefined) return (c && typeof c === 'object' ? Object.defineProperty(structuredClone(c), OFFLINE_MARK, { value: true }) : c) as T;
      throw new ApiError(0, OFFLINE);
    }
    const o = owner();
    if (o && QUEUEABLE.test(path)) {
      write(OUTBOX, [...read<Pending[]>(OUTBOX, []), { path, method, body: opts.body, key: key!, at: Date.now(), owner: o }]); notify();
      return { queued: true } as T;
    }
    throw new ApiError(0, OFFLINE);
  }
  if (data === null) data = {};
  // раздел закрыт подпиской — приложение откроет тарифы
  // нужно согласие на ИИ — приложение покажет экран согласия
  if (r.status === 428) dispatchEvent(new Event('bj-consent'));
  if (r.status === 402) dispatchEvent(new CustomEvent('bj-paywall', { detail: (data as { feature?: string }).feature ?? null }));
  if (!r.ok) throw new ApiError(r.status, (data as { error?: string }).error ?? `Ошибка ${r.status}`);
  if (method === 'GET') remember(path, data); else if (!path.startsWith('/api/auth/') && pendingCount()) void flushOutbox();
  return data as T;
}

let flushing = false;
/**
 * Отправить отложенное по порядку — только если сейчас вошёл владелец записей.
 * Ответ 4xx — запись не принята, убираем; нет сети, сервер недоступен или 401 — попробуем позже всю очередь.
 * Одна запись не держит остальные: «ещё отправляется» (409) или ошибка приложения на ней — пропускаем до следующего раза.
 */
export async function flushOutbox(): Promise<{ sent: number; dropped: number }> {
  if (flushing || !pendingCount()) return { sent: 0, dropped: 0 };
  flushing = true; let sent = 0, dropped = 0;
  try {
    const who = await fetch('/api/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null) as { username?: string } | null;
    if (!who?.username || who.username.toLowerCase() !== owner()) return { sent, dropped };
    const skip = new Set<string>();
    for (;;) {
      const x = mine().find(p => !skip.has(p.key)); if (!x) break;
      let r: Response;
      try { r = await send(x.path, x.method, x.body, x.key); } catch { break; }
      const data = await readBody(r);
      // сервера не видно (шлюз, страница прокси) или вышли из аккаунта — вся очередь ждёт
      if (notOurs(r, data) || r.status === 401) break;
      // эта запись ещё отправляется (или упала на сервере) — остальные не ждут её
      if (r.status >= 500 || (r.status === 409 && r.headers.get('Idempotent-Replay'))) { skip.add(x.key); continue; }
      if (r.ok) sent++; else dropped++;
      write(OUTBOX, read<Pending[]>(OUTBOX, []).filter(p => p.key !== x.key)); notify();
    }
  } finally { flushing = false; }
  if (sent || dropped) dispatchEvent(new CustomEvent('bj-synced', { detail: { sent, dropped } }));
  return { sent, dropped };
}
if (typeof window !== 'undefined') {
  addEventListener('online', () => { void flushOutbox(); }); setInterval(() => { if (pendingCount()) void flushOutbox(); }, 20000);
  // очередь от старой версии без владельца — не отправляем никуда
  try { const q = read<Pending[]>(OUTBOX, []); if (q.some(p => !p.owner)) write(OUTBOX, q.filter(p => p.owner)); } catch { /* нет доступа */ }
}

export interface Subscription { pro: boolean; source: 'trial' | 'web' | 'apple' | 'google' | 'free' | 'beta' | null; expiresAt: string | null; daysLeft: number | null; plan: 'month' | 'year' | null; autoRenew: boolean; ended?: boolean; beta?: boolean; features?: import('@bortjournal/core').PackKey[] | null }
export interface Profile { sex: string | null; age: number | null; heightCm: number | null; goal: string | null; pace?: string | null; targetKg: number | null; startWeightKg: number | null; settings: Record<string, any> }
export interface Me { admin?: boolean; /** демо без регистрации: удалится в demoUntil, пока не сохранено как аккаунт */ demo?: boolean; demoUntil?: string | null; username: string; tzOffset: number; modules: string[]; subscription: Subscription; profile: Profile | null }
export interface PlanResult { kcal: number; protein: number; fat: number; carbs: number; weeklyKg: number; tdee: number; bmi: number; notes: string[]; weeks: number | null; water: number; steps: number }
export interface TaskFull { id: string; title: string; day: string | null; time: string | null; done: boolean; prio: boolean; note: string | null; repeat: boolean; seriesId?: string | null; goalId?: string | null }
export interface Goal { id: string; period: "week" | "month" | "quarter" | "year"; periodKey: string; title: string; note: string | null; done: boolean; parentId: string | null; progress: number; tasks: number; tasksDone: number; kids: number }
export interface Meal { source?: string; id: string; day: string; time: string | null; slot: string | null; name: string; kcal: number; protein: number; fat: number; carbs: number }
export interface Drink { id: string; day: string; time: string | null; type: string; ml: number; title: string; kcal: number; name: string | null; kcalPer100: number | null; sugarPer100: number | null }
export interface DayEvent { id: string | null; module: string; kind: string; time: string | null; title: string; value: number | null; unit: string | null; data: Record<string, unknown> | null }
/** своя привычка на выбранный день: last7 — [день−6 … день] */
export interface Habit { id: string; title: string; icon: string | null; color: string | null; sort: number; done: boolean; streak: number; last7: boolean[] }
export interface HabitsDay { day: string; today: string; limit: number; items: Habit[] }
export interface Task { id: string; title: string; time: string | null; done: boolean; prio: boolean; repeat: boolean }
export interface CalEvent { id: string; title: string; time: string | null; minutes: number | null }
export interface Today {
  day: string; now: { day: string; hm: string; minutes: number }; isToday: boolean; name: string | null;
  plan: { kcal: number; protein: number }; streak: number; modules: string[]; events: DayEvent[]; subscription: Subscription;  /** события Google Календаря на этот день (если подключён); time null — на весь день */
  calendar?: CalEvent[];
  parts: {
    food?: { kcal: number; protein: number; fat: number; carbs: number; waterMl: number; norm: { kcal: number; protein: number; fat: number; carbs: number; water: number } };
    body?: { steps: number; stepsGoal: number; weight: { kg: number; day: string | null; today: boolean } | null };
    study?: { minutes: number; goal: number; quiz: { left: number; total: number } | null };
    budget?: { configured: boolean; currency?: string; leftToday?: number; allow?: number };
    books?: { reading: { id: string; title: string; page: number; pages: number | null; pct: number; todayPages: number } | null };
    gym?: { workouts: Array<{ id: string; title: string; time: string | null; minutes: number | null }>; plan: { id: string; name: string; time: string | null; exercises: number } | null };
    plans?: { tasks: Task[] };
  };
}
export interface FoodDay {
  meals: Meal[];
  drinks: Drink[];
  /** черновики приёма: фото еды в разборе или ждёт подтверждения */
  drafts?: FoodDraft[];
  /** draft — предварительная часть итогов (калории неподтверждённых фото) */
  totals: { kcal: number; protein: number; fat: number; carbs: number; waterMl: number; draft?: { kcal: number; protein: number; fat: number; carbs: number } };
}
export interface FoodDraftItem { name: string; grams: number; kcal: number; protein: number; fat: number; carbs: number; fiber: number; sugar: number; salt: number; confidence: string; source: string }
/** черновик приёма: queued и working — разбирается, ready — ждёт подтверждения, failed — не удался */
export interface FoodDraft {
  id: string; state: 'queued' | 'working' | 'ready' | 'failed'; day: string; time: string | null; slot: string | null; note: string; scale: string;
  isFood: boolean | null; items: FoodDraftItem[]; questions: Array<{ text: string; options: string[] }>; comment: string; error: string | null; attempts: number;
}
export const draftPending = (d: FoodDraft) => d.state === 'queued' || d.state === 'working';
