/**
 * Каркас: вход → анкета (если не пройдена) → экраны с нижней панелью.
 * Один лист снизу на все формы. Платное без Pro открывает экран тарифов.
 * Данные дня кэшируются по дате; действия срабатывают на экране сразу,
 * удаление отправляется через 5 секунд, если не нажали «Вернуть».
 */
import { can } from './lib/features';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays } from '@bortjournal/core';
import { api, ApiError, type Drink, type FoodDay, type Meal, type Me, type Subscription, type TaskFull, type Today as TodayData } from './lib/api';
import { fmt1 } from './lib/format';
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
import { Stats, type StatsTab } from './screens/Stats';
import { TodayWide } from './screens/TodayWide';
import { useWide } from './lib/wide';
import { applyTheme, type Theme } from './lib/theme';

const TABS: Array<[string, string, string]> = [['today', 'today', 'Сегодня'], ['plans', 'plans', 'Планы'], ['add', 'plus', 'Записать'], ['food', 'food', 'Еда'], ['more', 'more', 'Ещё']];
const ORDER = ['today', 'plans', 'food', 'goal', 'stats', 'more'];
// на компьютере в панели — и переехавшие разделы Pro
const WIDE_TABS: Array<[string, string, string]> = [['today', 'today', 'Сегодня'], ['plans', 'plans', 'Планы'], ['food', 'food', 'Еда'], ['goal', 'target', 'Цель'], ['stats', 'stats', 'Статистика'], ['more', 'more', 'Ещё']];
// разделы Pro, у которых уже есть свой экран
const PRO_TABS: Record<string, string> = { 'Цель и прогноз': 'goal', 'Цель и план': 'goal', 'Статистика': 'stats', 'Статистика и итог недели': 'stats', 'Достижения': 'stats:awards', 'Итог недели': 'stats:week' };
// пояс телефона — серверу, чтобы «сегодня» и «сейчас» совпадали с часами человека
const ME = () => `/api/me?tz=${-new Date().getTimezoneOffset()}`;

type SheetState =
  | { kind: 'none' } | { kind: 'add'; at?: string } | { kind: 'meal'; at?: string; meal?: Meal; day?: string } | { kind: 'drink'; at?: string; drink?: Drink; day?: string }
  | { kind: 'steps' } | { kind: 'weight' } | { kind: 'task'; day: string | null; task?: TaskFull }
  | { kind: 'paywall'; focus?: string } | { kind: 'settings' } | { kind: 'install' }
  | { kind: 'search'; at?: string; day?: string } | { kind: 'ai'; at?: string; mode: 'photo' | 'text'; day?: string };
const TITLES: Record<string, string> = { add: 'Записать', meal: 'Приём пищи', drink: 'Напиток', steps: 'Шаги за день', weight: 'Вес', task: 'Задача', paywall: '', settings: 'Профиль и нормы', install: 'На экран «Домой»', search: 'Поиск еды', ai: 'Еда по фото или описанию' };

