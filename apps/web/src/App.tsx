/**
 * Каркас: вход → анкета (если не пройдена) → экраны с нижней панелью.
 * Один лист снизу на все формы. Платное без Pro открывает экран тарифов.
 * Данные дня кэшируются по дате; действия срабатывают на экране сразу,
 * удаление отправляется через 5 секунд, если не нажали «Вернуть».
 */
import { can } from './lib/features';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays } from '@bortjournal/core';
import { api, ApiError, flushOutbox, forgetLocal, fromCache, pendingCount, setOwner, type Drink, type FoodDay, type FoodDraft, draftPending, type Meal, type Me, type Subscription, type TaskFull, type Today as TodayData } from './lib/api';
import { fmt, fmt1, plural } from './lib/format';
import { buzz } from './lib/motion';
import { DrinkForm, MealForm, NumberForm, TaskForm } from './components/Forms';
import { FoodAi, FoodSearch } from './components/FoodPro';
import { Icon } from './components/Icon';
import { Paywall } from './components/Paywall';
import { Sheet } from './components/Sheet';
import { useToast } from './components/Toasts';
import type { Mark } from './components/Timeline';
import { Food } from './screens/Food';
import { Login } from './screens/Login';
import { InstallHelp, More, SettingsForm } from './screens/More';
import { Onboarding } from './screens/Onboarding';
import { Plans } from './screens/Plans';
import { Goal } from './screens/Goal';
import { Gym } from './screens/Gym';
import { Budget } from './screens/Budget';
import { Books } from './screens/Books';
import { Study } from './screens/Study';
import { Profile } from './screens/Profile';
import { takeAuthResult } from './lib/oauth';
import { Reminders } from './components/Reminders';
import { VoiceCapture } from './components/Voice';
import { AiConsent } from './components/AiConsent';
import { FeedbackForm } from './components/Feedback';
import { Boundary } from './components/Boundary';
import { DemoBanner } from './components/DemoBanner';
import { setSex } from './lib/gender';
import { Admin } from './screens/Admin';
import { ResetPassword } from './screens/Reset';
import { Stats, type StatsTab } from './screens/Stats';
import { TodayWide } from './screens/TodayWide';
import { useWide } from './lib/wide';
import { applyTheme, type Theme } from './lib/theme';

const TABS: Array<[string, string, string]> = [['today', 'today', 'Сегодня'], ['plans', 'plans', 'Планы'], ['add', 'plus', 'Записать'], ['food', 'food', 'Еда'], ['more', 'more', 'Ещё']];
/** ссылка из напоминания «Фото разобрано»: #food?draft=<id> */
const GCAL_BACK: Record<string, [string, boolean]> = { connected: ['Google Календарь подключён — задачи появятся в календаре «Lumi» через пару минут', false], denied: ['Доступ к календарю не выдан', true], failed: ['Не получилось подключить календарь — попробуй ещё раз', true] };
const draftLink = (h: string) => /^food\?draft=([0-9a-f-]{36})$/.exec(h)?.[1] ?? null;
const ORDER = ['today', 'plans', 'food', 'study', 'gym', 'budget', 'books', 'goal', 'stats', 'more', 'profile', 'settings', 'admin'];
// разделы, открываемые поверх вкладок (на телефоне — с кнопкой «назад»); платные — с ключом своего набора
const SECTIONS: Record<string, string | null> = { goal: null, stats: null, study: 'study', gym: 'gym', budget: 'budget', books: 'books' };
const SECTION_NAME: Record<string, string> = { study: 'Учёба', gym: 'Зал', budget: 'Бюджет', books: 'Книги' };
// на компьютере в панели — и переехавшие разделы Pro
const WIDE_TABS: Array<[string, string, string]> = [['today', 'today', 'Сегодня'], ['plans', 'plans', 'Планы'], ['food', 'food', 'Еда'], ['study', 'study', 'Учёба'], ['gym', 'gym', 'Зал'], ['budget', 'money', 'Бюджет'], ['books', 'books', 'Книги'], ['goal', 'target', 'Цель'], ['stats', 'stats', 'Статистика'], ['more', 'more', 'Ещё']];
// разделы Pro, у которых уже есть свой экран
const PRO_TABS: Record<string, string> = { 'Цели и повторы': 'plans', 'Анализ еды': 'food', 'Учёба': 'study:study', 'Учёба и вопросы': 'study:study', 'Вопросы дня': 'study:quiz', 'Вопросы': 'study:quiz', 'Зал': 'gym', 'Тренировка': 'gym', 'Бюджет': 'budget', 'Трата': 'budget', 'Книги': 'books', 'Чтение': 'books', 'Цель и прогноз': 'goal', 'Цель и план': 'goal', 'Статистика': 'stats', 'Статистика и итог недели': 'stats', 'Достижения': 'stats:awards', 'Итог недели': 'stats:week' };
// пояс телефона — серверу, чтобы «сегодня» и «сейчас» совпадали с часами человека
const ME = () => `/api/me?tz=${-new Date().getTimezoneOffset()}`;

type SheetState =
  | { kind: 'none' } | { kind: 'add'; at?: string } | { kind: 'meal'; at?: string; meal?: Meal; day?: string } | { kind: 'drink'; at?: string; drink?: Drink; day?: string }
  | { kind: 'steps' } | { kind: 'weight' } | { kind: 'task'; day: string | null; task?: TaskFull }
  | { kind: 'paywall'; focus?: string } | { kind: 'settings' } | { kind: 'install' } | { kind: 'reminders' } | { kind: 'voice' } | { kind: 'aiConsent'; then?: SheetState } | { kind: 'feedback' }
  | { kind: 'search'; at?: string; day?: string } | { kind: 'ai'; at?: string; mode: 'photo' | 'text'; day?: string } | { kind: 'draft'; id: string };
