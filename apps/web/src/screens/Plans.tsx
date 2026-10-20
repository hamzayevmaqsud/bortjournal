/** «Планы» (бесплатно — задачи): неделя полосой дней, задачи дня и без даты, добавление и правка */
import { can } from '../lib/features';
import { useCallback, useEffect, useState } from 'react';
import { addDays, parseDay } from '@bortjournal/core';
import { api, type Subscription, type TaskFull } from '../lib/api';
import { MONG, plural } from '../lib/format';
import { Icon } from '../components/Icon';
import { Tasks } from '../components/Tasks';

const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const mondayOf = (d: string) => addDays(d, -((parseDay(d).getUTCDay() + 6) % 7));

export function Plans({ today, sub, version, onAdd, onOpen, onPro, onChanged }: {
  today: string; sub: Subscription; version: number;
  onAdd: (day: string | null) => void; onOpen: (t: TaskFull) => void; onPro: (what: string) => void; onChanged: () => void;
}) {
  const [mon, setMon] = useState(mondayOf(today)), [day, setDay] = useState(today), [items, setItems] = useState<TaskFull[] | null>(null);
  const load = useCallback(async () => { try { setItems((await api<{ items: TaskFull[] }>(`/api/plans/tasks?from=${mon}&to=${addDays(mon, 6)}`)).items); } catch { setItems([]); } }, [mon]);
  useEffect(() => { load(); }, [load, version]);
  const week = Array.from({ length: 7 }, (_, k) => addDays(mon, k));
  const ofDay = (d: string | null) => (items ?? []).filter(t => t.day === d);
  const toggle = async (id: string) => { setItems(xs => xs?.map(t => t.id === id ? { ...t, done: !t.done } : t) ?? xs); await api(`/api/plans/tasks/${id}/toggle`, { method: 'POST' }).catch(() => load()); onChanged(); };
  const dd = parseDay(day), list = ofDay(day), undated = ofDay(null);
  return <div className="day plans-page">
    <header className="dayhead">
      <button className="nav" onClick={() => { setMon(addDays(mon, -7)); setDay(addDays(day, -7)); }} aria-label="Прошлая неделя"><Icon name="chevL" /></button>
      <div className="daytitle"><span>планы · неделя</span><b>{parseDay(mon).getUTCDate()}–{parseDay(addDays(mon, 6)).getUTCDate()} {MONG[parseDay(addDays(mon, 6)).getUTCMonth()]}</b></div>
      <button className="nav" onClick={() => { setMon(addDays(mon, 7)); setDay(addDays(day, 7)); }} aria-label="Следующая неделя"><Icon name="chev" /></button>
    </header>
    <div className="wk" role="tablist">{week.map((d, k) => { const n = ofDay(d), done = n.filter(t => t.done).length; return <button key={d} role="tab" aria-selected={d === day} className={`wk-d ${d === day ? 'on' : ''} ${d === today ? 'today' : ''}`} onClick={() => setDay(d)}>
      <span>{d === today ? 'сег' : WD[k]}</span><b>{parseDay(d).getUTCDate()}</b><i>{n.length ? `${done}/${n.length}` : '·'}</i></button>; })}</div>
    <section className="panel">
      <div className="panel-h"><h2>{day === today ? 'Сегодня' : `${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][dd.getUTCDay()]}, ${dd.getUTCDate()} ${MONG[dd.getUTCMonth()]}`}</h2><small>{list.length ? `${list.filter(t => t.done).length} из ${list.length}` : ''}</small></div>
      {items === null ? <div className="skel" style={{ height: 90 }} /> : <Tasks tasks={list} onToggle={toggle} onOpen={id => { const t = list.find(x => x.id === id); if (t) onOpen(t); }} empty="На этот день задач нет." />}
      <button className="add-row" onClick={() => onAdd(day)}><Icon name="plus" />Задача на этот день</button>
    </section>
    <section className="panel">
      <div className="panel-h"><h2>Без даты</h2><small>{undated.length ? `${undated.length} ${plural(undated.length, 'задача', 'задачи', 'задач')}` : ''}</small></div>
      <Tasks tasks={undated} onToggle={toggle} onOpen={id => { const t = undated.find(x => x.id === id); if (t) onOpen(t); }} empty="Сюда — то, что сделать когда-нибудь." />
      <button className="add-row" onClick={() => onAdd(null)}><Icon name="plus" />Задача без даты</button>
    </section>
    <button className="pro-card" onClick={() => onPro('Цели и повторы')}>
      <span className="chip-ic" style={{ ['--c' as string]: 'var(--orange)' }}><Icon name="repeat" /></span>
      <span className="mid"><b>Цели на неделю–год и повторяющиеся задачи</b><small>{can(sub, 'plans') ? (sub.source === 'free' ? 'переезжают в новую версию — пока в старой' : 'скоро — в ближайшем обновлении') : 'часть Pro'}</small></span>
      {!can(sub, 'plans') && <span className="lock">PRO</span>}
    </button>
  </div>;
}
