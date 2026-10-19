/* ============================================================
   Бортжурнал — логика
   Данные живут на локальном сервере (server.js), в аккаунте пользователя.
   ============================================================ */
'use strict';

/* ---------- хранилище ---------- */
const KEY = 'bortjournal.v1'; // старое хранилище браузера, нужно только для переноса
const DEF = {
  settings: { kcal: 2200, protein: 140, steps: 10000, study: 60, apiKey: '', aiAuto: false, name: '' },
  meals: [], study: [], workouts: [], days: {}, srs: {}, quizzes: {}, foods: {},
  profile: null, activity: {}, drinks: [], sets: [], studyTime: {}
};
let S = structuredClone(DEF);
let me = null, rev = 0, photoOn = false;
// конспекты из Obsidian: приходят с сервера отдельно от данных пользователя
let OBS = { enabled: false, notes: [], diary: [] };

function normalize(d) {
  const out = Object.assign(structuredClone(DEF), d || {});
  out.settings = Object.assign({}, DEF.settings, (d && d.settings) || {});
  return out;
}

/* ---------- сервер ---------- */
async function apiFetch(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Ошибка ${r.status}`), { status: r.status, data });
  return data;
}
// сохранение: копим изменения 300 мс и отправляем всё состояние разом
let saveTimer = null, saving = null, dirty = false, offline = false;
function save() { updateBadge(); dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
async function flush() {
  clearTimeout(saveTimer);
  while (saving) await saving;
  if (!dirty || !me) return;
  dirty = false;
  const body = JSON.stringify({ rev, state: S });
  saving = (async () => {
    try {
      const r = await apiFetch('/api/state', { method: 'PUT', body });
      rev = r.rev;
      if (offline) { offline = false; toast('Связь с сервером есть, всё сохранено'); }
    } catch (e) {
      if (e.status === 409) {
        rev = e.data.rev; S = normalize(e.data.state); render();
        toast('Данные изменились на другом устройстве. Показываю свежую версию, последнее изменение повтори.', true);
      } else if (e.status === 401) {
        showAuth('Сессия закончилась, войди снова.');
      } else {
        dirty = true;
        if (!offline) { offline = true; toast('Сервер недоступен, изменения пока не сохранены. Повторяю…', true); }
        saveTimer = setTimeout(flush, 5000);
      }
    } finally { saving = null; }
  })();
  return saving;
}
window.addEventListener('pagehide', () => {
  if (dirty && me) fetch('/api/state', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev, state: S }) });
});
// вернулся во вкладку — подтягиваем изменения с других устройств
document.addEventListener('visibilitychange', async () => {
  if (!me) return;
  if (document.hidden) { flush(); return; }
  const a = document.activeElement;
  if (dirty || saving || $('#modal-root .overlay') || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
  try {
    const r = await apiFetch('/api/state');
    if (r.rev !== rev && !view.wizard) { rev = r.rev; S = normalize(r.state); render(); }
    maybeWeekly();
  } catch (e) { if (e.status === 401) showAuth('Сессия закончилась, войди снова.'); }
});

/* ---------- утилиты ---------- */
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const z = n => String(n).padStart(2, '0');
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const fmtN = n => Math.round(n).toLocaleString('ru-RU');
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; };
const $ = s => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function fmtMin(m) {
  m = Math.round(m);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}
function hoursStr(m) { return fmt1(m / 60); }

/* ---------- даты ---------- */
function ymd(d = new Date()) { return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function diffDays(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 864e5); }
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WDF = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function human(s) { const d = parseYmd(s); return `${d.getDate()} ${MON[d.getMonth()]}`; }
function humanLong(s) { const d = parseYmd(s); return `${d.getDate()} ${MONG[d.getMonth()]} ${d.getFullYear()}`; }
function relDay(s) {
  const t = ymd();
  if (s === t) return 'сегодня';
  if (s === addDays(t, -1)) return 'вчера';
  if (s === addDays(t, 1)) return 'завтра';
  return WDF[parseYmd(s).getDay()];
}
function nowHM() { const d = new Date(); return `${z(d.getHours())}:${z(d.getMinutes())}`; }
function hmToMin(hm) { if (!hm) return null; const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); }
function rangeDays(n, end = ymd()) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(addDays(end, -i)); return out; }

/* ---------- выборки ---------- */
const drinksOn = d => S.drinks.filter(x => x.date === d).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
// калорийные напитки (сок, газировка, латте) считаются в еде дня как отдельные записи
const mealsOn = d => [...S.meals.filter(m => m.date === d), ...drinksOn(d).map(drinkAsMeal).filter(m => m.kcal > 0)]
  .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const studyOn = d => S.study.filter(s => s.date === d).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const gymOn = d => S.workouts.filter(w => w.date === d).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const dayRec = d => S.days[d] || {};
// fi — клетчатка, su — сахар, sa — соль (есть у еды из фото/текста и у напитков); nut — сколько записей с этими данными
function sumMeals(ms) {
  return ms.reduce((a, m) => ({ kcal: a.kcal + num(m.kcal), p: a.p + num(m.p), f: a.f + num(m.f), c: a.c + num(m.c),
    fi: a.fi + num(m.fi), su: a.su + num(m.su), sa: a.sa + num(m.sa), nut: a.nut + (m.su !== undefined ? 1 : 0), n: a.n + 1 }),
    { kcal: 0, p: 0, f: 0, c: 0, fi: 0, su: 0, sa: 0, nut: 0, n: 0 });
}
const studyMin = d => studyOn(d).reduce((a, s) => a + num(s.minutes), 0) + (OBS.diary || []).filter(e => e.date === d).reduce((a, e) => a + num(S.studyTime[e.id]), 0);
function hasAny(d) { return !!(mealsOn(d).length || studyOn(d).length || gymOn(d).length || num(dayRec(d).steps)); }
function streak() {
  let d = ymd();
  if (!hasAny(d)) d = addDays(d, -1);
  let n = 0;
  while (hasAny(d) && n < 3650) { n++; d = addDays(d, -1); }
  return n;
}
function isEmptyStore() { return !S.meals.length && !S.study.length && !S.workouts.length && !Object.keys(S.days).length; }

/* ---------- иконки ---------- */
const I = {
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  food: '<svg viewBox="0 0 24 24"><path d="M4 12h16a8 8 0 0 1-16 0z"/><path d="M8 11.5V8m4 3.5V6m4 5.5V9"/></svg>',
  study: '<svg viewBox="0 0 24 24"><path d="M4 5h6.5a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6.5a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2H20z"/></svg>',
  quiz: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.8 2.1c-.8.5-1.3 1-1.3 1.9"/><path d="M12 16.6v.2"/></svg>',
  gym: '<svg viewBox="0 0 24 24"><path d="M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12"/></svg>',
  steps: '<svg viewBox="0 0 24 24"><path d="M7.5 3.5c1.8 0 2.8 2 2.8 4.5s-1 4.5-2.8 4.5S4.7 10.5 4.7 8s1-4.5 2.8-4.5z"/><path d="M6.4 14h2.4v2.6a1.2 1.2 0 0 1-2.4 0z"/><path d="M16.5 7.5c1.8 0 2.8 2 2.8 4.5s-1 4.5-2.8 4.5-2.8-2-2.8-4.5 1-4.5 2.8-4.5z"/><path d="M15.4 18h2.4v1.6a1.2 1.2 0 0 1-2.4 0z"/></svg>',
  stats: '<svg viewBox="0 0 24 24"><path d="M4 20v-9m5.3 9V4m5.4 16v-7m5.3 7V8"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M4 7h9m5 0h2M4 17h5m5 0h6"/><circle cx="15.5" cy="7" r="2.2"/><circle cx="11.5" cy="17" r="2.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z"/><path d="M13 7l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chevL: '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-1.5.5-2.5 1-3 0 1.5 1 2 1.5 2C11 8 10 6 12 3z"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m-4-4l4 4 4-4M5 20h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 15V4m-4 4l4-4 4 4M5 20h14"/></svg>',
  goal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".9"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.7-5.6M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6M4 20v-4h4"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path d="M12 3.5c3.2 4 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 2.8-6.5 6-10.5z"/><path d="M9 14.5a3 3 0 0 0 3 3"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l-4-4 4-4M6 12h10"/></svg>'
};
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = I[el.dataset.ico] || ''; });

/* ---------- состояние представления ---------- */
const view = { page: 'today', date: ymd(), range: 30, lastPage: null };
const PAGES = ['today', 'food', 'study', 'quiz', 'gym', 'steps', 'goal', 'stats', 'settings'];

function route() {
  const h = location.hash.replace('#', '') || 'today';
  view.page = PAGES.includes(h) ? h : 'today';
  render();
}
window.addEventListener('hashchange', route);

/* ============================================================
   РЕНДЕР
   ============================================================ */
function render() {
  if (!me) return;
  document.body.classList.toggle('setup-mode', !!view.wizard);
  if (view.wizard) { $('#main').innerHTML = pageWizard(); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === view.page));
  const pages = { today: pageToday, food: pageFood, study: pageStudy, quiz: pageQuiz, gym: pageGym, steps: pageSteps, goal: pageGoal, stats: pageStats, settings: pageSettings };
  const y = window.scrollY;
  $('#main').innerHTML = pages[view.page]();
  afterRender();
  if (view.lastPage !== view.page) window.scrollTo({ top: 0, behavior: 'instant' });
  else window.scrollTo({ top: y, behavior: 'instant' });
  view.lastPage = view.page;
  updateBadge();
}
function afterRender() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.ring-fg[data-offset]').forEach(el => { el.style.strokeDashoffset = el.dataset.offset; });
    document.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
    document.querySelectorAll('[data-count]').forEach(countUp);
  });
}
function countUp(el) {
  const to = num(el.dataset.count), fixed = el.dataset.fixed === '1';
  const out = v => fixed ? fmt1(v) : fmtN(v);
  if (reduceMotion || to === 0) { el.textContent = out(to); return; }
  const t0 = performance.now(), dur = 750;
  (function f(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = out(to * e);
    if (k < 1) requestAnimationFrame(f);
  })(t0);
}
function updateBadge() {
  const b = $('#quiz-badge'); if (!b) return;
  const q = S.quizzes[ymd()];
  let n = q ? q.items.filter(i => !i.result).length : dueCards(ymd()).length;
  n = Math.min(n, 9);
  b.hidden = !n; b.textContent = n;
}

/* ---------- общие компоненты ---------- */
function topbar(title, sub, { date = true, actions = '' } = {}) {
  return `<div class="topbar">
    ${title ? `<h1 class="topbar-title">${title}${sub ? `<small>${sub}</small>` : ''}</h1>` : '<span></span>'}
    <div class="topbar-actions">${actions}${date ? dateNav() : ''}</div>
  </div>`;
}
function dateNav() {
  const d = view.date, t = ymd();
  return `<div class="datenav">
    <button class="icon-btn" data-action="date" data-n="-1" aria-label="Предыдущий день">${I.chevL}</button>
    <button class="datenav-cur ${d === t ? '' : 'not-today'}" data-action="date-today" title="Вернуться к сегодня">${relDay(d)} · ${human(d)}</button>
    <button class="icon-btn" data-action="date" data-n="1" aria-label="Следующий день">${I.chevR}</button>
  </div>`;
}
function card({ domain, title, span = 4, i = 0, body, action = '', cls = '' }) {
  return `<section class="card ${cls}" style="--c:var(--${domain});--cf:var(--${domain}-f);--span:${span};--i:${i}">
    <header class="card-head"><h2 class="card-title">${title}</h2>${action}</header>${body}</section>`;
}
function addBtn(action, label, extra = '') {
  return `<button class="btn btn-accent btn-sm" data-action="${action}" ${extra}>${I.plus}${label}</button>`;
}
function ring(val, max, color, size = 104) {
  const r = (size - 10) / 2, C = 2 * Math.PI * r, p = Math.min(1, max ? val / max : 0);
  return `<div class="ring-wrap"><svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}"/>
    <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-offset="${C * (1 - p)}"/>
  </svg><span class="ring-pct">${Math.round(p * 100)}%</span></div>`;
}
function bar(val, max) { return `<div class="bar"><i data-w="${Math.min(100, max ? val / max * 100 : 0)}"></i></div>`; }
function empty(text) { return `<p class="empty">${text}</p>`; }
function itemActions(kind, id) {
  return `<div class="item-actions">
    <button class="icon-btn" data-action="edit-${kind}" data-id="${id}" aria-label="Изменить">${I.edit}</button>
    <button class="icon-btn danger" data-action="del-${kind}" data-id="${id}" aria-label="Удалить">${I.trash}</button>
  </div>`;
}
function field(label, inner) { return `<div class="field"><label>${label}</label>${inner}</div>`; }
function datalist(id, values) { return `<datalist id="${id}">${[...new Set(values.filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('')}</datalist>`; }

/* ============================================================
   СЕГОДНЯ
   ============================================================ */
function pageToday() {
  const d = view.date, set = S.settings;
  const ms = mealsOn(d), tot = sumMeals(ms), st = studyOn(d), stMin = studyMin(d), gw = gymOn(d), day = dayRec(d);
  const dd = parseYmd(d);
  const quiz = S.quizzes[d], due = quiz ? quiz.items.filter(i => !i.result).length : dueCards(d).length;
  const sk = streak();
  const greet = set.name ? `Привет, ${esc(set.name)}.` : '';
  const hour = new Date().getHours();
  const tod = hour < 5 ? 'Поздняя ночь' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  let i = 0;

  const onboard = isEmptyStore() ? `<section class="onboard">
      <h2>Это твой бортжурнал</h2>
      <p>Записывай еду, занятия, тренировки и шаги. Из тезисов занятий каждый день будут собираться вопросы на повторение, а статистика накопится сама. Начни с любого раздела.</p>
      <div class="btns">
        <button class="btn btn-accent" style="--c:var(--food)" data-action="add-meal">${I.plus}Приём пищи</button>
        <button class="btn btn-accent" style="--c:var(--study)" data-action="add-study">${I.plus}Занятие</button>
        <button class="btn btn-accent" style="--c:var(--gym)" data-action="add-gym">${I.plus}Тренировка</button>
        <button class="btn btn-accent" style="--c:var(--steps)" data-action="add-steps">${I.plus}Шаги</button>
      </div></section>` : '';

  const foodBody = `<div class="ring-row">${ring(tot.kcal, set.kcal, 'var(--food)')}
    <div class="ring-meta">
      <div class="big"><b data-count="${Math.round(tot.kcal)}">0</b><small>/ ${fmtN(set.kcal)} ккал</small></div>
      <div class="macros"><span class="macro"><em>Б</em>${fmtN(tot.p)}<i>/${set.protein}</i></span><span class="macro"><em>Ж</em>${fmtN(tot.f)}</span><span class="macro"><em>У</em>${fmtN(tot.c)}</span></div>
    </div></div>
    ${S.drinks.length || drinkDay(d).ml ? `<p class="hint" style="margin:10px 0 0">Вода: ${fmt1(drinkDay(d).hyd / 1000)} из ${fmt1(waterNorm() / 1000)} л</p>` : ''}
    ${ms.length ? `<div class="mini-list">${ms.slice(-4).map(m => `<div class="mini"><span class="mini-time">${esc(m.time || '')}</span><span class="mini-name">${esc(m.name)}</span><span class="mini-val">${fmtN(m.kcal)}</span></div>`).join('')}${ms.length > 4 ? `<a class="more" href="#food">и ещё ${ms.length - 4}</a>` : ''}</div>` : empty('Ещё ничего не ел')}`;

  const studyBody = `<div class="ring-row">${ring(stMin, set.study, 'var(--study)')}
    <div class="ring-meta">
      <div class="big"><b data-count="${stMin}">0</b><small>/ ${set.study} мин</small></div>
      <div class="chips">${st.slice(0, 4).map(s => `<span class="chip"><b>${esc(s.topic)}</b>${s.minutes ? `· ${s.minutes} мин` : ''}</span>`).join('') || '<span class="hint">Ни одного занятия</span>'}</div>
    </div></div>`;

  const steps = num(day.steps);
  const stepsBody = `<div class="big big-xl"><b data-count="${steps}">0</b><small>/ ${fmtN(set.steps)}</small></div>
    <div style="margin-top:12px">${bar(steps, set.steps)}</div>
    <p class="hint">${steps ? (steps >= set.steps ? 'Цель закрыта.' : `Осталось ${fmtN(set.steps - steps)}`) : 'Шаги за день ещё не записаны'}${steps && S.profile ? ` · ходьба ≈ ${fmtN(steps * Plan.kcalPerStep(curWeight(), S.profile.height))} ккал` : ''}${day.weight ? ` · вес ${fmt1(day.weight)} кг` : ''}</p>`;

  const gymBody = gw.length
    ? `<div class="list">${gw.map(w => `<div class="item"><span class="item-time">${esc(w.time || '')}</span><div class="item-main"><div class="item-title">${esc(w.type)}</div><div class="item-sub">${w.exercises.map(e => esc(e.name)).join(', ') || esc(w.note || '')}</div></div><span class="item-val">${w.minutes ? fmtMin(w.minutes) : ''}</span></div>`).join('')}</div>`
    : `<p class="empty">${d === ymd() ? 'Сегодня зал ещё впереди' : 'Без тренировки'}</p>`;

  const quizBody = quiz
    ? `<div class="big"><b>${quiz.items.filter(i => i.result).length}</b><small>/ ${quiz.items.length} отвечено</small></div>
       <div class="quiz-progress" style="margin-top:12px">${quiz.items.map(it => `<i class="${it.result || ''}"></i>`).join('')}</div>
       <p class="hint">${due ? `Осталось ${due} ${plural(due, 'вопрос', 'вопроса', 'вопросов')}` : 'Все вопросы дня разобраны'}</p>`
    : due
      ? `<div class="big"><b>${due}</b><small>${plural(due, 'карточка ждёт', 'карточки ждут', 'карточек ждут')}</small></div><p class="hint">Вопросы соберутся, когда откроешь раздел</p>`
      : `<p class="empty">${S.study.length ? 'На этот день повторять нечего' : 'Запиши занятие с тезисами, и вопросы появятся на следующий день'}</p>`;

  const noteBody = `<textarea class="note-area" data-note="${d}" placeholder="Как прошёл день? Пара строк для себя…">${esc(day.note || '')}</textarea>
    <div class="moods">${['Тяжело', 'Так себе', 'Норм', 'Хорошо', 'Огонь'].map((m, k) => `<button class="mood ${day.mood === k + 1 ? 'on' : ''}" data-action="mood" data-v="${k + 1}">${m}</button>`).join('')}</div>`;

  return `<section class="page page-today">
    ${topbar('', '', { actions: '' })}
    <header class="hero">
      <div class="hero-date">
        <div class="hero-wd">${relDay(d)}${d === ymd() ? ` · ${WDF[dd.getDay()]}` : ''}</div>
        <h1 class="hero-day">${dd.getDate()}<span class="hero-mon">${MONG[dd.getMonth()]}</span></h1>
      </div>
      <div class="hero-side">
        ${greet || d === ymd() ? `<div class="hero-greet">${greet || tod + '.'}</div>` : ''}
        ${S.profile ? `<a class="chip chip-goal" href="#goal">${I.goal}${fmtN(set.kcal)} ккал · ${kgWeek(planNow().weeklyKg)}</a>` : ''}
        <span class="chip chip-flame">${I.flame}${sk ? `${sk} ${plural(sk, 'день', 'дня', 'дней')} подряд` : 'серия начнётся с первой записи'}</span>
      </div>
    </header>
    ${nudgeBar()}
    ${ruler(d)}
    <div class="grid">
      ${onboard}
      ${card({ domain: 'food', title: 'Еда', i: i++, body: foodBody, action: `<span class="card-actions">${photoBtn('btn btn-accent btn-sm', 'Фото')}${addBtn('add-meal', 'Приём')}</span>` })}
      ${card({ domain: 'study', title: 'Учёба', i: i++, body: studyBody, cls: 'tile tile-navy', action: addBtn('add-study', 'Занятие') })}
      ${card({ domain: 'steps', title: 'Шаги', i: i++, body: stepsBody, cls: 'tile tile-mustard', action: addBtn('add-steps', 'Записать') })}
      ${card({ domain: 'quiz', title: 'Вопросы дня', span: 7, i: i++, body: quizBody, cls: 'tile tile-orange', action: `<a class="btn btn-accent btn-sm" href="#quiz">Открыть</a>` })}
      ${card({ domain: 'gym', title: 'Зал', span: 5, i: i++, body: gymBody, cls: 'tile tile-sage', action: addBtn('add-gym', 'Тренировка') })}
      ${card({ domain: 'paper', title: 'Заметка дня', span: 12, i: i++, body: noteBody, cls: 'tile tile-peach' })}
    </div>
  </section>`;
}

function ruler(d) {
  const start = 360, span = 1080;
  const pos = m => Math.max(0, Math.min(100, (m - start) / span * 100));
  const width = m => Math.max(0.6, Math.min(100, m / span * 100));
  const hours = [6, 9, 12, 15, 18, 21, 24];
  const ms = mealsOn(d).filter(m => m.time), st = studyOn(d).filter(s => s.time), gw = gymOn(d).filter(w => w.time);
  const n = new Date();
  const now = d === ymd() ? pos(n.getHours() * 60 + n.getMinutes()) : null;
  const bars = (arr, label) => arr.map(x => {
    const l = pos(hmToMin(x.time)), w = Math.min(width(num(x.minutes) || 30), 100 - l);
    return `<i class="mark bar" style="left:${l}%;width:${w}%" title="${esc(x.time)} · ${esc(label(x))}"></i>`;
  }).join('');
  return `<div class="ruler" aria-label="Лента дня">
    <div class="ruler-hours">${hours.map(h => `<span style="left:${pos(h * 60)}%">${h === 24 ? '00' : z(h)}</span>`).join('')}</div>
    <div class="ruler-lane lane-food">${ms.map(m => `<i class="mark dot" style="left:${pos(hmToMin(m.time))}%" title="${esc(m.time)} · ${esc(m.name)} · ${fmtN(m.kcal)} ккал"></i>`).join('')}</div>
    <div class="ruler-lane lane-study">${bars(st, s => `${s.topic} · ${fmtMin(s.minutes)}`)}</div>
    <div class="ruler-lane lane-gym">${bars(gw, w => `${w.type} · ${fmtMin(w.minutes)}`)}</div>
    ${now !== null ? `<i class="ruler-now" style="--x:${now.toFixed(2)}"></i>` : ''}
    <div class="ruler-legend"><span><i class="d"></i>еда</span><span><i class="s"></i>учёба</span><span><i class="g"></i>зал</span></div>
  </div>`;
}

/* ============================================================
   ЕДА
   ============================================================ */
/* ---------- нормы и оценка дня ---------- */
// цвета прошли проверку палитры (различимость при дальтонизме, контраст к фону)
const MAC = {
  kcal: { name: 'Калории', unit: 'ккал', color: '#D9622B' },
  p:    { name: 'Белки',   unit: 'г',    color: '#3F6FB5' },
  f:    { name: 'Жиры',    unit: 'г',    color: '#B07D0A' },
  c:    { name: 'Углеводы', unit: 'г',   color: '#1F9473' }
};
// доля калорий из Б/Ж/У: Acceptable Macronutrient Distribution Ranges (Institute of Medicine, 2005)
const AMDR = { p: [10, 35], f: [20, 35], c: [45, 65] };
function norms() {
  const k = num(S.settings.kcal) || 2200, p = num(S.settings.protein) || 0;
  const f = S.profile ? Math.min(planNow().fat, Math.round(k * 0.35 / 9)) : Math.round(k * 0.28 / 9);
  return { kcal: k, p, f, c: Math.max(0, Math.round((k - p * 4 - f * 9) / 4)) };
}
const ST = { good: '✓', warn: '▲', bad: '▲', low: '▼', info: '•' };
/* Статус показателя: live — день ещё идёт (сегодня), тогда «мало» не ругаем */
function judge(key, val, norm, live) {
  const r = norm ? val / norm : 0, d = Math.abs(val - norm), u = MAC[key].unit, n = key === 'kcal' ? fmtN(d) : fmt1(d);
  const S_ = (lvl, text, icon = ST[lvl]) => ({ lvl, text, icon });
  if (!val) return S_('info', live ? 'пока ничего' : 'нет записей');
  if (key === 'kcal') {
    if (r > 1.1) return S_('bad', `перебор +${n} ${u}`);
    if (r > 1.03) return S_('warn', `чуть больше нормы, +${n}`);
    if (live) return S_('info', `осталось ${n} ${u}`);
    if (r < 0.7) return S_('low', `мало: −${n} ${u}. Сильный недобор тормозит обмен`, '▼');
    return S_('good', 'в норме');
  }
  if (key === 'p') {
    if (r > 1.6) return S_('warn', `много: +${n} ${u}`);
    if (r >= 0.9) return S_('good', 'норма закрыта');
    if (live) return S_('info', `ещё ${n} ${u}`);
    return r >= 0.7 ? S_('low', `маловато, −${n} ${u}`, '▼') : S_('bad', `мало белка, −${n} ${u}`, '▼');
  }
  if (key === 'f') {
    if (r > 1.3) return S_('bad', `много жиров, +${n} ${u}`);
    if (r > 1.15) return S_('warn', `выше нормы, +${n} ${u}`);
    if (live) return S_('info', `осталось ${n} ${u}`);
    return r < 0.6 ? S_('low', `мало жиров, −${n} ${u}: нужны для гормонов`, '▼') : S_('good', 'в норме');
  }
  if (r > 1.3) return S_('bad', `много углеводов, +${n} ${u}`);
  if (r > 1.15) return S_('warn', `выше нормы, +${n} ${u}`);
  return live ? S_('info', `осталось ${n} ${u}`) : S_('good', 'в норме');
}
function statusChip(st) { return `<span class="st st-${st.lvl}"><i aria-hidden="true">${st.icon}</i>${st.text}</span>`; }

/* Кольцо «факт / норма»: второй виток тёмнее — сколько сверх нормы */
function meterRing(val, norm, color, label, size = 132) {
  const sw = 12, r = (size - sw) / 2, C = 2 * Math.PI * r, k = norm ? val / norm : 0;
  const a1 = Math.min(1, k), a2 = Math.min(1, Math.max(0, k - 1));
  const arc = (p, col, cls = '') => `<circle class="ring-fg ${cls}" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-offset="${C * (1 - p)}"/>`;
  return `<div class="meter" style="width:${size}px;height:${size}px"><svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}: ${Math.round(k * 100)}% нормы">
      <title>${label}: ${Math.round(k * 100)}% нормы</title>
      <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${sw}"/>
      ${a1 ? arc(a1, color) : ''}${a2 ? arc(a2, `color-mix(in srgb, ${color} 60%, #000)`, 'ring-over') : ''}
    </svg><div class="meter-c"><b>${Math.round(k * 100)}%</b><small>нормы</small></div></div>`;
}

/* Кольцо из сегментов с зазором 2px между ними */
function donut(segs, size, center, labelFn) {
  const sw = 22, r = (size - sw) / 2, C = 2 * Math.PI * r, tot = segs.reduce((a, s) => a + s.v, 0);
  if (!tot) return '';
  const gap = segs.filter(s => s.v > 0).length > 1 ? 2 + sw * 0 : 0;
  let acc = 0;
  const arcs = segs.map(s => {
    if (!s.v) return '';
    const len = C * s.v / tot, start = acc; acc += len;
    return `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${Math.max(0.1, len - gap)} ${C}" stroke-dashoffset="${-start}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${labelFn(s, s.v / tot)}</title></circle>`;
  }).join('');
  return `<div class="meter" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(segs.map(s => labelFn(s, s.v / tot)).join('; '))}">${arcs}</svg><div class="meter-c">${center}</div></div>`;
}

