/**
 * Расчёт целей и прогноза — перенос plan.js старого журнала без изменения формул.
 * Mifflin–St Jeor (или Katch–McArdle при известном % жира), коэффициент тренировок + шаги отдельно
 * (≈0,5 ккал/кг/км сверх 4000 шагов), дефицит не больше 1% веса в неделю и 25% расхода,
 * белок от безжировой массы, минимум 1500/1200 ккал.
 */
export const KCAL_PER_KG = 7700;
export const ACTIVITY = {
  sed: { f: 1.2, name: 'Без тренировок', hint: 'Сидячая работа, спорта на неделе нет' },
  light: { f: 1.3, name: 'Лёгкая', hint: '1–2 тренировки за неделю' },
  mod: { f: 1.4, name: 'Средняя', hint: '3–4 тренировки за неделю' },
  high: { f: 1.5, name: 'Высокая', hint: '5–6 тренировок за неделю' },
  ath: { f: 1.65, name: 'Очень высокая', hint: 'Тренировки каждый день или физическая работа' }
} as const;
export type ActivityLevel = keyof typeof ACTIVITY;
export const BASE_STEPS = 4000;
export const GOALS = {
  lose: { name: 'Похудеть', hint: 'Сбросить жир и сохранить мышцы' },
  maintain: { name: 'Держать форму', hint: 'Вес на месте, улучшать тело' },
  gain: { name: 'Набрать мышцы', hint: 'Расти с минимумом жира' }
} as const;
export type Goal = keyof typeof GOALS;
export const PACE = {
  lose: { soft: { kcal: 300, name: 'Мягкий' }, mid: { kcal: 500, name: 'Умеренный' }, hard: { kcal: 750, name: 'Быстрый' } },
  gain: { soft: { kcal: 200, name: 'Чистый' }, mid: { kcal: 300, name: 'Умеренный' }, hard: { kcal: 450, name: 'Быстрый' } }
} as const;
export type Pace = 'soft' | 'mid' | 'hard';
export const BUILD = { low: { name: 'Мало мышц', bf: 3 }, mid: { name: 'Средне', bf: 0 }, fit: { name: 'Спортивное', bf: -5 } } as const;

export interface PlanProfile { sex: 'm' | 'f'; age: number; height: number; goal: Goal; pace?: Pace; build?: keyof typeof BUILD; bodyFat?: number | null; steps?: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, step: number) => Math.round(v / step) * step;
export const bmi = (w: number, h: number) => w / Math.pow(h / 100, 2);
export function bodyFat(p: PlanProfile, w: number) {
  if (p.bodyFat) return { value: p.bodyFat, measured: true };
  const est = 1.2 * bmi(w, p.height) + 0.23 * p.age - 10.8 * (p.sex === 'm' ? 1 : 0) - 5.4 + (BUILD[p.build ?? 'mid']?.bf ?? 0);
  return { value: clamp(est, p.sex === 'm' ? 6 : 12, 60), measured: false };
}
export const bmr = (p: PlanProfile, w: number) => p.bodyFat ? 370 + 21.6 * w * (1 - p.bodyFat / 100) : 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
export const kcalPerStep = (w: number, h: number) => 0.5 * w * (0.415 * h / 100) / 1000;
export const stepsKcal = (steps: number, w: number, h: number) => Math.max(0, (steps || 0) - BASE_STEPS) * kcalPerStep(w, h);
export const minKcal = (p: PlanProfile) => (p.sex === 'm' ? 1500 : 1200);

