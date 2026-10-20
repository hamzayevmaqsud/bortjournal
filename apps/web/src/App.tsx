/**
 * Каркас: вход → экраны с нижней панелью. Данные дня кэшируются по дате, поэтому
 * смахивание к уже открытому дню мгновенное. Действия срабатывают на экране сразу,
 * сервер догоняет в фоне; удаление отправляется через 5 секунд, если не нажали «Вернуть».
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays } from '@bortjournal/core';
import { api, ApiError, type FoodDay, type Me, type Today as TodayData } from './lib/api';
import { fmt1 } from './lib/format';
import { buzz } from './lib/motion';
import { Icon } from './components/Icon';
import { Sheet } from './components/Sheet';
import { useToast } from './components/Toasts';
import type { Mark } from './components/Timeline';
import { Food } from './screens/Food';
import { Login } from './screens/Login';
import { Today } from './screens/Today';

const TABS: Array<[string, string, string]> = [['today', 'today', 'Сегодня'], ['plans', 'plans', 'Планы'], ['add', 'plus', 'Записать'], ['food', 'food', 'Еда'], ['more', 'more', 'Ещё']];
const ORDER = ['today', 'plans', 'food', 'more'];
// пояс телефона — серверу, чтобы «сегодня» и «сейчас» совпадали с часами человека
const ME = `/api/me?tz=${-new Date().getTimezoneOffset()}`;

export function App() {
  const toast = useToast();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState('today'), prevTab = useRef('today');
  const [day, setDay] = useState<string | null>(null), [today, setToday] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, TodayData>>({});
  const [food, setFood] = useState<FoodDay | null>(null);
  const [sheet, setSheet] = useState<{ open: boolean; at?: string }>({ open: false });
  const [still, setStill] = useState(false);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { setMe(null); return; }
    toast(e instanceof Error ? e.message : 'Что-то пошло не так', { err: true });
  }, [toast]);

  const loadDay = useCallback(async (d?: string) => {
    try {
      const t = await api<TodayData>(`/api/today${d ? `?day=${d}` : ''}`);
      setDays(x => ({ ...x, [t.day]: t }));
      if (!d) { setToday(t.now.day); setDay(t.now.day); }
      return t;
    } catch (e) { fail(e); return null; }
  }, [fail]);
  const loadFood = useCallback(async (d: string) => { try { setFood(await api<FoodDay>(`/api/food/day?day=${d}`)); } catch (e) { fail(e); } }, [fail]);

  useEffect(() => { api<Me>(ME).then(m => { setMe(m); loadDay(); }, () => setMe(null)); }, [loadDay]);
  useEffect(() => { if (day && !days[day]) loadDay(day); }, [day, days, loadDay]);
  useEffect(() => { if (tab === 'food' && today) loadFood(today); }, [tab, today, loadFood]);

  const data = day ? days[day] ?? null : null;
  const patch = (fn: (t: TodayData) => TodayData) => { if (!day) return; setStill(true); setDays(x => x[day] ? { ...x, [day]: fn(structuredClone(x[day]!)) } : x); };

  const goDay = useCallback((dir: number) => {
    setStill(false);
    setDay(d => { if (!d || !today) return d; const next = addDays(d, dir); return next > addDays(today, 7) ? d : next; });
  }, [today]);

  const addWater = async (ml: number) => {
    if (!day || !data) return;
    const time = sheet.at ?? (data.isToday ? data.now.hm : '12:00');
    setSheet({ open: false }); buzz([8, 40, 8]);
    patch(t => { if (t.parts.food) t.parts.food.waterMl += ml; t.events.push({ id: `tmp-${Date.now()}`, module: 'food', kind: 'drink', time, title: 'Вода без газа', value: ml, unit: 'ml', data: null }); return t; });
    toast(`+${ml} мл воды`);
    try { await api('/api/food/drinks', { method: 'POST', body: { day, time, type: 'water', ml } }); await loadDay(day); } catch (e) { fail(e); loadDay(day); }
  };

  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const deleteMark = (m: Mark) => {
    if (!day) return; buzz(14);
    const before = days[day];
    patch(t => { t.events = t.events.filter(e => e.id !== m.id); if (t.parts.food) { if (m.kcal) t.parts.food.kcal -= m.kcal; if (m.ml) t.parts.food.waterMl -= m.ml; } return t; });
    const d = day;
    pending.current.set(m.id, setTimeout(async () => {
      pending.current.delete(m.id);
      try { await api(`/api/food/entries/${m.id}`, { method: 'DELETE' }); loadDay(d); } catch (e) { fail(e); loadDay(d); }
    }, 5000));
    toast(`«${m.title}» удалено`, { undo: () => { clearTimeout(pending.current.get(m.id)); pending.current.delete(m.id); if (before) setDays(x => ({ ...x, [d]: before })); } });
  };

  const toggleTask = async (id: string) => {
    if (!day) return;
    patch(t => { const x = t.parts.plans?.tasks.find(k => k.id === id); if (x) x.done = !x.done; return t; });
    try { await api(`/api/plans/tasks/${id}/toggle`, { method: 'POST' }); } catch (e) { fail(e); loadDay(day); }
  };

  const go = (name: string) => {
    if (name === 'add') { setSheet({ open: true }); return; }
    prevTab.current = tab; setTab(name); buzz(6);
  };
  const soon = (what: string) => toast(`«${what}» переезжает в новую версию — пока он в старой`);

  if (me === undefined) return <div className="app" />;
  if (me === null) return <Login onDone={() => api<Me>(ME).then(m => { setMe(m); loadDay(); }, fail)} />;

  const pos = (name: string) => name === tab ? 'center' : ORDER.indexOf(name) < ORDER.indexOf(tab) ? 'left' : 'right';
  const foodPart = data?.parts.food;
  return <div className="app">
    <div className="screens">
      <section className="screen" data-pos={pos('today')} aria-hidden={tab !== 'today'}>
        {day && today && <Today data={data} day={day} today={today} still={still} onDay={goDay} onAdd={at => setSheet({ open: true, at })} onDelete={deleteMark} onToggleTask={toggleTask} onGo={go} onSoon={soon} />}
      </section>
      <section className="screen" data-pos={pos('plans')} aria-hidden={tab !== 'plans'}><div className="soon"><b>Планы</b>Переезжают в новую версию следующими. Пока они в старой.</div></section>
      <section className="screen" data-pos={pos('food')} aria-hidden={tab !== 'food'}>{tab === 'food' || food ? <Food data={food} norm={{ kcal: foodPart?.norm.kcal ?? data?.plan.kcal ?? 2200, protein: foodPart?.norm.protein ?? data?.plan.protein ?? 0 }} /> : null}</section>
      <section className="screen" data-pos={pos('more')} aria-hidden={tab !== 'more'}><div className="soon"><b>Ещё</b>Учёба, зал, бюджет, книги и статистика — переезжают по одному.
        <button style={{ marginTop: 12, color: 'var(--bad)', fontWeight: 700 }} onClick={async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); setMe(null); setDays({}); }}>Выйти</button></div></section>
    </div>
    <nav className="tabs" aria-label="Разделы">
      {TABS.map(([name, icon, label]) => <button key={name} className={`tab ${name === 'add' ? 'add' : ''}`} aria-current={tab === name ? 'page' : undefined} onClick={() => go(name)} aria-label={label}>
        <span className="pill"><Icon name={icon} /></span>{label}</button>)}
    </nav>
    <Sheet open={sheet.open} onClose={() => setSheet({ open: false })} title={sheet.at ? `Записать на ${sheet.at}` : 'Записать'}>
      <div className="big2">
        <button className="bigt" style={{ background: 'var(--food)' }} onClick={() => { setSheet({ open: false }); soon('Фото еды'); }}><span className="chip-ic"><Icon name="camera" /></span><b>Фото еды</b><small>калории посчитает ИИ</small></button>
        <button className="bigt" style={{ background: 'var(--navy)' }} onClick={() => { setSheet({ open: false }); soon('Поиск еды'); }}><span className="chip-ic"><Icon name="search" /></span><b>Найти еду</b><small>«гречка 200», плов…</small></button>
      </div>
      <div className="water">
        <span className="chip-ic" style={{ ['--c' as string]: 'var(--water)' }}><Icon name="drop" /></span>
        <span className="mid"><b>Вода</b><small>{fmt1((foodPart?.waterMl ?? 0) / 1000)} из {fmt1((foodPart?.norm.water ?? 2000) / 1000)} л</small></span>
        <button className="ml" onClick={() => addWater(250)}>+250</button><button className="ml" onClick={() => addWater(500)}>+500</button>
      </div>
      <div className="grid4">
        {[['Вес', 'edit', 'var(--navy)'], ['Шаги', 'steps', 'var(--steps)'], ['Зал', 'gym', 'var(--gym)'], ['Учёба', 'study', 'var(--study)'], ['Задача', 'task', 'var(--quiz)'], ['Трата', 'money', 'var(--money)'], ['Чтение', 'books', 'var(--books)'], ['Заметка', 'edit', 'var(--bad)']].map(([n, ic, c]) =>
          <button key={n} className="tile" onClick={() => { setSheet({ open: false }); soon(n!); }}><span className="chip-ic" style={{ ['--c' as string]: c }}><Icon name={ic!} /></span>{n}</button>)}
      </div>
    </Sheet>
  </div>;
}