/* Клетчатка: EFSA 25 г, для мужчин часто 30 г. Сахар: ВОЗ — свободных сахаров до 10% калорий.
   Соль: ВОЗ — до 5 г. AI оценивает сахара всего, поэтому предел мягкий. */
function nutNorms(nm) { return { fi: S.profile?.sex === 'f' ? 25 : 30, su: Math.round(nm.kcal * 0.1 / 4), sa: 5 }; }
function judgeNut(k, v, norm, live) {
  const r = norm ? v / norm : 0, n = fmt1(Math.abs(v - norm));
  if (k === 'fi') return r >= 1 ? { lvl: 'good', icon: '✓', text: 'норма есть' } : live ? { lvl: 'info', icon: '•', text: `ещё ${n} г` } : r >= 0.7 ? { lvl: 'low', icon: '▼', text: `маловато, −${n} г` } : { lvl: 'bad', icon: '▼', text: `мало клетчатки, −${n} г` };
  if (r > 1.5) return { lvl: 'bad', icon: '▲', text: `много, +${n} г` };
  if (r > 1) return { lvl: 'warn', icon: '▲', text: `выше предела, +${n} г` };
  return { lvl: 'good', icon: '✓', text: live ? `можно ещё ${n} г` : 'в пределах' };
}
function nutRow(tot, nm, live) {
  const nn = nutNorms(nm);
  if (!tot.nut) return `<p class="hint nut-empty">Клетчатка, сахар и соль считаются для еды, записанной по фото или текстом, и для напитков. Пока таких записей за день нет.</p>`;
  const it = [['fi', 'Клетчатка', '#6B8E23', 'не меньше'], ['su', 'Сахар', '#C2185B', 'до'], ['sa', 'Соль', '#5F6B7A', 'до']];
  return `<div class="meters meters-sm">${it.map(([k, name, color, pre]) => `<div class="meter-cell">${meterRing(tot[k], nn[k], color, name, 92)}
      <div class="meter-name"><i style="background:${color}"></i>${name}</div>
      <div class="meter-val"><b>${fmt1(tot[k])}</b> г · ${pre} ${nn[k]} г</div>${statusChip(judgeNut(k, tot[k], nn[k], live))}</div>`).join('')}</div>
    <p class="hint">${tot.nut < tot.n ? `Посчитано по ${tot.nut} из ${tot.n} записей — у записанных вручную без этих полей данных нет. ` : ''}Нормы: клетчатка — EFSA, сахар — ВОЗ (до 10% калорий, здесь сахара всего, включая фрукты и молочное), соль — ВОЗ до 5 г.</p>`;
}
function dayNormsCard(d, tot, nm, live) {
  return `<div class="meters">${['kcal', 'p', 'f', 'c'].map(k => {
    const v = k === 'kcal' ? tot.kcal : tot[k], m = MAC[k], st = judge(k, v, nm[k], live);
    return `<div class="meter-cell">${meterRing(v, nm[k], m.color, m.name)}
      <div class="meter-name"><i style="background:${m.color}"></i>${m.name}</div>
      <div class="meter-val"><b>${k === 'kcal' ? fmtN(v) : fmt1(v)}</b> / ${fmtN(nm[k])} ${m.unit}</div>
      ${statusChip(st)}</div>`;
  }).join('')}</div>`;
}

function macroSplitCard(tot) {
  const e = { p: tot.p * 4, f: tot.f * 9, c: tot.c * 4 }, sum = e.p + e.f + e.c;
  if (!sum) return empty('Запиши еду с БЖУ, и здесь появится баланс.');
  const segs = ['p', 'f', 'c'].map(k => ({ k, v: e[k], color: MAC[k].color }));
  const ring = donut(segs, 168, `<b>${fmtN(sum)}</b><small>ккал из БЖУ</small>`, (s, sh) => `${MAC[s.k].name}: ${Math.round(sh * 100)}% калорий`);
  const rows = segs.map(s => {
    const pct = Math.round(s.v / sum * 100), [lo, hi] = AMDR[s.k];
    const st = pct < lo ? { lvl: 'low', icon: '▼', text: `ниже нормы ${lo}–${hi}%` } : pct > hi ? { lvl: 'warn', icon: '▲', text: `выше нормы ${lo}–${hi}%` } : { lvl: 'good', icon: '✓', text: `норма ${lo}–${hi}%` };
    return `<div class="split-row"><span class="split-name"><i style="background:${s.color}"></i>${MAC[s.k].name}</span>
      <span class="split-bar"><span class="split-band" style="left:${lo}%;width:${hi - lo}%"></span><span class="split-mark" style="left:${Math.min(100, pct)}%;background:${s.color}"></span></span>
      <b class="split-pct">${pct}%</b>${statusChip(st)}</div>`;
  }).join('');
  const note = S.profile?.goal === 'lose' && e.p / sum > 0.25 ? '<p class="hint">На похудении белка больше обычного — это нормально: он сохраняет мышцы. Углеводы при этом могут быть ниже 45%.</p>' : '';
  return `<div class="split">${ring}<div class="split-rows">${rows}<p class="hint" style="margin:2px 0 0">Полоса — здоровый диапазон доли калорий (AMDR), точка — твой день.</p>${note}</div></div>`;
}

const SLOTS = [
  { name: 'Утро', hint: 'до 11:00', from: 0, to: 11 * 60, color: '#F2B48C' },
  { name: 'День', hint: '11–16', from: 11 * 60, to: 16 * 60, color: '#E3874F' },
  { name: 'Вечер', hint: '16–21', from: 16 * 60, to: 21 * 60, color: '#B9531F' },
  { name: 'Поздно', hint: 'после 21:00', from: 21 * 60, to: 24 * 60, color: '#7A2A17' }
];
function mealTimingCard(d) {
  const days = rangeDays(7, d), acc = SLOTS.map(() => 0), logged = new Set();
  for (const x of days) for (const m of mealsOn(x)) { const t = hmToMin(m.time); if (t === null) continue; const i = SLOTS.findIndex(s => t >= s.from && t < s.to); if (i >= 0) { acc[i] += num(m.kcal); logged.add(x); } }
  const tot = acc.reduce((a, b) => a + b, 0), n = logged.size;
  if (!tot) return empty('Здесь будет видно, в какое время ты съедаешь больше всего. Время берётся из записей еды.');
  const segs = SLOTS.map((s, i) => ({ ...s, v: acc[i] }));
  const ring = donut(segs, 168, `<b>${n} ${plural(n, 'день', 'дня', 'дней')}</b><small>с записями</small>`, (s, sh) => `${s.name} (${s.hint}): ${Math.round(sh * 100)}%`);
  const late = acc[3] / tot;
  return `<div class="split">${ring}<div class="split-rows">${segs.map(s => `<div class="split-row slim"><span class="split-name"><i style="background:${s.color}"></i>${s.name} <small>${s.hint}</small></span><b class="split-pct">${Math.round(s.v / tot * 100)}%</b><span class="muted">${fmtN(s.v / n)} ккал/день</span></div>`).join('')}
    <p class="hint" style="margin:0">По времени из записей. «ккал/день» — в среднем за ${n} ${plural(n, 'день', 'дня', 'дней')} с записями из последних 7${n < 3 ? '. Пока записей мало — картина станет точнее через несколько дней' : ''}.</p>
    ${n < 3 ? '' : late > 0.25 ? statusChip({ lvl: 'warn', icon: '▲', text: `Поздно съедается ${Math.round(late * 100)}% калорий — это мешает сну и чаще ведёт к перееданию` }) : statusChip({ lvl: 'good', icon: '✓', text: 'Поздних калорий немного' })}
  </div></div>`;
}


/* Календарь месяца: цвет дня — попадание в норму калорий, синяя точка — белок закрыт */
function foodCalendarCard(nm) {
  const t = ymd(), cur = view.calMonth || view.date.slice(0, 7);
  const [y, m] = cur.split('-').map(Number), first = `${cur}-01`;
  const days = new Date(y, m, 0).getDate(), lead = (parseYmd(first).getDay() + 6) % 7;
  let good = 0, logged = 0, prot = 0;
  const cells = [];
  for (let k = 0; k < lead; k++) cells.push('<span class="cal-cell cal-pad"></span>');
  for (let n = 1; n <= days; n++) {
    const d = `${cur}-${z(n)}`, tot = sumMeals(mealsOn(d)), live = d === t, fut = d > t;
    const st = tot.kcal ? judge('kcal', tot.kcal, nm.kcal, live) : null, sp = tot.kcal ? judge('p', tot.p, nm.p, live) : null;
    if (st && !live) { logged++; if (st.lvl === 'good') good++; if (sp.lvl === 'good') prot++; }
    const cls = ['cal-cell', st && !live ? `cal-${st.lvl}` : '', live ? 'cal-today' : '', fut ? 'cal-fut' : '', d === view.date ? 'cal-sel' : ''].join(' ');
    const tip = tot.kcal ? `${human(d)}: ${fmtN(tot.kcal)} из ${fmtN(nm.kcal)} ккал (${Math.round(tot.kcal / nm.kcal * 100)}%), белок ${fmtN(tot.p)} из ${nm.p} г · ${st.text}` : `${human(d)}: нет записей`;
    cells.push(`<button type="button" class="${cls}" data-action="cal-day" data-d="${d}" title="${tip}" aria-label="${tip}" ${fut ? 'disabled' : ''}>
      <span class="cal-n">${n}</span>${st && !live ? `<i class="cal-ic" aria-hidden="true">${st.icon}</i>` : ''}${sp && sp.lvl === 'good' ? '<i class="cal-p" aria-hidden="true"></i>' : ''}</button>`);
  }
  const mName = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'][m - 1];
  return `<div class="cal-head">
      <button class="icon-btn" data-action="cal-month" data-n="-1" aria-label="Предыдущий месяц">${I.chevL}</button>
      <b>${mName} ${y}</b>
      <button class="icon-btn" data-action="cal-month" data-n="1" aria-label="Следующий месяц" ${cur >= t.slice(0, 7) ? 'disabled' : ''}>${I.chevR}</button>
    </div>
    <div class="cal">${['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(w => `<span class="cal-wd">${w}</span>`).join('')}${cells.join('')}</div>
    <p class="wk-sum">${logged ? `В норме <b>${good} из ${logged}</b> ${plural(logged, 'дня', 'дней', 'дней')} с записями · белок закрыт <b>${prot}</b>` : 'В этом месяце завершённых дней с записями нет.'}</p>
    <div class="heat-legend"><span><i style="background:var(--st-good)"></i>в норме</span><span><i style="background:var(--st-warn)"></i>мимо нормы</span><span><i style="background:var(--st-bad)"></i>перебор</span><span><i class="cal-p cal-p-l"></i>белок закрыт</span></div>`;
}


/* ---------- приёмы пищи ---------- */
const MEAL_SLOTS = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин'], ['snack', 'Перекусы']];
const SLOT_NAME = Object.fromEntries(MEAL_SLOTS);
const SLOT_ONE = { breakfast: 'завтрак', lunch: 'обед', dinner: 'ужин', snack: 'перекус' };
// по времени: завтрак 5–11, обед 11–16, ужин 18–22, остальное — перекус; можно выбрать вручную
function slotOf(m) {
  if (m.slot && SLOT_NAME[m.slot]) return m.slot;
  const t = hmToMin(m.time);
  if (t === null) return 'snack';
  if (t >= 300 && t < 660) return 'breakfast';
  if (t >= 660 && t < 960) return 'lunch';
  if (t >= 1080 && t < 1320) return 'dinner';
  return 'snack';
}
function slotSelect(cur) {
  return `<select name="slot"><option value="">По времени</option>${MEAL_SLOTS.map(([k]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${SLOT_ONE[k][0].toUpperCase() + SLOT_ONE[k].slice(1)}</option>`).join('')}</select>`;
}
const baseName = n => String(n).replace(/,\s*\d[\d\s.,]*\s*(г|мл)\s*$/i, '').trim();

// записи по приёмам пищи; калорийные напитки — одной строкой (они в блоке «Вода и напитки»)
function foodListBody(ms, d, live) {
  const food = ms.filter(m => !m.drink), dr = ms.filter(m => m.drink), dk = dr.reduce((a, m) => a + m.kcal, 0);
  const prev = addDays(d, -1), prevFood = S.meals.filter(m => m.date === prev);
  const groups = MEAL_SLOTS.map(([k, name]) => {
    const items = food.filter(m => slotOf(m) === k), kc = items.reduce((a, m) => a + num(m.kcal), 0);
    const yest = prevFood.filter(m => slotOf(m) === k), yk = yest.reduce((a, m) => a + num(m.kcal), 0);
    if (!items.length && !(live && yest.length)) return '';
    return `<div class="slot">
      <div class="slot-head"><b>${name}</b>${items.length ? `<span class="slot-kcal">${fmtN(kc)} ккал</span>` : ''}
        ${items.length ? `<button class="slot-btn" data-action="save-set" data-slot="${k}" data-d="${d}" title="Сохранить в избранное">${I.star}В избранное</button>` : ''}</div>
      ${items.length ? `<div class="list">${items.map(mealItem).join('')}</div>` : ''}
      ${!items.length && yest.length ? `<button class="slot-repeat" data-action="repeat-slot" data-slot="${k}" data-from="${prev}">${I.repeat}Повторить вчерашний ${SLOT_ONE[k]}: ${esc(yest.map(m => baseName(m.name)).slice(0, 3).join(', '))}${yest.length > 3 ? '…' : ''} · ${fmtN(yk)} ккал</button>` : ''}
    </div>`;
  }).join('');
  const drinks = drinksOn(d);
  const drinkGroup = drinks.length || live ? `<div class="slot slot-drinks">
      <div class="slot-head"><b>Напитки</b>${drinks.length ? `<span class="slot-kcal">${fmt1(drinkDay(d).hyd / 1000)} л воды${dk ? ` · ${fmtN(dk)} ккал` : ''}</span>` : ''}
        <span class="slot-quick"><button class="slot-btn" data-action="quick-drink" data-type="water" data-ml="250">${I.plus}Вода 250</button><button class="slot-btn" data-action="quick-drink" data-type="water" data-ml="500">${I.plus}500</button></span></div>
      ${drinks.length ? `<div class="drinks-list">${drinks.map(drinkChip).join('')}</div>` : ''}
    </div>` : '';
  if (!food.length && !groups && !drinkGroup) return empty('За этот день записей нет.');
  return (food.length || groups ? groups : empty(live ? 'Еды сегодня ещё нет. Сфотографируй, опиши текстом или запиши вручную — кнопки выше.' : 'Еды за этот день нет.')) + drinkGroup;
}
/* Компактная сводка дня: большое кольцо калорий и полоски Б/Ж/У и воды */
function daySummaryCard(d, tot, nm, live) {
  const st = judge('kcal', tot.kcal, nm.kcal, live), water = drinkDay(d).hyd, wn = waterNorm();
  const bar = (label, v, norm, unit, color, fmt = fmtN) => {
    const r = norm ? v / norm : 0, over = r > 1.03;
    return `<div class="sb"><div class="sb-top"><span class="sb-name"><i style="background:${color}"></i>${label}</span>
      <span class="sb-val"><b>${fmt(v)}</b> / ${fmt(norm)} ${unit}${over ? ` <em>▲ +${fmt(v - norm)}</em>` : ''}</span></div>
      <div class="sb-track"><i data-w="${Math.min(100, r * 100)}" style="background:${over ? `color-mix(in srgb, ${color} 60%, #000)` : color}"></i></div></div>`;
  };
  return `<div class="summary">
    <div class="summary-ring">${meterRing(tot.kcal, nm.kcal, MAC.kcal.color, 'Калории', 156)}
      <div class="summary-k"><b>${fmtN(tot.kcal)}</b> / ${fmtN(nm.kcal)} ккал</div>${statusChip(st)}</div>
    <div class="summary-bars">
      ${bar('Белки', tot.p, nm.p, 'г', MAC.p.color)}
      ${bar('Жиры', tot.f, nm.f, 'г', MAC.f.color)}
      ${bar('Углеводы', tot.c, nm.c, 'г', MAC.c.color)}
      ${bar('Вода', water / 1000, wn / 1000, 'л', '#2A7FB8', fmt1)}
      <button class="link-btn" data-action="food-tab" data-v="analysis">Подробнее: клетчатка, сахар, соль, кофеин, баланс БЖУ ›</button>
    </div>
  </div>`;
}

function pageFood() {
  const d = view.date, ms = mealsOn(d), tot = sumMeals(ms), nm = norms(), live = d === ymd();
  const tab = view.foodTab || 'day';
  let i = 0;
  const tabs = `<div class="seg food-tabs" role="tablist">${[['day', 'День'], ['analysis', 'Анализ']].map(([k, n]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-action="food-tab" data-v="${k}">${n}</button>`).join('')}</div>`;
  const head = topbar('Еда', live ? `сегодня, ${humanLong(d)}` : humanLong(d), { date: false, actions: `${live ? '' : `<button class="btn" data-action="date-today">${I.chevL}К сегодня</button>`}${tabs}` });
  if (tab === 'analysis') return `<section class="page" style="--c:var(--food)">${head}
    <div class="grid">
      ${card({ domain: 'food', title: 'Календарь питания', span: 5, i: i++, body: foodCalendarCard(nm) })}
      ${card({ domain: 'food', title: live ? 'Нормы за сегодня подробно' : `Нормы за ${human(d)} подробно`, span: 7, i: i++, body: dayNormsCard(d, tot, nm, live) + nutRow(tot, nm, live) + drinkMeters(d, live) })}
      ${card({ domain: 'food', title: live ? 'Баланс БЖУ за сегодня' : `Баланс БЖУ за ${human(d)}`, span: 6, i: i++, body: macroSplitCard(tot) })}
      ${card({ domain: 'food', title: 'Когда ешь · 7 дней', span: 6, i: i++, body: mealTimingCard(d) })}
      ${card({ domain: 'paper', title: 'Отчёт за неделю', span: 12, i: i++, body: weekReportCard(nm) })}
    </div>
  </section>`;
  return `<section class="page" style="--c:var(--food)">${head}
    ${nudgeBar()}
    <div class="add-tiles">
      ${photoOn ? `<label class="add-tile add-photo">${I.camera}<span><b>Фото еды</b><small>ИИ разберёт тарелку и посчитает ккал и БЖУ</small></span><input type="file" accept="image/*" data-photo hidden></label>` : ''}
      ${photoOn ? `<button class="add-tile add-text" data-action="add-text">${I.spark}<span><b>Описать текстом</b><small>«гречка 200 г, грудка» — ИИ посчитает</small></span></button>` : ''}
      <button class="add-tile add-manual" data-action="add-meal">${I.plus}<span><b>Вручную</b><small>Название и калории, БЖУ по желанию</small></span></button>
      <button class="add-tile add-drink" data-action="add-drink">${I.drop}<span><b>Вода и напитки</b><small>Вода, чай, кофе, сок, газировка — по мл</small></span></button>
    </div>
    <div class="grid">
      ${card({ domain: 'food', title: live ? 'Сегодня' : human(d), span: 12, i: i++, body: daySummaryCard(d, tot, nm, live) })}
      ${card({ domain: 'food', title: live ? 'Записи за сегодня' : `Записи за ${human(d)}`, span: 12, i: i++, body: quickRow() + foodListBody(ms, d, live) })}
      ${live && tot.kcal ? card({ domain: 'gym', title: 'Чем закрыть норму', span: 12, i: i++, body: closeGapCard(tot, nm) }) : ''}
    </div>
  </section>`;
}
function mealItem(m) {
  return `<div class="item">
    <span class="item-time">${esc(m.time || '—')}</span>
    <div class="item-main"><div class="item-title">${esc(m.name)}</div><div class="item-sub">Б ${fmtN(m.p)} · Ж ${fmtN(m.f)} · У ${fmtN(m.c)}</div></div>
    <span class="item-val">${fmtN(m.kcal)}<small>ккал</small></span>
    ${itemActions('meal', m.id)}
  </div>`;
}
function topFoods(n) {
  return Object.values(S.foods).sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, n);
}
function rememberFood(m) {
  const k = m.name.trim().toLowerCase(); if (!k) return;
  const f = S.foods[k] || { name: m.name.trim(), count: 0 };
  Object.assign(f, { kcal: num(m.kcal), p: num(m.p), f: num(m.f), c: num(m.c), count: f.count + 1, last: ymd() });
  for (const k of ['fi', 'su', 'sa']) if (m[k] !== undefined) f[k] = num(m[k]); else delete f[k];
  S.foods[k] = f;
}
function mealForm(m) {
  const foods = Object.values(S.foods);
  const chips = topFoods(6);
  openModal({
    title: m ? 'Изменить запись' : 'Приём пищи', accent: 'var(--food)', form: 'meal',
    body: `<input type="hidden" name="id" value="${m ? m.id : ''}">
      ${chips.length && !m ? `<div class="chips">${chips.map(f => `<button type="button" class="chip chip-btn" data-action="fill-food" data-name="${esc(f.name)}"><b>${esc(f.name)}</b>${fmtN(f.kcal)}</button>`).join('')}</div>` : ''}
      ${field('Что ел', `<input name="name" list="foods" required autocomplete="off" placeholder="Овсянка с бананом" value="${esc(m?.name || '')}">${datalist('foods', foods.map(f => f.name))}`)}
      <div class="row">
        ${field('Ккал', `<input name="kcal" type="number" min="0" step="1" inputmode="numeric" required placeholder="0" value="${m ? m.kcal : ''}">`)}
        ${field('Белки, г', `<input name="p" type="number" min="0" step="0.1" inputmode="decimal" placeholder="0" value="${m?.p ?? ''}">`)}
        ${field('Жиры, г', `<input name="f" type="number" min="0" step="0.1" inputmode="decimal" placeholder="0" value="${m?.f ?? ''}">`)}
        ${field('Углев., г', `<input name="c" type="number" min="0" step="0.1" inputmode="decimal" placeholder="0" value="${m?.c ?? ''}">`)}
      </div>
      <div class="row">
        ${field('Приём пищи', slotSelect(m?.slot || ''))}
        ${field('Время', `<input name="time" type="time" value="${m ? m.time : (view.date === ymd() ? nowHM() : '12:00')}">`)}
        ${field('Дата', `<input name="date" type="date" value="${m ? m.date : view.date}">`)}
      </div>
      <details class="more-fields" ${m && (m.fi !== undefined || m.su !== undefined || m.sa !== undefined) ? 'open' : ''}><summary>Клетчатка, сахар, соль</summary>
        <div class="row">
          ${field('Клетчатка, г', `<input name="fi" type="number" min="0" step="0.1" inputmode="decimal" placeholder="—" value="${m?.fi ?? ''}">`)}
          ${field('Сахар, г', `<input name="su" type="number" min="0" step="0.1" inputmode="decimal" placeholder="—" value="${m?.su ?? ''}">`)}
          ${field('Соль, г', `<input name="sa" type="number" min="0" step="0.1" inputmode="decimal" placeholder="—" value="${m?.sa ?? ''}">`)}
        </div></details>`,
    submit: m ? 'Сохранить' : 'Записать'
  });
}




/* ============================================================
   ИЗБРАННОЕ, «ЧЕМ ЗАКРЫТЬ НОРМУ», ОТЧЁТ ЗА НЕДЕЛЮ
   ============================================================ */
const setItem = m => { const o = { name: m.name, kcal: num(m.kcal), p: num(m.p), f: num(m.f), c: num(m.c) }; if (m.su !== undefined) Object.assign(o, { fi: num(m.fi), su: num(m.su), sa: num(m.sa) }); return o; };
function addSet(name, meals) {
  const items = meals.filter(m => !m.drink).map(setItem);
  if (!items.length) return null;
  const set = { id: uid(), name: String(name).trim().slice(0, 40) || 'Набор', items };
  S.sets.push(set); return set;
}
function useSet(set, date = view.date) {
  const time = date === ymd() ? nowHM() : '12:00';
  for (const it of set.items) { const m = { id: uid(), date, time, ...it }; S.meals.push(m); rememberFood(m); }
}
const setKcal = set => set.items.reduce((a, x) => a + num(x.kcal), 0);
function quickRow() {
  const sets = S.sets.map(st => `<span class="fav"><button class="fav-use" data-action="use-set" data-id="${st.id}" title="${esc(st.items.map(x => x.name).join(', '))}">${I.star}<b>${esc(st.name)}</b>${fmtN(setKcal(st))}</button><button class="icon-btn" data-action="del-set" data-id="${st.id}" aria-label="Удалить набор «${esc(st.name)}»">${I.x}</button></span>`).join('');
  const freq = topFoods(sets ? 4 : 6).map(f => `<button class="chip chip-btn" data-action="quick-meal" data-name="${esc(f.name)}"><b>${esc(f.name)}</b>${fmtN(f.kcal)}</button>`).join('');
  if (!sets && !freq) return '';
  return `<div class="quick"><span class="quick-label">Быстро</span>${sets}${freq}</div>`;
}

// типичные порции, если в истории мало белковой еды
const SUGGEST = [
  { name: 'Творог 5%, 200 г', kcal: 242, p: 34, f: 10, c: 6 },
  { name: 'Куриная грудка, 150 г', kcal: 165, p: 35, f: 2.5, c: 0 },
  { name: 'Яйца варёные, 2 шт.', kcal: 157, p: 13, f: 11, c: 1 },
  { name: 'Греческий йогурт 2%, 150 г', kcal: 110, p: 15, f: 3, c: 6 },
  { name: 'Тунец в собственном соку, 120 г', kcal: 125, p: 28, f: 1, c: 0 },
  { name: 'Кефир 1%, 500 мл', kcal: 200, p: 15, f: 5, c: 20 },
  { name: 'Креветки варёные, 150 г', kcal: 150, p: 30, f: 2, c: 0 },
  { name: 'Сыр 17%, 50 г', kcal: 135, p: 14, f: 8.5, c: 0 },
  { name: 'Чечевица варёная, 200 г', kcal: 232, p: 18, f: 1, c: 40 },
  { name: 'Овощной салат без масла, 250 г', kcal: 60, p: 3, f: 0.5, c: 11 }
];
function closeGapCard(tot, nm) {
  const remK = nm.kcal - tot.kcal, remP = nm.p - tot.p;
  const pool = [...SUGGEST, ...Object.values(S.foods).filter(f => num(f.kcal) > 30).map(f => ({ name: f.name, kcal: num(f.kcal), p: num(f.p), f: num(f.f), c: num(f.c), mine: true }))];
  const uniq = [...new Map(pool.map(x => [baseName(x.name).toLowerCase(), x])).values()];
  const line = (combo, why) => {
    const k = combo.reduce((a, x) => a + x.kcal, 0), p = combo.reduce((a, x) => a + x.p, 0);
    return `<div class="gap-opt"><div class="gap-main"><b>${combo.map(x => esc(x.name)).join(' + ')}</b>
      <span>${fmtN(k)} ккал · белок ${fmt1(p)} г${combo.some(x => x.mine) ? ' · из твоего' : ''}</span><small>${why(k, p)}</small></div>
      <button class="btn btn-accent btn-sm" data-action="gap-add" data-items="${esc(JSON.stringify(combo.map(({ mine, ...x }) => x)))}">${I.plus}Записать</button></div>`;
  };
  if (remK <= 50) {
    const lean = uniq.filter(x => x.p >= 10).sort((a, b) => a.kcal / a.p - b.kcal / b.p)[0];
    return `<p class="gap-head">${remK < -50 ? `Калории уже выше нормы на ${fmtN(-remK)}.` : 'Калории на сегодня закрыты.'} ${remP > 10 ? `Белка не хватает ${fmtN(remP)} г.` : 'Белок тоже в порядке.'}</p>
      ${remP > 10 && lean ? line([lean], (k, p) => `если голоден — самый лёгкий способ добрать белок: ${fmtN(k / p * 10)} ккал на 10 г белка`) : '<p class="hint" style="margin:0">Дальше — вода, чай, овощи без масла.</p>'}`;
  }
  let opts = [];
  if (remP > 8) {
    const cands = uniq.filter(x => x.p >= 5 && x.kcal <= remK + 60);
    const combos = [];
    for (let a = 0; a < cands.length; a++) {
      combos.push([cands[a]]);
      for (let b = a + 1; b < cands.length; b++) if (cands[a].kcal + cands[b].kcal <= remK + 60) combos.push([cands[a], cands[b]]);
    }
    const score = c => { const k = c.reduce((s, x) => s + x.kcal, 0), p = c.reduce((s, x) => s + x.p, 0); return Math.min(p, remP) / remP * 100 - Math.max(0, k - remK) / 5 - Math.max(0, p - remP * 1.3) * 0.5 - (c.length - 1) * 4 + (c.some(x => x.mine) ? 6 : 0); };
    opts = combos.sort((x, y) => score(y) - score(x)).filter((c, i, arr) => arr.findIndex(o => o[0].name === c[0].name) === i).slice(0, 3);
  } else {
    opts = uniq.filter(x => x.kcal <= remK && x.kcal >= Math.min(remK * 0.4, 150)).sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || b.kcal - a.kcal).slice(0, 3).map(x => [x]);
  }
  return `<p class="gap-head">Осталось <b>${fmtN(remK)} ккал</b>${remP > 0 ? ` и <b>${fmtN(remP)} г белка</b>` : ', белок закрыт'}.</p>
    ${opts.length ? opts.slice(0, view.gapMore ? 3 : 1).map(c => line(c, (k, p) => `${remP > 8 ? (p >= remP * 0.9 ? 'белок закрыт' : `белка останется ${fmtN(remP - p)} г`) : 'по калориям'}, ${k <= remK ? `останется ${fmtN(remK - k)} ккал` : `перебор ${fmtN(k - remK)} ккал`}`)).join('') + (opts.length > 1 ? `<button class="link-btn" data-action="gap-more">${view.gapMore ? 'Скрыть варианты' : `Ещё ${opts.length - 1} ${plural(opts.length - 1, 'вариант', 'варианта', 'вариантов')} ›`}</button>` : '') : '<p class="hint" style="margin:0">Подходящих вариантов не нашлось — запиши побольше своей еды, и подсказки станут точнее.</p>'}`;
}