export function App() {
  const toast = useToast(), wide = useWide();
  const [me, setMe] = useState<Me | null | undefined>(undefined), [redo, setRedo] = useState(false);
  const [tab, setTab] = useState('today');
  const [day, setDay] = useState<string | null>(null), [today, setToday] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, TodayData>>({});
  const [version, setVersion] = useState(0);
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' }), [sheetOpen, setSheetOpen] = useState(false);
  const [still, setStill] = useState(false);
  const sub: Subscription = me?.subscription ?? { pro: false, source: null, expiresAt: null, daysLeft: null, plan: null, autoRenew: false };

  const open = (s: SheetState) => { setSheet(s); setSheetOpen(true); };
  const close = useCallback(() => setSheetOpen(false), []);
  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { setMe(null); return; }
    toast(e instanceof Error ? e.message : 'Что-то пошло не так', { err: true });
  }, [toast]);

  const loadMe = useCallback(async () => { try { setMe(await api<Me>(ME())); } catch { setMe(null); } }, []);
  const loadDay = useCallback(async (d?: string) => {
    try {
      const t = await api<TodayData>(`/api/today${d ? `?day=${d}` : ''}`);
      setDays(x => ({ ...x, [t.day]: t }));
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
  useEffect(() => {
    if (!me) return;
    const tick = () => { if (document.visibilityState === 'visible' && !pending.current.size) { sync.current(); loadMe(); } };
    const id = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick); addEventListener('focus', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); removeEventListener('focus', tick); };
  }, [me?.username]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // платное: без Pro — экран тарифов; с Pro — раздел ещё переезжает
  // разделы, которые уже переехали: с Pro открываются по-настоящему
  const PRO_OPEN: Record<string, (at?: string, d?: string) => SheetState> = {
    'Фото и описание еды': (at, d) => ({ kind: 'ai', at, mode: 'photo', day: d }), 'Описание еды': (at, d) => ({ kind: 'ai', at, mode: 'text', day: d }),
    'Поиск еды': (at, d) => ({ kind: 'search', at, day: d }), 'Поиск по базе продуктов': (at, d) => ({ kind: 'search', at, day: d }),
  };
  const pro = (what: string, at?: string, inDay?: string) => { if (!can(sub, what)) { open({ kind: 'paywall', focus: what }); return; } if (PRO_OPEN[what]) { open(PRO_OPEN[what]!(at, inDay)); return; } if (PRO_TABS[what]) { close(); const [t, st] = PRO_TABS[what]!.split(':'); setStatsTab(st as StatsTab | undefined); go(t!); return; } close(); toast(sub.source === 'free' ? `«${what}» переезжает в новую версию — пока он в старой` : `«${what}» появится в ближайшем обновлении — Pro уже включает его`); };
  const setSub = (s: Subscription) => { setMe(m => m ? { ...m, subscription: s } : m); setDays({}); if (day) loadDay(day); };
  const [back, setBack] = useState('today'), [statsTab, setStatsTab] = useState<StatsTab | undefined>();
  const go = (name: string) => {
    if (name === 'add') { open({ kind: 'add' }); return; }
    if ((name === 'goal' || name === 'stats') && !can(sub, name)) { open({ kind: 'paywall', focus: name === 'goal' ? 'Цель и прогноз' : 'Статистика' }); return; }
    if (name === 'goal' || name === 'stats') setBack(tab === 'goal' || tab === 'stats' ? back : tab);
    setTab(name); buzz(6);
  };

  if (me === undefined) return <div className="app" />;
  if (me === null) return <Login onDone={loadMe} />;
  if (!me.profile?.heightCm || redo) return <Onboarding onDone={async () => { setRedo(false); await loadMe(); setDays({}); loadDay(); }} />;

  const pos = (name: string) => name === tab ? 'center' : ORDER.indexOf(name) < ORDER.indexOf(tab) ? 'left' : 'right';
  const foodPart = data?.parts.food, body = data?.parts.body;
  const lockTile = (name: string, ic: string, c: string) => <button key={name} className="tile" onClick={() => pro(name, sheet.kind === 'add' ? sheet.at : undefined)}><span className="chip-ic" style={{ ['--c' as string]: c }}><Icon name={ic} /></span>{name}{!can(sub, name) && <span className="lock">PRO</span>}</button>;

  return <div className={`app ${wide ? 'wide' : ''}`}>
    {wide && <div className="brand"><i>✦</i>Бортжурнал</div>}
    <div className="screens">
      <section className="screen" data-pos={pos('today')} aria-hidden={tab !== 'today'}>
        {day && today && <TodayWide wide={wide} data={data} day={day} today={today} still={still} sub={sub} onDay={goDay} onAdd={at => open({ kind: 'add', at })} onDelete={deleteMark} onEdit={editMark} onToggleTask={toggleTask} onGo={go}
          onPro={pro} onPaywall={() => open({ kind: 'paywall' })} onSteps={() => open({ kind: 'steps' })} onWeight={() => open({ kind: 'weight' })} onWater={() => open({ kind: 'drink' })}
          onMeal={() => open({ kind: 'meal' })} onAddWater={ml => addWater(ml)} onTaskAdded={() => { toast('Задача добавлена'); refresh(); }} onTaskOpen={() => open({ kind: 'task', day })} />}
      </section>
      <section className="screen" data-pos={pos('plans')} aria-hidden={tab !== 'plans'}>
        {today && <Plans today={today} sub={sub} version={version} onAdd={d => open({ kind: 'task', day: d })} onOpen={t => open({ kind: 'task', day: t.day, task: t })} onPro={pro} onChanged={() => { if (day) loadDay(day); }} />}
      </section>
      <section className="screen" data-pos={pos('food')} aria-hidden={tab !== 'food'}>
        {today && tab === 'food' && <Food today={today} sub={sub} version={version} wide={wide} onChanged={() => { setStill(true); if (day) loadDay(day); }}
          onAddMeal={d => open({ kind: 'meal', day: d })} onAddDrink={d => open({ kind: 'drink', day: d })} onMeal={meal => open({ kind: 'meal', meal })} onDrink={drink => open({ kind: 'drink', drink })} onPro={(w, d) => pro(w, undefined, d)} />}
      </section>
      <section className="screen" data-pos={pos('goal')} aria-hidden={tab !== 'goal'}>
        {tab === 'goal' && <Goal wide={wide} onBack={() => setTab(back)} onWeigh={() => open({ kind: 'weight' })} onRedo={() => setRedo(true)} onChanged={() => { setDays({}); if (day) loadDay(day); }} />}
      </section>
      <section className="screen" data-pos={pos('stats')} aria-hidden={tab !== 'stats'}>
        {tab === 'stats' && <Stats wide={wide} tab={statsTab} onBack={() => setTab(back)} />}
      </section>
      <section className="screen" data-pos={pos('more')} aria-hidden={tab !== 'more'}>
        <More me={me} onPro={pro} onSaved={st => setMe(m => m && m.profile ? { ...m, profile: { ...m.profile, settings: st } } : m)} onPaywall={focus => open({ kind: 'paywall', focus })} onSettings={() => open({ kind: 'settings' })} onInstall={() => open({ kind: 'install' })}
          onLogout={async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); setMe(null); setDays({}); setDay(null); setToday(null); setTab('today'); }} />
      </section>
    </div>
    <nav className="tabs" aria-label="Разделы">
      {(wide ? WIDE_TABS : TABS).map(([name, icon, label]) => <button key={name} className={`tab ${name === 'add' ? 'add' : ''}`} aria-current={tab === name ? 'page' : undefined} onClick={() => go(name)} aria-label={label}>
        <span className="pill"><Icon name={icon} /></span>{label}{(name === 'goal' || name === 'stats') && !can(sub, name) && <span className="lock dock-lock">PRO</span>}</button>)}
    </nav>

    <Sheet open={sheetOpen} onClose={close} tall={sheet.kind === 'paywall' || sheet.kind === 'search' || sheet.kind === 'ai'} title={sheet.kind === 'add' && sheet.at ? `Записать на ${sheet.at}` : TITLES[sheet.kind] ?? ''}>
      {sheet.kind === 'add' && <>
        <div className="big2">
          <button className="bigt" style={{ background: 'var(--food)' }} onClick={() => open({ kind: 'meal', at: sheet.at })}><span className="chip-ic"><Icon name="food" /></span><b>Приём пищи</b><small>калории и БЖУ вручную</small></button>
          <button className="bigt" style={{ background: 'var(--navy)' }} onClick={() => pro('Фото и описание еды', sheet.at)}><span className="chip-ic"><Icon name="camera" /></span><b>Фото еды</b><small>калории посчитает ИИ</small>{!can(sub, 'food') && <span className="lock">PRO</span>}</button>
        </div>
        <div className="water">
          <span className="chip-ic" style={{ ['--c' as string]: 'var(--water)' }}><Icon name="drop" /></span>
          <span className="mid"><b>Вода</b><small>{fmt1((foodPart?.waterMl ?? 0) / 1000)} из {fmt1((foodPart?.norm.water ?? 2000) / 1000)} л</small></span>
          <button className="ml" onClick={() => addWater(250, sheet.at)}>+250</button><button className="ml" onClick={() => addWater(500, sheet.at)}>+500</button>
          <button className="ml" onClick={() => open({ kind: 'drink', at: sheet.at })} aria-label="Другой напиток">…</button>
        </div>
        <div className="grid4">
          <button className="tile" onClick={() => open({ kind: 'weight' })}><span className="chip-ic" style={{ ['--c' as string]: 'var(--navy)' }}><Icon name="today" /></span>Вес</button>
          <button className="tile" onClick={() => open({ kind: 'steps' })}><span className="chip-ic" style={{ ['--c' as string]: 'var(--steps)' }}><Icon name="steps" /></span>Шаги</button>
          <button className="tile" onClick={() => open({ kind: 'task', day })}><span className="chip-ic" style={{ ['--c' as string]: 'var(--quiz)' }}><Icon name="task" /></span>Задача</button>
          {lockTile('Поиск еды', 'search', 'var(--food)')}
          {lockTile('Зал', 'gym', 'var(--gym)')}{lockTile('Учёба', 'study', 'var(--study)')}{lockTile('Трата', 'money', 'var(--money)')}{lockTile('Чтение', 'books', 'var(--books)')}
        </div>
      </>}
      {sheet.kind === 'meal' && day && <MealForm key={sheet.meal?.id ?? 'new'} day={sheet.meal?.day ?? sheet.day ?? day} time={sheet.at} meal={sheet.meal} onDone={done} />}
      {sheet.kind === 'drink' && day && <DrinkForm key={sheet.drink?.id ?? 'new'} day={sheet.drink?.day ?? sheet.day ?? day} time={sheet.at} drink={sheet.drink} onDone={done} />}
      {sheet.kind === 'steps' && day && <NumberForm kind="steps" day={day} value={body?.steps || null} onDone={done} />}
      {sheet.kind === 'weight' && day && <NumberForm kind="weight" day={day} value={body?.weight?.today ? body.weight.kg : null} onDone={done} />}
      {sheet.kind === 'task' && <TaskForm key={sheet.task?.id ?? `new-${sheet.day}`} day={sheet.day} task={sheet.task} onDone={done} />}
      {sheet.kind === 'paywall' && <Paywall sub={sub} focus={sheet.focus} onChange={setSub} onClose={close} />}
      {sheet.kind === 'settings' && <SettingsForm me={me} onDone={s => { setMe(m => m && m.profile ? { ...m, profile: { ...m.profile, settings: s } } : m); done(); setDays({}); }} onRedo={() => { close(); setRedo(true); }} />}
      {sheet.kind === 'install' && <InstallHelp />}
      {sheet.kind === 'search' && day && <FoodSearch day={sheet.day ?? day} time={sheet.at} onDone={done} />}
      {sheet.kind === 'ai' && day && <FoodAi key={sheet.mode} day={sheet.day ?? day} time={sheet.at} mode={sheet.mode} onDone={done} />}
    </Sheet>
  </div>;
}