const TITLES: Record<string, string> = { add: 'Записать', meal: 'Приём пищи', drink: 'Напиток', steps: 'Шаги за день', weight: 'Вес', task: 'Задача', paywall: '', settings: 'Профиль и нормы', install: 'На экран «Домой»', reminders: 'Напоминания', voice: 'Записать голосом', aiConsent: 'ИИ-помощник', feedback: 'Написать разработчику', search: 'Поиск еды', ai: 'Еда по фото или описанию', draft: 'Проверь приём пищи' };

export function App() {
  const toast = useToast(), wide = useWide();
  // телефон: панель разделов уезжает вниз вместе с прокруткой (на столько же пикселей), листаешь вверх — так же выезжает;
  // когда прокрутка остановилась, панель плавно доезжает до ближайшего положения. Стиль пишем прямо в элемент — без перерисовки React
  const tabsRef = useRef<HTMLElement>(null), shift = useRef(0), goRef = useRef<(name: string) => void>(() => {}), openRef = useRef<(s: SheetState) => void>(() => {});
  // ссылка на черновик открывает «Еду» и проверку фото
  // возврат со страницы Google после подключения календаря: #settings?gcal=connected|denied|failed
  const openGcalBack = (h: string) => { const g = /^(?:profile|settings)\?gcal=(\w+)$/.exec(h)?.[1]; if (!g) return false; goRef.current('settings'); const m = GCAL_BACK[g]; if (m) toast(m[0], m[1] ? { err: true } : undefined); history.replaceState(null, '', location.pathname); return true; };
  const openDraftLink = (h: string) => { const id = draftLink(h); if (!id) return false; goRef.current('food'); openRef.current({ kind: 'draft', id }); history.replaceState(null, '', location.pathname); return true; };
  // уведомление ведёт в раздел: «/#plans» при открытии или сообщение от service worker, если окно уже открыто
  useEffect(() => {
    const nav = (h: string) => { if (openGcalBack(h) || openDraftLink(h)) return; if (h === 'voice') { openRef.current({ kind: 'voice' }); history.replaceState(null, '', location.pathname); return; } if (ORDER.includes(h)) { goRef.current(h); history.replaceState(null, '', location.pathname); } };
    const onMsg = (e: MessageEvent) => { if (typeof e.data?.nav === 'string') nav(e.data.nav); };
    const onHash = () => nav(location.hash.slice(1));
    navigator.serviceWorker?.addEventListener('message', onMsg); addEventListener('hashchange', onHash);
    return () => { navigator.serviceWorker?.removeEventListener('message', onMsg); removeEventListener('hashchange', onHash); };
  }, []);
  const showTabs = useCallback(() => { const n = tabsRef.current; shift.current = 0; if (n) { n.style.transition = ''; n.style.transform = ''; } }, []);
  useEffect(() => {
    if (wide) { showTabs(); return; }
    const last = new WeakMap<EventTarget, number>(); let idle = 0;
    const set = (v: number, smooth: boolean) => { const n = tabsRef.current; if (!n) return; shift.current = v; n.style.transition = smooth ? 'transform .25s var(--ease)' : 'none'; n.style.transform = v ? `translateY(${v}px)` : ''; };
    const on = (e: Event) => {
      const el = e.target as HTMLElement, n = tabsRef.current; if (!n || !el.classList?.contains('screen')) return;
      const y = el.scrollTop, d = y - (last.get(el) ?? y), h = n.offsetHeight; last.set(el, y);
      const edge = y <= 0 || y + el.clientHeight >= el.scrollHeight - 2;
      if (edge) { if (shift.current) set(0, true); return; }
      set(Math.max(0, Math.min(h, shift.current + d)), false);
      clearTimeout(idle);
      idle = window.setTimeout(() => { const v = shift.current; if (v > 0 && v < h) set(v > h / 2 ? h : 0, true); }, 140);
    };
    document.addEventListener('scroll', on, { capture: true, passive: true });
    return () => { clearTimeout(idle); document.removeEventListener('scroll', on, { capture: true }); };
  }, [wide, showTabs]);
  const [me, setMe] = useState<Me | null | undefined>(undefined), [redo, setRedo] = useState(false);
  const ready = !!me?.profile?.heightCm;
  // ссылка для нового пароля: /#reset=…
  const [resetToken, setResetToken] = useState(() => /^#reset=([\w-]{20,})$/.exec(location.hash)?.[1] ?? '');
  useEffect(() => { const h = location.hash.slice(1); if (!ready) return; if (openGcalBack(h)) { /* вернулись от Google */ } else if (openDraftLink(h)) { /* открыт черновик */ } else if (h === 'voice') { openRef.current({ kind: 'voice' }); history.replaceState(null, '', location.pathname); } else if (ORDER.includes(h)) { goRef.current(h); history.replaceState(null, '', location.pathname); } }, [ready]);
  // вернулись после привязки Google или Apple из профиля — сказать, что вышло, и открыть профиль
  useEffect(() => { if (!ready) return; const r = takeAuthResult(); if (!r) return; toast(r.error ?? r.ok!, r.error ? { err: true } : undefined); goRef.current('profile'); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState('today');
  const [day, setDay] = useState<string | null>(null), [today, setToday] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, TodayData>>({});
  const [version, setVersion] = useState(0);
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' }), [sheetOpen, setSheetOpen] = useState(false);
  const [still, setStill] = useState(false);
  const sub: Subscription = me?.subscription ?? { pro: false, source: null, expiresAt: null, daysLeft: null, plan: null, autoRenew: false };

  const open = (s: SheetState) => { setSheet(s); setSheetOpen(true); };
  openRef.current = open;
  const close = useCallback(() => setSheetOpen(false), []);
  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { setMe(null); return; }
    // без сети экран просто остаётся с последними данными — об этом говорит плашка и тост очереди
    if (e instanceof ApiError && e.status === 0) return;
    toast(e instanceof Error ? e.message : 'Что-то пошло не так', { err: true });
  }, [toast]);

  // без сети и без сохранённой копии — не выкидываем на вход, а пробуем ещё раз
  const loadMe = useCallback(async () => { try { const m = await api<Me>(ME()); setOwner(m.username); setSex(m.profile?.sex); setMe(m); } catch (e) { if (e instanceof ApiError && e.status === 0) setTimeout(() => loadMeRef.current(), 5000); else setMe(null); } }, []);
  const loadMeRef = useRef(loadMe); loadMeRef.current = loadMe;
  const loadDay = useCallback(async (d?: string) => {
    try {
      const t = await api<TodayData>(`/api/today${d ? `?day=${d}` : ''}`);
      // без сети — не затираем экран старой копией: там уже видно только что записанное
      setDays(x => fromCache(t) && x[t.day] ? x : { ...x, [t.day]: t });
      if (!d) { setToday(t.now.day); setDay(cur => cur ?? t.now.day); }
      return t;
    } catch (e) { fail(e); return null; }
  }, [fail]);

  useEffect(() => { loadMe(); }, [loadMe]);
  // тема из профиля — одна на телефоне и компьютере
  const theme = me?.profile?.settings?.theme as Theme | undefined;
  useEffect(() => { if (theme) applyTheme(theme); }, [theme]);
  useEffect(() => { if (me) loadDay(); }, [me?.username]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (me && day && !days[day]) loadDay(day); }, [me, day, days, loadDay]);

  const data = day ? days[day] ?? null : null;
  const patch = (fn: (t: TodayData) => TodayData) => { if (!day) return; setStill(true); setDays(x => x[day] ? { ...x, [day]: fn(structuredClone(x[day]!)) } : x); };
  // после любой записи: перечитать день, еду и списки; подписку — тоже (её мог изменить экран Pro)
  const refresh = useCallback(() => { setStill(true); if (day) loadDay(day); if (today && day !== today) loadDay(today); setVersion(v => v + 1); }, [day, today, loadDay]);
  // после записи: открылось ли новое достижение (Pro) — поздравляем
  const checkAwards = async () => {
    if (!can(sub, 'stats')) return;
    try {
      const { fresh } = await api<{ fresh: Array<{ name: string; tier: number; tierName: string }> }>('/api/awards/check', { method: 'POST' });
      if (!fresh.length) return;
      const top = fresh.slice().sort((a, b) => b.tier - a.tier)[0]!;
      buzz([10, 40, 10, 40, 20]);
      toast(`${fresh.length > 1 ? `Новые достижения: ${fresh.length}` : 'Новое достижение'} — ${top.name} · ${top.tierName}`, { undo: () => { setStatsTab('awards'); go('stats'); }, undoLabel: 'Смотреть' });
    } catch { /* поздравление не обязательно */ }
  };
  const done = () => { close(); refresh(); setTimeout(checkAwards, 600); };

  // записал на телефоне — видно на компьютере: перечитываем, когда окно снова на виду, и раз в 15 секунд.
  // Пока висит отложенное удаление, не трогаем — иначе удалённое вернётся на экран до отправки.
  const sync = useRef(refresh); sync.current = refresh;
  // записи без сети: сколько ждут отправки; отправились — перечитываем экран
  const [queued, setQueued] = useState(pendingCount);
  useEffect(() => {
    let last = pendingCount();
    const onBox = () => { const n = pendingCount(); if (n > last) toast('Нет связи — запись сохранена на телефоне и уйдёт, когда появится сеть'); last = n; setQueued(n); };
    const onSync = (e: Event) => { const { sent, dropped } = (e as CustomEvent<{ sent: number; dropped: number }>).detail; if (sent) toast(`Отправлено записей: ${sent}`); if (dropped) toast(`Сервер не принял записей: ${dropped}`, { err: true }); setDays({}); sync.current(); };
    const onPay = () => openRef.current({ kind: 'paywall' });
    const onConsent = () => openRef.current({ kind: 'aiConsent' });
    addEventListener('bj-consent', onConsent);
    // очередь общая для вкладок: другая вкладка отправила записи — эта тоже узнаёт
    const onStore = (e: StorageEvent) => { if (e.key === 'bj-outbox') { onBox(); if (pendingCount() === 0) { setDays({}); sync.current(); } } };
    addEventListener('storage', onStore);
    addEventListener('bj-outbox', onBox); addEventListener('bj-synced', onSync); addEventListener('bj-paywall', onPay); void flushOutbox();
    return () => { removeEventListener('bj-outbox', onBox); removeEventListener('bj-synced', onSync); removeEventListener('bj-paywall', onPay); removeEventListener('bj-consent', onConsent); removeEventListener('storage', onStore); };
  }, [toast]);
  useEffect(() => {
    if (!me) return;
    const tick = () => { if (document.visibilityState === 'visible' && !pending.current.size) { void flushOutbox(); sync.current(); loadMe(); } };
    const id = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick); addEventListener('focus', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); removeEventListener('focus', tick); };
  }, [me?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  // фото еды в фоне: черновики приёма. Пока что-то разбирается — спрашиваем чаще; разобралось — сообщаем внутри журнала
  const [drafts, setDrafts] = useState<FoodDraft[]>([]), seenDrafts = useRef(new Map<string, string>());
  const loadDrafts = useCallback(async () => {
    if (!me || !can(sub, 'food')) { setDrafts([]); return; }
    try {
      const list = (await api<{ items: FoodDraft[] }>('/api/food/drafts')).items;
      for (const d of list) {
        const was = seenDrafts.current.get(d.id);
        if (was && was !== d.state && d.state === 'ready') { toast(d.questions.length ? 'Фото разобрано, есть вопрос' : 'Фото разобрано — проверь и сохрани', { undo: () => openRef.current({ kind: 'draft', id: d.id }), undoLabel: 'Открыть' }); refresh(); }
        if (was && was !== d.state && d.state === 'failed') toast('Не получилось разобрать фото', { err: true, undo: () => openRef.current({ kind: 'draft', id: d.id }), undoLabel: 'Открыть' });
      }
      seenDrafts.current = new Map(list.map(d => [d.id, d.state]));
      setDrafts(list);
    } catch { /* сеть — попробуем в следующий раз */ }
  }, [me?.username, sub.pro, sub.plan]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadDrafts(); const on = () => { void loadDrafts(); }; addEventListener('bj-drafts', on); addEventListener('focus', on); return () => { removeEventListener('bj-drafts', on); removeEventListener('focus', on); }; }, [loadDrafts]);
  const draftsBusy = drafts.some(draftPending);
  useEffect(() => { const id = setInterval(() => { if (document.visibilityState === 'visible') void loadDrafts(); }, draftsBusy ? 4000 : 15000); return () => clearInterval(id); }, [draftsBusy, loadDrafts]);

  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('.sheet[aria-hidden="false"]'))) return;
      if (['n', 'N', 'т', 'Т', '+'].includes(e.key)) { e.preventDefault(); openRef.current({ kind: 'add' }); }
    };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, [wide]);

  const goDay = useCallback((dir: number) => {
    setStill(false);
    setDay(d => { if (!d || !today) return d; const next = addDays(d, dir); return next > addDays(today, 7) ? d : next; });
  }, [today]);

  const addWater = async (ml: number, at?: string) => {
    if (!day || !data) return;
    const time = at ?? (data.isToday ? data.now.hm : '12:00');
    close(); buzz([8, 40, 8]);
    patch(t => { if (t.parts.food) t.parts.food.waterMl += ml; t.events.push({ id: `tmp-${Date.now()}`, module: 'food', kind: 'drink', time, title: 'Вода без газа', value: ml, unit: 'ml', data: null }); return t; });
    toast(`+${ml} мл воды`);
    try { await api('/api/food/drinks', { method: 'POST', body: { day, time, type: 'water', ml } }); refresh(); } catch (e) { fail(e); loadDay(day); }
  };

  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const deleteMark = (m: Mark) => {
    if (!day) return; buzz(14);
    const before = days[day], d = day;
    patch(t => { t.events = t.events.filter(e => e.id !== m.id); if (t.parts.food) { if (m.kcal) t.parts.food.kcal -= m.kcal; if (m.ml) t.parts.food.waterMl -= m.ml; } return t; });
    pending.current.set(m.id, setTimeout(async () => {
      pending.current.delete(m.id);
      try { await api(`/api/food/entries/${m.id}`, { method: 'DELETE' }); refresh(); } catch (e) { fail(e); loadDay(d); }
    }, 5000));
    toast(`«${m.title}» удалено`, { undo: () => { clearTimeout(pending.current.get(m.id)); pending.current.delete(m.id); if (before) setDays(x => ({ ...x, [d]: before })); } });
  };
  const editMark = async (m: Mark) => {
    if (!day) return;
    try {
      const f = await api<FoodDay>(`/api/food/day?day=${day}`);
      const meal = f.meals.find(x => x.id === m.id); if (meal) return open({ kind: 'meal', meal });
      const drink = f.drinks.find(x => x.id === m.id); if (drink) return open({ kind: 'drink', drink });
    } catch (e) { fail(e); }
  };
  const toggleTask = async (id: string) => {
    if (!day) return;
    patch(t => { const x = t.parts.plans?.tasks.find(k => k.id === id); if (x) x.done = !x.done; return t; });
    try { await api(`/api/plans/tasks/${id}/toggle`, { method: 'POST' }); setVersion(v => v + 1); } catch (e) { fail(e); loadDay(day); }
  };
  // платное: без Pro — экран тарифов; с доступом — открываем раздел или нужный лист
  // разделы, которые уже переехали: с Pro открываются по-настоящему
  const PRO_OPEN: Record<string, (at?: string, d?: string) => SheetState> = {
    'Фото и описание еды': (at, d) => ({ kind: 'ai', at, mode: 'photo', day: d }), 'Описание еды': (at, d) => ({ kind: 'ai', at, mode: 'text', day: d }),
    'Напоминания': () => ({ kind: 'reminders' }),
    'Поиск еды': (at, d) => ({ kind: 'search', at, day: d }), 'Поиск по базе продуктов': (at, d) => ({ kind: 'search', at, day: d }),
  };
  const pro = (what: string, at?: string, inDay?: string) => { if (!can(sub, what)) { open({ kind: 'paywall', focus: what }); return; } if (PRO_OPEN[what]) { const next = PRO_OPEN[what]!(at, inDay); if ((next.kind === 'ai') && !me?.profile?.settings?.aiConsent) { open({ kind: 'aiConsent', then: next }); return; } open(next); return; } if (PRO_TABS[what]) { close(); const [t, st] = PRO_TABS[what]!.split(':'); if (t === 'study') setStudyTab(st as 'study' | 'quiz'); else setStatsTab(st as StatsTab | undefined); go(t!); return; } close(); toast(`«${what}» скоро появится`); };
  const setSub = (s: Subscription) => { setMe(m => m ? { ...m, subscription: s } : m); setDays({}); if (day) loadDay(day); };
  const [quick, setQuick] = useState<{ tab: string; t: number } | null>(null), [back, setBack] = useState('today'), [statsTab, setStatsTab] = useState<StatsTab | undefined>(), [studyTab, setStudyTab] = useState<'study' | 'quiz' | undefined>();
  const go = (name: string) => {
    if (name === 'add') { open({ kind: 'add' }); return; }
    // подписка кончилась — свои записи смотреть можно; не было подписки — сначала тарифы
    if (SECTIONS[name] && !can(sub, SECTIONS[name]!) && !sub.ended) { open({ kind: 'paywall', focus: SECTION_NAME[name] }); return; }
    if ((name === 'goal' || name === 'stats') && !can(sub, name)) { open({ kind: 'paywall', focus: name === 'goal' ? 'Цель и прогноз' : 'Статистика' }); return; }
    if (name in SECTIONS) setBack(tab in SECTIONS ? back : tab);
    if (name === 'profile' || name === 'settings' || name === 'admin') setBack(tab === name ? back : tab);
    setTab(name); showTabs(); buzz(6);
    try { sessionStorage.setItem('bj-tab', name); } catch { /* без памяти */ }
  };
  goRef.current = go;

  if (resetToken) return <ResetPassword token={resetToken} onDone={async () => { setResetToken(''); await loadMe(); setDays({}); loadDay(); }} />;
  if (me === undefined) return <div className="app" />;
  if (me === null) return <Login onDone={loadMe} />;
  if ((!me.profile?.heightCm && me.profile?.settings?.onboarded !== true) || redo) {
    const p = me.profile, w = data?.parts.body?.weight?.kg ?? p?.startWeightKg;
    const initial = p?.heightCm ? { name: String(p.settings?.name ?? ''), sex: (p.sex === 'f' ? 'f' : 'm') as 'm' | 'f', age: p.age ? String(p.age) : '', height: String(p.heightCm), weight: w ? String(w).replace('.', ',') : '', goal: (p.goal ?? 'maintain') as 'lose' | 'maintain' | 'gain', pace: (p.pace ?? 'mid') as 'soft' | 'mid' | 'hard', target: p.targetKg ? String(p.targetKg).replace('.', ',') : '' } : undefined;
    return <Onboarding initial={initial} onCancel={p?.heightCm ? () => setRedo(false) : undefined} onDone={async () => { setRedo(false); await loadMe(); setDays({}); loadDay(); }} />;
  }

  // «Ещё»: короткая живая сводка каждого раздела вместо «открыть»
  const P = data?.parts as any, moreSummary: Record<string, string> = {};
  if (P) {
    if (P.body?.weight) moreSummary.goal = `вес ${fmt1(P.body.weight.kg)} кг · прогноз и вехи`;
    if (P.gym) moreSummary.gym = P.gym.workouts?.length ? `сегодня: ${P.gym.workouts.map((w: any) => w.title).join(', ')}` : P.gym.plan ? `по плану: ${P.gym.plan.name}` : 'сегодня без тренировки';
    if (P.study) moreSummary.study = P.study.quiz?.left ? `${P.study.quiz.left} ${plural(P.study.quiz.left, 'вопрос', 'вопроса', 'вопросов')} на сегодня` : P.study.minutes ? `${P.study.minutes} мин сегодня` : 'конспекты и вопросы';
    if (P.budget) moreSummary.budget = P.budget.configured && P.budget.leftToday !== undefined ? (P.budget.leftToday >= 0 ? `${fmt(Math.round(P.budget.leftToday))} ${P.budget.currency} можно сегодня` : `перерасход ${fmt(Math.round(-P.budget.leftToday))} ${P.budget.currency}`) : 'задай бюджет на месяц';
    if (P.books) moreSummary.books = P.books.reading ? `читаю: ${P.books.reading.title} · ${P.books.reading.pct}%` : 'полка и цель года';
    moreSummary.stats = `серия ${data!.streak} ${plural(data!.streak, 'день', 'дня', 'дней')} · оценки дней`;
    moreSummary.awards = 'награды за серии и рекорды';
  }
  moreSummary.reminders = me.profile?.settings?.remind?.off ? 'выключены' : 'вода, еда, задачи, тренировки';
  // телефон: четвёртая вкладка — первый выбранный раздел (еда, учёба, зал, бюджет, книги)
  const chosen = me.profile?.settings?.sections as string[] | undefined;
  const fourth = (chosen ? (['food', 'study', 'gym', 'budget', 'books'] as const).find(k => chosen.includes(k)) : 'food') ?? 'food';
  const FOURTH: Record<string, [string, string, string]> = { food: ['food', 'food', 'Еда'], study: ['study', 'study', 'Учёба'], gym: ['gym', 'gym', 'Зал'], budget: ['budget', 'money', 'Бюджет'], books: ['books', 'books', 'Книги'] };
  const phoneTabs = TABS.map(t => t[0] === 'food' ? FOURTH[fourth]! : t);
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); forgetLocal(); setMe(null); setDays({}); setDay(null); setToday(null); setTab('today'); };
  const pos = (name: string) => name === tab ? 'center' : ORDER.indexOf(name) < ORDER.indexOf(tab) ? 'left' : 'right';
  const foodPart = data?.parts.food, body = data?.parts.body;
  // плитка листа «Записать»: раздел открывается сразу на действии (тренировка, занятие, расход, страница книги)
  const QUICK: Record<string, string> = { 'Зал': 'gym', 'Учёба': 'study', 'Трата': 'budget', 'Чтение': 'books' };
  const lockTile = (name: string, ic: string, c: string) => <button key={name} className="tile" onClick={() => { if (QUICK[name] && can(sub, name)) setQuick({ tab: QUICK[name]!, t: Date.now() }); pro(name, sheet.kind === 'add' ? sheet.at : undefined); }}><span className="chip-ic" style={{ ['--c' as string]: c }}><Icon name={ic} /></span>{name}{!can(sub, name) && <span className="lock">PRO</span>}</button>;

  return <div className={`app ${wide ? 'wide' : ''} ${me.demo ? 'demo-on' : ''}`}>
    {me.demo && <DemoBanner onLogout={logout} onClaimed={async () => { await loadMe(); toast('Аккаунт сохранён — записи на месте'); }} />}
    {wide && <div className="brand"><img className="brand-mark" src="/favicon.svg" alt="" />Lumi</div>}
    {tab in SECTIONS && SECTIONS[tab] && sub.ended && !can(sub, SECTIONS[tab]!) && <button className="ro-bar" onClick={() => open({ kind: 'paywall', focus: SECTION_NAME[tab] })}><Icon name="file" />Только просмотр — Pro закончился. Продлить</button>}
    {queued === 0 && drafts.length > 0 && (() => {
      const ready = drafts.filter(d => d.state === 'ready'), failed = drafts.filter(d => d.state === 'failed'), busy = drafts.filter(draftPending);
      const first = ready[0] ?? failed[0] ?? busy[0]!;
      const text = ready.length ? `Фото разобрано${ready.length > 1 ? ` (${ready.length})` : ''} — проверь и сохрани` : failed.length ? 'Фото не разобралось — открыть' : `Фото разбирается${busy.length > 1 ? ` (${busy.length})` : ''}…`;
      return <button className={`outbox-bar drafts-bar ${ready.length ? 'ready' : ''}`} onClick={() => open({ kind: 'draft', id: first.id })}><Icon name={ready.length ? 'check' : 'camera'} />{text}</button>;
    })()}
    {queued > 0 && <button className="outbox-bar" onClick={() => void flushOutbox()}><Icon name="repeat" />Без сети: {queued} {queued % 10 === 1 && queued % 100 !== 11 ? 'запись ждёт' : 'записей ждут'} отправки — нажми, чтобы отправить сейчас</button>}
    <div className="screens">
      <section className="screen" data-pos={pos('today')} aria-hidden={tab !== 'today'}>
        <Boundary name="today" onFeedback={() => open({ kind: 'feedback' })}>
        {day && today && <TodayWide wide={wide} data={data} day={day} today={today} still={still} sub={sub} settings={me.profile?.settings ?? {}} onReminders={() => open({ kind: 'reminders' })} onSettingsSaved={st => setMe(m => m && m.profile ? { ...m, profile: { ...m.profile, settings: st } } : m)} onDay={goDay} onAdd={at => open({ kind: 'add', at })} onDelete={deleteMark} onEdit={editMark} onToggleTask={toggleTask} onGo={go}
          onPro={pro} onPaywall={() => open({ kind: 'paywall' })} onSteps={() => open({ kind: 'steps' })} onWeight={() => open({ kind: 'weight' })} onWater={() => open({ kind: 'drink' })}
          onMeal={() => open({ kind: 'meal' })} onAddWater={ml => addWater(ml)} onTaskAdded={title => { patch(t => { if (t.parts.plans && !t.parts.plans.tasks.some(x => x.title === title && !x.done)) t.parts.plans.tasks.push({ id: `tmp-${Date.now()}`, title, time: null, done: false, prio: false, repeat: false }); return t; }); toast('Задача добавлена'); refresh(); }} onTaskOpen={() => open({ kind: 'task', day })} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('plans')} aria-hidden={tab !== 'plans'}>
        <Boundary name="plans" onFeedback={() => open({ kind: 'feedback' })}>
        {today && <Plans today={today} sub={sub} version={version} onAdd={d => open({ kind: 'task', day: d })} onOpen={t => open({ kind: 'task', day: t.day, task: t })} onPro={pro} onChanged={() => { if (day) loadDay(day); }} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('food')} aria-hidden={tab !== 'food'}>
        <Boundary name="food" onFeedback={() => open({ kind: 'feedback' })}>
        {today && tab === 'food' && <Food today={today} sub={sub} version={version} wide={wide} onChanged={() => { setStill(true); if (day) loadDay(day); }}
          onAddMeal={d => open({ kind: 'meal', day: d })} onAddDrink={d => open({ kind: 'drink', day: d })} onMeal={meal => open({ kind: 'meal', meal })} onDrink={drink => open({ kind: 'drink', drink })} onPro={(w, d) => pro(w, undefined, d)} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('study')} aria-hidden={tab !== 'study'}>
        <Boundary name="study" onFeedback={() => open({ kind: 'feedback' })}>
        {tab === 'study' && <Study wide={wide} version={version} tab={studyTab} quick={quick?.tab === 'study' ? quick.t : undefined} onBack={() => setTab(back)} onChanged={() => { setStill(true); if (day) loadDay(day); setTimeout(checkAwards, 600); }} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('gym')} aria-hidden={tab !== 'gym'}>
        <Boundary name="gym" onFeedback={() => open({ kind: 'feedback' })}>
        {tab === 'gym' && <Gym wide={wide} version={version} quick={quick?.tab === 'gym' ? quick.t : undefined} restSec={Number(me.profile?.settings?.rest) || 90} onBack={() => setTab(back)} onChanged={() => { setStill(true); if (day) loadDay(day); setTimeout(checkAwards, 600); }} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('budget')} aria-hidden={tab !== 'budget'}>
        <Boundary name="budget" onFeedback={() => open({ kind: 'feedback' })}>
        {tab === 'budget' && <Budget wide={wide} version={version} quick={quick?.tab === 'budget' ? quick.t : undefined} onBack={() => setTab(back)} onChanged={() => { setStill(true); if (day) loadDay(day); }} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('books')} aria-hidden={tab !== 'books'}>
        <Boundary name="books" onFeedback={() => open({ kind: 'feedback' })}>
        {tab === 'books' && <Books wide={wide} version={version} quick={quick?.tab === 'books' ? quick.t : undefined} onBack={() => setTab(back)} onChanged={() => { setStill(true); if (day) loadDay(day); setTimeout(checkAwards, 600); }} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('goal')} aria-hidden={tab !== 'goal'}>
        <Boundary name="goal" onFeedback={() => open({ kind: 'feedback' })}>
        {tab === 'goal' && <Goal wide={wide} onBack={() => setTab(back)} onWeigh={() => open({ kind: 'weight' })} onRedo={() => setRedo(true)} onChanged={() => { setDays({}); if (day) loadDay(day); }} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('stats')} aria-hidden={tab !== 'stats'}>
        <Boundary name="stats" onFeedback={() => open({ kind: 'feedback' })}>
        {tab === 'stats' && <Stats wide={wide} tab={statsTab} has={f => can(sub, f)} onBack={() => setTab(back)} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('profile')} aria-hidden={tab !== 'profile'}>
        <Boundary name="profile" onFeedback={() => open({ kind: 'feedback' })}>
        {tab === 'profile' && <Profile me={me} wide={wide} onBack={() => setTab(back)} onSaved={st => { setMe(m => m && m.profile ? { ...m, profile: { ...m.profile, settings: st } } : m); setDays({}); if (day) loadDay(day); }}
          onRedo={() => setRedo(true)} onFeedback={() => open({ kind: 'feedback' })} onReminders={() => open({ kind: 'reminders' })} onPaywall={() => open({ kind: 'paywall' })} onLogout={logout}
          onDeleted={() => { toast('Аккаунт удалён'); setMe(null); setDays({}); setDay(null); setToday(null); setTab('today'); }} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('settings')} aria-hidden={tab !== 'settings'}>
        <Boundary name="settings" onFeedback={() => open({ kind: 'feedback' })}>
        {tab === 'settings' && <Profile part="settings" me={me} wide={wide} onBack={() => setTab(back)} onSaved={st => { setMe(m => m && m.profile ? { ...m, profile: { ...m.profile, settings: st } } : m); setDays({}); if (day) loadDay(day); }}
          onRedo={() => setRedo(true)} onFeedback={() => open({ kind: 'feedback' })} onReminders={() => open({ kind: 'reminders' })} onPaywall={() => open({ kind: 'paywall' })} onLogout={logout}
          onDeleted={() => { toast('Аккаунт удалён'); setMe(null); setDays({}); setDay(null); setToday(null); setTab('today'); }} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('admin')} aria-hidden={tab !== 'admin'}>
        <Boundary name="admin" onFeedback={() => open({ kind: 'feedback' })}>
        {tab === 'admin' && me.admin && <Admin wide={wide} onBack={() => setTab(back)} />}
        </Boundary>
      </section>
      <section className="screen" data-pos={pos('more')} aria-hidden={tab !== 'more'}>
        <Boundary name="more" onFeedback={() => open({ kind: 'feedback' })}>
        <More me={me} wide={wide} summary={moreSummary} onFeedback={() => open({ kind: 'feedback' })} onAdmin={() => go('admin')} onPro={pro} onSaved={st => setMe(m => m && m.profile ? { ...m, profile: { ...m.profile, settings: st } } : m)} onPaywall={focus => open({ kind: 'paywall', focus })} onProfile={() => go('profile')} onSettings={() => go('settings')} onInstall={() => open({ kind: 'install' })}
          onLogout={logout} />
        </Boundary>
      </section>
    </div>
    <nav ref={tabsRef} className="tabs" aria-label="Разделы">
      {(wide ? WIDE_TABS : phoneTabs).map(([name, icon, label]) => <button key={name} className={`tab ${name === 'add' ? 'add' : ''}`} aria-current={tab === name ? 'page' : undefined} onClick={() => go(name)} aria-label={label}>
        <span className="pill"><Icon name={icon} /></span>{label}{SECTIONS[name] && !can(sub, SECTIONS[name]!) && <span className="lock dock-lock">PRO</span>}</button>)}
    </nav>

    <Sheet open={sheetOpen} onClose={close} tall={sheet.kind === 'paywall' || sheet.kind === 'search' || sheet.kind === 'ai'} title={sheet.kind === 'add' && sheet.at ? `Записать на ${sheet.at}` : TITLES[sheet.kind] ?? ''}>
      <Boundary key={sheet.kind} name={`лист ${sheet.kind}`}>
      {sheet.kind === 'add' && <>
        <div className="big2">
          <button className="bigt" style={{ background: 'var(--food)' }} onClick={() => open({ kind: 'meal', at: sheet.at })}><span className="chip-ic"><Icon name="food" /></span><b>Приём пищи</b><small>калории и БЖУ вручную</small></button>
          <button className="bigt" style={{ background: 'var(--navy)' }} onClick={() => pro('Фото и описание еды', sheet.at)}><span className="chip-ic"><Icon name="camera" /></span><b>Фото еды</b><small>калории посчитает ИИ</small>{!can(sub, 'food') && <span className="lock">PRO</span>}</button>
        </div>
        <button className="voice-row" onClick={() => open({ kind: 'voice' })}><span className="chip-ic" style={{ ['--c' as string]: 'var(--orange)' }}><Icon name="mic" /></span><span className="mid"><b>Голосом</b><small>задача с напоминанием или заметка — скажи, ИИ разберёт</small></span><Icon name="chev" className="ic chev" /></button>
        <div className="water">
          <span className="chip-ic" style={{ ['--c' as string]: 'var(--water)' }}><Icon name="drop" /></span>
          <span className="mid"><b>Вода</b><small>{fmt1((foodPart?.waterMl ?? 0) / 1000)} из {fmt1((foodPart?.norm.water ?? 2000) / 1000)} л</small></span>
          <button className="ml" onClick={() => addWater(250, sheet.at)}>+250</button><button className="ml" onClick={() => addWater(500, sheet.at)}>+500</button>
          <button className="ml" onClick={() => open({ kind: 'drink', at: sheet.at })} aria-label="Другой напиток">…</button>
        </div>
        <div className="grid4">
          <button className="tile" onClick={() => open({ kind: 'weight' })}><span className="chip-ic" style={{ ['--c' as string]: 'var(--navy)' }}><Icon name="scale" /></span>Вес</button>
          <button className="tile" onClick={() => open({ kind: 'steps' })}><span className="chip-ic" style={{ ['--c' as string]: 'var(--steps)' }}><Icon name="steps" /></span>Шаги</button>
          <button className="tile" onClick={() => open({ kind: 'task', day })}><span className="chip-ic" style={{ ['--c' as string]: 'var(--quiz)' }}><Icon name="task" /></span>Задача</button>
          {lockTile('Поиск еды', 'search', 'var(--food)')}
          {lockTile('Зал', 'gym', 'var(--gym)')}{lockTile('Учёба', 'study', 'var(--study)')}{lockTile('Трата', 'money', 'var(--money)')}{lockTile('Чтение', 'books', 'var(--books)')}
        </div>
      </>}
      {sheet.kind === 'meal' && day && <MealForm key={sheet.meal?.id ?? 'new'} day={sheet.meal?.day ?? sheet.day ?? day} time={sheet.at} meal={sheet.meal} onDone={done} />}
      {sheet.kind === 'drink' && day && <DrinkForm key={sheet.drink?.id ?? 'new'} day={sheet.drink?.day ?? sheet.day ?? day} time={sheet.at} drink={sheet.drink} onDone={done} />}
      {sheet.kind === 'steps' && day && <NumberForm kind="steps" day={day} value={body?.steps || null} onDone={v => { patch(t => { if (t.parts.body) t.parts.body.steps = v ?? 0; return t; }); done(); }} />}
      {sheet.kind === 'weight' && day && <NumberForm kind="weight" day={day} value={body?.weight?.today ? body.weight.kg : null} onDone={v => { patch(t => { if (t.parts.body && v) t.parts.body.weight = { kg: v, day, today: true }; return t; }); done(); }} />}
      {sheet.kind === 'task' && <TaskForm key={sheet.task?.id ?? `new-${sheet.day}`} day={sheet.day} task={sheet.task} plans={can(sub, 'plans')} onDone={done} />}
      {sheet.kind === 'paywall' && <Paywall sub={sub} focus={sheet.focus} onChange={setSub} onClose={close} />}
      {sheet.kind === 'settings' && <SettingsForm me={me} onDone={s => { setMe(m => m && m.profile ? { ...m, profile: { ...m.profile, settings: s } } : m); done(); setDays({}); }} onRedo={() => { close(); setRedo(true); }} />}
      {sheet.kind === 'install' && <InstallHelp />}
      {sheet.kind === 'reminders' && <Reminders onInstall={() => open({ kind: 'install' })} />}
      {sheet.kind === 'aiConsent' && <AiConsent onDone={async ok => { if (!ok) { close(); return; } try { const r = await api<{ settings: Record<string, unknown> }>('/api/profile/settings', { method: 'PUT', body: { aiConsent: true } }); setMe(m => m && m.profile ? { ...m, profile: { ...m.profile, settings: r.settings } } : m); if (sheet.then) open(sheet.then); else { close(); toast('ИИ-помощник включён — повтори действие'); } } catch (e) { fail(e); } }} />}
      {sheet.kind === 'feedback' && <FeedbackForm onDone={close} />}
      {sheet.kind === 'voice' && <VoiceCapture onDone={() => { setVersion(v => v + 1); if (day) loadDay(day); }} />}
      {sheet.kind === 'search' && day && <FoodSearch day={sheet.day ?? day} time={sheet.at} onDone={done} />}
      {sheet.kind === 'ai' && day && <FoodAi key={sheet.mode} day={sheet.day ?? day} time={sheet.at} mode={sheet.mode} onDone={done} />}
      {sheet.kind === 'draft' && day && <FoodAi key={sheet.id} day={day} mode="photo" draftId={sheet.id} onDone={done} />}
      </Boundary>
    </Sheet>
  </div>;
}