function weekReportCard(nm) {
  const t = ymd(), days = rangeDays(7, addDays(t, -1)).filter(d => mealsOn(d).length);
  if (days.length < 2) return empty('Отчёт появится, когда за последнюю неделю будет хотя бы 2 дня с записями.');
  const rows = days.map(d => { const ms = mealsOn(d), tot = sumMeals(ms); return { d, ms, tot, st: judge('kcal', tot.kcal, nm.kcal, false), sp: judge('p', tot.p, nm.p, false) }; });
  const n = rows.length, avg = k => rows.reduce((a, r) => a + r.tot[k], 0) / n;
  const aK = avg('kcal'), aP = avg('p'), ok = rows.filter(r => r.st.lvl === 'good').length, okP = rows.filter(r => r.sp.lvl === 'good').length;
  const best = rows.slice().sort((a, b) => Math.abs(a.tot.kcal - nm.kcal) - Math.abs(b.tot.kcal - nm.kcal))[0];
  const worst = rows.slice().sort((a, b) => b.tot.kcal - a.tot.kcal)[0];
  const src = new Map(); let all = 0, late = 0, drinkK = 0;
  for (const r of rows) for (const m of r.ms) {
    const k = baseName(m.name); src.set(k, (src.get(k) || 0) + num(m.kcal)); all += num(m.kcal);
    if (m.drink) drinkK += num(m.kcal);
    const tm = hmToMin(m.time); if (tm !== null && tm >= 21 * 60) late += num(m.kcal);
  }
  const top = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), mx = top[0]?.[1] || 1;
  const nut = rows.filter(r => r.tot.nut), nn = nutNorms(nm);
  const notes = [];
  notes.push(aK > nm.kcal * 1.05 ? `В среднем на ${fmtN(aK - nm.kcal)} ккал в день больше нормы — это ≈${fmt2((aK - nm.kcal) * 7 / 7700)} кг лишнего за неделю.` : aK < nm.kcal * 0.8 ? `В среднем сильно меньше нормы (−${fmtN(nm.kcal - aK)} ккал). Проверь, всё ли записываешь: сильный недобор тормозит обмен.` : 'По калориям в среднем — в норме.');
  if (aP < nm.p * 0.9) notes.push(`Белка в среднем ${fmtN(aP)} г из ${nm.p}. Добавь белковый продукт в 1–2 приёма — подсказки в «Чем закрыть норму».`);
  if (top[0] && top[0][1] / all > 0.15) notes.push(`«${top[0][0]}» дал ${Math.round(top[0][1] / all * 100)}% всех калорий недели.`);
  if (drinkK / all > 0.1) notes.push(`Напитки — ${Math.round(drinkK / all * 100)}% калорий. Замена на воду или «без сахара» — самый простой резерв.`);
  if (late / all > 0.25) notes.push(`После 21:00 съедается ${Math.round(late / all * 100)}% калорий.`);
  if (nut.length >= 2) { const f = nut.reduce((a, r) => a + r.tot.fi, 0) / nut.length; if (f < nn.fi * 0.7) notes.push(`Клетчатки в среднем ${fmt1(f)} г из ${nn.fi} — больше овощей, круп, бобовых.`); }
  return `<div class="report">
    <div class="report-kpis">
      <div><b>${fmtN(aK)}</b><span>ккал в среднем<br>норма ${fmtN(nm.kcal)}</span></div>
      <div><b>${fmtN(aP)} г</b><span>белка в среднем<br>норма ${nm.p} г</span></div>
      <div><b>${ok} из ${n}</b><span>дней в норме<br>по калориям</span></div>
      <div><b>${okP} из ${n}</b><span>дней белок<br>закрыт</span></div>
    </div>
    <div class="report-cols">
      <div><div class="fav-sub">Главные источники калорий</div><div class="hbars">${top.map(([k, v]) => `<div class="hbar"><span class="hbar-label" title="${esc(k)}">${esc(k)}</span><span class="hbar-track"><i data-w="${v / mx * 100}" style="background:${MAC.kcal.color}"></i></span><span class="hbar-val">${Math.round(v / all * 100)}%</span></div>`).join('')}</div></div>
      <div><div class="fav-sub">Что видно</div><ul class="goal-lines">${notes.map(x => `<li>${x}</li>`).join('')}
        ${best.d !== worst.d ? `<li>Ближе всего к норме — ${human(best.d)} (${fmtN(best.tot.kcal)} ккал), больше всего — ${human(worst.d)} (${fmtN(worst.tot.kcal)} ккал).</li>` : ''}</ul></div>
    </div>
    <p class="hint">За ${n} ${plural(n, 'день', 'дня', 'дней')} с записями из последних 7 (без сегодняшнего).</p>
  </div>`;
}


/* ---------- напоминания внутри приложения ---------- */
// без https push-уведомления недоступны, поэтому подсказываем, когда журнал открыт
function nudges() {
  const t = ymd(), now = new Date(), h = now.getHours() + now.getMinutes() / 60, out = [];
  if (view.date !== t || h < 9 || h >= 23) return out;
  view.nudgeOff = view.nudgeOff || {};
  const dr = drinksOn(t), hyd = drinkDay(t).hyd, norm = waterNorm();
  const expect = norm * Math.min(1, Math.max(0, (h - 8) / 13));
  const last = dr.filter(x => x.time).map(x => hmToMin(x.time)).sort((a, b) => b - a)[0];
  const sinceLast = last === undefined ? Infinity : now.getHours() * 60 + now.getMinutes() - last;
  if (!view.nudgeOff.water && hyd < expect - 400 && sinceLast > 120)
    out.push({ k: 'water', icon: I.drop, text: `${last === undefined ? 'Сегодня воды ещё не было' : `Воды не было ${Math.floor(sinceLast / 60)} ч`} — выпито ${fmt1(hyd / 1000)} из ${fmt1(norm / 1000)} л.`, btn: `<button class="btn btn-sm btn-primary" style="--c:#2A7FB8" data-action="quick-drink" data-type="water" data-ml="250">${I.plus}Стакан воды</button>` });
  const meals = S.meals.filter(m => m.date === t);
  if (!view.nudgeOff.food && h >= 13 && !meals.length)
    out.push({ k: 'food', icon: I.food, text: 'Еды за сегодня ещё не записано. Запиши, пока помнишь — хватит фото или пары слов.', btn: `<a class="btn btn-sm btn-primary" href="#food">Записать</a>` });
  return out;
}
function nudgeBar() {
  return nudges().map(n => `<div class="nudge">${n.icon}<span>${n.text}</span>${n.btn}<button class="icon-btn" data-action="nudge-off" data-k="${n.k}" aria-label="Скрыть">${I.x}</button></div>`).join('');
}

/* ============================================================
   ВОДА И НАПИТКИ
   ============================================================ */
// на 100 мл: ккал, белки, жиры, углеводы, сахар (г), кофеин (мг); hyd — засчитывается в воду
const DRINKS = {
  water:   { name: 'Вода без газа',     kcal: 0,  p: 0,   f: 0,   c: 0,    sugar: 0,    caf: 0,  hyd: 1, color: '#5B9BD1' },
  soda:    { name: 'Вода с газом',      kcal: 0,  p: 0,   f: 0,   c: 0,    sugar: 0,    caf: 0,  hyd: 1, color: '#7FB3DD' },
  tea:     { name: 'Чай без сахара',    kcal: 1,  p: 0,   f: 0,   c: 0.2,  sugar: 0,    caf: 15, hyd: 1, color: '#A3742A' },
  coffee:  { name: 'Кофе чёрный',       kcal: 2,  p: 0.1, f: 0,   c: 0.3,  sugar: 0,    caf: 40, hyd: 1, color: '#5A3A22' },
  latte:   { name: 'Кофе с молоком',    kcal: 45, p: 2.7, f: 2.3, c: 3.8,  sugar: 3.8,  caf: 25, hyd: 1, color: '#B0835A' },
  juice:   { name: 'Сок',               kcal: 45, p: 0.7, f: 0.2, c: 10.4, sugar: 8.4,  caf: 0,  hyd: 1, color: '#E89A2C' },
  cola:    { name: 'Газировка',         kcal: 42, p: 0,   f: 0,   c: 10.6, sugar: 10.6, caf: 10, hyd: 1, color: '#B8432E' },
  zero:    { name: 'Газировка без сахара', kcal: 0, p: 0, f: 0,   c: 0,    sugar: 0,    caf: 10, hyd: 1, color: '#6B6457' },
  milk:    { name: 'Молоко 2,5%',       kcal: 52, p: 2.9, f: 2.5, c: 4.7,  sugar: 4.7,  caf: 0,  hyd: 1, color: '#D8CBB0' },
  kefir:   { name: 'Кефир 1%',          kcal: 40, p: 3,   f: 1,   c: 4,    sugar: 4,    caf: 0,  hyd: 1, color: '#C9C0AE' },
  energy:  { name: 'Энергетик',         kcal: 45, p: 0,   f: 0,   c: 11,   sugar: 11,   caf: 32, hyd: 1, color: '#3C9A4E' },
  beer:    { name: 'Пиво',              kcal: 43, p: 0.5, f: 0,   c: 3.6,  sugar: 0,    caf: 0,  hyd: 0, color: '#C99A2E' },
  custom:  { name: 'Своё',              kcal: 0,  p: 0,   f: 0,   c: 0,    sugar: 0,    caf: 0,  hyd: 1, color: '#A19682' }
};
const ML_CHOICES = [[200, 'стакан'], [250, 'кружка'], [330, 'банка'], [500, 'бутылка'], [1000, 'литр']];
const CAF_MAX = 400, SUGAR_MAX = 25;

function drinkTotals(x) {
  const t = DRINKS[x.type] || DRINKS.custom, k = num(x.ml) / 100;
  const per = x.type === 'custom' ? { ...t, kcal: num(x.kcal100), c: num(x.sugar100), sugar: num(x.sugar100) } : t;
  return { kcal: Math.round(per.kcal * k), p: per.p * k, f: per.f * k, c: per.c * k, sugar: per.sugar * k, caf: per.caf * k, hyd: num(x.ml) * per.hyd };
}
function drinkName(x) { return x.type === 'custom' ? (x.name || 'Напиток') : DRINKS[x.type]?.name || 'Напиток'; }
function drinkAsMeal(x) {
  const t = drinkTotals(x);
  return { id: 'drink:' + x.id, drinkId: x.id, drink: true, date: x.date, time: x.time, name: `${drinkName(x)}, ${fmtN(x.ml)} мл`, kcal: t.kcal, p: t.p, f: t.f, c: t.c, sugar: t.sugar, fi: 0, su: t.sugar, sa: 0 };
}
/* Норма питья: EFSA — общая вода 2,5 л мужчинам / 2,0 л женщинам, ~80% из напитков; плюс тренировки */
function waterNorm() {
  const base = S.profile?.sex === 'f' ? 1600 : 2000;
  const bonus = { sed: 0, light: 250, mod: 400, high: 600, ath: 800 }[S.profile ? curLevel() : 'sed'] || 0;
  return base + bonus;
}
function drinkDay(d) {
  return drinksOn(d).reduce((a, x) => { const t = drinkTotals(x); a.hyd += t.hyd; a.ml += num(x.ml); a.sugar += t.sugar; a.caf += t.caf; a.kcal += t.kcal; return a; }, { hyd: 0, ml: 0, sugar: 0, caf: 0, kcal: 0 });
}


function drinkChip(x) {
  const t = drinkTotals(x), c = DRINKS[x.type] || DRINKS.custom;
  return `<span class="drink-chip" title="${esc(drinkName(x))}: ${fmtN(x.ml)} мл${t.kcal ? `, ${t.kcal} ккал` : ''}${t.caf ? `, кофеин ${fmtN(t.caf)} мг` : ''}"><i style="background:${c.color}"></i><span class="drink-t">${esc(x.time || '')}</span><b>${esc(drinkName(x))}</b> ${fmtN(x.ml)} мл${t.kcal ? ` · ${t.kcal} ккал` : ''}<button class="icon-btn" data-action="edit-drink" data-id="${x.id}" aria-label="Изменить">${I.edit}</button><button class="icon-btn danger" data-action="del-drink" data-id="${x.id}" aria-label="Удалить">${I.x}</button></span>`;
}
/* Вода и кофеин для вкладки «Анализ» */
function drinkMeters(d, live) {
  const tot = drinkDay(d), norm = waterNorm();
  const wr = tot.hyd / norm;
  const wst = !tot.hyd ? { lvl: 'info', icon: '•', text: live ? 'пока ничего' : 'нет записей' }
    : wr >= 1 ? { lvl: 'good', icon: '✓', text: 'норма выпита' }
    : live ? { lvl: 'info', icon: '•', text: `ещё ${fmt1((norm - tot.hyd) / 1000)} л` }
    : wr >= 0.75 ? { lvl: 'low', icon: '▼', text: `чуть меньше, −${fmtN(norm - tot.hyd)} мл` } : { lvl: 'bad', icon: '▼', text: `мало воды, −${fmtN(norm - tot.hyd)} мл` };
  const cst = tot.caf > CAF_MAX ? { lvl: 'bad', icon: '▲', text: `больше ${CAF_MAX} мг` } : tot.caf > CAF_MAX * 0.75 ? { lvl: 'warn', icon: '▲', text: 'близко к пределу' } : { lvl: 'good', icon: '✓', text: tot.caf ? 'в пределах' : 'без кофеина' };
  return `<div class="meters meters-sm meters-2">
      <div class="meter-cell">${meterRing(tot.hyd, norm, '#2A7FB8', 'Вода', 92)}<div class="meter-name"><i style="background:#2A7FB8"></i>Вода</div><div class="meter-val"><b>${fmt1(tot.hyd / 1000)}</b> / ${fmt1(norm / 1000)} л</div>${statusChip(wst)}</div>
      <div class="meter-cell">${meterRing(tot.caf, CAF_MAX, '#5A3A22', 'Кофеин', 92)}<div class="meter-name"><i style="background:#5A3A22"></i>Кофеин</div><div class="meter-val"><b>${fmtN(tot.caf)}</b> / ${CAF_MAX} мг</div>${statusChip(cst)}</div>
    </div>
    <p class="hint">Вода — по рекомендации EFSA (${S.profile?.sex === 'f' ? '≈1,6' : '≈2'} л напитков в день, плюс добавка за тренировки). Чай и кофе засчитываются, пиво — нет. Кофеин — до ${CAF_MAX} мг в день.</p>`;
}
function drinkForm(x) {
  const type = x?.type || 'water', ml = x?.ml || 250;
  openModal({
    title: x ? 'Изменить напиток' : 'Напиток', accent: '#2A7FB8', form: 'drink',
    body: `<input type="hidden" name="id" value="${x ? x.id : ''}">
      <div class="opts opts-drinks">${Object.entries(DRINKS).map(([k, t]) => `<label class="opt opt-drink"><input type="radio" name="type" value="${k}" ${k === type ? 'checked' : ''}><b><i style="background:${t.color}"></i>${t.name}</b><span>${k === 'custom' ? 'название и ккал сами' : t.kcal ? `${t.kcal} ккал/100 мл${t.sugar ? ` · сахар ${fmt1(t.sugar)} г` : ''}` : 'без калорий'}${t.caf ? ` · кофеин` : ''}${!t.hyd ? ' · не вода' : ''}</span></label>`).join('')}</div>
      <div class="drink-custom" ${type === 'custom' ? '' : 'hidden'}>
        <div class="row">${field('Название', `<input name="name" value="${esc(x?.name || '')}" placeholder="Например, морс">`)}${field('Ккал на 100 мл', `<input name="kcal100" type="number" min="0" step="any" value="${x?.kcal100 ?? ''}" placeholder="0">`)}${field('Сахар на 100 мл, г', `<input name="sugar100" type="number" min="0" step="any" value="${x?.sugar100 ?? ''}" placeholder="0">`)}</div>
      </div>
      <div class="field"><label>Сколько</label>
        <div class="chips">${ML_CHOICES.map(([v, n]) => `<button type="button" class="chip chip-btn ${+ml === v ? 'on' : ''}" data-action="drink-ml" data-v="${v}"><b>${v} мл</b>${n}</button>`).join('')}</div>
        <div class="ml-row"><button type="button" class="icon-btn" data-action="drink-step" data-n="-50" aria-label="Меньше на 50 мл">−</button><input name="ml" type="number" min="10" max="5000" step="10" inputmode="numeric" value="${ml}" required><span>мл</span><button type="button" class="icon-btn" data-action="drink-step" data-n="50" aria-label="Больше на 50 мл">+</button></div>
      </div>
      <p class="drink-prev" id="drink-prev"></p>
      <div class="row row-2">
        ${field('Время', `<input name="time" type="time" value="${x ? x.time : (view.date === ymd() ? nowHM() : '12:00')}">`)}
        ${field('Дата', `<input name="date" type="date" value="${x ? x.date : view.date}">`)}
      </div>`,
    submit: x ? 'Сохранить' : 'Записать'
  });
  drinkPreview();
}
function drinkPreview() {
  const f = $('#modal-root [data-form=drink]'); if (!f) return;
  const fd = new FormData(f), x = { type: fd.get('type'), ml: fd.get('ml'), kcal100: fd.get('kcal100'), sugar100: fd.get('sugar100') }, t = drinkTotals(x);
  f.querySelector('.drink-custom').hidden = x.type !== 'custom';
  f.querySelectorAll('[data-action=drink-ml]').forEach(b => b.classList.toggle('on', +b.dataset.v === num(x.ml)));
  $('#drink-prev').innerHTML = `<b>${fmtN(x.ml)} мл</b>${t.hyd ? ` · в воду ${fmtN(t.hyd)} мл` : ' · в воду не засчитывается'}${t.kcal ? ` · ${t.kcal} ккал` : ''}${t.sugar ? ` · сахар ${fmt1(t.sugar)} г` : ''}${t.caf ? ` · кофеин ${fmtN(t.caf)} мг` : ''}`;
}
function addDrink(type, ml) {
  const x = { id: uid(), date: view.date, time: view.date === ymd() ? nowHM() : '12:00', type, ml };
  S.drinks.push(x); save(); render();
  toast(`${drinkName(x)} ${fmtN(ml)} мл — записано`);
}

