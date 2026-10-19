/* ============================================================
   Бортжурнал — логика
   Данные живут на локальном сервере (server.js), в аккаунте пользователя.
   ============================================================ */
'use strict';

/* ---------- хранилище ---------- */
const KEY = 'bortjournal.v1'; // старое хранилище браузера, нужно только для переноса
const DEF = {
  settings: { kcal: 2200, protein: 140, steps: 10000, study: 60, name: '' },
  meals: [], study: [], workouts: [], days: {}, srs: {}, quizzes: {}, foods: {},
  profile: null, activity: {}, drinks: [], sets: [], studyTime: {},
  tasks: [], goals: [], money: [], budget: {}
};
let S = structuredClone(DEF);
let me = null, rev = 0, photoOn = false;
// конспекты из Obsidian: приходят с сервера отдельно от данных пользователя
let OBS = { enabled: false, notes: [], diary: [] };

function normalize(d) {
  const out = Object.assign(structuredClone(DEF), d && typeof d === 'object' && !Array.isArray(d) ? d : {});
  // типы полей: на случай битого импорта или старых версий
  for (const [k, v] of Object.entries(DEF)) {
    if (Array.isArray(v) && !Array.isArray(out[k])) out[k] = [];
    else if (v && typeof v === 'object' && !Array.isArray(v) && (typeof out[k] !== 'object' || out[k] === null || Array.isArray(out[k]))) out[k] = structuredClone(v);
  }
  out.settings = Object.assign({}, DEF.settings, (d && d.settings) || {});
  delete out.settings.apiKey; delete out.settings.aiAuto; // ключ Claude больше не храним
  return out;
}
/* Слияние трёх версий: base — что было на сервере, когда мы начали править, mine — наше, theirs — новое с сервера.
   Свои правки накладываем поверх чужих; массивы записей сливаем по id. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function merge3(base, mine, theirs) {
  if (same(mine, base)) return theirs;
  if (same(theirs, base) || theirs === undefined) return mine;
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const all = [...mine, ...theirs, ...(Array.isArray(base) ? base : [])];
    if (!all.every(x => x && typeof x === 'object' && 'id' in x)) return mine;
    const bm = new Map((Array.isArray(base) ? base : []).map(x => [x.id, x])), mm = new Map(mine.map(x => [x.id, x]));
    const out = new Map(theirs.map(x => [x.id, x]));
    for (const [id, x] of mm) if (!bm.has(id) || !same(bm.get(id), x)) out.set(id, x);
    for (const id of bm.keys()) if (!mm.has(id)) out.delete(id);
    return [...out.values()];
  }
  if (mine && theirs && typeof mine === 'object' && typeof theirs === 'object' && !Array.isArray(mine) && !Array.isArray(theirs)) {
    const b = base && typeof base === 'object' ? base : {}, out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(b)])) {
      const inM = k in mine, inT = k in theirs, inB = k in b;
      if (!inM && inB) { if (inT && !same(theirs[k], b[k])) out[k] = theirs[k]; continue; } // удалили у нас
      if (!inT && inB) { if (inM && !same(mine[k], b[k])) out[k] = mine[k]; continue; } // удалили на сервере
      out[k] = !inM ? theirs[k] : !inT ? mine[k] : merge3(b[k], mine[k], theirs[k]);
    }
    return out;
  }
  return mine;
}
let base = null; // последняя известная серверная версия (строка JSON)

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
  const sent = JSON.stringify(S), body = `{"rev":${rev},"state":${sent}}`;
  saving = (async () => {
    try {
      const r = await apiFetch('/api/state', { method: 'PUT', body });
      rev = r.rev; base = sent;
      if (offline) { offline = false; toast('Связь с сервером есть, всё сохранено'); }
    } catch (e) {
      if (e.status === 409) {
        // на другом устройстве сохранили раньше: накладываем наши правки поверх свежей версии и сохраняем ещё раз
        const theirs = normalize(e.data.state);
        S = normalize(merge3(base ? JSON.parse(base) : theirs, JSON.parse(sent), theirs));
        rev = e.data.rev; base = JSON.stringify(theirs);
        dirty = true; saveTimer = setTimeout(flush, 50);
        if (!typingNow()) render();
        toast('Подтянул изменения с другого устройства — твои правки сохранены поверх.');
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
  if (!dirty || !me) return;
  const body = JSON.stringify({ rev, state: S });
  // keepalive-запрос браузер принимает только до ~64 КБ; больше — успеет обычное сохранение при скрытии вкладки
  if (body.length < 60000) fetch('/api/state', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body });
});
const typingNow = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio'); };
// вернулся во вкладку — подтягиваем изменения с других устройств
document.addEventListener('visibilitychange', async () => {
  if (!me) return;
  if (document.hidden) { flush(); return; }
  checkDay();
  if (dirty || saving || $('#modal-root .overlay') || typingNow()) return;
  try {
    const r = await apiFetch('/api/state');
    if (r.rev !== rev && !view.wizard) { rev = r.rev; S = normalize(r.state); base = JSON.stringify(S); render(); }
    maybeWeekly();
  } catch (e) { if (e.status === 401) showAuth('Сессия закончилась, войди снова.'); }
});

/* ---------- смена дня при открытом журнале ---------- */
// если журнал не закрывали на ночь, утром «сегодня» должно стать новым днём
let knownToday = null;
function checkDay() {
  const t = ymd();
  if (knownToday === null) { knownToday = t; return; }
  if (t === knownToday) return;
  const old = knownToday; knownToday = t;
  if (view.date === old) view.date = t;
  if (view.planDay === old) view.planDay = t;
  if (view.planDate === old) view.planDate = t;
  if (me && !view.wizard && !typingNow() && !$('#modal-root .overlay')) { render(); maybeWeekly(); }
}
setInterval(checkDay, 60e3);
window.addEventListener('focus', checkDay);

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
// S.studyTime[id] = { m: минуты, d: дата } (раньше — просто число)
const stMin = v => typeof v === 'object' && v ? num(v.m) : num(v);
const studyMin = d => studyOn(d).reduce((a, s) => a + num(s.minutes), 0)
  + Object.entries(S.studyTime).reduce((a, [id, v]) => a + (typeof v === 'object' && v ? (v.d === d ? num(v.m) : 0) : ((OBS.diary || []).some(e => e.id === id && e.date === d) ? num(v) : 0)), 0);
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
  plans: '<svg viewBox="0 0 24 24"><rect x="4" y="4.5" width="16" height="16" rx="3"/><path d="M8 3v3M16 3v3M4 9.5h16M8.5 14l2 2 4-4"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.7-5.6M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6M4 20v-4h4"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path d="M12 3.5c3.2 4 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 2.8-6.5 6-10.5z"/><path d="M9 14.5a3 3 0 0 0 3 3"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/></svg>',
  budget: '<svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3"/><rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M15.5 13.5h1"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l-4-4 4-4M6 12h10"/></svg>'
};
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = I[el.dataset.ico] || ''; });

/* ---------- состояние представления ---------- */
const view = { page: 'today', date: ymd(), range: 30, lastPage: null };
const PAGES = ['today', 'plans', 'food', 'budget', 'study', 'quiz', 'gym', 'steps', 'goal', 'stats', 'settings', 'more'];
// на телефоне внизу 5 вкладок; эти разделы — в «Ещё»
const MORE_PAGES = ['budget', 'quiz', 'goal', 'gym', 'steps', 'stats', 'settings'];

function route() {
  const [h, sub] = (decodeURIComponent(location.hash.replace('#', '')) || 'today').split('/');
  view.page = PAGES.includes(h) ? h : 'today';
  if (view.page === 'food' && ['day', 'analysis'].includes(sub)) view.foodTab = sub;
  if (view.page === 'plans' && PERIODS[sub]) view.planKind = sub;
  if ($('#modal-root .overlay')) closeModal('nav');
  render();
}
// вкладка внутри раздела — в адрес, без новой записи в истории: перезагрузка не сбрасывает вид
const setSub = sub => history.replaceState(null, '', `#${view.page}/${sub}`);
window.addEventListener('hashchange', route);

/* ============================================================
   РЕНДЕР
   ============================================================ */