export function computePlan(p: PlanProfile, weight: number, level: ActivityLevel = 'sed', steps = p.steps ?? 6000) {
  const act = ACTIVITY[level] ?? ACTIVITY.sed;
  const base = bmr(p, weight), walk = stepsKcal(steps, weight, p.height), tdee = base * act.f + walk;
  const bf = bodyFat(p, weight), lbm = weight * (1 - bf.value / 100);
  const notes: string[] = [];
  let delta = 0;
  if (p.goal === 'lose') {
    delta = -(PACE.lose[p.pace ?? 'mid'] ?? PACE.lose.mid).kcal;
    const cap = Math.min(tdee * 0.25, weight * 0.01 * KCAL_PER_KG / 7);
    if (-delta > cap) { delta = -cap; notes.push('Дефицит урезан: больше 1% веса в неделю или 25% от расхода — это уже потеря мышц.'); }
  } else if (p.goal === 'gain') delta = (PACE.gain[p.pace ?? 'mid'] ?? PACE.gain.mid).kcal;
  let kcal = round(tdee + delta, 10);
  if (kcal < minKcal(p)) {
    kcal = minKcal(p);
    if (p.goal === 'lose' && kcal > tdee) { kcal = round(tdee, 10); notes.push(`Расход (${Math.round(tdee)} ккал) ниже безопасного минимума питания — дефицит едой не создать. Худеть за счёт шагов и тренировок.`); }
    else notes.push(`Калории подняты до минимума ${minKcal(p)} ккал: ниже без врача опускаться не стоит.`);
  }
  delta = kcal - tdee;
  const protein = round(Math.min(lbm * (p.goal === 'maintain' ? 1.8 : 2.1), 2.2 * weight), 5);
  const fat = round(Math.max(kcal * 0.25 / 9, 0.6 * lbm), 5);
  const carbs = Math.max(0, round((kcal - protein * 4 - fat * 9) / 4, 5));
  return { bmr: base, tdee, delta, kcal, protein, fat, carbs, weeklyKg: delta * 7 / KCAL_PER_KG, bf: bf.value, lbm, bmi: bmi(weight, p.height), notes };
}

/** через сколько недель вес дойдёт до цели при этих калориях; null — выйдет на плато раньше */
export function weeksTo(p: PlanProfile, w0: number, kcal: number, level: ActivityLevel, target: number, steps = p.steps ?? 6000, max = 260) {
  const dir = Math.sign(target - w0); if (!dir) return 0;
  const f = ACTIVITY[level]?.f ?? 1.2;
  let w = w0;
  for (let k = 1; k <= max; k++) {
    const next = w + (kcal - bmr(p, w) * f - stepsKcal(steps, w, p.height)) * 7 / KCAL_PER_KG;
    if ((next - w) * dir <= 0.005) return null;
    if ((target - next) * dir <= 0) return k - 1 + (target - w) / (next - w);
    w = next;
  }
  return null;
}
/** норма воды, мл: база по полу + активность */
export const waterGoal = (sex: string | null | undefined, level?: string | null) => (sex === 'f' ? 1600 : 2000) + (({ sed: 0, light: 250, mod: 400, high: 600, ath: 800 } as Record<string, number>)[level ?? 'sed'] ?? 0);

/** вес по неделям при постоянных калориях: расход пересчитывается под новый вес. [0] — старт */
export function simulate(p: PlanProfile, w0: number, kcal: number, level: ActivityLevel, weeks: number, steps = p.steps ?? 6000) {
  const f = ACTIVITY[level]?.f ?? 1.2, out = [w0];
  let w = w0;
  for (let k = 0; k < weeks; k++) { w += (kcal - bmr(p, w) * f - stepsKcal(steps, w, p.height)) * 7 / KCAL_PER_KG; out.push(w); }
  return out;
}

/** тренд веса — наименьшие квадраты; points: { t — день от начала окна, v — кг }. Нужно ≥3 замеров на ≥7 днях */
export function trend(points: Array<{ t: number; v: number }>) {
  const n = points.length;
  if (n < 3) return null;
  const span = points[n - 1]!.t - points[0]!.t;
  if (span < 7) return null;
  const mt = points.reduce((a, p) => a + p.t, 0) / n, mv = points.reduce((a, p) => a + p.v, 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of points) { sxy += (p.t - mt) * (p.v - mv); sxx += (p.t - mt) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, at: (t: number) => mv + slope * (t - mt), n, span };
}

/** реальный расход по факту: что съедено минус то, что ушло в вес (наклон тренда, кг в день) */
export const factTdee = (avgIntake: number, slopePerDay: number) => avgIntake - slopePerDay * KCAL_PER_KG;