/* ============================================================
   ФОТО ЕДЫ: распознавание через сервер (Gemini) и проверка
   ============================================================ */
const SCALE_OPTS = [['', 'Нет'], ['card', 'Карта'], ['fork', 'Вилка'], ['spoon', 'Ложка'], ['phone', 'Телефон'], ['hand', 'Ладонь']];
const CONF = { high: 'уверенно', medium: 'примерно', low: 'догадка' };
let ph = null;
function photoBtn(cls, label = 'Фото еды') {
  if (!photoOn) return '';
  return `<label class="${cls}" style="--c:var(--food);cursor:pointer">${I.camera}${label}<input type="file" accept="image/*" data-photo hidden></label>`;
}
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const url = cv.toDataURL('image/jpeg', 0.85);
  return { url, b64: url.slice(url.indexOf(',') + 1), mime: 'image/jpeg' };
}
function startText() {
  ph = { url: null, b64: null, mime: null, text: true, note: '', scale: '', stage: 'setup', rows: [], questions: [], answers: {}, comment: '', time: view.date === ymd() ? nowHM() : '12:00', date: view.date, err: '', setName: '' };
  renderPhoto();
  setTimeout(() => $('#modal-root [data-ph=note]')?.focus(), 80);
}
async function startPhoto(file) {
  try {
    const img = await shrinkImage(file);
    ph = { ...img, note: '', scale: '', stage: 'setup', rows: [], questions: [], answers: {}, comment: '', time: view.date === ymd() ? nowHM() : '12:00', date: view.date, err: '', setName: '' };
    renderPhoto();
  } catch { toast('Не получилось открыть фото. Попробуй JPEG или PNG.', true); }
}
function phTotals() {
  return ph.rows.reduce((a, r) => ({ kcal: a.kcal + num(r.kcal), p: a.p + num(r.p), f: a.f + num(r.f), c: a.c + num(r.c), g: a.g + num(r.grams), fi: a.fi + num(r.fi), su: a.su + num(r.su), sa: a.sa + num(r.sa) }), { kcal: 0, p: 0, f: 0, c: 0, g: 0, fi: 0, su: 0, sa: 0 });
}
function phTotalsHtml() {
  const t = phTotals();
  return `<b>${fmtN(t.kcal)} ккал</b> · Б ${fmt1(t.p)} · Ж ${fmt1(t.f)} · У ${fmt1(t.c)} · ${fmtN(t.g)} г<span class="ph-nut">клетчатка ${fmt1(t.fi)} г · сахар ${fmt1(t.su)} г · соль ${fmt1(t.sa)} г</span>`;
}
function renderPhoto() {
  const root = $('#modal-root'), st = ph.stage;
  let body = '', foot = '';
  const img = ph.url ? `<img class="ph-img" src="${ph.url}" alt="Фото еды">` : '';
  const topCls = ph.url ? '' : ' ph-noimg';
  if ((st === 'setup' || st === 'loading') && ph.text) {
    body = `${field('Что съел', `<textarea data-ph="note" rows="4" placeholder="Например: гречка 200 г, куриная грудка 150 г, огурец, чай с сахаром" ${st === 'loading' ? 'disabled' : ''}>${esc(ph.note)}</textarea>`)}
      <p class="hint" style="margin:0">Пиши как удобно, через запятую. Укажешь граммы — посчитает точнее, не укажешь — возьмёт обычную порцию.</p>`;
    foot = `<button type="button" class="btn btn-ghost" data-action="close-modal">Отмена</button><button type="button" class="btn btn-primary ${st === 'loading' ? 'busy' : ''}" data-action="ph-go">${st === 'loading' ? 'Считаю…' : `${I.spark}Посчитать`}</button>`;
  } else if (st === 'setup' || st === 'loading') {
    body = `<div class="ph-top">${img}<div class="ph-side">
        ${field('Подпись (необязательно)', `<textarea data-ph="note" rows="3" placeholder="Например: гречка 200 г, куриная грудка, соус сметанный" ${st === 'loading' ? 'disabled' : ''}>${esc(ph.note)}</textarea>`)}
        <div class="field"><label>Что лежит рядом для масштаба</label>
          <div class="seg seg-wrap">${SCALE_OPTS.map(([k, n]) => `<button type="button" class="${ph.scale === k ? 'on' : ''}" data-action="ph-scale" data-v="${k}" ${st === 'loading' ? 'disabled' : ''}>${n}</button>`).join('')}</div></div>
        <p class="hint" style="margin:0">Точнее всего — подписать вес с кухонных весов. Без весов положи рядом карту (85,6×54 мм) или вилку. Этикетку упаковки тоже можно сфотографировать.</p>
      </div></div>`;
    foot = `<button type="button" class="btn btn-ghost" data-action="close-modal">Отмена</button><button type="button" class="btn btn-primary ${st === 'loading' ? 'busy' : ''}" data-action="ph-go">${st === 'loading' ? 'Распознаю…' : `${I.spark}Распознать`}</button>`;
  } else {
    const qs = ph.questions.length ? `<div class="ph-qs">${ph.questions.map((q, qi) => `<div class="ph-q"><div class="ph-q-text">${esc(q.text)}</div><div class="chips">${q.options.map(o => `<button type="button" class="chip chip-btn ${ph.answers[qi] === o ? 'on' : ''}" data-action="ph-ans" data-q="${qi}" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
      <button type="button" class="btn btn-accent btn-sm" data-action="ph-go" ${Object.keys(ph.answers).length ? '' : 'disabled'}>${I.spark}Пересчитать с ответами</button></div>` : '';
    body = `<div class="ph-top ph-top-sm${topCls}">${img}<div class="ph-side">
        ${ph.comment ? `<p class="ph-comment">${esc(ph.comment)}</p>` : ''}
        <div class="ph-total" id="ph-total">${phTotalsHtml()}</div>
        <p class="hint" style="margin:0">Проверь вес порций: поменяешь граммы — ккал и БЖУ пересчитаются.</p>
      </div></div>
      ${qs}
      <div class="ph-rows">
        <div class="ph-row ph-head"><span>Что</span><span>г</span><span>ккал</span><span>Б</span><span>Ж</span><span>У</span><span></span></div>
        ${ph.rows.map((r, i) => `<div class="ph-row" data-i="${i}">
          <span class="ph-name"><input data-ph-row="${i}" data-f="name" value="${esc(r.name)}" aria-label="Название">${r.confidence ? `<small class="conf conf-${r.confidence}">${r.source === 'label' ? 'с этикетки' : r.source === 'user' ? 'с подписи' : CONF[r.confidence]}</small>` : ''}</span>
          ${['grams', 'kcal', 'p', 'f', 'c'].map(f => `<input data-ph-row="${i}" data-f="${f}" type="number" min="0" step="any" inputmode="decimal" value="${r[f]}" aria-label="${f}">`).join('')}
          <button type="button" class="icon-btn danger" data-action="ph-del" data-i="${i}" aria-label="Убрать">${I.x}</button>
        </div>`).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="ph-add">${I.plus}Добавить позицию</button>
      <div class="row row-2">
        ${field('Время', `<input data-ph="time" type="time" value="${ph.time}">`)}
        ${field('Дата', `<input data-ph="date" type="date" value="${ph.date}">`)}
      </div>
      ${field('Сохранить в избранное как (необязательно)', `<input data-ph="setName" value="${esc(ph.setName || '')}" placeholder="Например: мой завтрак">`)}`;
    foot = `<button type="button" class="btn btn-ghost" data-action="ph-back">${ph.text ? 'Изменить описание' : 'Другое фото'}</button><span class="spacer"></span><button type="button" class="btn btn-primary" data-action="ph-save" ${ph.rows.length ? '' : 'disabled'}>${I.check}Согласен, записать</button>`;
  }
  const wasOpen = root.classList.contains('open') && root.querySelector('.ph-sheet');
  root.innerHTML = `<div class="overlay" data-action="close-modal"><div class="sheet ph-sheet" style="--c:var(--food)" role="dialog" aria-modal="true" aria-label="Фото еды">
    <header class="sheet-head"><h2>${st === 'review' ? 'Проверь, что получилось' : ph.text ? 'Еда по описанию' : 'Еда по фото'}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Закрыть">${I.x}</button></header>
    <div class="sheet-form">${body}${ph.err ? `<p class="auth-err" role="alert">${esc(ph.err)}</p>` : ''}<footer class="sheet-foot">${foot}</footer></div>
  </div></div>`;
  if (!wasOpen) requestAnimationFrame(() => root.classList.add('open'));
}
async function photoGo() {
  if (!ph || ph.stage === 'loading') return;
  if (ph.text && ph.note.trim().length < 2) { ph.err = 'Напиши, что съел.'; renderPhoto(); return; }
  const answers = ph.questions.map((q, qi) => ph.answers[qi] ? `${q.text} — ${ph.answers[qi]}` : '').filter(Boolean);
  // ручные правки при пересчёте не теряем: отдаём их модели как факт
  if (ph.stage === 'review') for (const r of ph.rows) {
    if (!String(r.name).trim()) continue;
    if (!r.base) answers.push(`Добавлено вручную: ${r.name}, ${fmtN(r.grams)} г`);
    else if (num(r.grams) !== r.base.grams) answers.push(`Вес исправлен: ${r.name} — ${fmtN(r.grams)} г`);
  }
  const prev = ph.stage;
  ph.stage = 'loading'; ph.err = ''; renderPhoto();
  try {
    const r = await apiFetch('/api/food/photo', { method: 'POST', body: JSON.stringify({ image: ph.b64, mime: ph.mime, note: ph.note, scale: ph.scale, answers }) });
    if (!ph) return;
    if (!r.isFood) { ph.stage = 'setup'; ph.err = r.comment || (ph.text ? 'Не понял, что за еда. Опиши подробнее.' : 'На фото не видно еды.'); renderPhoto(); return; }
    ph.rows = r.items.map(it => ({ ...it, base: { grams: it.grams, kcal: it.kcal, p: it.p, f: it.f, c: it.c, fi: it.fi, su: it.su, sa: it.sa } }));
    ph.questions = answers.length ? [] : r.questions; ph.answers = {};
    ph.comment = r.comment; ph.stage = 'review';
  } catch (e) {
    if (!ph) return;
    ph.stage = prev === 'review' ? 'review' : 'setup'; ph.err = e.status ? e.message : 'Сервер недоступен.';
  }
  renderPhoto();
}
function photoSave() {
  const rows = ph.rows.filter(r => String(r.name).trim() && (num(r.kcal) || num(r.grams)));
  if (!rows.length) { ph.err = 'Нечего записывать.'; renderPhoto(); return; }
  const saved = [];
  for (const r of rows) {
    const m = { id: uid(), date: ph.date || view.date, time: ph.time || '', name: `${String(r.name).trim()}${num(r.grams) ? `, ${fmtN(r.grams)} г` : ''}`, kcal: Math.round(num(r.kcal)), p: num(r.p), f: num(r.f), c: num(r.c) };
    if (r.su !== undefined) Object.assign(m, { fi: num(r.fi), su: num(r.su), sa: num(r.sa) });
    S.meals.push(m); rememberFood(m); saved.push(m);
  }
  if (String(ph.setName || '').trim()) addSet(ph.setName, saved);
  const t = rows.reduce((a, r) => a + num(r.kcal), 0);
  ph = null; save(); closeModal(); render();
  toast(`Записано: ${rows.length} ${plural(rows.length, 'позиция', 'позиции', 'позиций')}, ${fmtN(t)} ккал`);
}

/* ============================================================
   УЧЁБА
   ============================================================ */
const CATS = ['C#', 'Unity', 'Алгоритмы', 'Архитектура', 'Web', 'Git', 'Математика', 'Английский'];
function usedCats() { return [...new Set([...S.study.map(s => s.category), ...CATS])].filter(Boolean); }

/* Небольшой markdown → HTML для шпаргалок: заголовки, списки, таблицы, код, жирный */
function mdToHtml(md) {
  const inline = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a.replace(/#.*/, ''));
  const out = [], lines = String(md).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf = []; while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]); out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = []; i--;
      while (++i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i]);
      i--;
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push(`<div class="md-table"><table>${body.map((r, k) => `<tr>${cells(r).map(c => k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('')}</tr>`).join('')}</table></div>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.+)$/.exec(l);
    if (h) { out.push(`<h${Math.min(4, h[1].length + 1)}>${inline(h[2])}</h${Math.min(4, h[1].length + 1)}>`); continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l), items = []; i--;
      while (++i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+(\[[ xX]\]\s+)?/, ''));
      i--;
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>\s?/.test(l)) { out.push(`<blockquote>${inline(l.replace(/^>\s?(\[![^\]]+\]\s*)?/, ''))}</blockquote>`); continue; }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('');
}
async function openCheat(id, regenerate) {
  const n = OBS.notes.find(x => x.id === id); if (!n) return;
  const root = $('#modal-root');
  const show = (inner, foot = '') => {
    root.innerHTML = `<div class="overlay" data-action="close-modal"><div class="sheet cheat-sheet" style="--c:var(--study)" role="dialog" aria-modal="true" aria-label="Шпаргалка">
      <header class="sheet-head"><h2>${esc(noteShort(n.title))} — шпаргалка</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Закрыть">${I.x}</button></header>
      <div class="cheat-body">${inner}</div><footer class="sheet-foot">${foot}</footer></div></div>`;
    requestAnimationFrame(() => root.classList.add('open'));
  };
  show(`<p class="cheat-wait"><span class="busy-dot"></span>${regenerate || !n.cheat ? 'Собираю шпаргалку из конспекта… обычно 20–40 секунд' : 'Открываю…'}</p>`);
  try {
    const r = regenerate || !n.cheat
      ? await apiFetch('/api/study/cheatsheet', { method: 'POST', body: JSON.stringify({ noteId: id }) })
      : await apiFetch('/api/study/cheatsheet?id=' + encodeURIComponent(id));
    if (!root.querySelector('.cheat-sheet')) return;
    show(mdToHtml(r.markdown), `<span class="hint" style="margin:0;flex:1">Сохранено в Obsidian: ${esc(r.rel)}</span><a class="btn" href="${esc(r.link)}">${I.study}Открыть в Obsidian</a><button class="btn btn-accent" style="--c:var(--study)" data-action="cheat-new" data-id="${id}">${I.repeat}Собрать заново</button>`);
    loadObs();
  } catch (e) { show(`<p class="auth-err">${esc(e.message)}</p>`, `<button class="btn btn-ghost" data-action="close-modal">Закрыть</button>`); }
}

function ago(iso) {
  if (!iso) return 'ещё не было';
  const m = Math.round((Date.now() - new Date(iso)) / 60e3);
  return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : human(ymd(new Date(iso)));
}
function obsStatusCard() {
  if (!OBS.enabled) return `<p class="hint" style="margin:0">Obsidian не подключён. Укажи на сервере в файле <b>.env</b> путь к хранилищу (<code>OBSIDIAN_VAULT</code>) и свой логин (<code>OBSIDIAN_USER</code>), затем перезапусти сервер. Конспекты из папки «Учёба» будут подтягиваться сами.</p>`;
  const q = OBS.queue || { total: 0, done: 0 };
  const left = q.total - q.done;
  return `<div class="obs-status">
    <div class="obs-line">${I.study}<span>Хранилище <b>${esc(OBS.vaultName)}</b> → папка <b>${esc(OBS.folder)}</b> · синхронизировано ${ago(OBS.lastSync)}</span>
      <button class="btn btn-sm" data-action="obs-sync">${I.repeat}Синхронизировать</button></div>
    ${OBS.error ? `<p class="auth-err" style="margin:0">${esc(OBS.error)}</p>` : ''}
    ${q.total ? `<div class="obs-line"><span class="obs-q">${left ? `${q.pausedUntil ? 'Лимит Gemini — пауза, продолжу сам. ' : 'Gemini готовит вопросы: '}${q.done} из ${q.total} разделов` : `Вопросы готовы для всех ${q.total} разделов`}</span><span class="sb-track obs-track"><i data-w="${q.total ? q.done / q.total * 100 : 0}" style="background:var(--quiz)"></i></span></div>` : ''}
    <details class="obs-howto"><summary>Как оформлять конспекты</summary>
      <p>Каждый конспект — отдельная заметка в папке «${esc(OBS.folder)}». Разделы — заголовки <code>##</code>: по каждому разделу будут свои вопросы. Наверху можно указать теги и дату:</p>
      <pre><code>---\ntitle: Название темы\ntags: [ai, transformers]\ncreated: ${ymd()}\n---</code></pre>
      <p>Пометки 🔍 (гипотезы) в вопросы не попадают, пункты <code>- [ ]</code> показываются как «что проверить». Дописал раздел — в дневнике появится запись, вопросы по нему пересоберутся.</p></details>
  </div>`;
}
function notesCard() {
  if (!OBS.notes.length) return empty(OBS.enabled ? `Конспектов пока нет. Положи заметку в папку «${esc(OBS.folder || 'Учёба')}» — она появится здесь в течение минуты.` : 'Подключи Obsidian — и конспекты появятся здесь.');
  return OBS.notes.map(n => {
    const secs = n.sections.filter(s => !s.skip), qn = secs.reduce((a, s) => a + (s.questions?.length || 0), 0), ready = secs.filter(s => s.questions !== null).length;
    const open = (n.tasks || []).filter(t => !t.done);
    const due = withState().filter(c => c.noteId === n.id && c.st.due <= ymd()).length;
    return `<div class="note">
      <div class="note-head"><div class="note-title"><b>${esc(n.title)}</b><span class="note-meta">${human(n.date)} · ${secs.length} ${plural(secs.length, 'раздел', 'раздела', 'разделов')} · ${qn} ${plural(qn, 'вопрос', 'вопроса', 'вопросов')}${ready < secs.length ? ` (готово ${ready}/${secs.length})` : ''}</span></div>
        <div class="note-actions">
          <button class="btn btn-primary btn-sm" style="--c:var(--quiz)" data-action="quiz-note" data-id="${n.id}" ${qn ? '' : 'disabled'}>${I.quiz}Повторить${due ? ` · ${due}` : ''}</button>
          <button class="btn btn-accent btn-sm" style="--c:var(--study);--cf:var(--study-f)" data-action="cheat" data-id="${n.id}" ${photoOn ? '' : 'disabled'}>${I.spark}${n.cheat ? 'Шпаргалка' : 'Сделать шпаргалку'}</button>
          <a class="btn btn-sm" href="${esc(n.link)}">Открыть в Obsidian</a>
        </div></div>
      ${n.tags.length ? `<div class="chips note-tags">${n.tags.map(t => `<span class="chip chip-pill" style="--c:var(--study);--cf:var(--study-f)">#${esc(t)}</span>`).join('')}</div>` : ''}
      <details class="theses"><summary>Разделы и вопросы</summary><div class="note-secs">${secs.map(sec => `<div class="note-sec"><span>${esc(sec.h)}</span>
        <span class="muted">${sec.questions === null ? 'вопросы готовятся…' : sec.qError ? `ошибка: ${esc(sec.qError.slice(0, 60))}` : `${sec.questions.length} ${plural(sec.questions.length, 'вопрос', 'вопроса', 'вопросов')}`}</span>
        <button class="icon-btn" title="Пересобрать вопросы по разделу" aria-label="Пересобрать вопросы" data-action="obs-regen" data-id="${n.id}" data-key="${sec.key}">${I.repeat}</button></div>`).join('')}</div></details>
      ${open.length ? `<details class="theses"><summary>Что проверить · ${open.length}</summary><ul class="note-tasks">${open.map(t => `<li>${esc(t.text)}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  }).join('');
}
function diaryCard() {
  const obs = (OBS.diary || []).map(e => ({ ...e, src: 'obs' }));
  const man = S.study.map(x => ({ id: x.id, date: x.date, src: 'manual', s: x }));
  const all = [...obs, ...man].sort((a, b) => b.date.localeCompare(a.date) || String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 80);
  if (!all.length) return empty('Дневник заполнится сам: новый конспект или дописанный раздел в Obsidian — запись здесь. Без Obsidian можно добавить занятие вручную.');
  return groupBy(all, e => e.date).map(([d, arr]) => `<div class="group-date"><span>${relDay(d)} · ${human(d)}</span><span>${(() => { const m = studyMin(d); return m ? fmtMin(m) : ''; })()}</span></div>
    <div class="list">${arr.map(e => e.src === 'manual' ? studyItem(e.s) : `<div class="item diary-item">
      <span class="diary-ic">${e.kind === 'new' ? I.plus : I.edit}</span>
      <div class="item-main"><div class="item-title">${esc(noteShort(e.title))}</div>
        <div class="item-sub">${e.kind === 'new' ? `новый конспект: ${e.added.length} ${plural(e.added.length, 'раздел', 'раздела', 'разделов')}` : [e.added.length ? `дописал: ${e.added.map(esc).join(', ')}` : '', e.changed.length ? `изменил: ${e.changed.map(esc).join(', ')}` : ''].filter(Boolean).join(' · ')}</div></div>
      <label class="diary-min" title="Сколько минут занимался"><input type="number" min="0" step="5" inputmode="numeric" placeholder="—" data-dmin="${e.id}" value="${S.studyTime[e.id] || ''}"><span>мин</span></label>
      <a class="icon-btn" href="${esc((OBS.notes.find(n => n.id === e.noteId) || {}).link || '#study')}" title="Открыть в Obsidian" aria-label="Открыть в Obsidian">${I.chevR}</a>
    </div>`).join('')}</div>`).join('');
}

function pageStudy() {
  const allMin = S.study.reduce((a, s) => a + num(s.minutes), 0) + Object.values(S.studyTime).reduce((a, v) => a + num(v), 0);
  const week = rangeDays(7).reduce((a, d) => a + studyMin(d), 0);
  const secs = OBS.notes.flatMap(n => n.sections.filter(s => !s.skip));
  const qn = secs.reduce((a, s) => a + (s.questions?.length || 0), 0);
  const due = dueCards(ymd()).length;
  const days30 = rangeDays(30).map(d => ({ label: parseYmd(d).getDate(), v: studyMin(d), hint: `${human(d)}: ${fmtMin(studyMin(d))}` }));
  let i = 0;
  return `<section class="page" style="--c:var(--study)">
    ${topbar('Учёба', OBS.enabled ? `конспекты из Obsidian · ${OBS.vaultName}` : `${S.study.length} ${plural(S.study.length, 'занятие', 'занятия', 'занятий')}`, { date: false, actions: `<button class="btn" data-action="add-study">${I.plus}Занятие вручную</button>` })}
    <div class="kpis">
      ${kpi('Конспектов', `${OBS.notes.length}`, 'study', i++, `${secs.length} ${plural(secs.length, 'раздел', 'раздела', 'разделов')}`)}
      ${kpi('Вопросов', `${qn}`, 'quiz', i++, 'по разделам конспектов')}
      ${kpi('К повторению', `${due}`, 'paper', i++, due ? 'сегодня' : 'на сегодня всё')}
      ${kpi('За 7 дней', `${hoursStr(week)}<small>ч</small>`, 'study', i++, `всего ${hoursStr(allMin)} ч`)}
    </div>
    <div class="grid">
      ${card({ domain: 'study', title: 'Obsidian', span: 12, i: i++, body: obsStatusCard() })}
      ${card({ domain: 'study', title: 'Конспекты', span: 12, i: i++, body: notesCard() })}
      ${card({ domain: 'study', title: 'Дневник занятий', span: 8, i: i++, body: diaryCard() + '<p class="hint">Время занятия можно вписать прямо в строку дневника — оно пойдёт в часы и график.</p>' })}
      ${card({ domain: 'study', title: '30 дней, минуты', span: 4, i: i++, body: barChart(days30, { color: 'var(--study)', target: S.settings.study, unit: 'мин', labelEvery: 7 }) })}
    </div>
  </section>`;
}
function studyItem(s) {
  return `<div class="item" style="align-items:flex-start">
    <span class="item-time">${esc(s.time || '—')}</span>
    <div class="item-main">
      <div class="item-title">${esc(s.topic)} ${s.category ? `<span class="chip chip-pill">${esc(s.category)}</span>` : ''}</div>
      ${s.notes.length ? `<details class="theses"><summary>${s.notes.length} ${plural(s.notes.length, 'тезис', 'тезиса', 'тезисов')}${s.qa.length ? ` · ${s.qa.length} Q&A` : ''}</summary><ul>${s.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>${s.qa.map(q => `<div class="qa-line"><b>${esc(q.q)}</b> — ${esc(q.a)}</div>`).join('')}</details>` : (s.qa.length ? `<details class="theses"><summary>${s.qa.length} Q&A</summary>${s.qa.map(q => `<div class="qa-line"><b>${esc(q.q)}</b> — ${esc(q.a)}</div>`).join('')}</details>` : '')}
    </div>
    <span class="item-val">${s.minutes ? fmtMin(s.minutes) : ''}</span>
    ${itemActions('study', s.id)}
  </div>`;
}
function studyForm(s) {
  openModal({
    title: s ? 'Изменить занятие' : 'Занятие', accent: 'var(--study)', form: 'study',
    body: `<input type="hidden" name="id" value="${s ? s.id : ''}">
      ${field('Тема', `<input name="topic" required autocomplete="off" placeholder="Делегаты и события в C#" value="${esc(s?.topic || '')}">`)}
      <div class="row">
        ${field('Направление', `<input name="category" list="cats" autocomplete="off" placeholder="C#" value="${esc(s?.category || '')}">${datalist('cats', usedCats())}`)}
        ${field('Минут', `<input name="minutes" type="number" min="0" step="5" inputmode="numeric" placeholder="45" value="${s?.minutes ?? ''}">`)}
        ${field('Время', `<input name="time" type="time" value="${s ? s.time : (view.date === ymd() ? nowHM() : '19:00')}">`)}
        ${field('Дата', `<input name="date" type="date" value="${s ? s.date : view.date}">`)}
      </div>
      ${field('Тезисы — что понял', `<textarea name="notes" placeholder="Каждая строка — отдельная мысль. Например:&#10;Делегат — это тип, описывающий сигнатуру метода&#10;event запрещает вызывать делегат извне класса">${esc(s ? s.notes.join('\n') : '')}</textarea>`)}
      <p class="hint">Из тезисов соберутся вопросы на повторение: пропуски в тексте и «расскажи, что помнишь по теме». Повторы придут через 1, 3, 7… дней.</p>
      ${field('Вопрос → ответ (необязательно)', `<textarea name="qa" style="min-height:70px" placeholder="Чем Action отличается от Func? => Func возвращает значение, Action — нет">${esc(s ? s.qa.map(q => `${q.q} => ${q.a}`).join('\n') : '')}</textarea>`)}`,
    submit: s ? 'Сохранить' : 'Записать'
  });
}
function parseLines(t) { return String(t || '').split('\n').map(x => x.trim()).filter(Boolean); }
function parseQA(t) {
  return parseLines(t).map(l => { const m = l.split(/\s*(?:=>|->|—>|::)\s*/); return m.length >= 2 ? { q: m[0], a: m.slice(1).join(' ') } : null; }).filter(Boolean);
}

/* ============================================================
   ВОПРОСЫ — интервальное повторение
   ============================================================ */
const STOP = new Set(['через', 'потому', 'чтобы', 'когда', 'можно', 'нужно', 'этого', 'этому', 'очень', 'также', 'только', 'после', 'перед', 'между', 'своей', 'своих', 'которые', 'который', 'которая', 'например', 'будет', 'может', 'всегда', 'иначе', 'нельзя', 'должен', 'должна', 'these', 'those', 'which', 'where', 'there', 'their', 'about', 'should', 'would', 'could', 'because']);

function allCards() {
  const cards = [];
  for (const s of S.study) {
    s.notes.forEach((t, i) => cards.push({ id: `${s.id}:n${i}`, type: 'thesis', session: s, text: t }));
    s.qa.forEach((p, i) => cards.push({ id: `${s.id}:q${i}`, type: 'qa', session: s, q: p.q, a: p.a }));
    if (s.notes.length >= 2) cards.push({ id: `${s.id}:sum`, type: 'summary', session: s });
  }
  for (const n of OBS.notes || []) for (const sec of n.sections) for (const q of sec.questions || [])
    cards.push({ id: `${n.id}:${sec.key}:${q.id}`, type: 'obs', session: { id: n.id, topic: `${noteShort(n.title)} · ${sec.h}`, date: sec.updated || sec.first, category: n.tags[0] || '' }, q: q.q, a: q.a, qkind: q.kind, noteId: n.id, key: sec.key });
  return cards;
}
function cardState(c) { return S.srs[c.id] || { interval: 0, ease: 2.5, reps: 0, due: addDays(c.session.date, 1) }; }
function withState() { return allCards().map(c => ({ ...c, st: cardState(c) })); }
function dueCards(date) { return withState().filter(c => c.st.due <= date).sort((a, b) => a.st.due.localeCompare(b.st.due)); }
function soonestCards(n, date) { return withState().filter(c => c.st.due > date).sort((a, b) => a.st.due.localeCompare(b.st.due)).slice(0, n); }

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let x = seed || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function shuffle(arr, r) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const QKIND = { fact: 'Факт', why: 'Почему так', compare: 'Сравни', practice: 'Практика' };
const noteShort = t => String(t).replace(/\s*[—–-]\s*конспект.*$/i, '').replace(/\s*\(.*\)\s*$/, '').trim() || t;
function makeQuestion(c, r) {
  const s = c.session, when = `${s.topic} · ${human(s.date)}`;
  if (c.type === 'obs') return { q: esc(c.q), a: esc(c.a), kind: QKIND[c.qkind] || 'Вопрос', meta: s.topic };
  if (c.type === 'qa') return { q: esc(c.q), a: esc(c.a), kind: 'Вопрос из конспекта', meta: when };
  if (c.type === 'summary') return { q: `Что ты изучал по теме «${esc(s.topic)}»? Назови главное своими словами.`, a: `<ul>${s.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`, kind: 'Вспомни тему', meta: when, html: true };
  const words = c.text.split(/\s+/);
  const cand = words.map((w, i) => ({ w, i, clean: w.replace(/[^\p{L}\p{N}#+.]/gu, '') })).filter(x => x.clean.length >= 5 && !STOP.has(x.clean.toLowerCase()));
  if (words.length >= 4 && cand.length) {
    cand.sort((a, b) => b.clean.length - a.clean.length);
    const pick = cand[Math.floor(r() * Math.min(3, cand.length))];
    const q = words.map((w, i) => i === pick.i ? `<mark class="blank">${'_'.repeat(Math.min(10, Math.max(4, pick.clean.length)))}</mark>${esc(w.slice(w.indexOf(pick.clean) + pick.clean.length))}` : esc(w)).join(' ');
    const a = words.map((w, i) => i === pick.i ? `<mark class="hl">${esc(w)}</mark>` : esc(w)).join(' ');
    return { q, a, kind: 'Заполни пропуск', meta: when, html: true };
  }
  const head = words.slice(0, Math.max(1, Math.min(3, Math.ceil(words.length / 2) - (words.length <= 3 ? 1 : 0)))).join(' ');
  return { q: `Раскрой тезис по теме «${esc(s.topic)}»: «${esc(head)}…»`, a: esc(c.text), kind: 'Раскрой мысль', meta: when };
}
function buildQuiz(date, pool) {
  const r = rng(hash(date));
  const picked = shuffle(pool, r).slice(0, 6);
  return { items: picked.map(c => quizItemFrom(c, r)), source: 'local', created: Date.now() };
}
const plainText = h => { const el = document.createElement('div'); el.innerHTML = String(h); return el.textContent.trim(); };
function quizItemFrom(c, r) {
  const q = makeQuestion(c, r);
  const ctx = c.type === 'obs' ? '' : c.session.notes ? c.session.notes.join('\n') : '';
  return { cardId: c.id, kind: q.kind, meta: q.meta, q: q.q, a: q.a, result: null, revealed: false, noteId: c.noteId || null, key: c.key || null, ctx: ctx.slice(0, 1500) };
}
function ensureQuiz(date) {
  if (S.quizzes[date]) return S.quizzes[date];
  const due = dueCards(date);
  if (!due.length) return null;
  const q = buildQuiz(date, due);
  S.quizzes[date] = q; save();
  return q;
}
function gradeCard(cardId, g) {
  const c = allCards().find(x => x.id === cardId); if (!c) return;
  let { interval, ease, reps } = cardState(c);
  if (g === 'again') { interval = 1; ease = Math.max(1.3, ease - 0.2); reps = 0; }
  else if (g === 'hard') { interval = Math.max(1, Math.round(interval * 1.2) || 1); ease = Math.max(1.3, ease - 0.05); reps++; }
  else { interval = reps === 0 ? 2 : reps === 1 ? 5 : Math.round(interval * ease); ease = Math.min(3, ease + 0.05); reps++; }
  S.srs[cardId] = { interval, ease, reps, due: addDays(ymd(), interval), last: ymd() };
}

function pageQuiz() {
  const d = ymd();
  const quiz = ensureQuiz(d);
  const hasKey = !!S.settings.apiKey;
  const dueN = dueCards(d).length, total = allCards().length;
  const aiBtn = hasKey ? `<button class="btn btn-accent" style="--c:var(--quiz)" data-action="ai-quiz" id="ai-btn">${I.spark}Переформулировать через Claude</button>` : '';
  const hist = quizHistory(14);

  if (!quiz) {
    const soon = soonestCards(1, d)[0];
    let msg;
    if (!total) msg = `Вопросы собираются из <b>тезисов</b> твоих занятий. Запиши первое занятие в разделе «Учёба» с парой тезисов — и завтра здесь появится первый вопрос.`;
    else if (soon) msg = `На сегодня повторять нечего. Ближайшая карточка — <b>${esc(soon.session.topic)}</b>, ${relDay(soon.st.due)}${soon.st.due !== addDays(d, 1) ? ` (${human(soon.st.due)})` : ''}.`;
    else msg = `Все карточки повторены.`;
    return `<section class="page" style="--c:var(--quiz)">
      ${topbar('Вопросы дня', humanLong(d), { date: false })}
      <div class="quiz-empty">${msg}
        <div class="btns">
          ${total && soon ? `<button class="btn btn-accent" style="--c:var(--quiz)" data-action="quiz-early">${I.spark}Повторить досрочно</button>` : ''}
          <a class="btn" href="#study">${I.plus}Записать занятие</a>
        </div>
      </div>
      ${hist ? `<div style="margin-top:14px">${card({ domain: 'quiz', title: 'Точность за 14 дней', body: hist, span: 12 })}</div>` : ''}
    </section>`;
  }

  const answered = quiz.items.filter(i => i.result).length;
  const curIdx = quiz.items.findIndex(i => !i.result);
  const good = quiz.items.filter(i => i.result === 'good').length;
  const doneAll = curIdx === -1;
  return `<section class="page" style="--c:var(--quiz)">
    ${topbar('Вопросы дня', `${humanLong(d)} · ${quiz.source === 'ai' ? 'сформулировал Claude' : 'из твоих конспектов'}`, { date: false, actions: aiBtn })}
    <div class="quiz-head">
      <div class="quiz-progress">${quiz.items.map((it, k) => `<i class="${it.result || (k === curIdx ? 'cur' : '')}"></i>`).join('')}</div>
      <span class="muted mono" style="font-size:12px">${answered} / ${quiz.items.length}</span>
    </div>
    ${doneAll ? `<div class="quiz-done"><div class="big"><b>${good}</b><small>/ ${quiz.items.length} уверенно</small></div><p class="muted" style="margin:10px 0 0">${good === quiz.items.length ? 'Чисто. Завтра будет новая порция.' : 'Что не вспомнил — вернётся завтра.'}</p>${dueN ? `<button class="btn btn-accent" style="--c:var(--quiz);margin-top:14px" data-action="quiz-more">${I.plus}Ещё ${Math.min(6, dueN)} ${plural(Math.min(6, dueN), 'карточка', 'карточки', 'карточек')} ждут</button>` : ''}</div>` : ''}
    <div class="qlist">${quiz.items.map((it, k) => quizItem(it, k, curIdx)).join('')}</div>
    ${hist ? `<div style="margin-top:14px">${card({ domain: 'quiz', title: 'Точность за 14 дней', body: hist, span: 12 })}</div>` : ''}
  </section>`;
}
function quizItem(it, k, curIdx) {
  const state = it.result ? 'done' : k === curIdx ? 'current' : 'locked';
  const resName = { good: 'помню', hard: 'частично', again: 'не помню' };
  return `<article class="q ${state}" style="--i:${k}">
    <div class="q-meta"><span>${k + 1} · ${esc(it.kind)}</span><span>${esc(it.meta)}</span></div>
    <p class="q-text">${it.q}</p>
    ${state === 'current' && !it.revealed ? (photoOn ? `<textarea class="q-input" data-qans="${k}" rows="3" placeholder="Ответь своими словами — ИИ сверит с конспектом">${esc(it.answer || '')}</textarea>
      <div class="q-actions"><button class="btn btn-primary" style="--c:var(--quiz)" data-action="q-check" data-k="${k}">${I.spark}Проверить ответ</button><button class="btn btn-ghost" data-action="reveal" data-k="${k}">${I.eye}Не знаю — показать ответ</button></div>`
      : `<div class="q-actions"><button class="btn btn-primary" style="--c:var(--quiz)" data-action="reveal" data-k="${k}">${I.eye}Показать ответ</button></div>`) : ''}
    ${it.check ? `<div class="q-check q-check-${it.check.verdict}"><div class="q-score"><b>${it.check.score}</b><small>из 100</small></div><div class="q-fb">
        ${it.answer ? `<p class="q-yours"><span>Твой ответ:</span> ${esc(it.answer)}</p>` : ''}<p>${esc(it.check.feedback)}</p>${it.check.missing.length ? `<ul>${it.check.missing.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></div>` : ''}
    ${(it.revealed || it.result) ? `<div class="q-answer"><span class="q-ref">Эталон</span>${it.a}</div>` : ''}
    ${state === 'current' && it.revealed ? `<div class="q-actions">
        ${it.check ? '<span class="q-suggest">Оценка ИИ подсвечена — можно выбрать другую:</span>' : ''}
        <button class="btn btn-accent grade-again ${it.check?.verdict === 'again' ? 'suggest' : ''}" data-action="grade" data-k="${k}" data-g="again">Не помню</button>
        <button class="btn btn-accent grade-hard ${it.check?.verdict === 'hard' ? 'suggest' : ''}" data-action="grade" data-k="${k}" data-g="hard">Частично</button>
        <button class="btn btn-accent grade-good ${it.check?.verdict === 'good' ? 'suggest' : ''}" data-action="grade" data-k="${k}" data-g="good">${I.check}Помню</button>
      </div>` : ''}
    ${it.result ? `<div class="q-actions"><span class="q-result ${it.result}">${resName[it.result]}</span></div>` : ''}
  </article>`;
}
function quizHistory(n) {
  const days = rangeDays(n).map(d => { const q = S.quizzes[d]; const items = q ? q.items.filter(i => i.result) : []; const good = items.filter(i => i.result === 'good').length; return { label: parseYmd(d).getDate(), v: items.length ? good / items.length * 100 : 0, hint: items.length ? `${human(d)}: ${good}/${items.length}` : `${human(d)}: нет ответов`, empty: !items.length }; });
  if (!days.some(x => !x.empty)) return '';
  return barChart(days, { color: 'var(--quiz)', max: 100, unit: '%', labelEvery: 2 });
}

/* ---------- Claude ---------- */
async function aiQuiz() {
  const key = S.settings.apiKey;
  if (!key) { toast('Сначала вставь API-ключ в настройках', true); return; }
  const d = ymd();
  const existing = S.quizzes[d];
  const pool = existing
    ? existing.items.filter(i => !i.result).map(i => withState().find(c => c.id === i.cardId)).filter(Boolean)
    : dueCards(d).slice(0, 6);
  if (!pool.length) { toast('Нет карточек для вопросов', true); return; }
  const payload = pool.map(c => ({
    id: c.id, topic: c.session.topic, category: c.session.category, date: c.session.date,
    content: c.type === 'qa' ? `Вопрос: ${c.q}\nОтвет: ${c.a}` : c.type === 'summary' ? c.session.notes.join('\n') : c.text
  }));
  const system = 'Ты наставник по IT и помогаешь ученику повторять материал по его собственным конспектам. Для каждой карточки составь один проверочный вопрос на русском: он должен требовать вспомнить или применить суть записи, но не должен содержать ответ. Если карточка — список тезисов по теме, задай вопрос на пересказ или применение темы целиком. Ответ — краткий эталон, 1–3 предложения, опираясь на текст карточки. Верни строго JSON-массив без пояснений и без markdown: [{"id":"...","q":"...","a":"..."}]. Сохраняй id без изменений, по одному объекту на карточку.';
  const user = `Карточки ученика:\n${JSON.stringify(payload, null, 1)}`;
  const btn = $('#ai-btn'); btn && btn.classList.add('busy');
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  const body = { model: 'claude-opus-5-5', max_tokens: 8000, system, messages: [{ role: 'user', content: user }] };
  try {
    let res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { ...headers, 'anthropic-beta': 'server-side-fallback-2026-07-01' }, body: JSON.stringify({ ...body, fallbacks: 'default' }) });
    if (res.status === 400) res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) { const t = await res.text(); throw new Error(`${res.status} — ${t.slice(0, 180)}`); }
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('модель отклонила запрос');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    const byId = Object.fromEntries(arr.map(x => [x.id, x]));
    const items = pool.filter(c => byId[c.id]).map(c => ({ cardId: c.id, kind: 'Вопрос от Claude', meta: `${c.session.topic} · ${human(c.session.date)}`, q: esc(byId[c.id].q), a: esc(byId[c.id].a), result: null, revealed: false }));
    if (!items.length) throw new Error('пустой ответ');
    const kept = existing ? existing.items.filter(i => i.result) : [];
    S.quizzes[d] = { items: [...kept, ...items], source: 'ai', created: Date.now() };
    save(); render(); toast('Вопросы переформулированы');
  } catch (err) {
    console.error(err);
    toast(`Не получилось: ${err.message}`, true);
    btn && btn.classList.remove('busy');
  }
}

/* ============================================================
   ЗАЛ
   ============================================================ */
const GYM_TYPES = ['Силовая', 'Кардио', 'Верх тела', 'Низ тела', 'Full body', 'Растяжка', 'Бокс', 'Плавание', 'Бег'];
function parseExercises(t) {
  return parseLines(t).map(line => {
    const m = line.match(/^(.+?)\s+(\d+\s*[x×х]\s*\d+.*)$/i);
    if (!m) return { name: line, sets: [] };
    const name = m[1].trim(), sets = [];
    const re = /(\d+)\s*[x×х]\s*(\d+)(?:\s*(?:@|по|\*)?\s*(\d+(?:[.,]\d+)?)\s*(?:кг|kg)?)?/gi;
    let g;
    while ((g = re.exec(m[2]))) { const n = +g[1], reps = +g[2], kg = g[3] ? num(g[3]) : 0; for (let i = 0; i < Math.min(n, 20); i++) sets.push({ reps, kg }); }
    return { name, sets };
  });
}
function setsStr(e) {
  if (!e.sets.length) return '';
  const groups = [];
  for (const s of e.sets) { const last = groups[groups.length - 1]; if (last && last.reps === s.reps && last.kg === s.kg) last.n++; else groups.push({ ...s, n: 1 }); }
  return groups.map(g => `<b>${g.n}×${g.reps}</b>${g.kg ? ` ${fmt1(g.kg)} кг` : ''}`).join(', ');
}
function volume(w) { return w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + s.reps * (s.kg || 0), 0), 0); }
function prs() {
  const map = {};
  for (const w of S.workouts) for (const e of w.exercises) for (const s of e.sets) {
    if (!s.kg) continue;
    const k = e.name.trim().toLowerCase();
    const cur = map[k];
    if (!cur || s.kg > cur.kg || (s.kg === cur.kg && s.reps > cur.reps)) map[k] = { name: e.name.trim(), kg: s.kg, reps: s.reps, date: w.date };
  }
  return Object.values(map).sort((a, b) => b.kg - a.kg);
}
function pageGym() {
  const week = rangeDays(7).reduce((a, d) => a + gymOn(d).length, 0);
  const month = rangeDays(30).reduce((a, d) => a + gymOn(d).length, 0);
  const minutes = S.workouts.reduce((a, w) => a + num(w.minutes), 0);
  const recent = [...S.workouts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  const weeks = weeklyCounts(12, d => gymOn(d).length);
  const pr = prs();
  let i = 0;
  return `<section class="page" style="--c:var(--gym)">
    ${topbar('Зал', `${S.workouts.length} ${plural(S.workouts.length, 'тренировка', 'тренировки', 'тренировок')}`, { date: false, actions: `<button class="btn btn-primary" style="--c:var(--gym)" data-action="add-gym">${I.plus}Тренировка</button>` })}
    <div class="kpis">
      ${kpi('За 7 дней', `${week}`, 'gym', i++, plural(week, 'тренировка', 'тренировки', 'тренировок'))}
      ${kpi('За 30 дней', `${month}`, 'gym', i++)}
      ${kpi('Часов в зале', `${hoursStr(minutes)}<small>ч</small>`, 'paper', i++, 'за всё время')}
      ${kpi('Рекордов', `${pr.length}`, 'paper', i++, 'упражнений с весом')}
    </div>
    <div class="grid">
      ${card({ domain: 'gym', title: 'Тренировок в неделю, 12 недель', span: 7, i: i++, body: barChart(weeks, { color: 'var(--gym)', unit: 'тр.', max: 7, labelEvery: 1 }) })}
      ${card({ domain: 'gym', title: 'Личные рекорды', span: 5, i: i++, body: pr.length ? `<table class="table"><thead><tr><th>Упражнение</th><th class="num">Вес</th><th class="num">Повт.</th></tr></thead><tbody>${pr.slice(0, 8).map(p => `<tr><td>${esc(p.name)}</td><td class="num">${fmt1(p.kg)} кг</td><td class="num">${p.reps}</td></tr>`).join('')}</tbody></table>` : empty('Запиши подходы с весом в формате «Жим лёжа 3x8 60», и рекорды посчитаются сами.') })}
      ${card({ domain: 'gym', title: 'Журнал тренировок', span: 12, i: i++, body: recent.length ? groupBy(recent, w => w.date).map(([d, arr]) => `<div class="group-date"><span>${relDay(d)} · ${human(d)}</span></div><div class="list">${arr.map(gymItem).join('')}</div>`).join('') : empty('Пока без тренировок.') })}
    </div>
  </section>`;
}
function gymItem(w) {
  const vol = volume(w);
  return `<div class="item" style="align-items:flex-start">
    <span class="item-time">${esc(w.time || '—')}</span>
    <div class="item-main">
      <div class="item-title">${esc(w.type)}</div>
      ${w.exercises.length ? `<div class="item-sub" style="display:flex;flex-direction:column;gap:3px;margin-top:6px">${w.exercises.map(e => `<span class="sets">${esc(e.name)}${e.sets.length ? ' — ' + setsStr(e) : ''}</span>`).join('')}</div>` : ''}
      ${w.note ? `<div class="item-sub">${esc(w.note)}</div>` : ''}
    </div>
    <span class="item-val">${w.minutes ? fmtMin(w.minutes) : ''}${vol ? `<small>${fmtN(vol)} кг объём</small>` : ''}</span>
    ${itemActions('gym', w.id)}
  </div>`;
}
function gymForm(w) {
  const text = w ? w.exercises.map(e => e.name + (e.sets.length ? ' ' + exToText(e) : '')).join('\n') : '';
  openModal({
    title: w ? 'Изменить тренировку' : 'Тренировка', accent: 'var(--gym)', form: 'gym',
    body: `<input type="hidden" name="id" value="${w ? w.id : ''}">
      <div class="row">
        ${field('Тип', `<input name="type" list="gymtypes" required autocomplete="off" placeholder="Силовая" value="${esc(w?.type || '')}">${datalist('gymtypes', [...GYM_TYPES, ...S.workouts.map(x => x.type)])}`)}
        ${field('Минут', `<input name="minutes" type="number" min="0" step="5" inputmode="numeric" placeholder="60" value="${w?.minutes ?? ''}">`)}
        ${field('Время', `<input name="time" type="time" value="${w ? w.time : (view.date === ymd() ? nowHM() : '18:00')}">`)}
        ${field('Дата', `<input name="date" type="date" value="${w ? w.date : view.date}">`)}
      </div>
      ${field('Упражнения', `<textarea name="exercises" data-live="exercises" placeholder="Жим лёжа 3x8 60&#10;Присед 4x6 80, 1x4 90&#10;Подтягивания 3x10&#10;Бег 20 мин">${esc(text)}</textarea>`)}
      <div class="preview" id="ex-preview">${exPreview(text)}</div>
      <p class="hint">Формат: название, затем подходы×повторы и вес. «3x8 60» — три подхода по 8 на 60 кг. Несколько групп через запятую. Без цифр — просто название.</p>
      ${field('Заметка', `<input name="note" placeholder="Самочувствие, что улучшить" value="${esc(w?.note || '')}">`)}`,
    submit: w ? 'Сохранить' : 'Записать'
  });
}
function exToText(e) {
  const groups = [];
  for (const s of e.sets) { const last = groups[groups.length - 1]; if (last && last.reps === s.reps && last.kg === s.kg) last.n++; else groups.push({ ...s, n: 1 }); }
  return groups.map(g => `${g.n}x${g.reps}${g.kg ? ' ' + g.kg : ''}`).join(', ');
}
function exPreview(text) {
  const ex = parseExercises(text);
  if (!ex.length) return '';
  return ex.map(e => `${esc(e.name)}${e.sets.length ? ` — ${e.sets.length} ${plural(e.sets.length, 'подход', 'подхода', 'подходов')}, ${setsStr(e)}` : ''}`).join('\n');
}

/* ============================================================
   ШАГИ И ТЕЛО
   ============================================================ */
function pageSteps() {
  const d = view.date, set = S.settings, day = dayRec(d);
  const days30 = rangeDays(30, d);
  const vals = days30.map(x => num(dayRec(x).steps));
  const withData = vals.filter(Boolean);
  const avg = withData.length ? withData.reduce((a, b) => a + b, 0) / withData.length : 0;
  const best = Math.max(0, ...vals);
  const hit = vals.filter(v => v >= set.steps).length;
  const weights = rangeDays(90, d).map(x => ({ d: x, v: num(dayRec(x).weight) })).filter(x => x.v);
  let i = 0;
  return `<section class="page" style="--c:var(--steps)">
    ${topbar('Шаги', humanLong(d))}
    <div class="grid">
      ${card({ domain: 'steps', title: 'Шагов за день', span: 4, i: i++, body: `<form data-form="steps" class="form-stack">
          <input class="big-input" name="steps" type="number" min="0" step="100" inputmode="numeric" placeholder="сколько шагов" value="${day.steps || ''}">
          <div style="margin-top:-4px">${bar(num(day.steps), set.steps)}</div>
          <div class="row row-2">
            ${field('Вес, кг', `<input name="weight" type="number" min="0" step="0.1" inputmode="decimal" placeholder="—" value="${day.weight || ''}">`)}
            <div class="field"><label>&nbsp;</label><button class="btn btn-primary" style="--c:var(--steps)" type="submit">Сохранить</button></div>
          </div></form>` })}
      ${card({ domain: 'steps', title: '30 дней', span: 8, i: i++, body: barChart(days30.map((x, k) => ({ label: parseYmd(x).getDate(), v: vals[k], hint: `${human(x)}: ${fmtN(vals[k])}` })), { color: 'var(--steps)', target: set.steps, unit: '', labelEvery: 5 }) })}
    </div>
    <div class="kpis" style="margin-top:14px">
      ${kpi('Среднее', `${fmtN(avg)}`, 'steps', i++, `за дни с записью (${withData.length})`)}
      ${kpi('Лучший день', `${fmtN(best)}`, 'steps', i++)}
      ${kpi('Цель достигнута', `${hit}<small>из 30</small>`, 'paper', i++, `цель ${fmtN(set.steps)}`)}
      ${kpi('Вес', weights.length ? `${fmt1(weights[weights.length - 1].v)}<small>кг</small>` : '—', 'paper', i++, weights.length > 1 ? `${weights[weights.length - 1].v - weights[0].v > 0 ? '+' : ''}${fmt1(weights[weights.length - 1].v - weights[0].v)} кг за ${diffDays(weights[0].d, weights[weights.length - 1].d)} дн.` : 'запиши вес, чтобы следить за динамикой')}
    </div>
    ${weights.length > 1 ? `<div class="grid" style="margin-top:14px">${card({ domain: 'paper', title: 'Вес, 90 дней', span: 12, i: i++, body: lineChart(weights.map(w => ({ label: human(w.d), v: w.v })), { color: 'var(--paper)', unit: 'кг' }) })}</div>` : ''}
  </section>`;
}


/* ============================================================
   ЦЕЛЬ: профиль, план и прогноз
   ============================================================ */
function mondayOf(d) { return addDays(d, -((parseYmd(d).getDay() + 6) % 7)); }
function profileNow() {
  const p = S.profile;
  return { ...p, age: p.age + Math.max(0, Math.floor(diffDays(p.ageDate || ymd(), ymd()) / 365.25)) };
}
function weightSeries() {
  return Object.keys(S.days).filter(d => num(S.days[d].weight)).sort().map(d => ({ d, v: num(S.days[d].weight) }));
}
function curWeight() { const w = weightSeries(); return w.length ? w[w.length - 1].v : num(S.profile?.weight); }
function curLevel(d = ymd()) {
  const m = mondayOf(d);
  if (S.activity[m]) return S.activity[m];
  const prev = Object.keys(S.activity).filter(k => k <= m).sort().pop();
  return prev ? S.activity[prev] : 'sed';
}
/* Шаги для плана: среднее за 7 прошлых дней, если записано хотя бы 3 дня, иначе оценка из анкеты */
function stepsNow() {
  const t = ymd(), vals = rangeDays(7, addDays(t, -1)).map(d => num(dayRec(d).steps)).filter(Boolean);
  if (vals.length >= 3) return { steps: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), measured: true, days: vals.length };
  return { steps: num(S.profile?.steps) || 6000, measured: false, days: vals.length };
}
function planNow() { return Plan.compute(profileNow(), curWeight(), curLevel(), stepsNow().steps); }
function applyGoals() { const c = planNow(); S.settings.kcal = c.kcal; S.settings.protein = c.protein; return c; }
const fmt2 = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const kgWeek = v => Math.abs(v) < 0.005 ? '±0 кг/нед' : `${v > 0 ? '+' : '−'}${fmt2(Math.abs(v))} кг/нед`;
const kgDiff = v => Math.abs(v) < 0.05 ? '±0' : `${v > 0 ? '+' : '−'}${fmt1(Math.abs(v))}`;
function etaText(weeks) {
  if (weeks === null) return null;
  const d = addDays(ymd(), Math.round(weeks * 7));
  const w = Math.round(weeks);
  return `${w < 1 ? 'меньше недели' : `${w} ${plural(w, 'неделя', 'недели', 'недель')}`}, примерно к ${humanLong(d)}`;
}

/* Факт за последние 4 недели: тренд веса и среднее съеденное */
function factStats() {
  const t = ymd(), start = addDays(t, -27);
  const pts = weightSeries().filter(x => x.d >= start).map(x => ({ t: diffDays(start, x.d), v: x.v }));
  const tr = Plan.trend(pts);
  const days = rangeDays(27, addDays(t, -1)).filter(d => mealsOn(d).length);
  const intake = days.length ? days.reduce((a, d) => a + sumMeals(mealsOn(d)).kcal, 0) / days.length : 0;
  const nowT = diffDays(start, t);
  return {
    tr, start, nowT, intake, intakeDays: days.length,
    weekly: tr ? tr.slope * 7 : 0,
    now: tr ? tr.at(nowT) : null,
    tdee: tr && days.length >= 10 ? Plan.factTdee(intake, tr.slope) : null
  };
}

function planLines(p, w, lv, c, stepsInfo) {
  const sim = Plan.simulate(p, w, c.kcal, lv, 26, c.steps), eta = Plan.weeksTo(p, w, c.kcal, lv, p.target, c.steps);
  const act = Plan.ACTIVITY[lv], lines = [];
  lines.push(`Основной обмен <b>${fmtN(c.bmr)} ккал</b> — столько тело тратит в полном покое (${c.bfMeasured ? 'Katch–McArdle по твоему проценту жира' : 'формула Миффлина — Сан Жеора'}).`);
  lines.push(`Тренировки «${act.name.toLowerCase()}» ×${String(act.f).replace('.', ',')} и ходьба ${fmtN(c.steps)} шагов в день${stepsInfo?.measured ? ` (среднее за ${stepsInfo.days} дн. по записям)` : ' (оценка — запиши шаги, и план возьмёт реальные)'}: +${fmtN(c.walk)} ккал. Итого расход <b>${fmtN(c.tdee)} ккал</b> — при таких калориях вес стоит на месте.`);
  if (p.goal === 'maintain') lines.push(`Цель <b>${fmtN(c.kcal)} ккал</b> — поддержка. Вес держится, а с силовыми и белком тело постепенно становится плотнее.`);
  else {
    const dd = Math.round(Math.abs(c.delta));
    lines.push(`Цель <b>${fmtN(c.kcal)} ккал</b> = расход ${c.delta < 0 ? '−' : '+'} ${fmtN(dd)}. Без дополнительной активности это <b>${kgWeek(c.weeklyKg)}</b>, около ${kgDiff(c.weeklyKg * 30 / 7)} кг в месяц.`);
    lines.push(`Прогноз: через 4 недели ≈ <b>${fmt1(sim[4])} кг</b>, через 12 — ≈ <b>${fmt1(sim[12])} кг</b>, через полгода — ≈ <b>${fmt1(sim[26])} кг</b>. Темп постепенно снижается: чем меньше вес, тем меньше расход.`);
  }
  if (p.target) {
    const e = etaText(eta);
    lines.push(e ? `До цели <b>${fmt1(p.target)} кг</b>: ${e}.` : `До <b>${fmt1(p.target)} кг</b> при этих калориях не дойти — вес выйдет на плато раньше. Цель пересчитается, когда вес изменится.`);
  }
  lines.push(`Белок <b>${c.protein} г</b> (≈2 г на кг безжировой массы — ${fmt1(c.lbm)} кг при жире ≈${Math.round(c.bf)}%${c.bfMeasured ? '' : ', оценка по ИМТ'}), жиры ${c.fat} г, углеводы ${c.carbs} г.`);
  if (p.goal === 'gain') lines.push(`Реально нарастить ≈ <b>${fmt1(c.muscleMonth)} кг мышц в месяц</b> при твоём стаже. Если вес растёт заметно быстрее, лишнее уходит в жир — тогда профицит стоит уменьшить.`);
  if (p.goal !== 'gain') { const extra = Math.round(Plan.kcalPerStep(w, p.height) * 3000); lines.push(`Каждые +3000 шагов в день — это ещё ≈${extra} ккал расхода, около ${fmt2(extra * 7 / Plan.KCAL_PER_KG)} кг в неделю, если не есть больше.`); }
  if (p.goal === 'lose' && p.experience === 'new') lines.push('Новичку на силовых с таким белком реально не только сохранить, но и немного нарастить мышцы на дефиците.');
  c.notes.forEach(n => lines.push(n));
  return { sim, eta, lines };
}

function forecastChart(series) {
  const all = series.flatMap(s => s.pts);
  if (all.length < 2) return empty('Запиши вес хотя бы пару раз, и здесь появится график.');
  const W = 1000, H = 300, pt = 22, pb = 28, pl = 40, pr = 12;
  const d0 = all.reduce((a, x) => x.d < a ? x.d : a, all[0].d), d1 = all.reduce((a, x) => x.d > a ? x.d : a, all[0].d);
  const span = Math.max(1, diffDays(d0, d1));
  const vals = all.map(x => x.v), lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5;
  const x = d => pl + (W - pl - pr) * diffDays(d0, d) / span, y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const t = ymd(), tx = x(t);
  const grid = [hi - 0.5, (hi + lo) / 2, lo + 0.5].map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/><text x="${pl - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${fmt1(v)}</text>`).join('');
  const lines = series.map(s => s.pts.length < 2 && !s.dots ? '' :
    `<path d="${path(s.pts)}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2.5}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>` +
    (s.dots ? s.pts.map(p => `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.2" fill="${s.color}"><title>${human(p.d)}: ${fmt1(p.v)} кг</title></circle>`).join('') : '')).join('');
  const now = t >= d0 && t <= d1 ? `<line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${pt}" y2="${H - pb}" stroke="var(--paper-3)" stroke-dasharray="2 4"/><text x="${tx.toFixed(1)}" y="${pt - 4}" text-anchor="middle">сегодня</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Вес и прогноз">${grid}${now}${lines}
    <text x="${pl}" y="${H - 6}">${human(d0)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${human(d1)}</text></svg>
    <div class="heat-legend">${series.filter(s => s.pts.length).map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`;
}

function pageGoal() {
  if (!S.profile) return `<section class="page">${topbar('Цель', 'план и прогноз', { date: false })}
    <div class="quiz-empty"><b>План ещё не составлен.</b> Ответь на пару вопросов о себе, и журнал посчитает калории, белок и прогноз веса.
    <div class="btns"><button class="btn btn-accent" data-action="edit-profile">${I.goal}Составить план</button></div></div></section>`;
  const p = profileNow(), w = curWeight(), lv = curLevel(), si = stepsNow(), c = Plan.compute(p, w, lv, si.steps), g = Plan.GOALS[p.goal];
  const { sim, lines } = planLines(p, w, lv, c, si);
  const f = factStats(), t = ymd();
  let i = 0;

  // факт
  let factBody;
  if (f.tr) {
    const proj4 = f.now + f.weekly * 4, proj12 = f.now + f.weekly * 12;
    const etaF = p.target && f.weekly && Math.sign(p.target - f.now) === Math.sign(f.weekly) ? etaText((p.target - f.now) / f.weekly) : null;
    const cmp = p.goal === 'maintain' ? (Math.abs(f.weekly) < 0.15 ? 'Вес держится — как и задумано.' : `Вес ${f.weekly > 0 ? 'растёт' : 'снижается'}, хотя цель — держать. Поправь калории.`)
      : Math.abs(c.weeklyKg) < 0.01 ? '' : (() => {
        const r = f.weekly / c.weeklyKg;
        if (r < 0) return p.goal === 'lose' ? 'Вес пока растёт, а не снижается. Проверь, всё ли съеденное записано.' : 'Вес пока снижается, а не растёт. Нужно есть больше.';
        if (r < 0.7) return `Идёшь медленнее плана (${Math.round(r * 100)}% от расчёта).`;
        if (r > 1.4) return p.goal === 'lose' ? `Худеешь быстрее плана (${Math.round(r * 100)}%). Следи, чтобы не уходили мышцы.` : `Набираешь быстрее плана (${Math.round(r * 100)}%) — часть уходит в жир.`;
        return 'Идёшь по плану.';
      })();
    const muscle = p.goal === 'gain' && f.weekly > 0 ? `<p class="hint">За месяц ≈ +${fmt1(f.weekly * 30 / 7)} кг, из них мышц реально до ${fmt1(Math.min(c.muscleMonth, f.weekly * 30 / 7))} кг.</p>` : '';
    factBody = `<div class="big"><b>${kgWeek(f.weekly).replace(' кг/нед', '')}</b><small>кг в неделю по тренду</small></div>
      <p class="goal-cmp">${cmp}</p>
      <ul class="goal-lines">
        <li>Сейчас по тренду ≈ <b>${fmt1(f.now)} кг</b> (${f.tr.n} ${plural(f.tr.n, 'замер', 'замера', 'замеров')} за ${f.tr.span} дн.).</li>
        <li>Если так пойдёт дальше: через 4 недели ≈ <b>${fmt1(proj4)} кг</b>, через 12 — ≈ <b>${fmt1(proj12)} кг</b>.</li>
        ${etaF ? `<li>До ${fmt1(p.target)} кг: ${etaF}.</li>` : ''}
        ${f.intakeDays ? `<li>В среднем съедено <b>${fmtN(f.intake)} ккал</b> (еда записана ${f.intakeDays} из 27 дней).</li>` : '<li>Еда за последние недели не записана — без неё не понять, сколько ты реально тратишь.</li>'}
        ${f.tdee ? `<li>Твой реальный расход ≈ <b>${fmtN(f.tdee)} ккал</b> (по расчёту ${fmtN(c.tdee)}).${Math.abs(f.tdee - c.tdee) > 200 ? ` Чтобы идти по плану, ешь ≈ ${fmtN(Math.round((f.tdee + c.delta) / 10) * 10)} ккал.` : ''}</li>` : ''}
      </ul>${muscle}`;
  } else {
    const n = weightSeries().filter(x => x.d >= f.start).length;
    factBody = `<p class="goal-cmp">Пока мало данных.</p><ul class="goal-lines">
      <li>Нужно минимум 3 замера веса за 7+ дней — сейчас ${n}. Взвешивайся утром натощак, 2–3 раза в неделю.</li>
      <li>Записывай еду: по съеденному и динамике веса журнал посчитает твой настоящий расход и поправит прогноз.</li></ul>`;
  }

  // график: история, план от старта, факт вперёд
  const start = S.profile.start || t;
  const hist = weightSeries().filter(x => x.d >= addDays(t, -120));
  const planSim = Plan.simulate(p, S.profile.startWeight || w, c.kcal, lv, Math.max(12, Math.ceil(diffDays(start, t) / 7) + 8), c.steps);
  const planPts = planSim.map((v, k) => ({ d: addDays(start, k * 7), v })).filter(x => x.d <= addDays(t, 56));
  const factPts = f.tr ? [{ d: t, v: f.now }, { d: addDays(t, 56), v: f.now + f.weekly * 8 }] : [];
  const chart = forecastChart([
    { name: 'план', pts: p.goal === 'maintain' ? [] : planPts, color: 'var(--orange)', dash: '6 6', w: 2 },
    { name: 'тренд дальше', pts: factPts, color: 'var(--gym)', dash: '2 5', w: 3 },
    { name: 'вес', pts: hist, color: 'var(--navy)', dots: true }
  ]);

  return `<section class="page" style="--c:var(--orange)">
    ${topbar('Цель', `${g.name.toLowerCase()}${p.target ? ` · ${fmt1(p.target)} кг` : ''}`, { date: false, actions: `<button class="btn" data-action="edit-profile">${I.edit}Изменить данные</button>` })}
    <div class="kpis">
      ${kpi('Калории в день', fmtN(c.kcal), 'paper', i++, `поддержка ${fmtN(c.tdee)}`)}
      ${kpi('Белок', `${c.protein}<small>г</small>`, 'food', i++, `жиры ${c.fat} · углеводы ${c.carbs}`)}
      ${kpi('Темп по плану', kgWeek(c.weeklyKg).replace(' кг/нед', '') + '<small>кг/нед</small>', 'gym', i++, p.goal === 'maintain' ? 'держим вес' : `${Plan.PACE[p.goal][p.pace].name.toLowerCase()} темп`)}
      ${kpi('Вес сейчас', `${fmt1(w)}<small>кг</small>`, 'quiz', i++, S.profile.startWeight ? `старт ${fmt1(S.profile.startWeight)} · ${kgDiff(w - S.profile.startWeight)} кг` : '')}
    </div>
    <div class="grid">
      ${card({ domain: 'food', title: 'План', span: 6, i: i++, cls: 'tile tile-orange', body: `${p.goal === 'maintain' ? `<div class="big"><b>${fmt1(w)}</b><small>кг держим</small></div>` : `<div class="big"><b>${fmt1(sim[12])}</b><small>кг через 12 недель</small></div>`}<ul class="goal-lines">${lines.slice(2, p.target ? 5 : 4).map(l => `<li>${l}</li>`).join('')}</ul>` })}
      ${card({ domain: 'study', title: 'По факту', span: 6, i: i++, cls: 'tile tile-navy', body: factBody })}
      ${card({ domain: 'paper', title: 'Вес и прогноз', span: 12, i: i++, body: chart })}
      ${card({ domain: 'gym', title: 'Активность на этой неделе', span: 6, i: i++, body: `<div class="seg seg-wrap">${Object.entries(Plan.ACTIVITY).map(([k, a]) => `<button class="${k === lv ? 'on' : ''}" data-action="set-level" data-v="${k}">${a.name}</button>`).join('')}</div>
        <p class="hint">${Plan.ACTIVITY[lv].hint}. Неделя с ${human(mondayOf(t))}; в понедельник спрошу снова.</p>
        <p class="hint">Шаги: ${si.measured ? `в среднем <b>${fmtN(si.steps)}</b> за ${si.days} дн. — это +${fmtN(c.walk)} ккал к расходу` : `пока оценка ${fmtN(si.steps)} в день. Записывай шаги хотя бы 3 дня в неделю — план подстроится`}.</p>` })}
      ${card({ domain: 'paper', title: 'Профиль', span: 6, i: i++, body: `<div class="chips">
        <span class="chip"><b>${p.sex === 'm' ? 'Мужчина' : 'Женщина'}</b></span><span class="chip"><b>${p.age}</b> лет</span><span class="chip"><b>${p.height}</b> см</span>
        <span class="chip">ИМТ <b>${fmt1(c.bmi)}</b></span><span class="chip">жир <b>${Math.round(c.bf)}%</b>${c.bfMeasured ? '' : ' (оценка)'}</span>
        <span class="chip">${Plan.BUILD[p.build].name}</span><span class="chip">стаж: ${Plan.EXPERIENCE[p.experience].name.toLowerCase()}</span></div>` })}
      ${card({ domain: 'paper', title: 'Как считается', span: 12, i: i++, body: `<ul class="goal-lines goal-how">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
        <p class="hint">Это оценка: формулы ошибаются на ±10% для конкретного человека. Поэтому через 2–4 недели записей журнал сверяет план с фактом и показывает твой реальный расход.
        Источники: <a href="https://pubmed.ncbi.nlm.nih.gov/15883556/" target="_blank" rel="noopener">Frankenfield 2005 (точность формул обмена)</a>,
        <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC3859816/" target="_blank" rel="noopener">Hall и Chow 2013 (почему 7700 ккал/кг работает только в начале)</a>,
        <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/" target="_blank" rel="noopener">ISSN 2017 (белок)</a>.</p>` })}
    </div>
  </section>`;
}

/* ---------- анкета ---------- */
const WIZ = ['about', 'body', 'activity', 'goal', 'result'];
function startWizard(edit = false) {
  const p = S.profile ? profileNow() : null;
  view.wizard = {
    step: 0, edit, err: '',
    d: p ? { sex: p.sex, age: p.age, height: p.height, weight: curWeight(), build: p.build, bodyFat: p.bodyFat || '', experience: p.experience, level: curLevel(), steps: String(p.steps || 6000), goal: p.goal, pace: p.pace, target: p.target || '' }
         : { sex: 'm', age: '', height: '', weight: '', build: 'mid', bodyFat: '', experience: 'new', level: 'sed', steps: '6000', goal: 'lose', pace: 'mid', target: '' }
  };
  closeModal(); render();
}
function wizProfile(d) {
  return { sex: d.sex, age: num(d.age), height: num(d.height), build: d.build, bodyFat: num(d.bodyFat) || null, experience: d.experience, steps: num(d.steps) || 6000, goal: d.goal, pace: d.pace, target: d.goal === 'maintain' ? null : num(d.target) || null };
}
function wizCheck(step, d) {
  if (step === 'about') {
    if (!(num(d.age) >= 14 && num(d.age) <= 90)) return 'Возраст — от 14 до 90 лет.';
    if (!(num(d.height) >= 120 && num(d.height) <= 230)) return 'Рост — в сантиметрах, от 120 до 230.';
    if (!(num(d.weight) >= 35 && num(d.weight) <= 300)) return 'Вес — в килограммах, от 35 до 300.';
  }
  if (step === 'body' && d.bodyFat !== '' && !(num(d.bodyFat) >= 4 && num(d.bodyFat) <= 60)) return 'Процент жира — от 4 до 60, или оставь пустым.';
  if (step === 'goal' && num(d.target)) {
    const t = num(d.target), w = num(d.weight);
    if (d.goal === 'lose' && t >= w) return 'Для похудения желаемый вес должен быть меньше текущего.';
    if (d.goal === 'gain' && t <= w) return 'Для набора желаемый вес должен быть больше текущего.';
    if (Plan.bmi(t, num(d.height)) < 17) return 'Такой вес ниже здоровой нормы для твоего роста. Выбери цель повыше.';
  }
  return '';
}
function opt(key, val, cur, title, hint = '') {
  return `<button type="button" class="opt ${String(cur) === String(val) ? 'on' : ''}" data-action="wiz-set" data-k="${key}" data-v="${val}"><b>${title}</b>${hint ? `<span>${hint}</span>` : ''}</button>`;
}
function wizLive() {
  const w = view.wizard, d = w.d, p = wizProfile(d), wt = num(d.weight);
  if (!p.age || !p.height || !wt) return '';
  const c = Plan.compute(p, wt, d.level);
  const eta = p.target ? etaText(Plan.weeksTo(p, wt, c.kcal, d.level, p.target)) : null;
  return `≈ <b>${fmtN(c.kcal)} ккал</b> в день · <b>${kgWeek(c.weeklyKg)}</b>${p.target ? (eta ? ` · до ${fmt1(p.target)} кг: ${eta}` : ` · до ${fmt1(p.target)} кг при этом темпе не дойти`) : ''}`;
}
function pageWizard() {
  const w = view.wizard, d = w.d, step = WIZ[w.step];
  const inp = (k, ph, extra = '') => `<input data-wiz="${k}" type="number" inputmode="decimal" step="any" value="${esc(d[k])}" placeholder="${ph}" ${extra}>`;
  let head = '', body = '';
  if (step === 'about') {
    head = ['Расскажи о себе', 'По полу, возрасту, росту и весу считается обмен веществ.'];
    body = `<div class="opts opts-2">${opt('sex', 'm', d.sex, 'Мужчина')}${opt('sex', 'f', d.sex, 'Женщина')}</div>
      <div class="row">${field('Возраст', inp('age', 'лет'))}${field('Рост, см', inp('height', 'см'))}${field('Вес, кг', inp('weight', 'кг'))}</div>`;
  } else if (step === 'body') {
    head = ['Какое у тебя тело', 'От этого зависят белок и то, сколько мышц реально нарастить.'];
    body = `<div class="opts opts-3">${Object.entries(Plan.BUILD).map(([k, b]) => opt('build', k, d.build, b.name, b.hint)).join('')}</div>
      ${field('Процент жира, если знаешь', inp('bodyFat', 'например 28 — с весов-анализатора или замера'))}
      <h3 class="wiz-sub">Опыт силовых тренировок</h3>
      <div class="opts opts-3">${Object.entries(Plan.EXPERIENCE).map(([k, e]) => opt('experience', k, d.experience, e.name, e.hint)).join('')}</div>`;
  } else if (step === 'activity') {
    head = ['Активность на этой неделе', 'Тренировки спрошу каждый понедельник. Шаги план возьмёт из твоих записей, а пока — по оценке.'];
    body = `<div class="opts">${Object.entries(Plan.ACTIVITY).map(([k, a]) => opt('level', k, d.level, a.name, a.hint)).join('')}</div>
      <h3 class="wiz-sub">Сколько обычно шагов в день</h3>
      <div class="opts opts-5">${Plan.STEP_CHOICES.map(n => opt('steps', n, d.steps, `~${fmtN(n)}`, n <= 3000 ? 'почти не хожу' : n >= 15000 ? 'очень много' : '')).join('')}</div>`;
  } else if (step === 'goal') {
    head = ['Чего хочешь добиться', 'Темп можно поменять в любой момент.'];
    const p = wizProfile(d), wt = num(d.weight);
    const pace = d.goal === 'maintain' ? '' : `<h3 class="wiz-sub">Темп</h3><div class="opts opts-3">${Object.entries(Plan.PACE[d.goal]).map(([k, x]) => {
      const c = Plan.compute({ ...p, pace: k }, wt, d.level);
      return opt('pace', k, d.pace, x.name, `${d.goal === 'lose' ? '−' : '+'}${x.kcal} ккал в день · ${kgWeek(c.weeklyKg)}`);
    }).join('')}</div>
      ${field('Желаемый вес, кг (необязательно)', inp('target', d.goal === 'lose' ? 'например ' + Math.round(wt * 0.85) : 'например ' + Math.round(wt * 1.05)))}`;
    body = `<div class="opts opts-3">${Object.entries(Plan.GOALS).map(([k, g]) => opt('goal', k, d.goal, g.name, g.hint)).join('')}</div>${pace}
      <p class="wiz-live" id="wiz-live">${wizLive()}</p>`;
  } else {
    const p = { ...wizProfile(d) }, wt = num(d.weight), c = Plan.compute(p, wt, d.level);
    const { lines } = planLines(p, wt, d.level, c);
    head = ['Твой план', 'Посчитано по формулам, которые точнее всего на больших выборках. Через пару недель записей журнал сверит план с фактом.'];
    body = `<div class="kpis">
        ${kpi('Калории в день', fmtN(c.kcal), 'paper', 0, `поддержка ${fmtN(c.tdee)}`)}
        ${kpi('Белок', `${c.protein}<small>г</small>`, 'food', 1, `жиры ${c.fat} · углеводы ${c.carbs}`)}
        ${kpi('Темп', kgWeek(c.weeklyKg).replace(' кг/нед', '') + '<small>кг/нед</small>', 'gym', 2, d.goal === 'maintain' ? 'держим вес' : 'без доп. активности')}
      </div><ul class="goal-lines goal-how">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
  }
  const last = w.step === WIZ.length - 1;
  return `<section class="page wiz">
    <div class="wiz-steps">${WIZ.map((_, k) => `<i class="${k < w.step ? 'done' : k === w.step ? 'cur' : ''}"></i>`).join('')}</div>
    <div class="wiz-card">
      <div class="wiz-kicker">Шаг ${w.step + 1} из ${WIZ.length}</div>
      <h1 class="wiz-title">${head[0]}</h1><p class="wiz-lead">${head[1]}</p>
      ${body}
      <p class="auth-err" role="alert">${esc(w.err)}</p>
      <div class="wiz-foot">
        ${w.step ? `<button class="btn btn-ghost" data-action="wiz-back">${I.chevL}Назад</button>` : w.edit ? '<button class="btn btn-ghost" data-action="wiz-cancel">Отмена</button>' : ''}
        <span class="spacer"></span>
        <button class="btn btn-primary" data-action="${last ? 'wiz-finish' : 'wiz-next'}">${last ? (w.edit ? 'Сохранить план' : 'Начать журнал') : w.step === WIZ.length - 2 ? 'Посчитать план' : 'Дальше'}${last ? '' : I.chevR}</button>
      </div>
    </div>
  </section>`;
}
function finishWizard() {
  const d = view.wizard.d, t = ymd(), wt = num(d.weight);
  const prev = S.profile;
  const p = wizProfile(d);
  const restart = !prev || prev.goal !== p.goal || prev.pace !== p.pace || prev.target !== p.target;
  S.profile = { ...p, ageDate: t, weight: wt, start: restart ? t : prev.start, startWeight: restart ? wt : prev.startWeight };
  S.activity[mondayOf(t)] = d.level;
  S.days[t] = { ...dayRec(t), weight: wt };
  const c = applyGoals();
  view.wizard = null; save();
  if (location.hash !== '#goal') location.hash = '#goal'; else render();
  toast(`План готов: ${fmtN(c.kcal)} ккал и ${c.protein} г белка в день`);
}

/* ---------- еженедельный вопрос ---------- */
function maybeWeekly() {
  if (!S.profile || view.wizard || $('#modal-root .overlay')) return;
  const m = mondayOf(ymd());
  if (S.activity[m]) return;
  const lv = curLevel();
  openModal({
    title: 'Новая неделя', accent: 'var(--orange)', form: 'week', submit: 'Обновить цели',
    body: `<p class="hint" style="margin:0">Неделя с ${human(m)}. Какая активность будет? От неё зависят калории на неделю.</p>
      <div class="opts">${Object.entries(Plan.ACTIVITY).map(([k, a]) => `<label class="opt"><input type="radio" name="level" value="${k}" ${k === lv ? 'checked' : ''}><b>${a.name}</b><span>${a.hint}</span></label>`).join('')}</div>
      ${field('Вес сегодня, кг', `<input name="weight" type="number" step="0.1" min="35" max="300" inputmode="decimal" value="${num(dayRec(ymd()).weight) || ''}" placeholder="последний: ${fmt1(curWeight())}">`)}`
  });
}

/* ============================================================
   СТАТИСТИКА
   ============================================================ */
function pageStats() {
  const n = view.range, set = S.settings;
  const days = rangeDays(n);
  const rows = days.map(d => { const t = sumMeals(mealsOn(d)); return { d, kcal: t.kcal, p: t.p, study: studyMin(d), steps: num(dayRec(d).steps), gym: gymOn(d).length, active: hasAny(d) }; });
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const kcalDays = rows.filter(r => r.kcal), stepDays = rows.filter(r => r.steps);
  const studyTot = rows.reduce((a, r) => a + r.study, 0), gymTot = rows.reduce((a, r) => a + r.gym, 0), active = rows.filter(r => r.active).length;
  const qItems = days.flatMap(d => (S.quizzes[d]?.items || []).filter(i => i.result));
  const acc = qItems.length ? qItems.filter(i => i.result === 'good').length / qItems.length * 100 : null;
  const lab = d => n <= 7 ? WD[parseYmd(d).getDay()] : parseYmd(d).getDate();
  const every = n <= 7 ? 1 : n <= 30 ? 5 : 15;
  const byCat = {};
  S.study.filter(s => days.includes(s.date)).forEach(s => { byCat[s.category || 'Без категории'] = (byCat[s.category || 'Без категории'] || 0) + num(s.minutes); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]); const maxCat = cats[0]?.[1] || 1;
  let i = 0;
  const seg = `<div class="seg">${[7, 30, 90].map(r => `<button class="${r === n ? 'on' : ''}" data-action="range" data-n="${r}">${r} дн</button>`).join('')}</div>`;
  return `<section class="page">
    ${topbar('Статистика', `последние ${n} дней`, { date: false, actions: seg })}
    <div class="kpis">
      ${kpi('Ккал в день', kcalDays.length ? `${fmtN(avg(kcalDays.map(r => r.kcal)))}` : '—', 'food', i++, kcalDays.length ? `цель ${fmtN(set.kcal)} · записано ${kcalDays.length} дн.` : 'нет записей')}
      ${kpi('Белка в день', kcalDays.length ? `${fmtN(avg(kcalDays.map(r => r.p)))}<small>г</small>` : '—', 'food', i++, `цель ${set.protein} г`)}
      ${kpi('Учёба', `${hoursStr(studyTot)}<small>ч</small>`, 'study', i++, `${fmtMin(studyTot / n)} в день`)}
      ${kpi('Точность ответов', acc === null ? '—' : `${Math.round(acc)}<small>%</small>`, 'quiz', i++, qItems.length ? `${qItems.length} ${plural(qItems.length, 'ответ', 'ответа', 'ответов')}` : 'ещё нет ответов')}
      ${kpi('Тренировок', `${gymTot}`, 'gym', i++, `${fmt1(gymTot / n * 7)} в неделю`)}
      ${kpi('Шагов в день', stepDays.length ? `${fmtN(avg(stepDays.map(r => r.steps)))}` : '—', 'steps', i++, `цель ${fmtN(set.steps)}`)}
      ${kpi('Активных дней', `${active}<small>из ${n}</small>`, 'paper', i++, `серия ${streak()}`)}
    </div>
    <div class="grid">
      ${card({ domain: 'paper', title: 'Карта активности · 16 недель', span: 12, i: i++, body: heatmap(16) })}
      ${card({ domain: 'food', title: 'Калории', span: 6, i: i++, body: barChart(rows.map(r => ({ label: lab(r.d), v: r.kcal, hint: `${human(r.d)}: ${fmtN(r.kcal)} ккал` })), { color: 'var(--food)', target: set.kcal, unit: 'ккал', labelEvery: every }) })}
      ${card({ domain: 'steps', title: 'Шаги', span: 6, i: i++, body: barChart(rows.map(r => ({ label: lab(r.d), v: r.steps, hint: `${human(r.d)}: ${fmtN(r.steps)}` })), { color: 'var(--steps)', target: set.steps, unit: '', labelEvery: every }) })}
      ${card({ domain: 'study', title: 'Учёба, минуты', span: 6, i: i++, body: barChart(rows.map(r => ({ label: lab(r.d), v: r.study, hint: `${human(r.d)}: ${fmtMin(r.study)}` })), { color: 'var(--study)', target: set.study, unit: 'мин', labelEvery: every }) })}
      ${card({ domain: 'study', title: 'Направления за период', span: 6, i: i++, body: cats.length ? `<div class="hbars">${cats.map(([c, m]) => `<div class="hbar"><span class="hbar-label">${esc(c)}</span><span class="hbar-track"><i data-w="${m / maxCat * 100}"></i></span><span class="hbar-val">${fmtMin(m)}</span></div>`).join('')}</div>` : empty('Нет занятий за период.') })}
      ${card({ domain: 'gym', title: 'Тренировки по неделям', span: 6, i: i++, body: barChart(weeklyCounts(Math.max(4, Math.ceil(n / 7)), d => gymOn(d).length), { color: 'var(--gym)', unit: 'тр.', max: 7, labelEvery: 1 }) })}
      ${card({ domain: 'quiz', title: 'Точность по дням', span: 6, i: i++, body: quizHistory(n) || empty('Отвечай на вопросы дня, и здесь появится график.') })}
    </div>
  </section>`;
}
function kpi(label, val, domain, i, sub) {
  return `<div class="kpi" style="--c:var(--${domain});--cf:var(--${domain}-f);--i:${i}"><div class="kpi-label">${label}</div><div class="kpi-val">${val}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}
function weeklyCounts(weeks, fn) {
  const today = ymd(), dow = (parseYmd(today).getDay() + 6) % 7;
  const monday = addDays(today, -dow);
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(monday, -7 * w);
    let v = 0; for (let k = 0; k < 7; k++) v += fn(addDays(start, k));
    out.push({ label: `${parseYmd(start).getDate()}.${z(parseYmd(start).getMonth() + 1)}`, v, hint: `Неделя с ${human(start)}: ${v}` });
  }
  return out;
}
function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m.entries()];
}

/* ---------- графики ---------- */
function barChart(rows, { color, target, max, unit = '', labelEvery } = {}) {
  const n = rows.length; if (!n) return empty('Нет данных');
  const W = 600, H = 150, pt = 12, pb = 22;
  const mx = Math.max(max || 0, target || 0, ...rows.map(r => r.v)) || 1;
  const ih = H - pt - pb, bw = W / n;
  const y = v => pt + ih * (1 - v / mx);
  const step = labelEvery || Math.ceil(n / 8);
  const bars = rows.map((r, i) => {
    const w = Math.max(2, bw * 0.68), x = i * bw + (bw - w) / 2;
    const h = r.v ? Math.max(2, ih * r.v / mx) : 2;
    const yy = r.v ? y(r.v) : pt + ih - 2;
    return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, w / 2)}" fill="${color}" opacity="${r.v ? (r.empty ? .35 : .85) : .12}"><title>${esc(r.hint || `${r.label}: ${fmtN(r.v)} ${unit}`)}</title></rect>`;
  }).join('');
  const labels = rows.map((r, i) => (i % step === 0 || (step > 1 && i === n - 1 && (n - 1) % step !== 0 && n > 3 && (n - 1 - i) < 0)) ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(r.label)}</text>` : '').join('');
  const tgt = target && target <= mx ? `<line class="target" x1="0" x2="${W}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"/><text class="target-label" x="${W}" y="${(y(target) - 4).toFixed(1)}" text-anchor="end">${fmtN(target)} ${unit}</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${tgt}${bars}${labels}</svg>`;
}
function lineChart(pts, { color, unit = '' }) {
  const n = pts.length; if (n < 2) return empty('Мало данных');
  const W = 600, H = 150, pt = 14, pb = 22, pl = 6, pr = 6;
  const vals = pts.map(p => p.v), lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
  const x = i => pl + (W - pl - pr) * i / (n - 1), y = v => pt + (H - pt - pb) * (1 - (v - lo) / span);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3" fill="${color}"><title>${esc(p.label)}: ${fmt1(p.v)} ${unit}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}
    <text x="${pl}" y="${H - 6}">${esc(pts[0].label)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${esc(pts[n - 1].label)}</text>
    ${[[hi, vals.indexOf(hi)], [lo, vals.indexOf(lo)]].map(([v, i]) => `<text x="${Math.min(W - 30, Math.max(30, x(i))).toFixed(1)}" y="${(y(v) - 9).toFixed(1)}" text-anchor="middle" fill="${color}">${fmt1(v)}</text>`).join('')}
  </svg>`;
}
function heatmap(weeks) {
  const today = ymd(), dow = (parseYmd(today).getDay() + 6) % 7;
  const monday = addDays(today, -dow);
  const cell = 14, pad = 1.5, q = (cell - pad * 3) / 2;
  const cols = [];
  const colors = ['var(--food)', 'var(--study)', 'var(--gym)', 'var(--steps)'];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(monday, -7 * w);
    for (let k = 0; k < 7; k++) {
      const d = addDays(start, k); if (d > today) continue;
      const flags = [mealsOn(d).length > 0, studyOn(d).length > 0, gymOn(d).length > 0, num(dayRec(d).steps) > 0];
      const X = (weeks - 1 - w) * cell + 18, Y = k * cell;
      const names = ['еда', 'учёба', 'зал', 'шаги'].filter((_, j) => flags[j]);
      cols.push(`<g><title>${human(d)}: ${names.join(', ') || 'пусто'}</title>${flags.map((f, j) => `<rect x="${X + pad + (j % 2) * (q + pad)}" y="${Y + pad + Math.floor(j / 2) * (q + pad)}" width="${q}" height="${q}" rx="1.2" fill="${f ? colors[j] : 'rgba(46,58,78,.09)'}"/>`).join('')}</g>`);
    }
  }
  const wd = ['пн', '', 'ср', '', 'пт', '', 'вс'].map((t, k) => t ? `<text x="0" y="${k * cell + cell / 2 + 3.5}">${t}</text>` : '').join('');
  return `<svg class="heat" viewBox="0 0 ${weeks * cell + 18} ${7 * cell}" role="img" style="max-width:${weeks * cell * 2.2 + 40}px">${wd}${cols.join('')}</svg>
    <div class="heat-legend"><span><i style="background:var(--food)"></i>еда</span><span><i style="background:var(--study)"></i>учёба</span><span><i style="background:var(--gym)"></i>зал</span><span><i style="background:var(--steps)"></i>шаги</span></div>`;
}

/* ============================================================
   НАСТРОЙКИ
   ============================================================ */
function pageSettings() {
  const s = S.settings;
  const size = new Blob([JSON.stringify(S)]).size;
  return `<section class="page">
    ${topbar('Настройки', 'аккаунт, цели, Claude, данные', { date: false })}
    <div class="grid">
      ${card({ domain: 'study', title: 'Аккаунт', span: 12, cls: 'tile tile-navy', body: `<div class="account">
        <div class="account-who"><div class="big"><b>${esc(me)}</b></div><p class="hint" style="margin:6px 0 0">Ты вошёл в аккаунт. Данные хранятся на сервере и доступны с любого устройства, где ты войдёшь.</p></div>
        <form data-form="password" class="account-pw">
          <input name="current" type="password" autocomplete="current-password" placeholder="Текущий пароль" required>
          <input name="next" type="password" autocomplete="new-password" placeholder="Новый пароль" minlength="6" required>
          <button class="btn btn-accent" type="submit">Сменить пароль</button>
        </form>
        <button class="btn btn-accent" data-action="logout">${I.logout}Выйти</button>
      </div>` })}
      ${card({ domain: 'paper', title: 'Цели на день', span: 6, body: `<form data-form="settings" class="form-stack">
        ${S.profile ? '<p class="hint" style="margin:0">Ккал и белок считаются по твоему плану и обновляются каждую неделю. Можно поправить вручную — до следующего пересчёта.</p>' : ''}
        ${field('Как к тебе обращаться', `<input name="name" placeholder="Имя (необязательно)" value="${esc(s.name)}">`)}
        <div class="row">
          ${field('Ккал', `<input name="kcal" type="number" min="500" step="50" value="${s.kcal}" style="--c:var(--food)">`)}
          ${field('Белок, г', `<input name="protein" type="number" min="0" step="5" value="${s.protein}" style="--c:var(--food)">`)}
          ${field('Шагов', `<input name="steps" type="number" min="0" step="500" value="${s.steps}" style="--c:var(--steps)">`)}
          ${field('Учёба, мин', `<input name="study" type="number" min="0" step="5" value="${s.study}" style="--c:var(--study)">`)}
        </div>
        <div><button class="btn btn-primary" type="submit">Сохранить цели</button></div></form>` })}
      ${card({ domain: 'quiz', title: 'Вопросы через Claude', span: 6, body: `<form data-form="ai" class="form-stack">
        <p class="hint" style="margin:0">Без ключа вопросы собираются локально из твоих тезисов. С ключом Claude переформулирует их в живые вопросы на понимание. Ключ хранится в твоём аккаунте на сервере и уходит напрямую в Anthropic API.</p>
        ${field('API-ключ Anthropic', `<input name="apiKey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(s.apiKey)}">`)}
        <label class="switch" style="--c:var(--quiz)"><input type="checkbox" name="aiAuto" ${s.aiAuto ? 'checked' : ''}><span>Автоматически переформулировать вопросы дня при открытии</span></label>
        <div><button class="btn btn-primary" style="--c:var(--quiz)" type="submit">Сохранить</button></div></form>` })}
      ${card({ domain: 'paper', title: 'Данные', span: 12, body: `
        <p class="hint" style="margin:0 0 12px">Записи аккаунта «${esc(me)}» хранятся на сервере (${(size / 1024).toFixed(1)} КБ). Экспорт в JSON нужен для резервной копии или переноса.</p>
        <div class="chips" style="gap:8px">
          <button class="btn" data-action="export">${I.download}Экспорт JSON</button>
          <label class="btn" style="cursor:pointer">${I.upload}Импорт JSON<input type="file" accept="application/json" data-import hidden></label>
          <button class="btn btn-danger" data-action="wipe">${I.trash}Стереть всё</button>
        </div>` })}
    </div>
  </section>`;
}

/* ============================================================
   МОДАЛКА И ТОСТ
   ============================================================ */
function openModal({ title, accent, body, submit = 'Сохранить', form }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay" data-action="close-modal"><div class="sheet" style="--c:${accent}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="sheet-head"><h2>${title}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Закрыть">${I.x}</button></header>
    <form data-form="${form}" class="sheet-form">${body}<footer class="sheet-foot"><button type="button" class="btn btn-ghost" data-action="close-modal">Отмена</button><button class="btn btn-primary" type="submit">${submit}</button></footer></form>
  </div></div>`;
  requestAnimationFrame(() => root.classList.add('open'));
  const first = root.querySelector('input:not([type=hidden]),textarea');
  setTimeout(() => first && first.focus(), 60);
}
function closeModal() {
  ph = null;
  const root = $('#modal-root'); if (!root.innerHTML) return;
  root.classList.remove('open');
  const html = root.innerHTML;
  // чистим, только если за это время не открыли новое окно
  setTimeout(() => { if (root.innerHTML === html && !root.classList.contains('open')) root.innerHTML = ''; }, reduceMotion ? 0 : 220);
}
function toast(msg, err = false) {
  const el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg;
  $('#toast-root').appendChild(el); setTimeout(() => el.remove(), 3300);
}

/* ============================================================
   ДЕЙСТВИЯ
   ============================================================ */
const ACTIONS = {
  'date': el => { view.date = addDays(view.date, +el.dataset.n); view.calMonth = null; render(); },
  'date-today': () => { view.date = ymd(); view.calMonth = null; render(); },
  'cal-month': el => { const [y, m] = (view.calMonth || view.date.slice(0, 7)).split('-').map(Number); const dt = new Date(y, m - 1 + +el.dataset.n, 1); view.calMonth = `${dt.getFullYear()}-${z(dt.getMonth() + 1)}`; render(); },
  'cal-day': el => { view.date = el.dataset.d; view.calMonth = el.dataset.d.slice(0, 7); render(); },
  'range': el => { view.range = +el.dataset.n; render(); },
  'close-modal': (el, e) => { if (el.classList.contains('overlay') && e.target !== el) return; closeModal(); },
  'add-meal': () => mealForm(),
  'add-drink': () => drinkForm(),
  'add-text': () => startText(),
  'food-tab': el => { view.foodTab = el.dataset.v; window.scrollTo({ top: 0, behavior: 'instant' }); render(); },
  'gap-more': () => { view.gapMore = !view.gapMore; render(); },
  'nudge-off': el => { view.nudgeOff = { ...(view.nudgeOff || {}), [el.dataset.k]: true }; render(); },
  'use-set': el => { const st = S.sets.find(x => x.id === el.dataset.id); if (!st) return; useSet(st); save(); render(); toast(`«${st.name}» — записано, ${fmtN(setKcal(st))} ккал`); },
  'del-set': el => { const st = S.sets.find(x => x.id === el.dataset.id); if (!st || !confirm(`Удалить набор «${st.name}»?`)) return; S.sets = S.sets.filter(x => x.id !== st.id); save(); render(); },
  'save-set': el => {
    const items = S.meals.filter(m => m.date === el.dataset.d && slotOf(m) === el.dataset.slot);
    openModal({ title: 'В избранное', accent: 'var(--food)', form: 'set', submit: 'Сохранить',
      body: `<input type="hidden" name="d" value="${el.dataset.d}"><input type="hidden" name="slot" value="${el.dataset.slot}">
        ${field('Название набора', `<input name="name" required maxlength="40" value="Мой ${SLOT_ONE[el.dataset.slot]}">`)}
        <p class="hint" style="margin:0">${esc(items.map(m => m.name).join(', '))} · ${fmtN(items.reduce((a, m) => a + num(m.kcal), 0))} ккал</p>` });
  },
  'repeat-slot': el => {
    const items = S.meals.filter(m => m.date === el.dataset.from && slotOf(m) === el.dataset.slot);
    for (const m of items) { const { id, date, ...rest } = m; S.meals.push({ ...rest, id: uid(), date: view.date }); }
    save(); render(); toast(`Повторено: ${items.length} ${plural(items.length, 'позиция', 'позиции', 'позиций')}`);
  },
  'gap-add': el => {
    const items = JSON.parse(el.dataset.items), time = nowHM();
    for (const it of items) { const m = { id: uid(), date: view.date, time, ...it }; S.meals.push(m); rememberFood(m); }
    save(); render(); toast(`Записано: ${items.map(x => baseName(x.name)).join(', ')}`);
  },
  'edit-drink': el => drinkForm(S.drinks.find(x => x.id === el.dataset.id)),
  'del-drink': el => { S.drinks = S.drinks.filter(x => x.id !== el.dataset.id); save(); render(); toast('Удалено'); },
  'quick-drink': el => addDrink(el.dataset.type, +el.dataset.ml),
  'drink-ml': el => { const i = $('#modal-root [name=ml]'); i.value = el.dataset.v; drinkPreview(); },
  'drink-step': el => { const i = $('#modal-root [name=ml]'); i.value = Math.max(10, num(i.value) + +el.dataset.n); drinkPreview(); },
  'add-study': () => studyForm(),
  'add-gym': () => gymForm(),
  'add-steps': () => openModal({
    title: 'Шаги и вес', accent: 'var(--steps)', form: 'steps',
    body: `<input class="big-input" name="steps" type="number" min="0" step="100" inputmode="numeric" placeholder="сколько шагов" value="${dayRec(view.date).steps || ''}">
      ${field('Вес, кг (необязательно)', `<input name="weight" type="number" min="0" step="0.1" inputmode="decimal" placeholder="—" value="${dayRec(view.date).weight || ''}">`)}`
  }),
  'edit-meal': el => mealForm(S.meals.find(m => m.id === el.dataset.id)),
  'edit-study': el => studyForm(S.study.find(s => s.id === el.dataset.id)),
  'edit-gym': el => gymForm(S.workouts.find(w => w.id === el.dataset.id)),
  'del-meal': el => { if (!confirm('Удалить запись?')) return; S.meals = S.meals.filter(m => m.id !== el.dataset.id); save(); render(); toast('Удалено'); },
  'del-study': el => { if (!confirm('Удалить занятие вместе с его карточками?')) return; const id = el.dataset.id; S.study = S.study.filter(s => s.id !== id); Object.keys(S.srs).forEach(k => { if (k.startsWith(id + ':')) delete S.srs[k]; }); save(); render(); toast('Удалено'); },
  'del-gym': el => { if (!confirm('Удалить тренировку?')) return; S.workouts = S.workouts.filter(w => w.id !== el.dataset.id); save(); render(); toast('Удалено'); },
  'quick-meal': el => {
    const f = S.foods[el.dataset.name.toLowerCase()]; if (!f) return;
    const m = { id: uid(), date: view.date, time: view.date === ymd() ? nowHM() : '12:00', name: f.name, kcal: f.kcal, p: f.p, f: f.f, c: f.c };
    for (const k of ['fi', 'su', 'sa']) if (f[k] !== undefined) m[k] = f[k];
    S.meals.push(m); rememberFood(m); save(); render(); toast(`${f.name} — записано`);
  },
  'fill-food': el => {
    const f = S.foods[el.dataset.name.toLowerCase()]; if (!f) return;
    const form = el.closest('form');
    form.name.value = f.name; form.kcal.value = f.kcal; form.p.value = f.p || ''; form.f.value = f.f || ''; form.c.value = f.c || '';
    form.kcal.focus();
  },
  'mood': el => { const d = view.date; S.days[d] = { ...dayRec(d), mood: dayRec(d).mood === +el.dataset.v ? 0 : +el.dataset.v }; save(); document.querySelectorAll('.mood').forEach(m => m.classList.toggle('on', +m.dataset.v === S.days[d].mood)); },
  'q-check': async el => {
    const d = ymd(), q = S.quizzes[d], it = q.items[+el.dataset.k];
    const ta = document.querySelector(`[data-qans="${el.dataset.k}"]`); it.answer = (ta?.value || it.answer || '').trim();
    if (!it.answer) { toast('Сначала напиши ответ — или нажми «Не знаю»', true); return; }
    el.classList.add('busy');
    try {
      it.check = await apiFetch('/api/study/check', { method: 'POST', body: JSON.stringify({ question: plainText(it.q), reference: plainText(it.a), answer: it.answer, noteId: it.noteId, key: it.key, context: it.ctx || '' }) });
      it.revealed = true; save(); render();
    } catch (e) { el.classList.remove('busy'); toast(e.message, true); }
  },
  'quiz-note': el => {
    const d = ymd(), pool = withState().filter(c => c.noteId === el.dataset.id);
    if (!pool.length) { toast('Вопросы по этому конспекту ещё готовятся', true); return; }
    const r = rng(hash(d + el.dataset.id + Date.now()));
    const items = shuffle(pool, r).slice(0, 6).map(c => quizItemFrom(c, r));
    const kept = (S.quizzes[d]?.items || []).filter(i => i.result);
    S.quizzes[d] = { items: [...kept, ...items], source: 'local', created: Date.now() };
    save(); location.hash = '#quiz';
  },
  'obs-sync': async el => {
    el.classList.add('busy');
    try { OBS = await apiFetch('/api/obsidian/sync', { method: 'POST', body: '{}' }); toast('Синхронизировано'); } catch (e) { toast(e.message, true); }
    render();
  },
  'obs-regen': async el => { await apiFetch('/api/obsidian/regen', { method: 'POST', body: JSON.stringify({ noteId: el.dataset.id, key: el.dataset.key || null }) }).catch(e => toast(e.message, true)); toast('Вопросы пересоберутся в фоне'); setTimeout(() => loadObs(true), 1500); },
  'cheat': el => openCheat(el.dataset.id, false),
  'cheat-new': el => openCheat(el.dataset.id, true),
  'reveal': el => { const q = S.quizzes[ymd()]; q.items[+el.dataset.k].revealed = true; save(); render(); },
  'grade': el => {
    const q = S.quizzes[ymd()], it = q.items[+el.dataset.k];
    it.result = el.dataset.g; gradeCard(it.cardId, el.dataset.g); save(); render();
  },
  'quiz-early': () => { const d = ymd(); const pool = soonestCards(5, d); if (!pool.length) return; S.quizzes[d] = buildQuiz(d, pool); save(); render(); },
  'quiz-more': () => { const d = ymd(), q = S.quizzes[d]; const have = new Set(q.items.map(i => i.cardId)); const pool = dueCards(d).filter(c => !have.has(c.id)); const extra = buildQuiz(d + ':' + q.items.length, pool); q.items.push(...extra.items); save(); render(); },
  'ai-quiz': () => aiQuiz(),
  'export': () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bortjournal-${ymd()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('Файл сохранён');
  },
  'wipe': () => { if (!confirm('Стереть все записи без возможности восстановления?')) return; if (!confirm('Точно? Экспорт сделан?')) return; S = structuredClone(DEF); save(); render(); toast('Чисто'); },
  'logout': async () => {
    await flush();
    try { await apiFetch('/api/logout', { method: 'POST', body: '{}' }); } catch { /* всё равно выходим */ }
    showAuth();
  },
  'auth-mode': el => { authMode = el.dataset.mode; showAuth(); },
  'edit-profile': () => startWizard(!!S.profile),
  'ph-scale': el => { ph.scale = el.dataset.v; renderPhoto(); },
  'ph-go': () => photoGo(),
  'ph-ans': el => { const q = +el.dataset.q; ph.answers[q] = ph.answers[q] === el.dataset.o ? undefined : el.dataset.o; if (!ph.answers[q]) delete ph.answers[q]; renderPhoto(); },
  'ph-del': el => { ph.rows.splice(+el.dataset.i, 1); renderPhoto(); },
  'ph-add': () => { ph.rows.push({ name: '', grams: 0, kcal: 0, p: 0, f: 0, c: 0 }); renderPhoto(); const ins = document.querySelectorAll('.ph-name input'); ins[ins.length - 1]?.focus(); },
  'ph-back': () => { ph.stage = 'setup'; ph.err = ''; renderPhoto(); },
  'ph-save': () => photoSave(),
  'wiz-set': el => { const w = view.wizard; w.d[el.dataset.k] = el.dataset.v; w.err = ''; render(); },
  'wiz-next': () => { const w = view.wizard; w.err = wizCheck(WIZ[w.step], w.d); if (!w.err) w.step++; render(); },
  'wiz-back': () => { const w = view.wizard; w.err = ''; w.step--; render(); },
  'wiz-cancel': () => { view.wizard = null; render(); },
  'wiz-finish': () => finishWizard(),
  'set-level': el => { S.activity[mondayOf(ymd())] = el.dataset.v; const c = applyGoals(); save(); render(); toast(`Цели на неделю: ${fmtN(c.kcal)} ккал, белок ${c.protein} г`); }
};

const FORMS = {
  meal(fd) {
    const id = fd.get('id') || uid();
    const m = { id, date: fd.get('date') || view.date, time: fd.get('time') || '', name: String(fd.get('name')).trim(), kcal: num(fd.get('kcal')), p: num(fd.get('p')), f: num(fd.get('f')), c: num(fd.get('c')) };
    if (fd.get('slot')) m.slot = String(fd.get('slot'));
    // клетчатка/сахар/соль — только если что-то введено, иначе запись не считается в этих нормах
    if (['fi', 'su', 'sa'].some(k => String(fd.get(k) || '').trim() !== '')) for (const k of ['fi', 'su', 'sa']) m[k] = num(fd.get(k));
    if (!m.name) return;
    const idx = S.meals.findIndex(x => x.id === id);
    if (idx >= 0) S.meals[idx] = m; else { S.meals.push(m); rememberFood(m); }
    save(); closeModal(); render(); toast(idx >= 0 ? 'Сохранено' : `${m.name} — ${fmtN(m.kcal)} ккал`);
  },
  study(fd) {
    const id = fd.get('id') || uid();
    const s = { id, date: fd.get('date') || view.date, time: fd.get('time') || '', topic: String(fd.get('topic')).trim(), category: String(fd.get('category') || '').trim(), minutes: num(fd.get('minutes')), notes: parseLines(fd.get('notes')), qa: parseQA(fd.get('qa')) };
    if (!s.topic) return;
    const idx = S.study.findIndex(x => x.id === id);
    if (idx >= 0) S.study[idx] = s; else S.study.push(s);
    save(); closeModal(); render();
    const n = s.notes.length + s.qa.length + (s.notes.length >= 2 ? 1 : 0);
    toast(idx >= 0 ? 'Сохранено' : n ? `Записано. ${n} ${plural(n, 'карточка', 'карточки', 'карточек')} придут завтра` : 'Записано');
  },
  gym(fd) {
    const id = fd.get('id') || uid();
    const w = { id, date: fd.get('date') || view.date, time: fd.get('time') || '', type: String(fd.get('type')).trim(), minutes: num(fd.get('minutes')), exercises: parseExercises(fd.get('exercises')), note: String(fd.get('note') || '').trim() };
    if (!w.type) return;
    const idx = S.workouts.findIndex(x => x.id === id);
    if (idx >= 0) S.workouts[idx] = w; else S.workouts.push(w);
    save(); closeModal(); render(); toast(idx >= 0 ? 'Сохранено' : 'Тренировка записана');
  },
  steps(fd) {
    const d = view.date;
    S.days[d] = { ...dayRec(d), steps: num(fd.get('steps')), weight: num(fd.get('weight')) || undefined };
    save(); closeModal(); render(); toast('Сохранено');
  },
  settings(fd) {
    Object.assign(S.settings, { name: String(fd.get('name') || '').trim(), kcal: num(fd.get('kcal')) || 2200, protein: num(fd.get('protein')), steps: num(fd.get('steps')) || 10000, study: num(fd.get('study')) || 60 });
    save(); render(); toast('Цели обновлены');
  },
  ai(fd) {
    S.settings.apiKey = String(fd.get('apiKey') || '').trim();
    S.settings.aiAuto = fd.get('aiAuto') === 'on';
    save(); toast(S.settings.apiKey ? 'Ключ сохранён' : 'Ключ удалён');
  },
  set(fd) {
    const items = S.meals.filter(m => m.date === fd.get('d') && slotOf(m) === fd.get('slot'));
    const st = addSet(fd.get('name'), items); if (!st) return;
    save(); closeModal(); render(); toast(`«${st.name}» в избранном`);
  },
  drink(fd) {
    const id = fd.get('id') || uid(), type = String(fd.get('type') || 'water'), ml = Math.round(num(fd.get('ml')));
    if (!(ml > 0)) return;
    const x = { id, date: fd.get('date') || view.date, time: fd.get('time') || '', type, ml };
    if (type === 'custom') Object.assign(x, { name: String(fd.get('name') || '').trim() || 'Напиток', kcal100: num(fd.get('kcal100')), sugar100: num(fd.get('sugar100')) });
    const idx = S.drinks.findIndex(d => d.id === id);
    if (idx >= 0) S.drinks[idx] = x; else S.drinks.push(x);
    save(); closeModal(); render(); toast(`${drinkName(x)} ${fmtN(ml)} мл — ${idx >= 0 ? 'сохранено' : 'записано'}`);
  },
  week(fd) {
    const t = ymd(), w = num(fd.get('weight'));
    S.activity[mondayOf(t)] = String(fd.get('level') || curLevel());
    if (w >= 35 && w <= 300) S.days[t] = { ...dayRec(t), weight: w };
    const c = applyGoals(); save(); closeModal(); render();
    toast(`Цели на неделю: ${fmtN(c.kcal)} ккал, белок ${c.protein} г`);
  },
  async password(fd, f) {
    try {
      await apiFetch('/api/password', { method: 'POST', body: JSON.stringify({ current: fd.get('current'), next: fd.get('next') }) });
      f.reset(); toast('Пароль изменён');
    } catch (e) { toast(e.message, true); }
  },
  async auth(fd, f) {
    const username = String(fd.get('username') || '').trim(), password = String(fd.get('password') || '');
    const err = $('#auth-err'), btn = f.querySelector('[type=submit]');
    if (authMode === 'register' && password !== fd.get('password2')) { err.textContent = 'Пароли не совпадают.'; return; }
    err.textContent = ''; btn.classList.add('busy');
    try {
      me = (await apiFetch(`/api/${authMode}`, { method: 'POST', body: JSON.stringify({ username, password }) })).username;
      photoOn = !!(await apiFetch('/api/me').catch(() => ({}))).photo;
      await loadState();
    } catch (e) { me = null; err.textContent = e.status ? e.message : 'Сервер недоступен.'; }
    finally { btn.classList.remove('busy'); }
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const fn = ACTIONS[el.dataset.action]; if (fn) fn(el, e);
});
document.addEventListener('submit', e => {
  const f = e.target; if (!f.dataset.form) return;
  e.preventDefault(); FORMS[f.dataset.form]?.(new FormData(f), f);
});
let noteTimer;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.qans !== undefined) { const it = S.quizzes[ymd()]?.items[+t.dataset.qans]; if (it) it.answer = t.value; }
  if (t.dataset.dmin !== undefined) { const v = Math.max(0, Math.round(num(t.value))); if (v) S.studyTime[t.dataset.dmin] = v; else delete S.studyTime[t.dataset.dmin]; save(); }
  if (ph && t.dataset.ph) ph[t.dataset.ph] = t.value;
  if (ph && t.dataset.phRow !== undefined) {
    const r = ph.rows[+t.dataset.phRow], f = t.dataset.f;
    if (f === 'name') r.name = t.value;
    else {
      r[f] = num(t.value);
      // поменяли вес — пропорционально пересчитываем ккал и БЖУ от оценки
      if (f === 'grams' && r.base && r.base.grams > 0) {
        const k = r.grams / r.base.grams, row = t.closest('.ph-row');
        for (const x of ['kcal', 'p', 'f', 'c', 'fi', 'su', 'sa']) {
          if (r.base[x] === undefined) continue;
          r[x] = x === 'kcal' ? Math.round(r.base[x] * k) : Math.round(r.base[x] * k * 10) / 10;
          const inp = row.querySelector(`[data-f="${x}"]`); if (inp) inp.value = r[x];
        }
      }
    }
    const tot = $('#ph-total'); if (tot) tot.innerHTML = phTotalsHtml();
  }
  if (t.dataset.wiz && view.wizard) {
    view.wizard.d[t.dataset.wiz] = t.value;
    const live = $('#wiz-live'); if (live) live.innerHTML = wizLive();
  }
  if (t.closest && t.closest('[data-form=drink]')) drinkPreview();
  if (t.dataset.live === 'exercises') { const p = $('#ex-preview'); if (p) p.textContent = exPreview(t.value); }
  if (t.dataset.note !== undefined) {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { const d = t.dataset.note; S.days[d] = { ...dayRec(d), note: t.value }; save(); }, 400);
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.photo !== undefined && t.files[0]) { startPhoto(t.files[0]); t.value = ''; return; }
  if (t.dataset.import !== undefined && t.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.meals) || !Array.isArray(d.study)) throw new Error('не похоже на экспорт Бортжурнала');
        if (!confirm('Заменить текущие данные импортированными?')) return;
        S = normalize(d); save(); render(); toast('Импортировано');
      } catch (err) { toast(`Импорт не удался: ${err.message}`, true); }
    };
    r.readAsText(t.files[0]); t.value = '';
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { const f = $('#modal-root form'); if (f) f.requestSubmit(); }
});

// Автоподстановка через Claude при открытии вопросов, если включено
window.addEventListener('hashchange', () => {
  if (view.page === 'quiz' && S.settings.aiAuto && S.settings.apiKey) {
    const q = S.quizzes[ymd()];
    if (q && q.source !== 'ai' && q.items.every(i => !i.result)) aiQuiz();
  }
});

/* ============================================================
   ВХОД И ЗАПУСК
   ============================================================ */
let authMode = 'login';
function showAuth(msg = '') {
  me = null; rev = 0; dirty = false; clearTimeout(saveTimer); S = structuredClone(DEF); view.wizard = null;
  document.body.classList.remove('setup-mode');
  document.body.classList.add('auth-mode');
  const reg = authMode === 'register';
  $('#main').innerHTML = `<section class="page auth">
    <div class="auth-hero">
      <div class="auth-kicker">Бортжурнал</div>
      <h1>Еда, учёба, зал и шаги в одном журнале</h1>
      <p>У каждого свой аккаунт. Записи хранятся на сервере, поэтому их видно с любого устройства, где ты войдёшь.</p>
    </div>
    <form class="auth-card" data-form="auth" novalidate>
      <div class="seg" role="tablist">
        <button type="button" class="${reg ? '' : 'on'}" data-action="auth-mode" data-mode="login">Вход</button>
        <button type="button" class="${reg ? 'on' : ''}" data-action="auth-mode" data-mode="register">Регистрация</button>
      </div>
      <h2>${reg ? 'Новый аккаунт' : 'С возвращением'}</h2>
      ${field('Логин', `<input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required ${reg ? 'placeholder="латиница, цифры, . _ -"' : ''}>`)}
      ${field('Пароль', `<input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required ${reg ? 'placeholder="не короче 6 символов"' : ''}>`)}
      ${reg ? field('Повтори пароль', '<input name="password2" type="password" autocomplete="new-password" required>') : ''}
      <p class="auth-err" id="auth-err" role="alert">${esc(msg)}</p>
      <button class="btn btn-primary" type="submit">${reg ? 'Создать аккаунт' : 'Войти'}</button>
    </form>
  </section>`;
  $('#main [name=username]').focus();
}
async function loadObs(rerender = false) {
  try { OBS = await apiFetch('/api/obsidian'); } catch { OBS = { enabled: false, notes: [], diary: [] }; }
  OBS.notes = OBS.notes || []; OBS.diary = OBS.diary || [];
  if (rerender && ['study', 'quiz', 'today'].includes(view.page) && !$('#modal-root .overlay')) render();
}
// пока открыта учёба или вопросы — подтягиваем свежие вопросы, которые сервер генерирует в фоне
setInterval(() => { if (me && !document.hidden && ['study', 'quiz'].includes(view.page)) loadObs(true); }, 30e3);
async function loadState() {
  const r = await apiFetch('/api/state');
  rev = r.rev; S = normalize(r.state);
  document.body.classList.remove('auth-mode');
  view.wizard = null;
  await loadObs();
  route();
  await migrateLocal();
  if (!S.profile) startWizard(); else maybeWeekly();
}
// записи из старой версии (localStorage) один раз переносим в аккаунт
async function migrateLocal() {
  let d;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return; }
  if (!d || !(d.meals?.length || d.study?.length || d.workouts?.length || Object.keys(d.days || {}).length)) return;
  if (!isEmptyStore()) return;
  if (!confirm(`В этом браузере остались записи из версии без аккаунтов. Перенести их в аккаунт «${me}»?`)) return;
  S = normalize(d); save(); await flush();
  if (dirty) return;
  try { localStorage.removeItem(KEY); } catch { /* не страшно */ }
  render(); toast('Записи перенесены в аккаунт');
}
async function boot() {
  if (location.protocol === 'file:') {
    document.body.classList.add('auth-mode');
    $('#main').innerHTML = `<section class="page auth"><div class="auth-hero">
      <div class="auth-kicker">Бортжурнал</div><h1>Запусти сервер</h1>
      <p>Теперь данные хранятся в аккаунтах на локальном сервере. В папке проекта выполни <b>npm start</b> и открой <b>http://localhost:3333</b>.</p></div></section>`;
    return;
  }
  try { const r = await apiFetch('/api/me'); me = r.username; photoOn = !!r.photo; }
  catch (e) { return showAuth(e.status === 401 ? '' : 'Сервер недоступен. Проверь, что он запущен.'); }
  await loadState();
}
boot();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
