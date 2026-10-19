/* ============================================================
   Бортжурнал — расчёт целей и прогноза
   Чистые функции без DOM: в браузере доступны как window.Plan,
   в Node — через require('./plan.js').

   Источники формул:
   - Основной обмен: Mifflin–St Jeor (1990). Самая точная из
     распространённых формул (Frankenfield и др., 2005). Если известен
     процент жира — Katch–McArdle по безжировой массе.
   - Процент жира без замера: Deurenberg (1991) по ИМТ, возрасту и полу.
   - Расход за день: основной обмен × коэффициент тренировок + ходьба.
     Коэффициент описывает только тренировки и работу; шаги считаются
     отдельно по факту: ходьба тратит ≈0,5 ккал на кг веса на км
     (ACSM, чистые затраты сверх покоя), длина шага ≈0,415 × рост.
     Первые ~4000 шагов уже заложены в сидячий коэффициент 1,2.
   - 1 кг веса ≈ 7700 ккал. Правило линейное и на длинной дистанции
     завышает потерю (Hall и др., 2011), поэтому прогноз считается по
     неделям с пересчётом расхода под новый вес.
   - Безопасный темп похудения — не больше ~1% массы тела в неделю,
     дефицит не больше 25% от расхода.
   - Белок: ISSN — 1,4–2,0 г/кг для тренирующихся, на дефиците больше;
     здесь считается от безжировой массы, чтобы не завышать при лишнем весе.
   - Набор мышц: модель Алана Арагона (доля массы в месяц по стажу),
     применяется к безжировой массе — для людей с лишним весом обычная
     формула от полной массы даёт нереальные цифры.
   ============================================================ */