function render() {
  if (!me) return;
  document.body.classList.toggle('setup-mode', !!view.wizard);
  if (view.wizard) { $('#main').innerHTML = pageWizard(); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === view.page || (t.dataset.page === 'more' && MORE_PAGES.includes(view.page))));
  const pages = { more: pageMore, today: pageToday, plans: pagePlans, food: pageFood, budget: pageBudget, study: pageStudy, quiz: pageQuiz, gym: pageGym, steps: pageSteps, goal: pageGoal, stats: pageStats, settings: pageSettings };
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
  const b = $('#quiz-badge'), bm = $('#more-badge'); if (!b) return;
  const q = S.quizzes[ymd()];
  // значок — сколько осталось в сегодняшней порции (до открытия раздела — сколько в неё попадёт)
  let n = q ? q.items.filter(i => !i.result).length : Math.min(dueCards(ymd()).length, QUIZ_SIZE);
  b.hidden = !n; b.textContent = n;
  if (bm) { bm.hidden = !n; bm.textContent = n; }
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
      ? `<div class="big"><b>${Math.min(due, QUIZ_SIZE)}</b><small>${plural(Math.min(due, QUIZ_SIZE), 'вопрос', 'вопроса', 'вопросов')} на сегодня</small></div><p class="hint">${due > QUIZ_SIZE ? `Всего ждут повторения ${due}; по ${QUIZ_SIZE} в день, остальные — кнопкой «ещё».` : 'Откроются в разделе «Вопросы».'}</p>`
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
        <div class="hstats">
          ${S.profile ? `<a class="hstat" href="#goal" title="План питания и цель">
            <span class="hstat-k">${I.goal}План</span>
            <b class="hstat-v">${fmtN(set.kcal)}<small>ккал</small></b>
            <span class="hstat-s">${kgWeek(planNow().weeklyKg)}</span>
          </a>` : ''}
          <button class="hstat" data-action="weigh" title="Записать вес">
            <span class="hstat-k"><i class="hstat-ico">⚖</i>Вес</span>
            ${num(day.weight) ? `<b class="hstat-v">${fmt1(day.weight)}<small>кг</small></b><span class="hstat-s">сегодня</span>`
              : S.profile ? `<b class="hstat-v">${fmt1(curWeight())}<small>кг</small></b><span class="hstat-s hstat-cta">взвеситься →</span>`
              : `<b class="hstat-v">—</b><span class="hstat-s hstat-cta">записать →</span>`}
          </button>
          <div class="hstat ${sk ? 'hstat-flame' : ''}" title="Дней подряд с записями">
            <span class="hstat-k">${I.flame}Серия</span>
            <b class="hstat-v">${sk}<small>${plural(sk, 'день', 'дня', 'дней')}</small></b>
            <span class="hstat-s">${sk ? 'подряд' : 'с первой записи'}</span>
          </div>
        </div>
      </div>
    </header>
    ${starterCard(d)}
    ${nudgeBar()}
    ${dayTimeline(d)}
    <div class="grid">
      ${onboard}
      ${card({ domain: 'food', title: 'Еда', i: i++, body: foodBody, action: `<span class="card-actions">${photoBtn('btn btn-accent btn-sm', 'Фото')}${addBtn('add-meal', 'Приём')}</span>` })}
      ${card({ domain: 'study', title: 'Учёба', i: i++, body: studyBody, cls: 'tile tile-navy', action: addBtn('add-study', 'Занятие') })}
      ${card({ domain: 'steps', title: 'Шаги', i: i++, body: stepsBody, cls: 'tile tile-mustard', action: addBtn('add-steps', 'Записать') })}
      ${card({ domain: 'quiz', title: 'Вопросы дня', span: 7, i: i++, body: quizBody, cls: 'tile tile-orange', action: `<a class="btn btn-accent btn-sm" href="#quiz">Открыть</a>` })}
      ${card({ domain: 'gym', title: 'Зал', span: 5, i: i++, body: gymBody, cls: 'tile tile-sage', action: addBtn('add-gym', 'Тренировка') })}
      ${card({ domain: 'food', title: d === ymd() ? 'Задачи на сегодня' : `Задачи · ${human(d)}`, span: 6, i: i++, body: todayTasksCard(d), action: `<a class="btn btn-accent btn-sm" href="#plans">Планы</a>` })}
      ${card({ domain: 'paper', title: 'Заметка дня', span: 6, i: i++, body: noteBody, cls: 'tile tile-peach' })}
    </div>
  </section>`;
}

/* ============================================================
   ЛЕНТА ДНЯ: еда, вода, учёба, зал, вопросы по времени
   ============================================================ */
// время, выбранное нажатием на ленту, подставляется в следующую открытую форму
function defTime(fallback) { const t = view.presetTime; view.presetTime = null; return t || (view.date === ymd() ? nowHM() : fallback); }
function pageMore() {
  const q = S.quizzes[ymd()], qn = q ? q.items.filter(i => !i.result).length : Math.min(dueCards(ymd()).length, QUIZ_SIZE);
  const items = [
    ['budget', 'Бюджет', num(S.budget.amount) ? (v => v >= 0 ? `сегодня можно ${fmtM(v)}` : `перерасход ${fmtM(-v)}`)(budgetDay(ymd()).leftToday) : 'лимит на день'],
    ['quiz', 'Вопросы', qn ? `${qn} на сегодня` : 'на сегодня всё'],
    ['goal', 'Цель', S.profile ? `${fmt1(curWeight())} кг → ${S.profile.target ? fmt1(S.profile.target) + ' кг' : 'держать'}` : 'составить план'],
    ['gym', 'Зал', (() => { const n = S.workouts.filter(w => w.date >= addDays(ymd(), -6)).length; return n ? `${n} за неделю` : 'тренировки'; })()],
    ['steps', 'Шаги и вес', num(dayRec(ymd()).steps) ? `сегодня ${fmtN(dayRec(ymd()).steps)}` : 'шаги за день'],
    ['stats', 'Статистика', 'графики за период'],
    ['settings', 'Настройки', 'аккаунт, цели, данные']
  ];
  return `<section class="page">${topbar('Ещё', 'остальные разделы', { date: false })}
    <div class="more-grid">${items.map(([k, n, sub]) => `<a class="more-i" href="#${k}"><span class="more-ic">${I[k]}</span><b>${n}</b><span>${sub}</span>${k === 'quiz' && qn ? `<em>${qn}</em>` : ''}</a>`).join('')}</div>
  </section>`;
}
/* Стартовый список для нового пользователя: пункты отмечаются сами, когда сделаны */
function starterCard(d) {
  if (!S.settings.starter || d !== ymd()) return '';
  const items = [
    { done: mealsOn(d).some(m => !m.drink), text: 'Запиши первый приём пищи', btn: `<button class="btn btn-sm btn-primary" style="--c:var(--orange)" data-action="${photoOn ? 'add-text' : 'add-meal'}">${I.plus}Записать</button>` },
    { done: drinkDay(d).hyd > 0, text: 'Выпей стакан воды', btn: `<button class="btn btn-sm btn-primary" style="--c:#2A7FB8" data-action="quick-drink" data-type="water" data-ml="250">${I.plus}250 мл</button>` },
    { done: !!num(dayRec(d).weight), text: 'Взвесься — по замерам журнал покажет реальный темп', btn: `<button class="btn btn-sm btn-primary" style="--c:var(--navy)" data-action="weigh">${I.plus}Вес</button>` },
    { done: tasksOn(d).length > 0, text: 'Поставь одну задачу на сегодня', btn: `<button class="btn btn-sm btn-primary" style="--c:var(--mustard)" data-action="focus-task">${I.plus}Задача</button>` }
  ];
  const n = items.filter(x => x.done).length;
  return `<section class="starter">
    <div class="starter-head"><div><b>С чего начать</b><span>${n === items.length ? 'Всё сделано — дальше журнал подскажет сам.' : `${n} из ${items.length} · четыре шага, пара минут`}</span></div>
      <button class="icon-btn" data-action="starter-off" aria-label="Скрыть">${I.x}</button></div>
    <div class="starter-list">${items.map(x => `<div class="starter-i ${x.done ? 'done' : ''}"><span class="cbx ${x.done ? 'on' : ''}">${x.done ? I.check : ''}</span><span class="starter-t">${x.text}</span>${x.done ? '' : x.btn}</div>`).join('')}</div>
  </section>`;
}
function dayTimeline(d) {
  const t = ymd(), live = d === t, now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const meals = S.meals.filter(m => m.date === d && m.time).sort((a, b) => a.time.localeCompare(b.time));
  const drinks = drinksOn(d).filter(x => x.time);
  const study = S.study.filter(x => x.date === d && x.time);
  const gym = gymOn(d).filter(w => w.time);
  const edits = (OBS.diary || []).filter(e => e.date === d && e.at && ymd(new Date(e.at)) === d);
  const quiz = (S.quizzes[d]?.items || []).filter(i => i.result && i.at);
  const all = [...meals, ...drinks, ...study, ...gym].map(x => hmToMin(x.time));
  const startH = Math.min(6, ...all.map(m => Math.floor(m / 60)));
  const start = startH * 60, span = 24 * 60 - start;
  const pos = m => Math.max(0, Math.min(100, (m - start) / span * 100));
  const w = mins => Math.max(0.8, mins / span * 100);
  const ticks = []; for (let h = Math.ceil(startH / 3) * 3; h <= 24; h += 3) ticks.push(h);
  const grid = ticks.map(h => `<i class="tl-tick" style="left:${pos(h * 60)}%"></i>`).join('') + (live ? `<i class="tl-nowline" style="left:${pos(nowMin)}%"></i>` : '');
  const gap = (lastMin, minGap, text) => live && lastMin !== undefined && nowMin - lastMin >= minGap
    ? `<div class="tl-gap" style="left:${pos(lastMin)}%;width:${pos(nowMin) - pos(lastMin)}%"><span>${text(Math.floor((nowMin - lastMin) / 60))}</span></div>` : '';
  const tip = s => `data-tip="${esc(s)}" aria-label="${esc(s)}"`;

  const foodK = meals.reduce((a, m) => a + num(m.kcal), 0);
  const foodMarks = meals.map(m => { const sz = Math.round(10 + Math.min(12, num(m.kcal) / 60)); return `<button class="tl-dot tl-food" style="left:${pos(hmToMin(m.time))}%;--s:${sz}px" data-action="edit-meal" data-id="${m.id}" ${tip(`${m.time} · ${m.name} · ${fmtN(m.kcal)} ккал`)}></button>`; }).join('');
  const lastMeal = meals.length ? hmToMin(meals[meals.length - 1].time) : undefined;

  const dd = drinkDay(d);
  const drinkMarks = drinks.map(x => { const tt = drinkTotals(x), sz = Math.round(8 + Math.min(10, num(x.ml) / 80)); return `<button class="tl-dot tl-drink" style="left:${pos(hmToMin(x.time))}%;--s:${sz}px;--c:${(DRINKS[x.type] || DRINKS.custom).color}" data-action="edit-drink" data-id="${x.id}" ${tip(`${x.time} · ${drinkName(x)} ${fmtN(x.ml)} мл${tt.kcal ? ` · ${tt.kcal} ккал` : ''}`)}></button>`; }).join('');
  const lastDrink = drinks.length ? Math.max(...drinks.map(x => hmToMin(x.time))) : undefined;

  const studyMarks = study.map(x => `<button class="tl-bar tl-study" style="left:${pos(hmToMin(x.time))}%;width:${w(num(x.minutes) || 30)}%" data-action="edit-study" data-id="${x.id}" ${tip(`${x.time} · ${x.topic}${x.minutes ? ` · ${fmtMin(x.minutes)}` : ''}`)}></button>`).join('')
    + edits.map(e => { const dt = new Date(e.at), m = dt.getHours() * 60 + dt.getMinutes(), n = OBS.notes.find(x => x.id === e.noteId); return `<a class="tl-pin" href="${esc(n?.link || '#study')}" data-action="tl-open" style="left:${pos(m)}%" ${tip(`${z(dt.getHours())}:${z(dt.getMinutes())} · Obsidian: ${noteShort(e.title)}${e.kind === 'new' ? ' — новый конспект' : ` — ${[...e.added, ...e.changed].slice(0, 3).join(', ')}`}`)}><i class="tl-diamond"></i></a>`; }).join('');
  const sMin = studyMin(d);

  const gymMarks = gym.map(x => `<button class="tl-bar tl-gym" style="left:${pos(hmToMin(x.time))}%;width:${w(num(x.minutes) || 60)}%" data-action="edit-gym" data-id="${x.id}" ${tip(`${x.time} · ${x.type}${x.minutes ? ` · ${fmtMin(x.minutes)}` : ''}${x.exercises?.length ? ` · ${x.exercises.map(e => e.name).slice(0, 3).join(', ')}` : ''}`)}></button>`).join('');
  const gymMin = gym.reduce((a, x) => a + num(x.minutes), 0);

  const qItems = S.quizzes[d]?.items || [], qDone = qItems.filter(i => i.result).length;
  const RES = { good: 'помню', hard: 'частично', again: 'не помню' };
  const quizMarks = quiz.map(i => `<a class="tl-dot tl-quiz tl-q-${i.result}" href="#quiz" data-action="tl-open" style="left:${pos(hmToMin(i.at))}%;--s:10px" ${tip(`${i.at} · ${plainText(i.q).slice(0, 70)} — ${RES[i.result]}`)}></a>`).join('');

  const lanes = [
    { k: 'food', icon: I.food, name: 'Еда', marks: foodMarks + gap(lastMeal, 240, h => `${h} ч без еды`), sum: meals.length ? `${meals.length} · ${fmtN(foodK)} ккал` : 'нет записей' },
    { k: 'drink', icon: I.drop, name: 'Вода', marks: drinkMarks + gap(lastDrink, 150, h => `воды нет ${h} ч`), sum: `${fmt1(dd.hyd / 1000)} из ${fmt1(waterNorm() / 1000)} л` },
    { k: 'study', icon: I.study, name: 'Учёба', marks: studyMarks, sum: sMin ? fmtMin(sMin) : edits.length ? `${edits.length} ${plural(edits.length, 'правка', 'правки', 'правок')} в Obsidian` : '—' },
    { k: 'gym', icon: I.gym, name: 'Зал', marks: gymMarks, sum: gymMin ? fmtMin(gymMin) : gym.length ? `${gym.length} тр.` : '—' },
    { k: 'quiz', icon: I.quiz, name: 'Вопросы', marks: quizMarks, sum: qItems.length ? `${qDone} из ${qItems.length}` : '—' },
    { k: 'task', icon: I.plans, name: 'Задачи', marks: tasksOn(d).filter(x => x.time).map(x => `<button class="tl-dot tl-task ${x.done ? 'on' : ''}" style="left:${pos(hmToMin(x.time))}%;--s:13px" data-action="task-edit" data-id="${x.id}" ${tip(`${x.time} · ${x.title}${x.done ? ' — сделано' : ''}`)}></button>`).join(''), sum: (() => { const l = tasksOn(d); return l.length ? `${l.filter(x => x.done).length} из ${l.length}` : '—'; })() }
  ];
  return `<section class="tl" aria-label="Лента дня">
    <div class="tl-row tl-axis"><span></span><div class="tl-axis-track">${ticks.map(h => `<span style="left:${pos(h * 60)}%">${h === 24 ? '00' : z(h)}</span>`).join('')}${live ? `<b class="tl-now-label" style="left:${pos(nowMin)}%">сейчас ${nowHM()}</b>` : ''}</div><span></span></div>
    ${lanes.map(l => `<div class="tl-row tl-${l.k}-row">
      <div class="tl-label">${l.icon}<span>${l.name}</span></div>
      <div class="tl-track" data-action="tl-add" data-k="${l.k}" data-start="${start}" data-span="${span}" title="Нажми, чтобы добавить на это время">${grid}${l.marks}</div>
      <div class="tl-sum">${l.sum}</div></div>`).join('')}
    <p class="tl-hint">Нажми на пустое место дорожки — добавишь запись на это время. Нажми на отметку — изменишь её.</p>
  </section>`;
}


/* ============================================================
   ПЛАНЫ И ЗАДАЧИ
   ============================================================ */
const PERIODS = { week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' };
const PARENT = { week: 'month', month: 'quarter', quarter: 'year', year: null };
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
function periodKey(kind, d) {
  const dt = parseYmd(d), y = dt.getFullYear(), m = dt.getMonth();
  return kind === 'week' ? mondayOf(d) : kind === 'month' ? `${y}-${z(m + 1)}` : kind === 'quarter' ? `${y}-Q${Math.floor(m / 3) + 1}` : `${y}`;
}
function periodRange(kind, key) {
  if (kind === 'week') return [key, addDays(key, 6)];
  if (kind === 'month') { const [y, m] = key.split('-').map(Number); return [`${key}-01`, ymd(new Date(y, m, 0))]; }
  if (kind === 'quarter') { const [y, q] = key.split('-Q').map(Number); return [ymd(new Date(y, (q - 1) * 3, 1)), ymd(new Date(y, q * 3, 0))]; }
  return [`${key}-01-01`, `${key}-12-31`];
}
function periodLabel(kind, key) {
  const [a, b] = periodRange(kind, key), da = parseYmd(a), db = parseYmd(b);
  if (kind === 'week') return da.getMonth() === db.getMonth() ? `${da.getDate()}–${db.getDate()} ${MONG[db.getMonth()]}` : `${human(a)} – ${human(b)}`;
  if (kind === 'month') return `${MONTHS[da.getMonth()][0].toUpperCase() + MONTHS[da.getMonth()].slice(1)} ${da.getFullYear()}`;
  if (kind === 'quarter') return `${key.split('-Q')[1]} квартал ${da.getFullYear()}`;
  return `${key} год`;
}
function shiftDate(kind, d, n) {
  const dt = parseYmd(d);
  if (kind === 'week') return addDays(d, 7 * n);
  if (kind === 'month') return ymd(new Date(dt.getFullYear(), dt.getMonth() + n, 1));
  if (kind === 'quarter') return ymd(new Date(dt.getFullYear(), dt.getMonth() + 3 * n, 1));
  return ymd(new Date(dt.getFullYear() + n, 0, 1));
}
const goalsOf = (kind, key) => S.goals.filter(g => g.period === kind && g.key === key);
const tasksOn = d => S.tasks.filter(t => t.date === d).sort((a, b) => (a.done - b.done) || (a.time || '99').localeCompare(b.time || '99') || (b.prio ? 1 : 0) - (a.prio ? 1 : 0));
const overdueTasks = () => { const t = ymd(); return S.tasks.filter(x => x.date && x.date < t && !x.done).sort((a, b) => a.date.localeCompare(b.date)); };
/* Прогресс цели: по её задачам и подцелям; если их нет — отметка вручную */
function goalProgress(g, depth = 0) {
  const tasks = S.tasks.filter(t => t.goalId === g.id), kids = depth < 4 ? S.goals.filter(x => x.parentId === g.id) : [];
  if (g.done) return 100;
  if (!tasks.length && !kids.length) return 0;
  const parts = [...tasks.map(t => t.done ? 100 : 0), ...kids.map(k => goalProgress(k, depth + 1))];
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}
function goalRow(g) {
  const pr = goalProgress(g), parent = g.parentId && S.goals.find(x => x.id === g.parentId);
  const nT = S.tasks.filter(t => t.goalId === g.id).length, nK = S.goals.filter(x => x.parentId === g.id).length;
  return `<div class="goal ${pr >= 100 ? 'done' : ''}">
    <button class="cbx ${g.done ? 'on' : ''}" data-action="goal-toggle" data-id="${g.id}" aria-label="${g.done ? 'Снять отметку' : 'Отметить выполненной'}">${g.done ? I.check : ''}</button>
    <div class="goal-main" data-action="goal-edit" data-id="${g.id}">
      <div class="goal-title">${esc(g.title)}</div>
      <div class="goal-sub">${parent ? `↳ ${esc(parent.title)} · ` : ''}${nT ? `${S.tasks.filter(t => t.goalId === g.id && t.done).length}/${nT} ${plural(nT, 'задача', 'задачи', 'задач')}` : ''}${nT && nK ? ' · ' : ''}${nK ? `${nK} ${plural(nK, 'подцель', 'подцели', 'подцелей')}` : ''}${!nT && !nK ? 'отметь, когда выполнишь' : ''}</div>
    </div>
    <div class="goal-pr"><span class="sb-track"><i data-w="${pr}" style="background:${pr >= 100 ? 'var(--st-good)' : 'var(--orange)'}"></i></span><b>${pr}%</b></div>
  </div>`;
}
function goalsBlock(kind, key) {
  const gs = goalsOf(kind, key);
  return `<div class="goals">${gs.map(goalRow).join('') || `<p class="hint" style="margin:0">Целей на ${PERIODS[kind].toLowerCase() === 'неделя' ? 'эту неделю' : periodLabel(kind, key).toLowerCase()} пока нет.</p>`}
    <button class="link-btn" data-action="goal-add" data-kind="${kind}" data-key="${key}">${I.plus}Цель на ${kind === 'week' ? 'неделю' : kind === 'month' ? 'месяц' : kind === 'quarter' ? 'квартал' : 'год'}</button></div>`;
}
function taskRow(t, opts = {}) {
  const g = t.goalId && S.goals.find(x => x.id === t.goalId);
  return `<div class="task ${t.done ? 'done' : ''} ${t.prio ? 'prio' : ''}" draggable="true" data-task="${t.id}">
    <button class="cbx ${t.done ? 'on' : ''}" data-action="task-toggle" data-id="${t.id}" aria-label="${t.done ? 'Вернуть' : 'Выполнено'}">${t.done ? I.check : ''}</button>
    <div class="task-main" data-action="task-edit" data-id="${t.id}">
      <span class="task-title">${t.prio ? '<b class="task-prio">!</b>' : ''}${esc(t.title)}</span>
      ${(() => { const meta = [opts.showDate && t.date ? relDay(t.date) : '', t.time && !opts.noTime ? esc(t.time) : '', g ? `◎ ${esc(g.title)}` : ''].filter(Boolean).join(' · '); return meta ? `<span class="task-meta">${meta}</span>` : ''; })()}
    </div>
  </div>`;
}
/* Строка создания задачи со всеми опциями сразу. scope — где она стоит (план недели, главная) */
function compState(scope, date) {
  view.comp = view.comp || {};
  const c = view.comp[scope] = view.comp[scope] || { title: '', time: '', prio: false, goalId: '', note: '', noteOpen: false };
  if (c.ctx !== date) { c.ctx = date; c.date = date; }
  return c;
}
function composerHtml(scope, date) {
  const c = compState(scope, date), t = ymd(), tm = addDays(t, 1);
  const mon = mondayOf(c.date || t), week = Array.from({ length: 7 }, (_, k) => addDays(mon, k));
  const ref = c.date || t;
  const goals = [...goalsOf('week', periodKey('week', ref)), ...goalsOf('month', periodKey('month', ref)), ...goalsOf('quarter', periodKey('quarter', ref)), ...goalsOf('year', periodKey('year', ref))];
  const dayChip = (d, label) => `<button type="button" class="opt-chip ${c.date === d ? 'on' : ''}" data-action="comp-date" data-scope="${scope}" data-d="${d}">${label}</button>`;
  const other = c.date && c.date !== t && c.date !== tm && !week.includes(c.date);
  const set = c.time || c.prio || c.goalId || c.note || c.noteOpen || c.date !== c.ctx;
  // на главной опции свёрнуты под «⋯», в планах — раскрываются при вводе
  const open = scope === 'today' ? (c.optsOpen || set) : (c.open || c.title || set);
  return `<div class="composer ${open ? 'open' : ''} ${scope === 'today' ? 'compact' : ''}" data-scope="${scope}">
    <div class="comp-main">
      <input class="comp-title" data-comp="${scope}" data-f="title" value="${esc(c.title)}" placeholder="Что нужно сделать?" maxlength="200" enterkeyhint="done" aria-label="Новая задача">
      ${scope === 'today' ? `<button type="button" class="icon-btn comp-more ${open ? 'on' : ''}" data-action="comp-opts" data-scope="${scope}" aria-label="Опции задачи" aria-expanded="${!!open}" title="День, время, важность, цель">${I.more}</button>` : ''}
      <button type="button" class="btn btn-primary" style="--c:var(--orange)" data-action="comp-add" data-scope="${scope}">${I.plus}Добавить</button>
    </div>
    <div class="comp-opts">
      <div class="comp-group"><span class="comp-lbl">Когда</span>
        ${dayChip(t, 'Сегодня')}${dayChip(tm, 'Завтра')}
        ${week.filter(d => d !== t && d !== tm).map(d => dayChip(d, `${WD[parseYmd(d).getDay()]} ${parseYmd(d).getDate()}`)).join('')}
        ${dayChip('', 'Без даты')}
        <label class="opt-chip opt-date ${other ? 'on' : ''}">${I.plans}<input type="date" data-comp="${scope}" data-f="date" value="${other ? c.date : ''}" aria-label="Другая дата">${other ? human(c.date) : 'Дата'}</label>
      </div>
      <div class="comp-group">
        <label class="opt-chip opt-time ${c.time ? 'on' : ''}"><input type="time" data-comp="${scope}" data-f="time" value="${c.time}" aria-label="Время"></label>
        <button type="button" class="opt-chip ${c.prio ? 'on prio' : ''}" data-action="comp-prio" data-scope="${scope}">! Важная</button>
        ${goals.length ? `<label class="opt-chip opt-goal ${c.goalId ? 'on' : ''}">◎<select data-comp="${scope}" data-f="goalId" aria-label="Цель"><option value="">Цель</option>${goals.map(g => `<option value="${g.id}" ${c.goalId === g.id ? 'selected' : ''}>${PERIODS[g.period]}: ${esc(g.title)}</option>`).join('')}</select></label>` : ''}
        <button type="button" class="opt-chip ${c.noteOpen || c.note ? 'on' : ''}" data-action="comp-note" data-scope="${scope}">${I.edit}Заметка</button>
      </div>
      ${c.noteOpen ? `<textarea class="comp-note" data-comp="${scope}" data-f="note" rows="2" placeholder="Детали, ссылки, что подготовить">${esc(c.note)}</textarea>` : ''}
    </div>
  </div>`;
}
function compAdd(scope) {
  const c = view.comp?.[scope]; if (!c) return;
  const title = c.title.trim(); if (!title) { $(`[data-comp="${scope}"][data-f=title]`)?.focus(); return; }
  const t = { id: uid(), title, date: c.date || null, time: c.time || '', done: false, prio: c.prio, goalId: c.goalId || null, note: c.note.trim(), created: ymd() };
  S.tasks.push(t);
  Object.assign(c, { title: '', time: '', prio: false, note: '', noteOpen: false, goalId: '', date: c.ctx, open: false, optsOpen: false });
  save(); render();
  toast(`Задача на ${t.date ? `${relDay(t.date)}${t.time ? ', ' + t.time : ''}` : 'без даты'}`);
  requestAnimationFrame(() => $(`[data-comp="${scope}"][data-f=title]`)?.focus());
}
function addTaskFromText(text, date) {
  let title = String(text).trim(); if (!title) return null;
  let time = '', prio = false;
  const tm = /\s(\d{1,2})[:.](\d{2})$/.exec(' ' + title);
  if (tm && +tm[1] < 24 && +tm[2] < 60) { time = `${z(+tm[1])}:${tm[2]}`; title = title.slice(0, title.length - tm[0].length + 1).trim(); }
  if (/^!\s*/.test(title)) { prio = true; title = title.replace(/^!\s*/, ''); }
  if (!title) return null;
  const t = { id: uid(), title, date: date || null, time, done: false, prio, created: ymd() };
  S.tasks.push(t); return t;
}

function dayTasksPanel(d, scope) {
  const list = d === null ? S.tasks.filter(x => !x.date) : tasksOn(d);
  const open = list.filter(x => !x.done), timed = open.filter(x => x.time).sort((a, b) => a.time.localeCompare(b.time)), free = open.filter(x => !x.time), done = list.filter(x => x.done);
  const now = nowHM(), isToday = d === ymd();
  return `${timed.length ? `<div class="dp-sec"><div class="dp-h">По времени</div><div class="sched">${timed.map(x => `<div class="sched-row ${isToday && x.time < now ? 'past' : ''}"><span class="sched-t">${x.time}</span>${taskRow(x, { noTime: true })}</div>`).join('')}</div></div>` : ''}
    ${free.length ? `<div class="dp-sec"><div class="dp-h">${d === null ? 'Когда-нибудь' : 'В течение дня'}</div><div class="tasks">${free.map(x => taskRow(x)).join('')}</div></div>` : ''}
    ${!open.length ? `<p class="dp-empty">${list.length ? 'Всё сделано 🎉' : d === null ? 'Здесь задачи без даты — идеи и «когда-нибудь».' : 'Задач нет. Добавь первую — опции сразу под строкой.'}</p>` : ''}
    ${done.length ? `<details class="dp-done"><summary>Сделано · ${done.length}</summary><div class="tasks">${done.map(x => taskRow(x)).join('')}</div></details>` : ''}`;
}
function weekView(anchor) {
  const key = periodKey('week', anchor), [mon] = periodRange('week', key), t = ymd();
  const days = Array.from({ length: 7 }, (_, k) => addDays(mon, k));
  if (view.planDay === undefined || (view.planDay !== null && !days.includes(view.planDay))) view.planDay = days.includes(t) ? t : mon;
  const sel = view.planDay, od = overdueTasks();
  const wg = goalsOf('week', key), inbox = S.tasks.filter(x => !x.date && !x.done);
  const tab = d => {
    const list = d === null ? inbox : tasksOn(d), done = list.filter(x => x.done).length, dt = d && parseYmd(d);
    return `<button class="dtab ${d === sel ? 'open' : ''} ${d === t ? 'is-today' : ''} ${d && d < t ? 'past' : ''} ${d === null ? 'inbox' : ''}" data-action="plan-day" data-d="${d ?? ''}" data-drop="${d ?? ''}" aria-pressed="${d === sel}">
      ${d === null ? `<span class="dtab-wd">без даты</span><span class="dtab-n">∞</span>` : `<span class="dtab-wd">${d === t ? 'сегодня' : WD[dt.getDay()]}</span><span class="dtab-n">${dt.getDate()}</span>`}
      <span class="dtab-c">${list.length ? (d === null ? list.length : `${done}/${list.length}`) : '—'}</span>
      ${list.length && d !== null ? `<i class="dtab-bar"><b style="width:${done / list.length * 100}%"></b></i>` : ''}
    </button>`;
  };
  const sd = sel && parseYmd(sel), list = sel === null ? inbox : tasksOn(sel), doneN = list.filter(x => x.done).length;
  return `<div class="wgoals">
      <span class="wgoals-l">Цели недели</span>
      ${wg.map(g => { const pr = goalProgress(g); return `<button class="wgoal ${pr >= 100 ? 'done' : ''}" data-action="goal-edit" data-id="${g.id}"><span>${esc(g.title)}</span><i class="wgoal-bar"><b style="width:${pr}%"></b></i><em>${pr}%</em></button>`; }).join('')}
      <button class="link-btn" data-action="goal-add" data-kind="week" data-key="${key}">${I.plus}Цель</button>
    </div>
    <div class="dtabs" role="tablist">${days.map(tab).join('')}${tab(null)}</div>
    <section class="dpanel ${sel === t ? 'is-today' : ''}">
      <header class="dp-head">
        <div><h2>${sel === null ? 'Без даты' : `${WDF[sd.getDay()][0].toUpperCase() + WDF[sd.getDay()].slice(1)}, ${sd.getDate()} ${MONG[sd.getMonth()]}`}</h2>
          <span class="dp-sub">${sel === t ? 'сегодня · ' : sel === addDays(t, 1) ? 'завтра · ' : ''}${list.length ? `сделано ${doneN} из ${list.length}` : 'задач нет'}</span></div>
        ${list.length && sel !== null ? `<div class="dp-pr"><i class="sb-track"><i data-w="${doneN / list.length * 100}" style="background:${doneN === list.length ? 'var(--st-good)' : 'var(--orange)'}"></i></i><b>${Math.round(doneN / list.length * 100)}%</b></div>` : ''}
      </header>
      ${sel === t && od.length ? `<div class="dp-overdue"><span>${I.repeat}Просрочено ${od.length}: ${od.slice(0, 3).map(x => esc(x.title)).join(', ')}${od.length > 3 ? '…' : ''}</span><button class="btn btn-sm btn-primary" style="--c:var(--orange)" data-action="tasks-to-today">Перенести на сегодня</button></div>` : ''}
      ${composerHtml('plan', sel)}
      <div class="dp-list">${dayTasksPanel(sel, 'plan')}</div>
    </section>
    <p class="hint">Перенести задачу: на компьютере — перетащи на закладку дня; на телефоне — нажми на задачу и выбери день.</p>`;
}
function monthView(anchor) {
  const key = periodKey('month', anchor), [a, b] = periodRange('month', key), t = ymd();
  const lead = (parseYmd(a).getDay() + 6) % 7, n = parseYmd(b).getDate();
  const weeks = []; for (let d = mondayOf(a); d <= b; d = addDays(d, 7)) weeks.push(d);
  const wg = weeks.flatMap(w => goalsOf('week', w));
  const qk = periodKey('quarter', anchor), qg = goalsOf('quarter', qk);
  const cells = [];
  for (let k = 0; k < lead; k++) cells.push('<span class="mcal-cell pad"></span>');
  for (let k = 1; k <= n; k++) {
    const d = `${key}-${z(k)}`, list = tasksOn(d), done = list.filter(x => x.done).length;
    cells.push(`<button class="mcal-cell ${d === t ? 'today' : ''} ${list.length && done === list.length ? 'all' : ''}" data-action="plan-open-week" data-d="${d}" title="${human(d)}: ${list.length ? `${done} из ${list.length} задач` : 'задач нет'}">
      <span class="mcal-n">${k}</span>${list.length ? `<span class="mcal-dots">${list.slice(0, 5).map(x => `<i class="${x.done ? 'on' : ''}"></i>`).join('')}</span><span class="mcal-c">${done}/${list.length}</span>` : ''}</button>`);
  }
  return `<div class="grid">
    ${card({ domain: 'food', title: 'Цели месяца', span: 6, i: 0, body: goalsBlock('month', key) + (qg.length ? `<p class="plans-up">Цели квартала: ${qg.map(g => `<button class="link-btn" data-action="goal-edit" data-id="${g.id}">${esc(g.title)} · ${goalProgress(g)}%</button>`).join(' ')}</p>` : '') })}
    ${card({ domain: 'food', title: 'Цели недель месяца', span: 6, i: 1, body: wg.length ? `<div class="goals">${wg.map(goalRow).join('')}</div>` : empty('Цели недель появятся здесь — их ставят на вкладке «Неделя».') })}
    ${card({ domain: 'food', title: 'Задачи по дням', span: 12, i: 2, body: `<div class="mcal">${['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(w => `<span class="cal-wd">${w}</span>`).join('')}${cells.join('')}</div><p class="hint">Нажми на день — откроется его неделя.</p>` })}
  </div>`;
}
function bigView(kind, anchor) {
  const key = periodKey(kind, anchor), [a, b] = periodRange(kind, key);
  const sub = kind === 'quarter' ? 'month' : 'quarter';
  const subKeys = []; for (let d = a; d <= b; d = shiftDate(sub, d, 1)) subKeys.push(periodKey(sub, d));
  return `<div class="grid">
    ${card({ domain: 'food', title: `Цели · ${periodLabel(kind, key)}`, span: 12, i: 0, body: goalsBlock(kind, key) })}
    ${subKeys.map((k, n) => card({ domain: 'paper', title: periodLabel(sub, k), span: kind === 'quarter' ? 4 : 3, i: n + 1, body: `${goalsOf(sub, k).map(goalRow).join('') || '<p class="hint" style="margin:0">Целей нет.</p>'}<button class="link-btn" data-action="plan-go" data-kind="${sub}" data-d="${periodRange(sub, k)[0]}">Открыть ›</button>` })).join('')}
  </div>`;
}
function pagePlans() {
  const kind = view.planKind || 'week', anchor = view.planDate || ymd();
  const key = periodKey(kind, anchor), isNow = key === periodKey(kind, ymd());
  const t = ymd(), todayTasks = tasksOn(t), weekTasks = S.tasks.filter(x => x.date >= mondayOf(t) && x.date <= addDays(mondayOf(t), 6));
  return `<section class="page" style="--c:var(--orange)">
    ${topbar('Планы', `сегодня ${todayTasks.filter(x => x.done).length} из ${todayTasks.length} задач · неделя ${weekTasks.filter(x => x.done).length} из ${weekTasks.length}`, { date: false, actions: `<div class="seg" role="tablist">${Object.entries(PERIODS).map(([k, n]) => `<button role="tab" class="${k === kind ? 'on' : ''}" data-action="plan-kind" data-v="${k}">${n}</button>`).join('')}</div>` })}
    <div class="plan-nav">
      <button class="icon-btn" data-action="plan-shift" data-n="-1" aria-label="Назад">${I.chevL}</button>
      <b>${periodLabel(kind, key)}</b>
      <button class="icon-btn" data-action="plan-shift" data-n="1" aria-label="Вперёд">${I.chevR}</button>
      ${isNow ? '' : `<button class="btn btn-sm" data-action="plan-now">${kind === 'week' ? 'К этой неделе' : kind === 'month' ? 'К этому месяцу' : kind === 'quarter' ? 'К этому кварталу' : 'К этому году'}</button>`}
    </div>
    ${kind === 'week' ? weekView(anchor) : kind === 'month' ? monthView(anchor) : bigView(kind, anchor)}
  </section>`;
}

function goalForm(g, kind, key) {
  kind = g ? g.period : kind; key = g ? g.key : key;
  const pk = PARENT[kind], parents = pk ? goalsOf(pk, periodKey(pk, periodRange(kind, key)[0])) : [];
  const curParent = g?.parentId && S.goals.find(x => x.id === g.parentId);
  if (curParent && !parents.includes(curParent)) parents.unshift(curParent);
  const tasks = g ? S.tasks.filter(t => t.goalId === g.id) : [];
  openModal({
    title: g ? 'Цель' : `Цель · ${periodLabel(kind, key)}`, accent: 'var(--orange)', form: 'goal', submit: g ? 'Сохранить' : 'Добавить',
    body: `<input type="hidden" name="id" value="${g ? g.id : ''}"><input type="hidden" name="kind" value="${kind}"><input type="hidden" name="key" value="${key}">
      ${field('Цель', `<input name="title" required maxlength="140" placeholder="${kind === 'week' ? 'Например: дочитать раздел CSI и ответить на вопросы' : kind === 'year' ? 'Например: сдать сертификацию OpenShift' : 'Например: закончить PoC и написать отчёт'}" value="${esc(g?.title || '')}">`)}
      ${pk ? field(`Часть цели на ${pk === 'month' ? 'месяц' : pk === 'quarter' ? 'квартал' : 'год'}`, `<select name="parentId"><option value="">— не связана —</option>${parents.map(x => `<option value="${x.id}" ${g?.parentId === x.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>`) : ''}
      ${field('Заметка', `<textarea name="note" rows="2" placeholder="Зачем, критерий готовности">${esc(g?.note || '')}</textarea>`)}
      ${tasks.length ? `<div class="field"><label>Задачи цели</label><div class="tasks">${tasks.map(x => taskRow(x, { showDate: true })).join('')}</div></div>` : ''}
      ${g ? `<button type="button" class="btn btn-danger btn-sm" data-action="goal-del" data-id="${g.id}">${I.trash}Удалить цель</button>` : ''}`
  });
}
function taskForm(t, date) {
  const d = t ? t.date : date, ref = d || ymd();
  const goals = [...goalsOf('week', periodKey('week', ref)), ...goalsOf('month', periodKey('month', ref)), ...goalsOf('quarter', periodKey('quarter', ref)), ...goalsOf('year', periodKey('year', ref))];
  // текущая цель задачи остаётся в списке, даже если она из другого периода
  const curGoal = t?.goalId && S.goals.find(x => x.id === t.goalId);
  if (curGoal && !goals.includes(curGoal)) goals.unshift(curGoal);
  const week = Array.from({ length: 7 }, (_, k) => addDays(mondayOf(ymd()), k));
  openModal({
    title: t ? 'Задача' : 'Новая задача', accent: 'var(--orange)', form: 'task', submit: t ? 'Сохранить' : 'Добавить',
    body: `<input type="hidden" name="id" value="${t ? t.id : ''}">
      ${field('Что сделать', `<input name="title" required maxlength="200" value="${esc(t?.title || '')}">`)}
      <div class="field"><label>Когда</label>
        <div class="chips">${week.map(x => `<button type="button" class="chip chip-btn ${x === d ? 'on' : ''}" data-action="task-day" data-d="${x}">${x === ymd() ? 'Сегодня' : x === addDays(ymd(), 1) ? 'Завтра' : `${WD[parseYmd(x).getDay()]} ${parseYmd(x).getDate()}`}</button>`).join('')}<button type="button" class="chip chip-btn ${!d ? 'on' : ''}" data-action="task-day" data-d="">без даты</button></div>
        <div class="row row-2" style="margin-top:8px"><input name="date" type="date" value="${d || ''}" aria-label="Дата"><input name="time" type="time" value="${t?.time || ''}" aria-label="Время"></div></div>
      ${goals.length ? field('Цель', `<select name="goalId"><option value="">— без цели —</option>${goals.map(x => `<option value="${x.id}" ${t?.goalId === x.id ? 'selected' : ''}>${PERIODS[x.period]}: ${esc(x.title)}</option>`).join('')}</select>`) : ''}
      <label class="switch" style="--c:var(--orange)"><input type="checkbox" name="prio" ${t?.prio ? 'checked' : ''}><span>Важная</span></label>
      ${field('Заметка', `<textarea name="note" rows="2">${esc(t?.note || '')}</textarea>`)}
      ${t ? `<button type="button" class="btn btn-danger btn-sm" data-action="task-del" data-id="${t.id}">${I.trash}Удалить задачу</button>` : ''}`
  });
}
function todayTasksCard(d) {
  const list = tasksOn(d), od = d === ymd() ? overdueTasks() : [];
  const wg = goalsOf('week', periodKey('week', d)).filter(g => goalProgress(g) < 100);
  return `${composerHtml('today', d)}<div class="tasks" style="margin-top:12px">${list.map(x => taskRow(x)).join('')}</div>
    ${od.length ? `<p class="hint" style="margin:10px 0 0">Просрочено: ${od.length} — <button class="link-btn" data-action="tasks-to-today">перенести на сегодня</button></p>` : ''}
    ${wg.length ? `<div class="today-goals"><span>Цели недели:</span>${wg.slice(0, 3).map(g => `<a href="#plans">${esc(g.title)} · ${goalProgress(g)}%</a>`).join('')}</div>` : ''}`;
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
  if (!tot.nut) return `<p class="hint nut-empty">Клетчатка, сахар и соль считаются там, где они известны: еда по фото или тексту, ручные записи с заполненными полями «Клетчатка, сахар, соль» и напитки. Пока таких записей за день нет.</p>`;
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
  return (food.length || groups ? groups : empty(live ? (photoOn ? 'Еды сегодня ещё нет. Сфотографируй, опиши текстом или запиши вручную — кнопки выше.' : 'Еды сегодня ещё нет. Запиши вручную — кнопка выше.') : 'Еды за этот день нет.')) + drinkGroup;
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
  const head = topbar('Еда', live ? `сегодня, ${humanLong(d)}` : humanLong(d), { date: true, actions: tabs });
  if (tab === 'analysis') return `<section class="page" style="--c:var(--food)">${head}
    <div class="grid">
      ${card({ domain: 'food', title: 'Календарь питания', span: 5, i: i++, body: foodCalendarCard(nm) })}
      ${card({ domain: 'food', title: live ? 'Клетчатка, сахар, соль, вода · сегодня' : `Клетчатка, сахар, соль, вода · ${human(d)}`, span: 7, i: i++, body: nutRow(tot, nm, live) + drinkMeters(d, live) })}
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
        ${field('Время', `<input name="time" type="time" value="${m ? m.time : defTime('12:00')}">`)}
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
  if (S.settings.starter && view.page === 'today') return out; // пока виден стартовый список — он и подсказывает
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
   ЧИТАЛКА КОНСПЕКТОВ И ПОИСК
   ============================================================ */
let rd = null;
function markTerms(root, q) {
  const words = String(q || '').toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}._\-/]+/u).filter(w => w.length >= 2);
  if (!words.length) return;
  const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]')).join('|'), 'gi');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('pre,code,.mermaid-wrap,mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (!re.test(n.data)) continue; re.lastIndex = 0;
    const span = document.createElement('span');
    span.innerHTML = esc(n.data).replace(re, m => `<mark class="hit">${m}</mark>`);
    n.replaceWith(...span.childNodes);
  }
}
async function openReader(rel, h = '', q = '') {
  closeModal('swap');
  const root = $('#modal-root');
  rd = { rel, h, q };
  root.innerHTML = `<div class="overlay reader-overlay" data-action="close-modal"><div class="sheet reader" role="dialog" aria-modal="true" aria-label="Конспект">
    <p class="cheat-wait"><span class="busy-dot"></span>Открываю…</p></div></div>`;
  requestAnimationFrame(() => root.classList.add('open'));
  let n;
  try { n = await apiFetch('/api/obsidian/note?rel=' + encodeURIComponent(rel)); }
  catch (e) { root.querySelector('.reader').innerHTML = `<header class="sheet-head"><h2>Не открылось</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Закрыть">${I.x}</button></header><p class="auth-err">${esc(e.message)}</p>`; return; }
  if (!rd || rd.rel !== rel) return;
  rd.note = n;
  const toc = n.sections.map(x => `<button class="rd-toc-i" data-action="rd-jump" data-h="${esc(x)}">${esc(x)}</button>`).join('');
  const sheet = root.querySelector('.reader');
  sheet.innerHTML = `<header class="reader-head">
      <div class="reader-title"><small>${esc(n.rel.replace(/\.md$/, ''))}</small><h2>${esc(n.title)}</h2>
        ${n.tags.length ? `<div class="chips">${n.tags.map(t => `<span class="chip chip-pill" style="--c:var(--study);--cf:var(--study-f)">#${esc(t)}</span>`).join('')}</div>` : ''}</div>
      <div class="reader-actions">
        ${n.sections.length ? `<select class="rd-toc-sel" data-rd-sec aria-label="Перейти к разделу"><option value="">Разделы…</option>${n.sections.map(x => `<option>${esc(x)}</option>`).join('')}</select>` : ''}
        <label class="rd-find">${I.search}<input type="search" placeholder="Найти в конспекте" value="${esc(q)}" data-rd-find></label>
        ${n.noteId ? `<button class="btn btn-sm btn-primary" style="--c:var(--quiz)" data-action="quiz-note" data-id="${n.noteId}">${I.quiz}Повторить</button>` : ''}
        ${n.noteId && photoOn ? `<button class="btn btn-sm btn-accent" style="--c:var(--study);--cf:var(--study-f)" data-action="cheat" data-id="${n.noteId}">${I.spark}Шпаргалка</button>` : ''}
        <a class="btn btn-sm" href="${esc(n.link)}">Открыть в Obsidian</a>
        <button type="button" class="icon-btn" data-action="close-modal" aria-label="Закрыть">${I.x}</button>
      </div></header>
    <div class="reader-main">
      ${toc ? `<nav class="rd-toc" aria-label="Разделы"><div class="rd-toc-h">Разделы</div>${toc}</nav>` : ''}
      <article class="rd-body md">${mdToHtml(n.markdown)}</article>
    </div>`;
  const body = sheet.querySelector('.rd-body');
  markTerms(body, q);
  renderMermaid(body);
  const target = h ? body.querySelector('#' + headId(h)) : body.querySelector('mark.hit');
  if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 60);
}
function rdFind(q) {
  const body = $('.rd-body'); if (!body || !rd?.note) return;
  body.innerHTML = mdToHtml(rd.note.markdown);
  markTerms(body, q); renderMermaid(body);
  const first = body.querySelector('mark.hit'); if (first) first.scrollIntoView({ block: 'center' });
}

