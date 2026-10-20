/** Запросы к API. Ошибка несёт текст для человека и код ответа */
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: opts.method ?? 'GET', credentials: 'same-origin', headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch { throw new ApiError(0, 'Нет связи с сервером. Проверь интернет и Tailscale.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (data as { error?: string }).error ?? `Ошибка ${r.status}`);
  return data as T;
}

export interface Subscription { pro: boolean; source: 'trial' | 'web' | 'apple' | 'google' | 'free' | null; expiresAt: string | null; daysLeft: number | null; plan: 'month' | 'year' | null; autoRenew: boolean; ended?: boolean; features?: import('@bortjournal/core').PackKey[] | null }
export interface Profile { sex: string | null; age: number | null; heightCm: number | null; goal: string | null; targetKg: number | null; startWeightKg: number | null; settings: Record<string, any> }
export interface Me { username: string; tzOffset: number; modules: string[]; subscription: Subscription; profile: Profile | null }
export interface PlanResult { kcal: number; protein: number; fat: number; carbs: number; weeklyKg: number; tdee: number; bmi: number; notes: string[]; weeks: number | null; water: number; steps: number }
export interface TaskFull { id: string; title: string; day: string | null; time: string | null; done: boolean; prio: boolean; note: string | null; repeat: boolean }
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
