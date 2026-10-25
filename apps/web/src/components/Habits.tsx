/**
 * Свои привычки на экране «Сегодня»: крупная круглая галочка, серия и семь точек за неделю.
 * Отметка — сразу на экране (без сети встаёт в очередь), при ошибке откатывается.
 * «Изменить» переводит строки в правку: название, выше/ниже, в архив.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fromCache, type Habit, type HabitsDay } from '../lib/api';
import { plural } from '../lib/format';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import '../styles/habits.css';

const SUGGEST = ['Медитация', 'Витамины', 'Без сладкого', '10 000 шагов'];
const colorOf = (h: Habit) => `var(--${h.color ?? 'orange'})`;
const err = (e: unknown) => e instanceof Error ? e.message : 'Не получилось';

export function Habits({ day, today, isToday, index = 8 }: { day: string; today: string; isToday: boolean; index?: number }) {
  const toast = useToast();
  const [items, setItems] = useState<Habit[] | null>(null), [limit, setLimit] = useState(20);
  const [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [edit, setEdit] = useState(false);
  const want = useRef(day), list = useRef<Habit[] | null>(null);
  list.current = items;

  const load = useCallback(async (d: string) => {
    want.current = d;
    try {
      const r = await api<HabitsDay>(`/api/habits?day=${d}`);
      if (want.current !== d) return;
      // копия без сети не затирает то, что человек только что отметил
      if (fromCache(r) && list.current) return;
      setItems(r.items); setLimit(r.limit);
    } catch { if (want.current === d) setItems(x => x ?? []); }
  }, []);
  useEffect(() => { setItems(null); void load(day); }, [day, load]);
  useEffect(() => { const on = () => void load(want.current); addEventListener('bj-synced', on); return () => removeEventListener('bj-synced', on); }, [load]);

  const future = day > today;
  const toggle = async (h: Habit) => {
    if (future) return;
    const done = !h.done, last7 = [...h.last7.slice(0, 6), done];
    buzz(done ? [10, 30, 10] : 8);
    setItems(xs => xs?.map(x => x.id === h.id ? { ...x, done, streak: Math.max(0, x.streak + (done ? 1 : -1)), last7 } : x) ?? xs);
    try {
      const r = await api<{ queued?: boolean; done: boolean; streak: number; last7: boolean[] }>(`/api/habits/${h.id}/check`, { method: 'PUT', body: { day, done } });
      if (!r.queued && want.current === day) setItems(xs => xs?.map(x => x.id === h.id ? { ...x, done: r.done, streak: r.streak, last7: r.last7 } : x) ?? xs);
    } catch (e) {
      setItems(xs => xs?.map(x => x.id === h.id ? h : x) ?? xs);
      toast(err(e), { err: true });
    }
  };

  const add = async (t: string) => {
    t = t.trim(); if (!t || busy) return;
    setBusy(true);
    try {
      const h = await api<Habit>('/api/habits', { method: 'POST', body: { title: t } });
      // новая привычка пришла на «сегодня» — на другой день просто перечитываем
      if (day === today) setItems(xs => [...(xs ?? []), h]); else void load(day);
      setTitle(''); buzz(8);
    } catch (e) { toast(err(e), { err: true }); } finally { setBusy(false); }
  };

  const rename = async (h: Habit, v: string) => {
    v = v.replace(/\s+/g, ' ').trim();
    if (!v || v === h.title) return;
    setItems(xs => xs?.map(x => x.id === h.id ? { ...x, title: v } : x) ?? xs);
    try { await api(`/api/habits/${h.id}`, { method: 'PUT', body: { title: v } }); }
    catch (e) { setItems(xs => xs?.map(x => x.id === h.id ? { ...x, title: h.title } : x) ?? xs); toast(err(e), { err: true }); }
  };

  const move = async (i: number, dir: -1 | 1) => {
    const xs = items; if (!xs) return;
    const j = i + dir; if (j < 0 || j >= xs.length) return;
    const next = [...xs]; [next[i], next[j]] = [next[j]!, next[i]!];
    setItems(next); buzz(6);
    try { await api('/api/habits/order', { method: 'PUT', body: { ids: next.map(x => x.id) } }); }
    catch (e) { setItems(xs); toast(err(e), { err: true }); }
  };

  const archive = async (h: Habit) => {
    const xs = items;
    setItems(xs?.filter(x => x.id !== h.id) ?? null);
    try { await api(`/api/habits/${h.id}/archive`, { method: 'POST' }); toast(`«${h.title}» — в архиве`); }
    catch (e) { setItems(xs); toast(err(e), { err: true }); }
  };

  const n = items?.length ?? 0, done = items?.filter(h => h.done).length ?? 0;
  return <section className="wc span7 c-habits" data-tour="habits" style={{ ['--i' as string]: index }} aria-labelledby="hb-h">
    <div className="card-head">
      <h2 id="hb-h">Привычки</h2>
      <div className="card-actions">
        {n > 0 && !edit && <span className="count">{done} из {n}</span>}
        {n > 0 && <button className="link-btn hb-edit" onClick={() => setEdit(e => !e)} aria-pressed={edit}>{edit ? 'Готово' : 'Изменить'}</button>}
      </div>
    </div>

    {items === null ? <div className="hb-skel" aria-hidden="true"><i /><i /></div>
      : n === 0 ? <div className="hb-empty">
        <p>Своё маленькое «каждый день»: отмечай — и смотри, как растёт серия.</p>
        <div className="hb-sugg">{SUGGEST.map(t => <button key={t} className="chip" disabled={busy} onClick={() => add(t)}><Icon name="plus" />{t}</button>)}</div>
      </div>
      : <ul className={`hb-list ${edit ? 'editing' : ''}`}>
        {items.map((h, i) => <li key={h.id} className={`hb-row ${h.done ? 'on' : ''}`} style={{ ['--c' as string]: colorOf(h) }}>
          {edit ? <>
            <input className="in hb-name" defaultValue={h.title} maxLength={60} aria-label={`Название привычки «${h.title}»`}
              onBlur={e => rename(h, e.currentTarget.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = h.title; e.currentTarget.blur(); } }} />
            <button className="hb-tool up" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`«${h.title}» выше`}><Icon name="chev" /></button>
            <button className="hb-tool down" onClick={() => move(i, 1)} disabled={i === n - 1} aria-label={`«${h.title}» ниже`}><Icon name="chev" /></button>
            <button className="hb-tool del" onClick={() => archive(h)} aria-label={`«${h.title}» в архив`}><Icon name="trash" /></button>
          </> : <>
            <button className="hb-check" onClick={() => toggle(h)} disabled={future} aria-pressed={h.done}
              aria-label={`Сделано: ${h.title}`} title={future ? 'Этот день ещё не наступил' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
            </button>
            <div className="hb-mid">
              <span className="hb-title">{h.icon && <span className="hb-ic" aria-hidden="true">{h.icon}</span>}{h.title}</span>
              <span className="hb-dots" role="img" aria-label={`За 7 дней: ${h.last7.filter(Boolean).length} из 7`}>
                {h.last7.map((on, k) => <i key={k} className={`${on ? 'on' : ''} ${k === 6 ? 'cur' : ''}`} />)}
              </span>
            </div>
            <span className={`hb-streak ${h.streak ? 'hot' : ''}`} aria-label={`Серия: ${h.streak} ${plural(h.streak, 'день', 'дня', 'дней')}`}>
              <Icon name="flame" /><b>{h.streak}</b>
            </span>
          </>}
        </li>)}
      </ul>}

    {items !== null && !edit && (n < limit
      ? <form className="task-add hb-add" onSubmit={e => { e.preventDefault(); void add(title); }}>
        <input className="in" value={title} onChange={e => setTitle(e.target.value)} maxLength={60} placeholder="Новая привычка…" aria-label="Новая привычка" />
        <button className="primary" disabled={!title.trim() || busy}><Icon name="plus" />Привычка</button>
      </form>
      : <p className="card-note">Это все {limit} привычек. Чтобы добавить новую, убери одну в архив.</p>)}
  </section>;
}