let searchTimer = null, searchSeq = 0;
function studySearchCard() {
  if (!OBS.enabled) return '';
  return `<div class="search">
    <label class="search-box">${I.search}<input type="search" placeholder="Поиск по всем заметкам Obsidian: etcd кворум, multipath, LACP…" data-search value="${esc(view.studyQ || '')}" autocomplete="off"></label>
    <div class="search-res" id="search-res">${searchResultsHtml()}</div>
  </div>`;
}
function searchResultsHtml() {
  const r = view.searchRes;
  if (!view.studyQ || view.studyQ.trim().length < 2) {
    const lib = view.library || [];
    if (!lib.length) return '';
    return `<div class="lib"><div class="fav-sub">Заметки в хранилище · ${lib.length}</div>${lib.slice(0, 12).map(n => `<button class="lib-i" data-action="rd-open" data-rel="${esc(n.rel)}"><b>${esc(n.title)}</b><span>${esc(n.rel.split('/').slice(0, -1).join(' / ') || 'корень')}${n.sections ? ` · ${n.sections} ${plural(n.sections, 'раздел', 'раздела', 'разделов')}` : ''}</span></button>`).join('')}</div>`;
  }
  if (!r) return '<p class="hint">Ищу…</p>';
  if (!r.length) return '<p class="hint">Ничего не нашлось. Попробуй другое слово.</p>';
  return r.map(x => `<button class="hit-i" data-action="rd-open" data-rel="${esc(x.rel)}" data-h="${esc(x.h)}"><span class="hit-path"><b>${esc(noteShort(x.title))}</b>${x.h ? ` › ${esc(x.h)}` : ''}</span><span class="hit-snip">${esc(x.snippet)}</span></button>`).join('');
}
async function runSearch(q) {
  const seq = ++searchSeq;
  view.studyQ = q; view.searchRes = null;
  const box = $('#search-res'); if (box) box.innerHTML = searchResultsHtml();
  if (q.trim().length < 2) return;
  try { const r = await apiFetch('/api/obsidian/search?q=' + encodeURIComponent(q)); if (seq !== searchSeq) return; view.searchRes = r.hits; }
  catch (e) { view.searchRes = []; }
  const b2 = $('#search-res'); if (b2) { b2.innerHTML = searchResultsHtml(); markTerms(b2, q); }
}
async function loadLibrary() {
  try { view.library = (await apiFetch('/api/obsidian/library')).notes; const b = $('#search-res'); if (b && !view.studyQ) b.innerHTML = searchResultsHtml(); } catch { /* без хранилища */ }
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
        ${field('Время', `<input name="time" type="time" value="${x ? x.time : defTime('12:00')}">`)}
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
  const prev = ph.stage, cur = ph;
  ph.stage = 'loading'; ph.err = ''; renderPhoto();
  try {
    const r = await apiFetch('/api/food/photo', { method: 'POST', body: JSON.stringify({ image: ph.b64, mime: ph.mime, note: ph.note, scale: ph.scale, answers }) });
    if (!ph || ph !== cur) return; // окно закрыли или открыли новое — старый ответ не нужен
    if (!r.isFood) { ph.stage = 'setup'; ph.err = r.comment || (ph.text ? 'Не понял, что за еда. Опиши подробнее.' : 'На фото не видно еды.'); renderPhoto(); return; }
    ph.rows = r.items.map(it => ({ ...it, base: { grams: it.grams, kcal: it.kcal, p: it.p, f: it.f, c: it.c, fi: it.fi, su: it.su, sa: it.sa } }));
    ph.questions = answers.length ? [] : r.questions; ph.answers = {};
    ph.comment = r.comment; ph.stage = 'review';
  } catch (e) {
    if (!ph || ph !== cur) return;
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

/* ---------- markdown → HTML (конспекты Obsidian и шпаргалки) ---------- */
const CALLOUT = { info: 'Инфо', note: 'Заметка', tip: 'Совет', warning: 'Внимание', important: 'Важно', example: 'Пример', bug: 'Гипотеза', todo: 'Сделать', danger: 'Опасно', quote: 'Цитата', abstract: 'Кратко', question: 'Вопрос', success: 'Готово', failure: 'Ошибка' };
const headId = t => 'h-' + hash(String(t).trim().toLowerCase()).toString(36);
function mdInline(t) {
  return esc(t)
    .replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\[\[([^\]|#]*)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (m, note, sec, label) => {
      const h = sec ? sec.slice(1) : '';
      return `<a class="wl" href="#" data-action="rd-link" data-note="${note}" data-h="${h}">${label || (note ? note + (h ? ' › ' + h : '') : h)}</a>`;
    })
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function mdToHtml(md) {
  const lines = String(md).replace(/\r/g, '').split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^\s*(```|~~~)\s*([\w-]*)/.exec(l);
    if (fence) {
      const buf = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i]);
      out.push(fence[2] === 'mermaid' ? `<div class="mermaid-wrap"><pre class="mermaid">${esc(buf.join('\n'))}</pre></div>` : `<pre${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const buf = []; i--;
      while (++i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i].replace(/^\s*>\s?/, ''));
      i--;
      const c = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(buf[0] || '');
      if (c) { const type = c[1].toLowerCase(); out.push(`<div class="callout callout-${esc(type)}"><div class="callout-title">${mdInline(c[2] || CALLOUT[type] || type)}</div>${mdToHtml(buf.slice(1).join('\n'))}</div>`); }
      else out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = []; i--;
      while (++i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i]);
      i--;
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push(`<div class="md-table"><table>${body.map((r, k) => `<tr>${cells(r).map(x => k ? `<td>${mdInline(x)}</td>` : `<th>${mdInline(x)}</th>`).join('')}</tr>`).join('')}</table></div>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(l);
    if (h) { const lvl = Math.min(4, h[1].length + 1); out.push(`<h${lvl} id="${headId(h[2])}">${mdInline(h[2])}</h${lvl}>`); continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { out.push('<hr>'); continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const items = []; i--;
      while (++i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) items.push({ ind: m[1].replace(/\t/g, '  ').length, ord: /\d/.test(m[2]), text: m[3] });
        else items[items.length - 1].text += ' ' + lines[i].trim();
      }
      i--;
      // вложенность по отступам
      const render = (arr, from, ind) => {
        let html = '', k = from;
        const ord = arr[from].ord;
        while (k < arr.length && arr[k].ind >= ind) {
          if (arr[k].ind > ind) { const [sub, next] = render(arr, k, arr[k].ind); html = html.replace(/<\/li>$/, sub + '</li>'); k = next; continue; }
          const t = /^\[( |x|X)\]\s+(.*)$/.exec(arr[k].text);
          html += t ? `<li class="task${t[1] !== ' ' ? ' done' : ''}"><span class="cb">${t[1] !== ' ' ? '✓' : ''}</span>${mdInline(t[2])}</li>` : `<li>${mdInline(arr[k].text)}</li>`;
          k++;
        }
        return [`<${ord ? 'ol' : 'ul'}>${html}</${ord ? 'ol' : 'ul'}>`, k];
      };
      let k = 0; while (k < items.length) { const [html, next] = render(items, k, items[k].ind); out.push(html); k = next; }
      continue;
    }
    if (l.trim()) {
      const buf = [l]; // абзац — до пустой строки или блока
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^\s*([-*+]|\d+[.)])\s+|^\s*>|^#{1,6}\s|^\s*\||^\s*(```|~~~)|^\s*---\s*$/.test(lines[i + 1])) buf.push(lines[++i]);
      out.push(`<p>${buf.map(mdInline).join('<br>')}</p>`);
    }
  }
  return out.join('');
}
// mermaid-схемы рисуем, если есть интернет (библиотека с CDN); иначе остаётся текст схемы
let mermaidLoading = null;
function renderMermaid(root) {
  const nodes = [...root.querySelectorAll('pre.mermaid:not([data-done])')];
  if (!nodes.length) return;
  mermaidLoading = mermaidLoading || new Promise((ok, fail) => {
    if (window.mermaid) return ok();
    const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js'; sc.integrity = 'sha384-rbtjAdnIQE/aQJGEgXrVUlMibdfTSa4PQju4HDhN3sR2PmaKFzhEafuePsl9H/9I'; sc.crossOrigin = 'anonymous'; // контрольная сумма: подменённый файл браузер не запустит
    sc.onload = ok; sc.onerror = fail; document.head.appendChild(sc);
  }).then(() => window.mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict', fontFamily: 'Onest, sans-serif',
    themeVariables: { primaryColor: '#FBF4E6', primaryBorderColor: '#2F3B4F', primaryTextColor: '#2B3445', lineColor: '#6E6758', secondaryColor: '#F4D4BE', tertiaryColor: '#C8D8BD', clusterBkg: '#EFE3CE', clusterBorder: '#A19682' } }));
  mermaidLoading.then(() => { nodes.forEach(n => n.dataset.done = '1'); return window.mermaid.run({ nodes }); }).catch(() => {});
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
    ${!photoOn ? '<p class="hint" style="margin:0">Вопросы и шпаргалки по конспектам делает Gemini — добавь ключ GEMINI_API_KEY в файл .env на сервере. Читать и искать можно и без него.</p>' : ''}
    ${q.total && photoOn ? `<div class="obs-line"><span class="obs-q">${left ? `${q.pausedUntil ? 'Лимит Gemini — пауза, продолжу сам. ' : 'Gemini готовит вопросы: '}${q.done} из ${q.total} разделов` : `Вопросы готовы для всех ${q.total} разделов`}</span><span class="sb-track obs-track"><i data-w="${q.total ? q.done / q.total * 100 : 0}" style="background:var(--quiz)"></i></span></div>` : ''}
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
          <button class="btn btn-primary btn-sm" style="--c:var(--study)" data-action="rd-open" data-rel="${esc(n.rel)}">${I.study}Читать</button>
          <button class="btn btn-accent btn-sm" style="--c:var(--quiz);--cf:var(--quiz-f)" data-action="quiz-note" data-id="${n.id}" ${qn ? '' : 'disabled'}>${I.quiz}Повторить${due ? ` · ${due}` : ''}</button>
          <button class="btn btn-accent btn-sm" style="--c:var(--study);--cf:var(--study-f)" data-action="cheat" data-id="${n.id}" ${photoOn ? '' : 'disabled'}>${I.spark}${n.cheat ? 'Шпаргалка' : 'Сделать шпаргалку'}</button>
          <a class="btn btn-sm" href="${esc(n.link)}">Открыть в Obsidian</a>
        </div></div>
      ${n.tags.length ? `<div class="chips note-tags">${n.tags.map(t => `<span class="chip chip-pill" style="--c:var(--study);--cf:var(--study-f)">#${esc(t)}</span>`).join('')}</div>` : ''}
      <details class="theses"><summary>Разделы и вопросы</summary><div class="note-secs">${secs.map(sec => `<div class="note-sec"><button class="link-btn note-sec-h" data-action="rd-open" data-rel="${esc(n.rel)}" data-h="${esc(sec.h)}">${esc(sec.h)}</button>
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
  const from = addDays(ymd(), -13), shown = view.diaryAll ? all : all.filter(e => e.date >= from), more = all.length - shown.length;
  return groupBy(shown, e => e.date).map(([d, arr]) => `<div class="group-date"><span>${relDay(d)} · ${human(d)}</span><span>${(() => { const m = studyMin(d); return m ? fmtMin(m) : ''; })()}</span></div>
    <div class="list">${arr.map(e => e.src === 'manual' ? studyItem(e.s) : `<div class="item diary-item">
      <span class="diary-ic">${e.kind === 'new' ? I.plus : I.edit}</span>
      <div class="item-main"><div class="item-title">${esc(noteShort(e.title))}</div>
        <div class="item-sub">${e.kind === 'new' ? `новый конспект: ${e.added.length} ${plural(e.added.length, 'раздел', 'раздела', 'разделов')}` : [e.added.length ? `дописал: ${e.added.map(esc).join(', ')}` : '', e.changed.length ? `изменил: ${e.changed.map(esc).join(', ')}` : ''].filter(Boolean).join(' · ')}</div></div>
      <label class="diary-min" title="Сколько минут занимался"><input type="number" min="0" step="5" inputmode="numeric" placeholder="—" data-dmin="${e.id}" data-dd="${e.date}" value="${stMin(S.studyTime[e.id]) || ''}"><span>мин</span></label>
      <a class="icon-btn" href="${esc((OBS.notes.find(n => n.id === e.noteId) || {}).link || '#study')}" title="Открыть в Obsidian" aria-label="Открыть в Obsidian">${I.chevR}</a>
    </div>`).join('')}</div>`).join('') + (more > 0 ? `<button class="btn btn-sm" style="margin-top:12px" data-action="diary-all">Показать ещё ${more}</button>` : view.diaryAll && all.length ? '<button class="btn btn-sm btn-ghost" style="margin-top:12px" data-action="diary-all">Свернуть</button>' : '');
}

function pageStudy() {
  if (OBS.enabled && !view.library) { view.library = []; loadLibrary(); }
  const allMin = S.study.reduce((a, s) => a + num(s.minutes), 0) + Object.values(S.studyTime).reduce((a, v) => a + stMin(v), 0);
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
      ${kpi('К повторению', `${due}`, 'paper', i++, due ? `порциями по ${QUIZ_SIZE} в день` : 'на сегодня всё')}
      ${kpi('За 7 дней', `${hoursStr(week)}<small>ч</small>`, 'study', i++, `всего ${hoursStr(allMin)} ч`)}
    </div>
    <div class="grid">
      ${OBS.enabled ? card({ domain: 'study', title: 'Поиск и чтение', span: 12, i: i++, body: studySearchCard() }) : ''}
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
        ${field('Время', `<input name="time" type="time" value="${s ? s.time : defTime('19:00')}">`)}
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
    // id карточки — по тексту: правка или удаление одной строки не сдвигает историю повторения других
    s.notes.forEach(t => cards.push({ id: `${s.id}:t${hash(t).toString(36)}`, type: 'thesis', session: s, text: t }));
    s.qa.forEach(p => cards.push({ id: `${s.id}:a${hash(p.q).toString(36)}`, type: 'qa', session: s, q: p.q, a: p.a }));
    if (s.notes.length >= 2) cards.push({ id: `${s.id}:sum`, type: 'summary', session: s });
  }
  for (const n of OBS.notes || []) for (const sec of n.sections) for (const q of sec.questions || [])
    cards.push({ id: `${n.id}:${sec.key}:${q.id}`, type: 'obs', session: { id: n.id, topic: `${noteShort(n.title)} · ${sec.h}`, date: sec.updated || sec.first, category: n.tags[0] || '' }, q: q.q, a: q.a, qkind: q.kind, noteId: n.id, key: sec.key });
  return cards;
}
// перенос истории повторения со старых id (по номеру строки) на новые (по тексту) — один раз
function migrateCardIds() {
  let moved = 0;
  for (const s of S.study) {
    s.notes.forEach((t, i) => { const o = `${s.id}:n${i}`, n = `${s.id}:t${hash(t).toString(36)}`; if (S.srs[o] && !S.srs[n]) { S.srs[n] = S.srs[o]; delete S.srs[o]; moved++; } });
    s.qa.forEach((p, i) => { const o = `${s.id}:q${i}`, n = `${s.id}:a${hash(p.q).toString(36)}`; if (S.srs[o] && !S.srs[n]) { S.srs[n] = S.srs[o]; delete S.srs[o]; moved++; } });
  }
  return moved;
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
  const picked = shuffle(pool, r).slice(0, QUIZ_SIZE);
  return { items: picked.map(c => quizItemFrom(c, r)), source: 'local', created: Date.now() };
}
// DOMParser не запускает скрипты и не грузит картинки из разбираемого HTML
const plainText = h => new DOMParser().parseFromString(String(h), 'text/html').body.textContent.trim();
function quizItemFrom(c, r) {
  const q = makeQuestion(c, r);
  return { cardId: c.id, kind: q.kind, meta: q.meta, q: q.q, a: q.a, result: null, revealed: false, noteId: c.noteId || null, key: c.key || null };
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

const quizDay = () => view.quizDay || ymd();
const QUIZ_SIZE = 6; // сколько вопросов в порции дня
function pageQuiz() {
  const d = ymd(); view.quizDay = d;
  const quiz = ensureQuiz(d);
  const dueN = dueCards(d).length, total = allCards().length;
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
    ${topbar('Вопросы дня', `${humanLong(d)} · из твоих конспектов`, { date: false })}
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
        ${field('Время', `<input name="time" type="time" value="${w ? w.time : defTime('18:00')}">`)}
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
   БЮДЖЕТ: сколько можно потратить сегодня (по мотивам Budget OK)
   Сумма на период делится на оставшиеся дни. Потратил меньше — завтра
   на день больше, перерасход — меньше. Доходы в периоде добавляются к сумме.
   ============================================================ */
const MONEY_CATS = {
  out: [['food', 'Продукты', '#D9622B'], ['cafe', 'Кафе', '#B5891E'], ['transport', 'Транспорт', '#4D7B78'], ['home', 'Дом и счета', '#2F3B4F'],
    ['shop', 'Покупки', '#8E2F22'], ['health', 'Здоровье', '#3C5B38'], ['fun', 'Отдых', '#C0794F'], ['other', 'Другое', '#A19682']],
  in: [['salary', 'Зарплата', '#3C5B38'], ['side', 'Подработка', '#4D7B78'], ['gift', 'Подарок', '#B5891E'], ['other', 'Другое', '#A19682']]
};
const mcat = (kind, k) => MONEY_CATS[kind === 'in' ? 'in' : 'out'].find(c => c[0] === k) || ['other', 'Другое', '#A19682'];
const CUR = () => S.budget.cur || '₼';
const fmtM = v => `${(Math.round(v * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${CUR()}`;
const msum = xs => xs.reduce((a, x) => a + num(x.amount), 0);
// «12,5+3» — как в калькуляторе
const parseAmount = v => Math.round(String(v || '').split('+').reduce((a, x) => a + num(x), 0) * 100) / 100;

function budgetPeriod(d) {
  const st = Math.min(28, Math.max(1, Math.round(num(S.budget.start)) || 1)), dt = parseYmd(d);
  const m = dt.getMonth() - (dt.getDate() < st ? 1 : 0);
  const from = ymd(new Date(dt.getFullYear(), m, st)), to = addDays(ymd(new Date(dt.getFullYear(), m + 1, st)), -1);
  return { from, to, days: diffDays(from, to) + 1 };
}
function budgetDay(d) {
  const p = budgetPeriod(d), inP = S.money.filter(x => x.date >= p.from && x.date <= p.to);
  const outs = inP.filter(x => x.kind !== 'in'), income = msum(inP.filter(x => x.kind === 'in'));
  const total = num(S.budget.amount) + income - num(S.budget.save);
  const before = msum(outs.filter(x => x.date < d)), today = msum(outs.filter(x => x.date === d)), spent = msum(outs);
  const daysLeft = diffDays(d, p.to) + 1, allow = Math.max(0, (total - before) / daysLeft);
  return { ...p, total, income, spent, before, today, daysLeft, allow, leftToday: allow - today, leftPeriod: total - spent,
    tomorrow: daysLeft > 1 ? Math.max(0, (total - before - today) / (daysLeft - 1)) : null, base: total / p.days, outs };
}

function budgetSetupForm(compact = false) {
  const b = S.budget;
  return `<div class="row row-2">
      ${field(`Сумма на месяц, ${esc(CUR())}`, `<input name="amount" type="text" inputmode="decimal" required placeholder="например 1500" value="${b.amount || ''}">`)}
      ${field('Месяц начинается', `<select name="start">${Array.from({ length: 28 }, (_, k) => `<option value="${k + 1}" ${(b.start || 1) === k + 1 ? 'selected' : ''}>${k + 1}-го числа</option>`).join('')}</select>`)}
    </div>
    <div class="row row-2">
      ${field('Отложить в копилку', `<input name="save" type="text" inputmode="decimal" placeholder="0" value="${b.save || ''}">`)}
      ${field('Валюта', `<select name="cur">${['₼', '₽', '$', '€', '₸', '₺', '£'].map(c => `<option ${CUR() === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
    </div>
    ${compact ? '' : '<p class="hint">Например, день зарплаты. Копилка вычитается из суммы сразу, а доходы внутри месяца к ней прибавляются.</p>'}`;
}

function moneyFields(x = {}) {
  const kind = x.kind || view.mKind || 'out', cats = MONEY_CATS[kind];
  const cat = cats.some(c => c[0] === x.cat) ? x.cat : cats[0][0];
  return `<input type="hidden" name="kind" value="${kind}">
    ${x.id ? `<input type="hidden" name="id" value="${x.id}"><input type="hidden" name="date" value="${x.date}"><input type="hidden" name="time" value="${esc(x.time || '')}">` : ''}
    <div class="m-amount"><span class="m-sign">${kind === 'in' ? '+' : '−'}</span><input name="amount" type="text" inputmode="decimal" autocomplete="off" required placeholder="0" value="${x.amount || ''}" aria-label="Сумма"><span class="m-cur">${esc(CUR())}</span></div>
    <div class="m-cats" role="radiogroup" aria-label="Категория">${cats.map(([k, n, c]) => `<label class="m-cat" style="--dot:${c}"><input type="radio" name="cat" value="${k}" ${k === cat ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
    <input name="note" maxlength="80" placeholder="Заметка: что купил, где" value="${esc(x.note || '')}">`;
}

function pageBudget() {
  const d = view.date;
  if (!num(S.budget.amount)) return `<section class="page" style="--c:var(--money)">
    ${topbar('Бюджет', 'сколько можно потратить сегодня', { date: false })}
    <div class="grid">${card({ domain: 'money', title: 'Сколько у тебя на месяц?', span: 12, body: `<p class="hint" style="margin-top:0">Журнал разделит сумму на дни и каждый день будет показывать, сколько можно потратить. Потратил меньше — остаток перейдёт на следующие дни, перерасход — завтрашний лимит станет меньше.</p>
      <form data-form="budget-set" class="form-stack">${budgetSetupForm()}<button class="btn btn-primary" style="--c:var(--money)" type="submit">${I.check}Начать</button></form>` })}</div>
  </section>`;
  const B = budgetDay(d), isToday = d === ymd(), kind = view.mKind || 'out';
  const over = B.leftToday < 0, k = B.allow ? Math.min(1, B.today / B.allow) : (B.today ? 1 : 0);
  const R = 62, C = 2 * Math.PI * R;
  const ops = S.money.filter(x => x.date === d).sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
  const hero = `<div class="bud-hero ${over ? 'over' : ''}">
      <div class="bud-ring"><svg viewBox="0 0 150 150" width="150" height="150" role="img" aria-label="Потрачено ${Math.round(k * 100)}% дневного лимита">
        <circle cx="75" cy="75" r="${R}" class="ring-bg" stroke-width="14"/>
        <circle cx="75" cy="75" r="${R}" fill="none" stroke="${over ? 'var(--bad)' : 'var(--money)'}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - k)}" transform="rotate(-90 75 75)"/>
      </svg><div class="bud-ring-c"><b>${Math.round(k * 100)}%</b><small>потрачено</small></div></div>
      <div class="bud-main">
        <div class="bud-k">${over ? 'Перерасход' : isToday ? 'Сегодня можно потратить' : d > ymd() ? 'В этот день можно будет' : 'В этот день оставалось'}</div>
        <div class="bud-v">${over ? '−' : ''}${fmtM(Math.abs(B.leftToday))}</div>
        <div class="bud-s">лимит дня ${fmtM(B.allow)} · потрачено ${fmtM(B.today)}</div>
        ${B.tomorrow !== null ? `<div class="bud-tip">${over ? `Завтра на день будет ${fmtM(B.tomorrow)}` : B.tomorrow > B.allow + 0.005 ? `Если больше не тратить — завтра ${fmtM(B.tomorrow)}` : `Завтра — ${fmtM(B.tomorrow)}`}</div>` : '<div class="bud-tip">Последний день периода</div>'}
      </div>
      <div class="bud-side">
        <div><span>Осталось в месяце</span><b class="${B.leftPeriod < 0 ? 'neg' : ''}">${fmtM(B.leftPeriod)}</b><small>из ${fmtM(B.total)}</small></div>
        <div><span>До ${human(addDays(B.to, 1))}</span><b>${B.daysLeft} ${plural(B.daysLeft, 'день', 'дня', 'дней')}</b><small>${human(B.from)} — ${human(B.to)}</small></div>
      </div>
    </div>`;
  const add = `<form data-form="money" class="m-form" data-kind="${kind}">
      <div class="seg m-kind" role="tablist">${[['out', 'Расход'], ['in', 'Доход']].map(([v, n]) => `<button type="button" role="tab" class="${kind === v ? 'on' : ''}" data-action="m-kind" data-v="${v}">${n}</button>`).join('')}</div>
      ${moneyFields()}
      <button class="btn btn-primary btn-lg" style="--c:${kind === 'in' ? 'var(--gym)' : 'var(--money)'}" type="submit">${I.plus}${kind === 'in' ? 'Добавить доход' : 'Добавить расход'}</button>
    </form>`;
  const list = ops.length ? `<ul class="m-list">${ops.map(x => { const [, n, c] = mcat(x.kind, x.cat); return `<li class="m-row">
      <i class="m-dot" style="--dot:${c}"></i>
      <div class="m-txt"><b>${esc(x.note || n)}</b><span>${x.note ? n : ''}${x.note && x.time ? ' · ' : ''}${esc(x.time || '')}</span></div>
      <b class="m-sum ${x.kind === 'in' ? 'in' : ''}">${x.kind === 'in' ? '+' : '−'}${fmtM(x.amount)}</b>
      <button class="icon-btn" data-action="m-edit" data-id="${x.id}" aria-label="Изменить">${I.edit}</button>
      <button class="icon-btn" data-action="m-del" data-id="${x.id}" aria-label="Удалить">${I.trash}</button>
    </li>`; }).join('')}</ul>` : empty(isToday ? 'Сегодня трат ещё нет' : 'В этот день записей нет');
  // разбор периода
  const days = []; for (let x = B.from; x <= B.to; x = addDays(x, 1)) days.push(x);
  const daily = days.map(x => ({ label: parseYmd(x).getDate(), v: msum(B.outs.filter(o => o.date === x)), hint: `${human(x)}: ${fmtM(msum(B.outs.filter(o => o.date === x)))}`, empty: x > ymd() }));
  const byCat = MONEY_CATS.out.map(([k, n, c]) => ({ k, n, color: c, v: msum(B.outs.filter(o => (mcat('out', o.cat)[0]) === k)) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const cats = byCat.length ? `<div class="m-cat-wrap">${donut(byCat, 150, `<b>${fmtM(B.spent)}</b><small>за месяц</small>`, (s, p) => `${s.n}: ${fmtM(s.v)} (${Math.round(p * 100)}%)`)}
      <ul class="m-cat-list">${byCat.map(x => `<li><i class="m-dot" style="--dot:${x.color}"></i><span>${x.n}</span><b>${fmtM(x.v)}</b><em>${Math.round(x.v / B.spent * 100)}%</em></li>`).join('')}</ul></div>` : empty('Траты за месяц появятся здесь');
  const passed = Math.max(1, Math.min(B.days, diffDays(B.from, ymd()) + 1));
  let i = 0;
  return `<section class="page page-budget" style="--c:var(--money)">
    ${topbar('Бюджет', `${human(B.from)} — ${human(B.to)}`, { actions: `<button class="btn btn-ghost btn-sm" data-action="budget-settings">${I.settings}Настроить</button>` })}
    ${hero}
    <div class="grid">
      ${card({ domain: 'money', title: 'Записать', span: 5, i: i++, body: add })}
      ${card({ domain: 'money', title: isToday ? 'Сегодня' : human(d), span: 7, i: i++, body: list, action: ops.length ? `<span class="chip">${ops.length} ${plural(ops.length, 'запись', 'записи', 'записей')}</span>` : '' })}
      ${card({ domain: 'money', title: 'По дням', span: 7, i: i++, body: barChart(daily, { color: 'var(--money)', target: Math.round(B.base), unit: CUR(), labelEvery: 5 }) + `<p class="hint">Линия — ровный лимит ${fmtM(B.base)} в день. В среднем тратишь ${fmtM(msum(B.outs.filter(o => o.date <= ymd())) / passed)} в день.</p>` })}
      ${card({ domain: 'money', title: 'Куда уходят деньги', span: 5, i: i++, body: cats })}
    </div>
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
// цели дня пересчитываются из плана; если калории изменились — говорим об этом, чтобы цифры не «прыгали» молча
function applyGoals(quiet = false) {
  const c = planNow(), old = num(S.settings.kcal);
  S.settings.kcal = c.kcal; S.settings.protein = c.protein;
  if (!quiet && old && Math.abs(old - c.kcal) >= 10) toast(`План пересчитан: ${fmtN(old)} → ${fmtN(c.kcal)} ккал`);
  return c;
}
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

function forecastChart(series, size = {}) {
  const all = series.flatMap(s => s.pts);
  if (all.length < 2) return empty('Запиши вес хотя бы пару раз, и здесь появится график.');
  const W = size.W || 1000, H = size.H || 300, pt = 22, pb = 28, pl = 40, pr = 12;
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

const MONP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const whenNom = weeks => { if (weeks === null || !isFinite(weeks)) return null; const d = parseYmd(addDays(ymd(), Math.round(weeks * 7))); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const whenText = weeks => { if (weeks === null || !isFinite(weeks)) return null; const d = parseYmd(addDays(ymd(), Math.round(weeks * 7))); return `${MONP[d.getMonth()]} ${d.getFullYear()}`; };
const kg = v => `${fmt1(v)} кг`;

function pageGoal() {
  if (!S.profile) return `<section class="page">${topbar('Цель', 'план и прогноз', { date: false })}
    <div class="quiz-empty"><b>План ещё не составлен.</b> Ответь на пару вопросов о себе, и журнал посчитает калории, белок и прогноз веса.
    <div class="btns"><button class="btn btn-accent" data-action="edit-profile">${I.goal}Составить план</button></div></div></section>`;
  const p = profileNow(), w = curWeight(), lv = curLevel(), si = stepsNow(), c = Plan.compute(p, w, lv, si.steps), g = Plan.GOALS[p.goal];
  const { lines } = planLines(p, w, lv, c, si);
  const f = factStats(), t = ymd();
  const start = S.profile.startWeight || w, target = p.target, dir = p.goal === 'gain' ? 1 : -1;
  const now = f.tr ? f.now : w;
  // реальный темп важнее расчётного: если есть тренд в нужную сторону — срок по нему
  const factOk = f.tr && Math.sign(f.weekly) === dir && Math.abs(f.weekly) > 0.03;
  const weeksBy = m => factOk ? (m - now) / f.weekly : Plan.weeksTo(p, now, c.kcal, lv, m, c.steps);
  let i = 0;

  /* 1. путь к цели */
  let hero;
  if (p.goal === 'maintain' || !target) {
    const ref = p.goal === 'maintain' ? start : w, dev = now - ref;
    hero = `<div class="path">
      <div class="path-top"><div><span class="path-k">${g.name}</span><h2 class="path-h">${p.goal === 'maintain' ? `Держим ≈ ${kg(ref)}` : `${kg(start)} → ?`}</h2></div>
        <div class="path-now"><b>${kg(now)}</b><span>сейчас${f.tr ? ' по тренду' : ''}</span></div></div>
      <p class="path-eta">${p.goal === 'maintain' ? (Math.abs(dev) <= 1.5 ? `Вес в коридоре ±1,5 кг — всё как задумано.` : `Вес ушёл на ${kgDiff(dev)} кг от цели — поправь калории.`) : 'Желаемый вес не указан — задай его, и появится срок и вехи.'}</p>
      ${p.goal !== 'maintain' ? `<button class="btn btn-sm" data-action="edit-profile">${I.goal}Указать желаемый вес</button>` : ''}
    </div>`;
  } else {
    const total = Math.abs(target - start), passed = Math.max(0, Math.min(total, (now - start) * dir)), pct = total ? passed / total * 100 : 0;
    const reached = (target - now) * dir <= 0;
    const etaW = reached ? null : weeksBy(target), eta = whenText(etaW), planEta = reached ? null : whenText(Plan.weeksTo(p, now, c.kcal, lv, target, c.steps));
    const step = total > 12 ? 5 : total > 5 ? 2 : 1, ms = [];
    for (let m = dir < 0 ? Math.floor((now - 0.01) / step) * step : Math.ceil((now + 0.01) / step) * step; dir < 0 ? m > target : m < target; m += dir * step) ms.push(m);
    ms.push(target);
    const miles = ms.slice(0, 4).map(m => ({ m, when: whenNom(weeksBy(m)) }));
    hero = `<div class="path">
      <div class="path-top">
        <div><span class="path-k">${g.name}</span><h2 class="path-h">${fmt1(start)} → ${fmt1(target)} кг</h2></div>
        <div class="path-now"><b>${kg(now)}</b><span>сейчас${f.tr ? ' по тренду' : ''}</span><button class="btn btn-sm" data-action="weigh">⚖ Взвеситься</button></div>
      </div>
      <div class="path-track" role="img" aria-label="Пройдено ${fmt1(passed)} из ${fmt1(total)} кг">
        <i class="path-fill" style="width:${pct}%"></i>
        <span class="path-me ${pct < 8 ? 'edge-l' : pct > 92 ? 'edge-r' : ''}" style="left:${pct}%"><b>ты здесь</b></span>
        ${ms.slice(0, -1).map(m => `<span class="path-tick" style="left:${Math.abs(m - start) / total * 100}%"><em>${fmt1(m)}</em></span>`).join('')}
      </div>
      <div class="path-ends"><span>старт ${fmt1(start)}</span><b>пройдено ${fmt1(passed)} из ${fmt1(total)} кг · ${Math.round(pct)}%</b><span>цель ${fmt1(target)}</span></div>
      <p class="path-eta">${reached ? `<b>Цель достигнута 🎉</b> Поставь новую или переключись на «держать форму».` : eta ? `Дойдёшь примерно в <b>${eta}</b>` : 'При текущем темпе цель не приближается'}${factOk && planEta && planEta !== eta ? ` <span class="muted">· по расчёту — в ${planEta}</span>` : ''}${!f.tr ? ' <span class="muted">· по расчёту, уточнится, когда накопятся замеры веса</span>' : ''}</p>
      <div class="miles">${miles.map((x, k) => `<div class="mile ${k === miles.length - 1 && x.m === target ? 'goal' : ''}"><b>${fmt1(x.m)} кг</b><span>${x.when ? `≈ ${x.when}` : '—'}</span></div>`).join('')}</div>
    </div>`;
  }

  /* 2. что делать каждый день */
  const nmz = norms(), eaten = sumMeals(mealsOn(t)).kcal, left = nmz.kcal - eaten;
  const stepGoal = num(S.settings.steps) || si.steps;
  const todaySteps = num(dayRec(t).steps);
  const daily = `<div class="dos">
    <a class="do do-kcal" href="#food"><span class="do-k">Ешь до</span><b>${fmtN(nmz.kcal)}</b><span class="do-u">ккал в день</span>
      <span class="do-today">${eaten ? (left >= 0 ? `сегодня осталось ${fmtN(left)}` : `сегодня перебор ${fmtN(-left)}`) : 'сегодня ещё ничего не записано'}</span></a>
    <a class="do do-prot" href="#food"><span class="do-k">Белок</span><b>${nmz.p}</b><span class="do-u">граммов в день</span>
      <span class="do-today">сегодня ${fmtN(sumMeals(mealsOn(t)).p)} г</span></a>
    <a class="do do-steps" href="#steps"><span class="do-k">Шаги</span><b>${fmtN(stepGoal)}+</b><span class="do-u">в день</span>
      <span class="do-today">${todaySteps ? `сегодня ${fmtN(todaySteps)}` : 'сегодня не записаны'} · в среднем ${fmtN(si.steps)}</span></a>
  </div>
  <p class="hint">Калории посчитаны так, чтобы ${p.goal === 'lose' ? `терять ≈ ${fmt2(Math.abs(c.weeklyKg))} кг в неделю` : p.goal === 'gain' ? `набирать ≈ ${fmt2(c.weeklyKg)} кг в неделю` : 'вес стоял на месте'}. Каждые +3 000 шагов — ещё ≈ ${fmtN(Plan.kcalPerStep(w, p.height) * 3000)} ккал расхода.</p>`;

  /* 3. как идёшь */
  let status;
  if (!f.tr) {
    const n = weightSeries().filter(x => x.d >= f.start).length;
    status = `<div class="verdict v-wait"><b>Пока мало данных</b><span>Нужно 3 взвешивания за неделю — сейчас ${n}. Взвешивайся утром натощак 2–3 раза в неделю, и журнал покажет реальный темп.</span></div>`;
  } else {
    const plan = c.weeklyKg, fact = f.weekly, r = plan ? fact / plan : 0;
    const v = p.goal === 'maintain' ? (Math.abs(fact) < 0.15 ? ['good', 'Вес держится'] : ['warn', fact > 0 ? 'Вес растёт' : 'Вес снижается'])
      : r < 0 ? ['bad', p.goal === 'lose' ? 'Вес растёт, а не снижается' : 'Вес снижается, а не растёт']
      : r < 0.7 ? ['warn', 'Медленнее плана'] : r > 1.4 ? ['warn', p.goal === 'lose' ? 'Быстрее плана — слишком быстро' : 'Быстрее плана — лишнее уходит в жир'] : r > 1.05 ? ['good', 'Чуть быстрее плана'] : ['good', 'Идёшь по плану'];
    const mx = Math.max(Math.abs(plan), Math.abs(fact), 0.1);
    const why = f.tdee ? (Math.abs(f.tdee - c.tdee) > 150 ? `Твой реальный расход ≈ ${fmtN(f.tdee)} ккал — ${f.tdee > c.tdee ? 'выше' : 'ниже'} расчёта (${fmtN(c.tdee)}), поэтому темп ${f.tdee > c.tdee === (p.goal === 'lose') ? 'быстрее' : 'медленнее'}.${v[0] !== 'good' || r > 1.4 ? ` Чтобы идти ровно по плану, ешь ≈ ${fmtN(Math.round((f.tdee + c.delta) / 10) * 10)} ккал.` : ''}` : `Реальный расход ≈ ${fmtN(f.tdee)} ккал — совпадает с расчётом.`) : 'Записывай еду каждый день — тогда журнал посчитает твой реальный расход.';
    status = `<div class="verdict v-${v[0]}"><b>${v[1]}</b><span>За ${f.tr.span} дн. ${dir < 0 ? (f.weekly < 0 ? 'ушло' : 'прибавилось') : (f.weekly > 0 ? 'прибавилось' : 'ушло')} ≈ ${kg(Math.abs(f.weekly * f.tr.span / 7))}.</span></div>
      <div class="pace">
        <div class="pace-row"><span>План</span><i class="pace-bar"><b style="width:${Math.abs(plan) / mx * 100}%;background:var(--orange)"></b></i><em>${kgWeek(plan)}</em></div>
        <div class="pace-row"><span>Факт</span><i class="pace-bar"><b style="width:${Math.abs(fact) / mx * 100}%;background:var(--navy)"></b></i><em>${kgWeek(fact)}</em></div>
      </div>
      <p class="pace-why">${why}</p>`;
  }

  /* 4. график */
  const st = S.profile.start || t;
  const hist = weightSeries().filter(x => x.d >= addDays(t, -120));
  const planSim = Plan.simulate(p, start, c.kcal, lv, Math.max(12, Math.ceil(diffDays(st, t) / 7) + 8), c.steps);
  const planPts = planSim.map((v, k) => ({ d: addDays(st, k * 7), v })).filter(x => x.d <= addDays(t, 56));
  const factPts = f.tr ? [{ d: t, v: f.now }, { d: addDays(t, 56), v: f.now + f.weekly * 8 }] : [];
  const chart = forecastChart([
    { name: 'по плану', pts: p.goal === 'maintain' ? [] : planPts, color: 'var(--orange)', dash: '6 6', w: 2 },
    { name: 'если так пойдёт дальше', pts: factPts, color: 'var(--gym)', dash: '2 5', w: 3 },
    { name: 'твой вес', pts: hist, color: 'var(--navy)', dots: true }
  ], { W: 620, H: 330 });

  /* 5. активность недели */
  const acts = Object.entries(Plan.ACTIVITY).map(([k, a]) => {
    const kc = Plan.compute(p, w, k, si.steps).kcal;
    return `<button class="act ${k === lv ? 'on' : ''}" data-action="set-level" data-v="${k}"><b>${a.name}</b><span>${a.hint}</span><em>${fmtN(kc)} ккал</em></button>`;
  }).join('');

  return `<section class="page goal-page" style="--c:var(--orange)">
    ${topbar('Цель', `${g.name.toLowerCase()} · ${Plan.PACE[p.goal]?.[p.pace]?.name.toLowerCase() || 'поддержка'} темп`, { date: false, actions: `<button class="btn" data-action="edit-profile">${I.edit}Изменить цель</button>` })}
    <div class="grid">
      ${card({ domain: 'paper', title: 'Путь к цели', span: 12, i: i++, body: hero })}
      ${card({ domain: 'food', title: 'Что делать каждый день', span: 12, i: i++, body: daily })}
      ${card({ domain: 'paper', title: 'Как идёшь', span: 5, i: i++, body: status })}
      ${card({ domain: 'paper', title: 'Вес', span: 7, i: i++, body: chart })}
      ${card({ domain: 'gym', title: `Активность на этой неделе · с ${human(mondayOf(t))}`, span: 12, i: i++, body: `<div class="acts">${acts}</div>
        <p class="hint">Выбери, сколько тренировок будет на неделе — калории пересчитаются. Шаги учитываются отдельно: ${si.measured ? `в среднем ${fmtN(si.steps)} в день за ${si.days} дн.`.replace(/\.$/, '') : `пока оценка ${fmtN(si.steps)} в день — записывай шаги, и план возьмёт реальные`}. В понедельник спрошу снова.</p>` })}
      ${card({ domain: 'paper', title: 'Подробнее', span: 12, i: i++, body: `
        <details class="more-block"><summary>Почему такие цифры</summary><ul class="goal-lines goal-how">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
          <p class="hint">Формулы ошибаются на ±10% для конкретного человека, поэтому журнал сверяет расчёт с твоими замерами веса и записями еды.
          Источники: <a href="https://pubmed.ncbi.nlm.nih.gov/15883556/" target="_blank" rel="noopener">Frankenfield 2005</a>, <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC3859816/" target="_blank" rel="noopener">Hall и Chow 2013</a>, <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/" target="_blank" rel="noopener">ISSN 2017</a>.</p></details>
        <details class="more-block"><summary>Профиль</summary><div class="chips" style="margin-top:10px">
          <span class="chip"><b>${p.sex === 'm' ? 'Мужчина' : 'Женщина'}</b></span><span class="chip"><b>${p.age}</b> лет</span><span class="chip"><b>${p.height}</b> см</span>
          <span class="chip">ИМТ <b>${fmt1(c.bmi)}</b></span><span class="chip">жир <b>${Math.round(c.bf)}%</b>${c.bfMeasured ? '' : ' (оценка)'}</span>
          <span class="chip">${Plan.BUILD[p.build].name}</span><span class="chip">стаж: ${Plan.EXPERIENCE[p.experience].name.toLowerCase()}</span>
          <span class="chip">обмен в покое <b>${fmtN(c.bmr)}</b> ккал</span><span class="chip">расход в день <b>${fmtN(c.tdee)}</b> ккал</span></div>
          <button class="btn btn-sm" style="margin-top:12px" data-action="edit-profile">${I.edit}Изменить данные</button></details>` })}
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
      return opt('pace', k, d.pace, x.name, `${c.delta < 0 ? '−' : '+'}${fmtN(Math.abs(c.delta))} ккал в день · ${kgWeek(c.weeklyKg)}${Math.abs(Math.abs(c.delta) - x.kcal) > 20 ? ' (урезано до безопасного)' : ''}`);
    }).join('')}</div>
      ${field('Желаемый вес, кг (необязательно)', inp('target', d.goal === 'lose' ? 'например ' + Math.round(wt * 0.85) : 'например ' + Math.round(wt * 1.05)))}`;
    body = `<div class="opts opts-3">${Object.entries(Plan.GOALS).map(([k, g]) => opt('goal', k, d.goal, g.name, g.hint)).join('')}</div>${pace}
      <p class="wiz-live" id="wiz-live">${wizLive()}</p>`;
  } else {
    const p = { ...wizProfile(d) }, wt = num(d.weight), c = Plan.compute(p, wt, d.level);
    const { lines } = planLines(p, wt, d.level, c);
    head = ['Твой план', 'Это стартовая оценка. Через пару недель записей веса и еды журнал сверит её с фактом и поправит.'];
    body = `<div class="kpis">
        ${kpi('Калории в день', fmtN(c.kcal), 'paper', 0, `поддержка ${fmtN(c.tdee)}`)}
        ${kpi('Белок', `${c.protein}<small>г</small>`, 'food', 1, `жиры ${c.fat} · углеводы ${c.carbs}`)}
        ${kpi('Темп', kgWeek(c.weeklyKg).replace(' кг/нед', '') + '<small>кг/нед</small>', 'gym', 2, d.goal === 'maintain' ? 'держим вес' : 'без доп. активности')}
      </div><details class="more-block"><summary>Почему такие цифры</summary><ul class="goal-lines goal-how">${lines.map(l => `<li>${l}</li>`).join('')}</ul></details>`;
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
  if (!prev) S.settings.steps = Math.max(5000, Math.round(num(d.steps) / 500) * 500 || 6000);
  // вес пишем в сегодняшний день, только если его ввели заново, — иначе это ложный замер, который портит тренд
  if (!prev || Math.abs(wt - curWeight()) >= 0.05) S.days[t] = { ...dayRec(t), weight: wt };
  const c = applyGoals(true);
  if (!prev) S.settings.starter = true;
  view.wizard = null; save();
  const to = prev ? '#goal' : '#today';
  if (location.hash !== to) location.hash = to; else render();
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
    ${topbar('Настройки', 'аккаунт, цели, данные', { date: false })}
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
// открытое окно — отдельный шаг истории: «Назад» на телефоне закрывает окно, а не уходит со страницы
let modalStep = false, ignorePop = false;
new MutationObserver(() => {
  const open = !!$('#modal-root .overlay');
  if (open && !modalStep) { modalStep = true; history.pushState({ modal: 1 }, ''); }
}).observe(document.getElementById('modal-root'), { childList: true });
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  if (modalStep) { modalStep = false; if ($('#modal-root .overlay')) closeModal('pop'); }
});
// how: 'user' — закрыл сам (шаг истории убираем), 'pop' — «Назад», 'swap' — окно сменяется другим, 'nav' — переход по странице
function closeModal(how = 'user') {
  if (modalStep && how === 'user') { modalStep = false; ignorePop = true; history.back(); }
  else if (how === 'nav') modalStep = false;
  ph = null; rd = null;
  const root = $('#modal-root'); if (!root.innerHTML) return;
  root.classList.remove('open');
  const html = root.innerHTML;
  // чистим, только если за это время не открыли новое окно
  setTimeout(() => { if (root.innerHTML === html && !root.classList.contains('open')) root.innerHTML = ''; }, reduceMotion ? 0 : 220);
}
/* Удаление с возможностью вернуть: убранные записи кладутся обратно на свои места */
function undoToast(msg, undo) {
  const el = document.createElement('div'); el.className = 'toast toast-undo'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span><button type="button">Вернуть</button>`;
  let used = false;
  el.querySelector('button').addEventListener('click', () => { if (used) return; used = true; undo(); save(); render(); el.remove(); toast('Вернул'); });
  $('#toast-root').appendChild(el); setTimeout(() => el.remove(), 6500);
}
function removeItems(key, pred, msg, extra = {}) {
  const removed = S[key].map((x, i) => [i, x]).filter(([, x]) => pred(x));
  if (!removed.length) return;
  const snap = extra.snapshot ? extra.snapshot() : null;
  S[key] = S[key].filter(x => !pred(x)); extra.after?.();
  save(); render();
  undoToast(msg, () => { for (const [i, x] of removed) S[key].splice(Math.min(i, S[key].length), 0, x); if (snap) extra.restore(snap); });
}
function toast(msg, err = false) {
  const el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg;
  $('#toast-root').appendChild(el); setTimeout(() => el.remove(), 3300);
}

/* ============================================================
   ДЕЙСТВИЯ
   ============================================================ */
const ACTIONS = {
  'm-kind': el => { view.mKind = el.dataset.v; render(); $('.m-form [name=amount]')?.focus(); },
  'm-edit': el => {
    const x = S.money.find(m => m.id === el.dataset.id); if (!x) return;
    openModal({ title: x.kind === 'in' ? 'Доход' : 'Расход', accent: 'var(--money)', form: 'money', body: `<div class="m-form">${moneyFields(x)}</div>` });
  },
  'm-del': el => { const x = S.money.find(m => m.id === el.dataset.id); if (x) removeItems('money', m => m.id === x.id, `${x.kind === 'in' ? 'Доход' : 'Расход'} ${fmtM(x.amount)} удалён`); },
  'budget-settings': () => openModal({ title: 'Бюджет', accent: 'var(--money)', form: 'budget-set', body: budgetSetupForm() }),
  'date': el => { view.date = addDays(view.date, +el.dataset.n); view.calMonth = null; render(); },
  'date-today': () => { view.date = ymd(); view.calMonth = null; render(); },
  'cal-month': el => { const [y, m] = (view.calMonth || view.date.slice(0, 7)).split('-').map(Number); const dt = new Date(y, m - 1 + +el.dataset.n, 1); view.calMonth = `${dt.getFullYear()}-${z(dt.getMonth() + 1)}`; render(); },
  'cal-day': el => { view.date = el.dataset.d; view.calMonth = el.dataset.d.slice(0, 7); render(); },
  'range': el => { view.range = +el.dataset.n; render(); },
  'close-modal': (el, e) => { if (el.classList.contains('overlay') && e.target !== el) return; closeModal(); },
  'add-meal': () => mealForm(),
  'add-drink': () => drinkForm(),
  'add-text': () => startText(),
  'food-tab': el => { view.foodTab = el.dataset.v; setSub(el.dataset.v); window.scrollTo({ top: 0, behavior: 'instant' }); render(); },
  'gap-more': () => { view.gapMore = !view.gapMore; render(); },
  'nudge-off': el => { view.nudgeOff = { ...(view.nudgeOff || {}), [el.dataset.k]: true }; render(); },
  'use-set': el => { const st = S.sets.find(x => x.id === el.dataset.id); if (!st) return; useSet(st); save(); render(); toast(`«${st.name}» — записано, ${fmtN(setKcal(st))} ккал`); },
  'del-set': el => { const st = S.sets.find(x => x.id === el.dataset.id); if (st) removeItems('sets', x => x.id === st.id, `Набор «${st.name}» удалён`); },
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
  'del-drink': el => { const x0 = S.drinks.find(x => x.id === el.dataset.id); if (x0) removeItems('drinks', x => x.id === x0.id, `${drinkName(x0)} ${fmtN(x0.ml)} мл — удалено`); },
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
  'del-meal': el => { const m = S.meals.find(x => x.id === el.dataset.id); if (m) removeItems('meals', x => x.id === m.id, `«${baseName(m.name)}» удалено`); },
  'del-study': el => {
    const id = el.dataset.id, st = S.study.find(x => x.id === id); if (!st) return;
    removeItems('study', x => x.id === id, `Занятие «${st.topic}» удалено`, {
      snapshot: () => ({ srs: Object.fromEntries(Object.entries(S.srs).filter(([k]) => k.startsWith(id + ':'))), quizzes: structuredClone(S.quizzes) }),
      after: () => { Object.keys(S.srs).forEach(k => { if (k.startsWith(id + ':')) delete S.srs[k]; }); for (const q of Object.values(S.quizzes)) q.items = q.items.filter(i => i.result || !String(i.cardId).startsWith(id + ':')); },
      restore: snap => { Object.assign(S.srs, snap.srs); S.quizzes = snap.quizzes; }
    });
  },
  'del-gym': el => { const w = S.workouts.find(x => x.id === el.dataset.id); if (w) removeItems('workouts', x => x.id === w.id, `Тренировка «${w.type}» удалена`); },
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
  'tl-add': (el, e) => {
    const r = el.getBoundingClientRect(), x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const m = Math.min(23 * 60 + 45, Math.round((+el.dataset.start + x * +el.dataset.span) / 15) * 15);
    view.presetTime = `${z(Math.floor(m / 60))}:${z(m % 60)}`;
    ({ food: () => mealForm(), drink: () => drinkForm(), study: () => studyForm(), gym: () => gymForm(), quiz: () => { view.presetTime = null; location.hash = '#quiz'; }, task: () => { const tm = view.presetTime; view.presetTime = null; taskForm(null, view.date); setTimeout(() => { const f = $('#modal-root [data-form=task]'); if (f) f.time.value = tm; }, 0); } })[el.dataset.k]?.();
  },
  'tl-open': () => {},
  'weigh': () => {
    const t = ymd(), last = curWeight ? (S.profile ? curWeight() : 0) : 0;
    openModal({ title: 'Вес сегодня', accent: 'var(--navy)', form: 'weigh', submit: 'Записать',
      body: `<input class="big-input" name="weight" type="number" step="0.1" min="30" max="350" inputmode="decimal" value="${num(dayRec(t).weight) || ''}" placeholder="${last ? `последний: ${fmt1(last)}` : 'кг'}" required>
        <p class="hint" style="margin:0">Лучше утром натощак, 2–3 раза в неделю — так тренд точнее.</p>` });
  },
  'diary-all': () => { view.diaryAll = !view.diaryAll; render(); },
  'starter-off': () => { S.settings.starter = false; save(); render(); },
  'focus-task': () => { const i = $('[data-comp=today][data-f=title]'); if (i) { i.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => i.focus(), 300); } else location.hash = '#plans'; },
  'plan-day': el => { view.planDay = el.dataset.d || null; render(); },
  'comp-date': el => { const c = view.comp[el.dataset.scope]; c.date = el.dataset.d || null; render(); requestAnimationFrame(() => $(`[data-comp="${el.dataset.scope}"][data-f=title]`)?.focus()); },
  'comp-prio': el => { const c = view.comp[el.dataset.scope]; c.prio = !c.prio; render(); },
  'comp-note': el => { const c = view.comp[el.dataset.scope]; c.noteOpen = !c.noteOpen; render(); if (c.noteOpen) requestAnimationFrame(() => $(`[data-comp="${el.dataset.scope}"][data-f=note]`)?.focus()); },
  'comp-add': el => compAdd(el.dataset.scope),
  'comp-opts': el => { const c = view.comp[el.dataset.scope]; c.optsOpen = !c.optsOpen; render(); },
  'plan-kind': el => { view.planKind = el.dataset.v; setSub(el.dataset.v); render(); },
  'plan-shift': el => { const k = view.planKind || 'week'; view.planDate = shiftDate(k, view.planDate || ymd(), +el.dataset.n); render(); },
  'plan-now': () => { view.planDate = ymd(); render(); },
  'plan-go': el => { view.planKind = el.dataset.kind; view.planDate = el.dataset.d; render(); },
  'plan-open-week': el => { view.planKind = 'week'; view.planDate = el.dataset.d; view.planDay = el.dataset.d; render(); },
  'goal-add': el => goalForm(null, el.dataset.kind, el.dataset.key),
  'goal-edit': el => { const g = S.goals.find(x => x.id === el.dataset.id); if (g) goalForm(g); },
  'goal-toggle': el => { const g = S.goals.find(x => x.id === el.dataset.id); if (!g) return; g.done = !g.done; save(); render(); if (g.done) toast(`Цель выполнена: ${g.title}`); },
  'goal-del': el => {
    const g = S.goals.find(x => x.id === el.dataset.id); if (!g) return; closeModal();
    removeItems('goals', x => x.id === g.id, `Цель «${g.title}» удалена`, {
      snapshot: () => ({ kids: S.goals.filter(x => x.parentId === g.id).map(x => x.id), tasks: S.tasks.filter(t => t.goalId === g.id).map(t => t.id) }),
      after: () => { S.goals.forEach(x => { if (x.parentId === g.id) x.parentId = null; }); S.tasks.forEach(t => { if (t.goalId === g.id) t.goalId = null; }); },
      restore: snap => { S.goals.forEach(x => { if (snap.kids.includes(x.id)) x.parentId = g.id; }); S.tasks.forEach(t => { if (snap.tasks.includes(t.id)) t.goalId = g.id; }); }
    });
  },
  'task-toggle': el => { const t = S.tasks.find(x => x.id === el.dataset.id); if (!t) return; t.done = !t.done; t.doneAt = t.done ? new Date().toISOString() : null; save(); render(); },
  'task-edit': el => { const t = S.tasks.find(x => x.id === el.dataset.id); if (t) taskForm(t); },
  'task-del': el => { const t = S.tasks.find(x => x.id === el.dataset.id); closeModal(); if (t) removeItems('tasks', x => x.id === t.id, `Задача «${t.title}» удалена`); },
  'task-day': el => { const f = el.closest('form'); f.date.value = el.dataset.d; f.querySelectorAll('[data-action=task-day]').forEach(b => b.classList.toggle('on', b === el)); },
  'tasks-to-today': () => { const t = ymd(), od = overdueTasks(); od.forEach(x => { x.date = t; }); save(); render(); toast(`Перенесено на сегодня: ${od.length}`); },
  'rd-open': el => openReader(el.dataset.rel, el.dataset.h || '', view.studyQ || ''),
  'rd-jump': el => { const t = $('.rd-body #' + headId(el.dataset.h)); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
  'rd-link': (el, e) => {
    e.preventDefault();
    const note = el.dataset.note, h = el.dataset.h;
    if (!note) { const t = $('.rd-body #' + headId(h)); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    const hit = (view.library || []).find(n => n.rel.replace(/\.md$/, '').endsWith(note) || n.title === note);
    if (hit) openReader(hit.rel, h); else toast(`Заметка «${note}» не найдена в хранилище`, true);
  },
  'q-check': async el => {
    const d = quizDay(), q = S.quizzes[d], it = q?.items[+el.dataset.k]; if (!it) return render();
    const ta = document.querySelector(`[data-qans="${el.dataset.k}"]`); it.answer = (ta?.value || it.answer || '').trim();
    if (!it.answer) { toast('Сначала напиши ответ — или нажми «Не знаю»', true); return; }
    el.classList.add('busy');
    try {
      it.check = await apiFetch('/api/study/check', { method: 'POST', body: JSON.stringify({ question: plainText(it.q), reference: plainText(it.a), answer: it.answer, noteId: it.noteId, key: it.key, context: (() => { const c = allCards().find(x => x.id === it.cardId); return c && c.type !== 'obs' && c.session.notes ? c.session.notes.join('\n').slice(0, 1500) : ''; })() }) });
      it.revealed = true; save(); render();
    } catch (e) { el.classList.remove('busy'); toast(e.message, true); }
  },
  'quiz-note': el => {
    const d = ymd(), have = new Set((S.quizzes[d]?.items || []).map(i => i.cardId));
    const pool = withState().filter(c => c.noteId === el.dataset.id && !have.has(c.id));
    if (!pool.length) { toast(have.size ? 'Все вопросы этого конспекта уже в сегодняшних' : 'Вопросы по этому конспекту ещё готовятся', true); if (have.size) location.hash = '#quiz'; return; }
    const r = rng(hash(d + el.dataset.id + Date.now()));
    const items = shuffle(pool, r).slice(0, QUIZ_SIZE).map(c => quizItemFrom(c, r));
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
  'reveal': el => { const q = S.quizzes[quizDay()]; if (!q) return render(); q.items[+el.dataset.k].revealed = true; save(); render(); },
  'grade': el => {
    const q = S.quizzes[quizDay()], it = q?.items[+el.dataset.k]; if (!it) return render();
    it.result = el.dataset.g; it.at = nowHM(); gradeCard(it.cardId, el.dataset.g); save(); render();
  },
  'quiz-early': () => { const d = ymd(); const pool = soonestCards(5, d); if (!pool.length) return; S.quizzes[d] = buildQuiz(d, pool); save(); render(); },
  'quiz-more': () => { const d = ymd(), q = S.quizzes[d]; const have = new Set(q.items.map(i => i.cardId)); const pool = dueCards(d).filter(c => !have.has(c.id)); const extra = buildQuiz(d + ':' + q.items.length, pool); q.items.push(...extra.items); save(); render(); },
  'export': () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bortjournal-${ymd()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('Файл сохранён');
  },
  'wipe': () => { if (!confirm('Стереть все записи без возможности восстановления?')) return; if (!confirm('Точно? Экспорт сделан?')) return; S = structuredClone(DEF); save(); render(); toast('Чисто'); },
  'logout': async () => {
    await flush();
    try { await apiFetch('/api/logout', { method: 'POST', body: '{}' }); } catch { /* всё равно выходим */ }
    history.replaceState(null, '', '#today'); showAuth();
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
  'set-level': el => { S.activity[mondayOf(ymd())] = el.dataset.v; const c = applyGoals(true); save(); render(); toast(`Цели на неделю: ${fmtN(c.kcal)} ккал, белок ${c.protein} г`); }
};

const FORMS = {
  'budget-set'(fd) {
    const amount = parseAmount(fd.get('amount'));
    if (amount <= 0) { toast('Введи сумму на месяц', true); return; }
    S.budget = { amount, start: Math.min(28, Math.max(1, +fd.get('start') || 1)), save: Math.max(0, parseAmount(fd.get('save'))), cur: String(fd.get('cur') || '₼').slice(0, 3) };
    save(); closeModal(); render(); toast(`Сегодня можно ${fmtM(budgetDay(ymd()).leftToday)}`);
  },
  money(fd) {
    const amount = parseAmount(fd.get('amount'));
    if (amount <= 0) { toast('Введи сумму', true); return; }
    const old = fd.get('id'), id = old || uid(), kind = fd.get('kind') === 'in' ? 'in' : 'out';
    const x = { id, date: fd.get('date') || view.date, time: old ? String(fd.get('time') || '') : (view.date === ymd() ? nowHM() : ''), kind, cat: mcat(kind, fd.get('cat'))[0], amount, note: String(fd.get('note') || '').trim().slice(0, 80) };
    const idx = S.money.findIndex(m => m.id === id);
    if (idx >= 0) S.money[idx] = x; else S.money.push(x);
    save(); if (old) closeModal(); render();
    if (old) toast('Сохранено');
    else { const B = budgetDay(x.date); toast(kind === 'in' ? `+${fmtM(amount)} к бюджету месяца` : B.leftToday >= 0 ? `Осталось на сегодня ${fmtM(B.leftToday)}` : `Перерасход ${fmtM(-B.leftToday)} — завтра ${fmtM(B.tomorrow ?? 0)}`); $('.m-form [name=amount]')?.focus(); }
  },
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
    if (S.profile && d === ymd()) applyGoals();
    save(); closeModal(); render(); toast('Сохранено');
  },
  settings(fd) {
    Object.assign(S.settings, { name: String(fd.get('name') || '').trim(), kcal: num(fd.get('kcal')) || 2200, protein: num(fd.get('protein')), steps: num(fd.get('steps')) || 10000, study: num(fd.get('study')) || 60 });
    save(); render(); toast('Цели обновлены');
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
  goal(fd) {
    const id = fd.get('id'), title = String(fd.get('title') || '').trim(); if (!title) return;
    const g = id ? S.goals.find(x => x.id === id) : { id: uid(), period: fd.get('kind'), key: fd.get('key'), done: false, created: ymd() };
    Object.assign(g, { title, parentId: fd.has('parentId') ? fd.get('parentId') || null : (g.parentId || null), note: String(fd.get('note') || '').trim() });
    if (!id) S.goals.push(g);
    save(); closeModal(); render(); toast(id ? 'Сохранено' : 'Цель добавлена');
  },
  task(fd) {
    const id = fd.get('id'), title = String(fd.get('title') || '').trim(); if (!title) return;
    const t = id ? S.tasks.find(x => x.id === id) : { id: uid(), done: false, created: ymd() };
    Object.assign(t, { title, date: fd.get('date') || null, time: fd.get('time') || '', goalId: fd.has('goalId') ? fd.get('goalId') || null : (t.goalId || null), prio: fd.get('prio') === 'on', note: String(fd.get('note') || '').trim() });
    if (!id) S.tasks.push(t);
    save(); closeModal(); render(); toast(id ? 'Сохранено' : `Задача на ${t.date ? relDay(t.date) : 'без даты'}`);
  },
  weigh(fd) {
    const t = ymd(), w = num(fd.get('weight'));
    if (!(w >= 30 && w <= 350)) { toast('Вес — в килограммах, от 30 до 350', true); return; }
    S.days[t] = { ...dayRec(t), weight: Math.round(w * 10) / 10 };
    if (S.profile) applyGoals();
    save(); closeModal(); render(); toast(`Вес ${fmt1(w)} кг записан`);
  },
  week(fd) {
    const t = ymd(), w = num(fd.get('weight'));
    S.activity[mondayOf(t)] = String(fd.get('level') || curLevel());
    if (w >= 35 && w <= 300) S.days[t] = { ...dayRec(t), weight: w };
    const c = applyGoals(true); save(); closeModal(); render();
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
  if (t.dataset.comp && ['title', 'note'].includes(t.dataset.f)) { const c = view.comp?.[t.dataset.comp]; if (c) c[t.dataset.f] = t.value; }
  if (t.dataset.search !== undefined) { clearTimeout(searchTimer); const v = t.value; searchTimer = setTimeout(() => runSearch(v), 250); }
  if (t.dataset.rdFind !== undefined) { clearTimeout(searchTimer); const v = t.value; searchTimer = setTimeout(() => rdFind(v), 250); }
  if (t.dataset.qans !== undefined) { const it = S.quizzes[quizDay()]?.items[+t.dataset.qans]; if (it) it.answer = t.value; }
  if (t.dataset.dmin !== undefined) { const v = Math.max(0, Math.round(num(t.value))); if (v) S.studyTime[t.dataset.dmin] = { m: v, d: t.dataset.dd }; else delete S.studyTime[t.dataset.dmin]; save(); }
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
  if (t.dataset.comp && ['date', 'time', 'goalId'].includes(t.dataset.f)) { const c = view.comp?.[t.dataset.comp]; if (c) { c[t.dataset.f] = t.value || (t.dataset.f === 'date' ? c.date : ''); render(); } return; }
  if (t.dataset.rdSec !== undefined && t.value) { const h = $('.rd-body #' + headId(t.value)); if (h) h.scrollIntoView({ block: 'start', behavior: 'smooth' }); t.value = ''; return; }
  if (t.dataset.photo !== undefined && t.files[0]) { startPhoto(t.files[0]); t.value = ''; return; }
  if (t.dataset.import !== undefined && t.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.meals) || !Array.isArray(d.study)) throw new Error('не похоже на экспорт Бортжурнала');
        if (!confirm('Заменить текущие данные импортированными?')) return;
        const clean = normalize(d); clean.quizzes = {}; // вопросы дня пересоберутся сами
        S = clean; save(); render(); toast('Импортировано');
      } catch (err) { toast(`Импорт не удался: ${err.message}`, true); }
    };
    r.readAsText(t.files[0]); t.value = '';
  }
});
document.addEventListener('focusin', e => {
  const sc = e.target.dataset?.comp; if (!sc || e.target.dataset.f !== 'title') return;
  const c = view.comp?.[sc]; if (c && !c.open && sc !== 'today') { c.open = true; e.target.closest('.composer')?.classList.add('open'); }
});
// чип «Дата» в строке создания сразу открывает выбор даты
document.addEventListener('click', e => { const l = e.target.closest?.('.opt-date'); if (!l || e.target.tagName === 'INPUT') return; e.preventDefault(); const i = l.querySelector('input'); try { i.showPicker(); } catch { i.focus(); } });
let dragTask = null;
document.addEventListener('dragstart', e => { const el = e.target.closest?.('[data-task]'); if (!el) return; dragTask = el.dataset.task; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragTask); el.classList.add('dragging'); });
document.addEventListener('dragend', e => { e.target.closest?.('[data-task]')?.classList.remove('dragging'); document.querySelectorAll('.drop-over').forEach(x => x.classList.remove('drop-over')); dragTask = null; });
document.addEventListener('dragover', e => { const z = dragTask && e.target.closest?.('[data-drop]'); if (!z) return; e.preventDefault(); document.querySelectorAll('.drop-over').forEach(x => x !== z && x.classList.remove('drop-over')); z.classList.add('drop-over'); });
document.addEventListener('drop', e => {
  const z = dragTask && e.target.closest?.('[data-drop]'); if (!z) return;
  e.preventDefault();
  const t = S.tasks.find(x => x.id === dragTask); if (!t) return;
  t.date = z.dataset.drop || null; save(); render();
  toast(`«${t.title}» → ${t.date ? `${relDay(t.date)}, ${human(t.date)}` : 'без даты'}`);
});
document.addEventListener('keydown', e => {
  if (e.target.dataset?.comp && e.target.dataset.f === 'title' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); compAdd(e.target.dataset.comp); return; }
  const qt = e.target.dataset?.qtask;
  if (qt !== undefined && e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    const t = addTaskFromText(e.target.value, qt || null);
    if (t) { save(); render(); requestAnimationFrame(() => document.querySelector(`[data-qtask="${qt}"]`)?.focus()); }
    return;
  }
  if (e.key === 'Escape') closeModal();
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { const f = $('#modal-root form'); if (f) f.requestSubmit(); }
});

/* ============================================================
   ВХОД И ЗАПУСК
   ============================================================ */
let authMode = 'login';
let regOpen = null, stash = null;
function showAuth(msg = '') {
  // несохранённые правки не выбрасываем: после входа наложим их поверх данных с сервера
  if (me && dirty) stash = { user: me, state: JSON.stringify(S), base };
  me = null; rev = 0; dirty = false; clearTimeout(saveTimer); S = structuredClone(DEF); view.wizard = null;
  if (regOpen === null) apiFetch('/api/config').then(c => { regOpen = !!c.register; if (c.firstRun) authMode = 'register'; if (!me) showAuth(msg); }).catch(() => {});
  if (regOpen === false) authMode = 'login';
  document.body.classList.remove('setup-mode');
  document.body.classList.add('auth-mode');
  const reg = authMode === 'register';
  $('#main').innerHTML = `<section class="page auth">
    <div class="auth-hero">
      <div class="auth-kicker">Бортжурнал</div>
      <h1>Еда, учёба, зал и шаги в одном журнале</h1>
      <p>Записи хранятся на твоём сервере, поэтому их видно с любого твоего устройства, где ты войдёшь.</p>
    </div>
    <form class="auth-card" data-form="auth" novalidate>
      ${regOpen ? `<div class="seg" role="tablist">
        <button type="button" class="${reg ? '' : 'on'}" data-action="auth-mode" data-mode="login">Вход</button>
        <button type="button" class="${reg ? 'on' : ''}" data-action="auth-mode" data-mode="register">Регистрация</button>
      </div>` : ''}
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
  const before = JSON.stringify(OBS);
  try { OBS = await apiFetch('/api/obsidian'); } catch { OBS = { enabled: false, notes: [], diary: [] }; }
  OBS.notes = OBS.notes || []; OBS.diary = OBS.diary || [];
  // перерисовываем, только если что-то изменилось и человек ничего не печатает
  if (rerender && JSON.stringify(OBS) !== before && ['study', 'quiz', 'today'].includes(view.page) && !$('#modal-root .overlay') && !typingNow()) render();
}
// пока открыта учёба или вопросы — подтягиваем свежие вопросы, которые сервер генерирует в фоне
setInterval(() => { if (me && !document.hidden && ['study', 'quiz'].includes(view.page)) loadObs(true); }, 30e3);
async function loadState() {
  const r = await apiFetch('/api/state');
  rev = r.rev; S = normalize(r.state); base = JSON.stringify(S); checkDay();
  if (r.state && r.state.settings && 'apiKey' in r.state.settings) save(); // убрать старый ключ Claude с сервера
  if (migrateCardIds()) save();
  // план на сегодня — по свежим данным (вес, шаги, активность недели)
  if (S.profile) { const old = num(S.settings.kcal), c = applyGoals(true); if (old !== c.kcal) { save(); if (old) setTimeout(() => toast(`План пересчитан: ${fmtN(old)} → ${fmtN(c.kcal)} ккал`), 600); } }
  if (stash && stash.user === me) { S = normalize(merge3(stash.base ? JSON.parse(stash.base) : S, JSON.parse(stash.state), S)); save(); toast('Несохранённые правки восстановлены'); }
  stash = null;
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