(function (root) {
  'use strict';

  const KCAL_PER_KG = 7700;

  // только тренировки и работа: шаги добавляются отдельно
  const ACTIVITY = {
    sed:   { f: 1.2,  name: 'Без тренировок', hint: 'Сидячая работа, спорта на неделе нет' },
    light: { f: 1.3,  name: 'Лёгкая',         hint: '1–2 тренировки за неделю' },
    mod:   { f: 1.4,  name: 'Средняя',        hint: '3–4 тренировки за неделю' },
    high:  { f: 1.5,  name: 'Высокая',        hint: '5–6 тренировок за неделю' },
    ath:   { f: 1.65, name: 'Очень высокая',  hint: 'Тренировки каждый день или физическая работа' }
  };
  const BASE_STEPS = 4000;
  const STEP_CHOICES = [3000, 6000, 9000, 12000, 15000];
  const GOALS = {
    lose:     { name: 'Похудеть',      hint: 'Сбросить жир и сохранить мышцы' },
    maintain: { name: 'Держать форму', hint: 'Вес на месте, улучшать тело' },
    gain:     { name: 'Набрать мышцы', hint: 'Расти с минимумом жира' }
  };
  // ккал в день: дефицит для похудения, профицит для набора
  const PACE = {
    lose: { soft: { kcal: 300, name: 'Мягкий' }, mid: { kcal: 500, name: 'Умеренный' }, hard: { kcal: 750, name: 'Быстрый' } },
    gain: { soft: { kcal: 200, name: 'Чистый' }, mid: { kcal: 300, name: 'Умеренный' }, hard: { kcal: 450, name: 'Быстрый' } }
  };
  const BUILD = {
    low: { name: 'Мало мышц',  hint: 'Мягкое тело, силовыми почти не занимался', bf: 3 },
    mid: { name: 'Средне',     hint: 'Обычное телосложение', bf: 0 },
    fit: { name: 'Спортивное', hint: 'Видно мышцы, регулярно тренируешься', bf: -5 }
  };
  // доля безжировой массы, которую реально нарастить за месяц
  const EXPERIENCE = {
    new: { name: 'Новичок',     hint: 'Меньше года силовых или не было', muscle: 0.015 },
    mid: { name: 'Средний',     hint: '1–3 года регулярных силовых', muscle: 0.0075 },
    pro: { name: 'Опытный',     hint: 'Больше 3 лет', muscle: 0.0035 }
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round = (v, step) => Math.round(v / step) * step;

  function bmi(weight, height) { return weight / Math.pow(height / 100, 2); }

  function bodyFat(p, weight) {
    if (p.bodyFat) return { value: p.bodyFat, measured: true };
    const est = 1.2 * bmi(weight, p.height) + 0.23 * p.age - 10.8 * (p.sex === 'm' ? 1 : 0) - 5.4 + (BUILD[p.build]?.bf || 0);
    return { value: clamp(est, p.sex === 'm' ? 6 : 12, 60), measured: false };
  }

  function bmr(p, weight) {
    if (p.bodyFat) return 370 + 21.6 * weight * (1 - p.bodyFat / 100);
    return 10 * weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  }

  /* ккал на один шаг: 0,5 ккал/кг/км × вес × длина шага */
  function kcalPerStep(weight, height) { return 0.5 * weight * (0.415 * height / 100) / 1000; }
  function stepsKcal(steps, weight, height) { return Math.max(0, (steps || 0) - BASE_STEPS) * kcalPerStep(weight, height); }

  function minKcal(p) { return p.sex === 'm' ? 1500 : 1200; }

  /* Цели на день для профиля, текущего веса и активности недели */
  function compute(p, weight, level, steps = p.steps || 6000) {
    const act = ACTIVITY[level] || ACTIVITY.sed;
    const base = bmr(p, weight), walk = stepsKcal(steps, weight, p.height), tdee = base * act.f + walk;
    const bf = bodyFat(p, weight), lbm = weight * (1 - bf.value / 100);
    const notes = [];
    let delta = 0;
    if (p.goal === 'lose') {
      delta = -(PACE.lose[p.pace] || PACE.lose.mid).kcal;
      const cap = Math.min(tdee * 0.25, weight * 0.01 * KCAL_PER_KG / 7);
      if (-delta > cap) { delta = -cap; notes.push('Дефицит урезан: больше 1% веса в неделю или 25% от расхода — это уже потеря мышц.'); }
    } else if (p.goal === 'gain') {
      delta = (PACE.gain[p.pace] || PACE.gain.mid).kcal;
    }
    let kcal = round(tdee + delta, 10);
    if (kcal < minKcal(p)) {
      kcal = minKcal(p);
      // если даже минимум выше расхода, худеть едой не получится — держим поддержку и честно говорим об этом
      if (p.goal === 'lose' && kcal > tdee) { kcal = round(tdee, 10); notes.push(`Расход (${Math.round(tdee)} ккал) ниже безопасного минимума питания — дефицит едой не создать. Худеть за счёт шагов и тренировок; калории — на поддержке.`); }
      else notes.push(`Калории подняты до минимума ${minKcal(p)} ккал: ниже без врача опускаться не стоит.`);
    }
    delta = kcal - tdee;
    const protein = round(Math.min(lbm * (p.goal === 'maintain' ? 1.8 : 2.1), 2.2 * weight), 5);
    const fat = round(Math.max(kcal * 0.25 / 9, 0.6 * lbm), 5);
    const carbs = Math.max(0, round((kcal - protein * 4 - fat * 9) / 4, 5));
    return {
      bmr: base, tdee, factor: act.f, level, steps, walk, delta, kcal, protein, fat, carbs,
      weeklyKg: delta * 7 / KCAL_PER_KG,
      bf: bf.value, bfMeasured: bf.measured, lbm, bmi: bmi(weight, p.height),
      muscleMonth: lbm * (EXPERIENCE[p.experience] || EXPERIENCE.new).muscle,
      notes
    };
  }

  /* Вес по неделям при постоянных калориях: расход пересчитывается под новый вес */
  function simulate(p, w0, kcal, level, weeks, steps = p.steps || 6000) {
    const f = (ACTIVITY[level] || ACTIVITY.sed).f, out = [w0];
    let w = w0;
    for (let k = 0; k < weeks; k++) {
      w += (kcal - bmr(p, w) * f - stepsKcal(steps, w, p.height)) * 7 / KCAL_PER_KG;
      out.push(w);
    }
    return out;
  }

  /* Через сколько недель вес дойдёт до цели; null, если при этих калориях не дойдёт */
  function weeksTo(p, w0, kcal, level, target, steps = p.steps || 6000, max = 260) {
    if (!target) return null;
    const dir = Math.sign(target - w0); if (!dir) return 0;
    const f = (ACTIVITY[level] || ACTIVITY.sed).f;
    let w = w0;
    for (let k = 1; k <= max; k++) {
      const next = w + (kcal - bmr(p, w) * f - stepsKcal(steps, w, p.height)) * 7 / KCAL_PER_KG;
      if ((next - w) * dir <= 0.005) return null; // вышли на плато раньше цели
      if ((target - next) * dir <= 0) return k - 1 + (target - w) / (next - w);
      w = next;
    }
    return null;
  }

  /* Тренд веса: наименьшие квадраты по записям за окно. points: [{t: дни, v: кг}] */
  function trend(points) {
    const n = points.length;
    if (n < 3) return null;
    const span = points[n - 1].t - points[0].t;
    if (span < 7) return null;
    const mt = points.reduce((a, p) => a + p.t, 0) / n, mv = points.reduce((a, p) => a + p.v, 0) / n;
    let sxy = 0, sxx = 0;
    for (const p of points) { sxy += (p.t - mt) * (p.v - mv); sxx += (p.t - mt) ** 2; }
    const slope = sxx ? sxy / sxx : 0;
    return { slope, at: t => mv + slope * (t - mt), n, span };
  }

  /* Реальный расход по факту: что съедено минус то, что ушло в вес */
  function factTdee(avgIntake, slopePerDay) { return avgIntake - slopePerDay * KCAL_PER_KG; }

  const api = { KCAL_PER_KG, BASE_STEPS, STEP_CHOICES, kcalPerStep, stepsKcal, ACTIVITY, GOALS, PACE, BUILD, EXPERIENCE, bmi, bodyFat, bmr, minKcal, compute, simulate, weeksTo, trend, factTdee };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Plan = api;
})(typeof window !== 'undefined' ? window : globalThis);
