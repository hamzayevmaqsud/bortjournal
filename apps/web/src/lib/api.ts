/**
 * Запросы к API. Ошибка несёт текст для человека и код ответа.
 * Без сети: последние ответы GET берутся из памяти телефона, а ежедневные записи (еда, вода, шаги, задачи, траты,
 * подходы, минуты учёбы) встают в очередь и уходят сами, когда связь вернётся. У каждой записи свой ключ
 * (Idempotency-Key): если ответ потерялся и запрос ушёл повторно, сервер не создаст дубль.
 */
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

const OFFLINE = 'Нет связи с сервером. Проверь интернет и Tailscale.';
// какие записи можно отложить: всё, что не требует ответа сервера прямо сейчас (не ИИ, не поиск, не оплата)
const QUEUEABLE = /^\/api\/(food\/(meals|drinks|entries)|body\/day|plans\/(tasks|goals)|budget\/entries|gym\/(live|workouts)|study\/(time|sessions|quiz\/grade)|books\/[^/]+\/(progress|quotes))/;
const OUTBOX = 'bj-outbox', CACHE = 'bj-cache', CACHE_MAX = 40;
interface Pending { path: string; method: string; body?: unknown; key: string; at: number }
const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* память переполнена — без кэша */ } };
const uuid = () => (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const notify = () => dispatchEvent(new Event('bj-outbox'));

/** сколько записей ждут отправки */
export const pendingCount = () => read<Pending[]>(OUTBOX, []).length;
function remember(path: string, data: unknown) {
  if (!path.startsWith('/api/') || path.includes('search')) return;
  const c = read<Record<string, { at: number; data: unknown }>>(CACHE, {});
  c[path] = { at: Date.now(), data };
  const keys = Object.keys(c).sort((a, b) => c[b]!.at - c[a]!.at);
  for (const k of keys.slice(CACHE_MAX)) delete c[k];
  write(CACHE, c);
}
const cached = (path: string) => read<Record<string, { at: number; data: unknown }>>(CACHE, {})[path]?.data;
/** выйти из аккаунта — стереть копии ответов и очередь этого человека */
export const forgetLocal = () => { try { localStorage.removeItem(CACHE); localStorage.removeItem(OUTBOX); } catch { /* нет доступа */ } notify(); };

async function send(path: string, method: string, body: unknown, key?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  return fetch(path, { method, credentials: 'same-origin', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET', key = method === 'GET' ? undefined : uuid();
  let r: Response;
  try { r = await send(path, method, opts.body, key); }
  catch {
    if (method === 'GET') { const c = cached(path); if (c !== undefined) return c as T; throw new ApiError(0, OFFLINE); }
    if (QUEUEABLE.test(path)) {
      write(OUTBOX, [...read<Pending[]>(OUTBOX, []), { path, method, body: opts.body, key: key!, at: Date.now() }]); notify();
      return { queued: true } as T;
    }
    throw new ApiError(0, OFFLINE);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (data as { error?: string }).error ?? `Ошибка ${r.status}`);
  if (method === 'GET') remember(path, data); else if (pendingCount()) void flushOutbox();
  return data as T;
}

let flushing = false;
/** отправить отложенное по порядку; ответ 4xx — запись не принята, убираем; нет сети или 5xx — попробуем позже */
export async function flushOutbox(): Promise<{ sent: number; dropped: number }> {
  if (flushing) return { sent: 0, dropped: 0 };
  flushing = true; let sent = 0, dropped = 0;
  try {
    for (;;) {
      const q = read<Pending[]>(OUTBOX, []), x = q[0]; if (!x) break;
      let r: Response;
      try { r = await send(x.path, x.method, x.body, x.key); } catch { break; }
      if (r.status >= 500 || r.status === 401) break;
      if (r.ok) sent++; else dropped++;
      write(OUTBOX, read<Pending[]>(OUTBOX, []).filter(p => p.key !== x.key)); notify();
    }
  } finally { flushing = false; }
  if (sent || dropped) dispatchEvent(new CustomEvent('bj-synced', { detail: { sent, dropped } }));
  return { sent, dropped };
}
if (typeof window !== 'undefined') { addEventListener('online', () => { void flushOutbox(); }); setInterval(() => { if (pendingCount()) void flushOutbox(); }, 20000); }

export interface Subscription { pro: boolean; source: 'trial' | 'web' | 'apple' | 'google' | 'free' | null; expiresAt: string | null; daysLeft: number | null; plan: 'month' | 'year' | null; autoRenew: boolean; ended?: boolean; features?: import('@bortjournal/core').PackKey[] | null }
export interface Profile { sex: string | null; age: number | null; heightCm: number | null; goal: string | null; pace?: string | null; targetKg: number | null; startWeightKg: number | null; settings: Record<string, any> }
export interface Me { username: string; tzOffset: number; modules: string[]; subscription: Subscription; profile: Profile | null }
export interface PlanResult { kcal: number; protein: number; fat: number; carbs: number; weeklyKg: number; tdee: number; bmi: number; notes: string[]; weeks: number | null; water: number; steps: number }
export interface TaskFull { id: string; title: string; day: string | null; time: string | null; done: boolean; prio: boolean; note: string | null; repeat: boolean; seriesId?: string | null; goalId?: string | null }
export interface Goal { id: string; period: "week" | "month" | "quarter" | "year"; periodKey: string; title: string; note: string | null; done: boolean; parentId: string | null; progress: number; tasks: number; tasksDone: number; kids: number }
export interface Meal { source?: string; id: string; day: string; time: string | null; slot: string | null; name: string; kcal: number; protein: number; fat: number; carbs: number }
export interface Drink { id: string; day: string; time: string | null; type: string; ml: number; title: string; kcal: number; name: string | null; kcalPer100: number | null; sugarPer100: number | null }
export interface DayEvent { id: string | null; module: string; kind: string; time: string | null; title: string; value: number | null; unit: string | null; data: Record<string, unknown> | null }
export interface Task { id: string; title: string; time: string | null; done: boolean; prio: boolean; repeat: boolean }
export interface Today {
  day: string; now: { day: string; hm: string; minutes: number }; isToday: boolean; name: string | null;
  plan: { kcal: number; protein: number }; streak: number; modules: string[]; events: DayEvent[]; subscription: Subscription;
  parts: {
    food?: { kcal: number; protein: number; fat: number; carbs: number; waterMl: number; norm: { kcal: number; protein: number; fat: number; carbs: number; water: number } };
    body?: { steps: number; stepsGoal: number; weight: { kg: number; day: string | null; today: boolean } | null };
    study?: { minutes: number; goal: number; quiz: { left: number; total: number } };
    budget?: { configured: boolean; currency?: string; leftToday?: number; allow?: number };
    books?: { reading: { id: string; title: string; page: number; pages: number | null; pct: number; todayPages: number } | null };
    gym?: { workouts: Array<{ id: string; title: string; time: string | null; minutes: number | null }>; plan: { id: string; name: string; time: string | null; exercises: number } | null };
    plans?: { tasks: Task[] };
  };
}
export interface FoodDay {
  meals: Meal[];
  drinks: Drink[];
  totals: { kcal: number; protein: number; fat: number; carbs: number; waterMl: number };
}
