/* ============================================================
   Бортжурнал — какие напоминания пора отправить
   Чистая функция: данные пользователя + местное время → список сообщений.
   Каждое сообщение имеет ключ; один ключ отправляется не чаще раза в день
   (вода — не чаще раза в 2,5 часа).
   ============================================================ */
'use strict';

const z = n => String(n).padStart(2, '0');
const hm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };

/* местное время пользователя по его смещению от UTC (минуты) */
function localNow(tz, now = Date.now()) {
  const d = new Date(now + (tz || 0) * 60000);
  return { ymd: `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`, min: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: d.getUTCDay() };
}
function addDays(ymd, n) { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function hasAny(st, d) {
  return (st.meals || []).some(m => m.date === d) || (st.study || []).some(s => s.date === d) || (st.workouts || []).some(w => w.date === d) || num(st.days?.[d]?.steps) > 0;
}
function streakBefore(st, today) {
  let d = addDays(today, -1), n = 0;
  while (hasAny(st, d) && n < 3650) { n++; d = addDays(d, -1); }
  return n;
}
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; };
const fmtL = ml => (Math.round(ml / 100) / 10).toString().replace('.', ',');

// окно срабатывания: с указанного времени и ещё 30 минут (сервер проверяет раз в минуту)
const inWindow = (min, at) => at !== null && min >= at && min < at + 30;

function due(st, tz, sent = {}, now = Date.now()) {
  const R = { water: true, food: true, streak: true, quiz: true, tasks: true, gym: true, ...(st.settings?.remind || {}) };
  if (R.off) return [];
  const L = localNow(tz, now), t = L.ymd, out = [];
  const sentToday = k => String(sent[k] || '').startsWith(t);
  const push = (key, title, body, url) => { if (!sentToday(key)) out.push({ key, title, body, url }); };

  // задачи со временем
  if (R.tasks) for (const x of st.tasks || []) if (x.date === t && !x.done && inWindow(L.min, hm(x.time))) push(`task:${x.id}`, `Задача в ${x.time}`, x.title, '/#plans');

  // тренировка по плану
  if (R.gym && !(st.workouts || []).some(w => w.date === t) && !st.gymLive) {
    for (const p of st.gymPlans || []) if ((p.days || []).includes(L.wd) && inWindow(L.min, hm(p.time || '19:00'))) push(`gym:${p.id}`, `Сегодня тренировка: ${p.name}`, `${(p.ex || []).length} ${plural((p.ex || []).length, 'упражнение', 'упражнения', 'упражнений')} — открой и начни, веса подскажу.`, '/#gym');
  }

  // вопросы на повторение — по подсказке, которую оставляет приложение
  const hint = st.remindHints || {};
  if (R.quiz && hint.date === t && hint.quizDue > 0 && inWindow(L.min, 10 * 60)) push('quiz', `${hint.quizDue} вопросов на повторение`, 'Пара минут — и знания не выветрятся.', '/#quiz');

  // еда: к обеду ничего не записано
  if (R.food && !(st.meals || []).some(m => m.date === t) && inWindow(L.min, 13 * 60 + 30)) push('food', 'Записать обед?', 'Сегодня ещё нет записей еды — хватит фото или пары слов.', '/#food');

  // вода: с 10 до 21, если отстаёшь от равномерного графика и давно не пил
  if (R.water && L.min >= 10 * 60 && L.min < 21 * 60) {
    const dr = (st.drinks || []).filter(x => x.date === t && x.type !== 'beer' && x.type !== 'wine' && x.type !== 'spirits');
    const ml = dr.reduce((a, x) => a + num(x.ml), 0), norm = num(hint.waterNorm) || 2000;
    const expect = norm * Math.min(1, Math.max(0, (L.min / 60 - 8) / 13));
    const last = Math.max(-1, ...dr.map(x => hm(x.time) ?? -1));
    const since = sent.waterAt ? (now - sent.waterAt) / 60000 : Infinity;
    if (ml < expect - 400 && (last < 0 || L.min - last > 120) && since > 150) out.push({ key: 'water', title: 'Пора выпить воды', body: `Выпито ${fmtL(ml)} из ${fmtL(norm)} л.`, url: '/#today', every: true });
  }

  // серия под угрозой: вечером, если сегодня ничего не записано
  const sk = streakBefore(st, t);
  if (R.streak && sk >= 2 && !hasAny(st, t) && inWindow(L.min, 21 * 60)) push('streak', `Серия ${sk} дн. под угрозой`, 'Запиши что-нибудь до полуночи — приём пищи, шаги или занятие.', '/#today');

  // не засыпаем уведомлениями: если есть что-то по времени, вода подождёт
  return out.some(x => x.key !== 'water') ? out.filter(x => x.key !== 'water') : out;
}

module.exports = { due, localNow, streakBefore };
