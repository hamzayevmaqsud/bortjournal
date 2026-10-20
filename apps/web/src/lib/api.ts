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

export interface Me { username: string; tzOffset: number; modules: string[]; profile: { settings?: Record<string, unknown> } | null }
export interface DayEvent { id: string | null; module: string; kind: string; time: string | null; title: string; value: number | null; unit: string | null; data: Record<string, unknown> | null }
export interface Task { id: string; title: string; time: string | null; done: boolean; prio: boolean; repeat: boolean }
export interface Today {
  day: string; now: { day: string; hm: string; minutes: number }; isToday: boolean; name: string | null;
  plan: { kcal: number; protein: number }; streak: number; modules: string[]; events: DayEvent[];
  parts: {
    food?: { kcal: number; protein: number; fat: number; carbs: number; waterMl: number; norm: { kcal: number; protein: number; water: number } };
    body?: { steps: number; stepsGoal: number; weight: { kg: number; day: string | null; today: boolean } | null };
    study?: { minutes: number; goal: number; quiz: { left: number; total: number } };
    budget?: { configured: boolean; currency?: string; leftToday?: number; allow?: number };
    books?: { reading: { id: string; title: string; page: number; pages: number | null; pct: number; todayPages: number } | null };
    gym?: { workouts: Array<{ id: string; title: string; time: string | null; minutes: number | null }>; plan: { id: string; name: string; time: string | null; exercises: number } | null };
    plans?: { tasks: Task[] };
  };
}
export interface FoodDay {
  meals: Array<{ id: string; time: string | null; slot: string | null; name: string; kcal: number; protein: number; fat: number; carbs: number }>;
  drinks: Array<{ id: string; time: string | null; title: string; ml: number; kcal: number }>;
  totals: { kcal: number; protein: number; fat: number; carbs: number; waterMl: number };
}
