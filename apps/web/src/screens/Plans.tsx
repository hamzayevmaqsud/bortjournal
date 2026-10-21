/**
 * «Планы». Задачи — бесплатно: неделя полосой дней, задачи дня и без даты.
 * «Цели и повторы» (набор): цели на неделю, месяц, квартал и год с прогрессом по задачам и подцелям,
 * календарь месяца, повторяющиеся задачи (их ставят в форме задачи).
 */
import { useCallback, useEffect, useState } from 'react';
import { addDays, mondayOf, parseDay, PERIOD_ACC, PERIOD_KINDS, PERIOD_NAMES, PERIOD_PARENT, periodKey, periodLabel, periodRange, shiftPeriod, type PeriodKind } from '@bortjournal/core';
import { api, ApiError, type Goal, type Subscription, type TaskFull } from '../lib/api';
import { can } from '../lib/features';
import { MONG, plural } from '../lib/format';
import { buzz } from '../lib/motion';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { Tasks } from '../components/Tasks';
import { useToast } from '../components/Toasts';

interface Note { id: string; text: string; source: string; done: boolean; createdAt: string }
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const NOW_BTN: Record<PeriodKind, string> = { week: 'К этой неделе', month: 'К этому месяцу', quarter: 'К этому кварталу', year: 'К этому году' };
const PH: Record<PeriodKind, string> = { week: 'Например: дочитать раздел и ответить на вопросы', month: 'Например: закончить проект и написать отчёт', quarter: 'Например: выйти на 10 000 шагов каждый день', year: 'Например: сдать сертификацию' };

function GoalRow({ g, parent, onToggle, onOpen }: { g: Goal; parent?: Goal; onToggle: () => void; onOpen: () => void }) {
  const sub = [parent ? `↳ ${parent.title}` : '', g.tasks ? `${g.tasksDone}/${g.tasks} ${plural(g.tasks, 'задача', 'задачи', 'задач')}` : '', g.kids ? `${g.kids} ${plural(g.kids, 'подцель', 'подцели', 'подцелей')}` : ''].filter(Boolean).join(' · ');
  return <div className={`goal-r ${g.progress >= 100 ? 'done' : ''}`}>
    <button className={`cbx ${g.done ? 'on' : ''}`} aria-label={g.done ? 'Снять отметку' : 'Отметить выполненной'} aria-pressed={g.done} onClick={() => { buzz(g.done ? 8 : [10, 30, 10]); onToggle(); }}><Icon name="check" className="" /></button>
    <button className="goal-main" onClick={onOpen}><b>{g.title}</b>{sub && <small>{sub}</small>}</button>
    <span className="goal-pr"><span className="wbar"><i style={{ width: `${g.progress}%`, background: g.progress >= 100 ? 'var(--good)' : 'var(--orange)' }} /></span><b>{g.progress}%</b></span>
  </div>;
}

function GoalForm({ g, kind, pkey, parents, onDone }: { g?: Goal; kind: PeriodKind; pkey: string; parents: Goal[]; onDone: () => void }) {
  const toast = useToast(), [v, setV] = useState({ title: g?.title ?? '', note: g?.note ?? '', parentId: g?.parentId ?? '' }), [busy, setBusy] = useState(false);
  const pk = PERIOD_PARENT[kind];
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast(ok); onDone(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); } finally { setBusy(false); } };
  const body = { title: v.title, note: v.note, parentId: v.parentId || null };
  return <form className="form" onSubmit={e => { e.preventDefault(); run(() => g ? api(`/api/plans/goals/${g.id}`, { method: 'PUT', body }) : api('/api/plans/goals', { method: 'POST', body: { ...body, period: kind, periodKey: pkey } }), g ? 'Сохранено' : 'Цель добавлена'); }}>
    <label className="fld"><span>Цель · {periodLabel(kind, pkey)}</span><input className="in" required maxLength={200} autoComplete="off" placeholder={PH[kind]} value={v.title} onChange={e => setV({ ...v, title: e.target.value })} /></label>
    {pk && parents.length > 0 && <label className="fld"><span>Часть цели на {PERIOD_ACC[pk]}</span><select className="in" value={v.parentId} onChange={e => setV({ ...v, parentId: e.target.value })}><option value="">— не связана —</option>{parents.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
    <label className="fld"><span>Заметка</span><textarea className="in" rows={2} placeholder="Зачем, критерий готовности" value={v.note} onChange={e => setV({ ...v, note: e.target.value })} /></label>
    {g && <p className="card-note">Прогресс считается по задачам этой цели{kind !== 'week' ? ' и по вложенным целям' : ''}. Привязать задачу к цели можно в форме задачи. Если задач нет — отметь цель галочкой.</p>}
    <div className="row-btns">
      {g && <button type="button" className="danger" disabled={busy} onClick={() => run(() => api(`/api/plans/goals/${g.id}`, { method: 'DELETE' }), 'Цель удалена')}>Удалить</button>}
      <button className="primary" disabled={busy}>{g ? 'Сохранить' : 'Добавить'}</button>
    </div>
  </form>;
}

export function Plans({ today, sub, version, onAdd, onOpen, onPro, onChanged }: {
  today: string; sub: Subscription; version: number;
  onAdd: (day: string | null) => void; onOpen: (t: TaskFull) => void; onPro: (what: string) => void; onChanged: () => void;
}) {
  const pro = can(sub, 'plans');
  const [kind, setKind] = useState<PeriodKind>('week'), [anchor, setAnchor] = useState(today), [day, setDay] = useState(today);
  const [items, setItems] = useState<TaskFull[] | null>(null), [goals, setGoals] = useState<Goal[]>([]), [v, setV] = useState(0);
  const [sheet, setSheet] = useState<null | { g?: Goal; kind: PeriodKind; key: string }>(null), [formParents, setFormParents] = useState<Goal[]>([]);
  const [notes, setNotes] = useState<Note[]>([]), [noteText, setNoteText] = useState('');
  const k = pro ? kind : 'week', key = periodKey(k, anchor), [from, to] = periodRange(k, key);
  const load = useCallback(async () => {
    try { setItems((await api<{ items: TaskFull[] }>(`/api/plans/tasks?from=${from}&to=${to}`)).items); } catch { setItems([]); }
    if (pro) api<{ items: Goal[] }>(`/api/plans/goals?from=${from}&to=${to}`).then(r => setGoals(r.items), () => setGoals([]));
    api<{ items: Note[] }>('/api/plans/notes').then(r => setNotes(r.items), () => {});
  }, [from, to, pro]);
  useEffect(() => { load(); }, [load, version, v]);
  // родительская цель может лежать вне видимого периода (месяц для недели на стыке) — для формы берём по началу периода
  useEffect(() => {
    if (!sheet) return; const par = PERIOD_PARENT[sheet.kind]; if (!par) { setFormParents([]); return; }
    const start = periodRange(sheet.kind, sheet.key)[0];
    api<{ items: Goal[] }>(`/api/plans/goals?from=${start}&to=${start}`).then(r => setFormParents(r.items.filter(g => g.period === par)), () => setFormParents([]));
  }, [sheet]);
  const changed = () => { setV(x => x + 1); onChanged(); };
  const ofDay = (d: string | null) => (items ?? []).filter(t => t.day === d);
  const toggle = async (id: string) => { setItems(xs => xs?.map(t => t.id === id ? { ...t, done: !t.done } : t) ?? xs); await api(`/api/plans/tasks/${id}/toggle`, { method: 'POST' }).catch(() => {}); changed(); };
  const toggleGoal = async (id: string) => { setGoals(gs => gs.map(g => g.id === id ? { ...g, done: !g.done } : g)); await api(`/api/plans/goals/${id}/toggle`, { method: 'POST' }).catch(() => {}); setV(x => x + 1); };
  const noteDone = async (n: Note) => { setNotes(ns => ns.map(x => x.id === n.id ? { ...x, done: !x.done } : x)); await api(`/api/plans/notes/${n.id}`, { method: 'PUT', body: { done: !n.done } }).catch(() => {}); };
  const noteDel = async (n: Note) => { setNotes(ns => ns.filter(x => x.id !== n.id)); await api(`/api/plans/notes/${n.id}`, { method: 'DELETE' }).catch(() => {}); };
  const byId = new Map(goals.map(g => [g.id, g]));
  const goalsOf = (pk: PeriodKind, pkey: string) => goals.filter(g => g.period === pk && g.periodKey === pkey);
  const rows = (gs: Goal[]) => <div className="goals-l">{gs.map(g => <GoalRow key={g.id} g={g} parent={g.parentId ? byId.get(g.parentId) : undefined} onToggle={() => toggleGoal(g.id)} onOpen={() => setSheet({ g, kind: g.period, key: g.periodKey })} />)}</div>;
  const goalBlock = (pk: PeriodKind, pkey: string) => { const gs = goalsOf(pk, pkey); return <>
    {gs.length ? rows(gs) : <p className="hint" style={{ textAlign: 'left', margin: 2 }}>Целей на {pk === 'week' ? 'эту неделю' : periodLabel(pk, pkey).toLowerCase()} пока нет.</p>}
    <button className="add-row" onClick={() => setSheet({ kind: pk, key: pkey })}><Icon name="plus" />Цель на {PERIOD_ACC[pk]}</button></>; };
  const go = (n: number) => { setAnchor(shiftPeriod(k, anchor, n)); if (k === 'week') setDay(addDays(day, 7 * n)); };
  const open = (pk: PeriodKind, d: string) => { setKind(pk); setAnchor(d); if (pk === 'week') setDay(d); };
  const isNow = key === periodKey(k, today);

  const weekView = () => {
    const mon = key, week = Array.from({ length: 7 }, (_, i) => addDays(mon, i)), dd = parseDay(day), list = ofDay(day), undated = ofDay(null);
    const ups = pro ? (['month', 'quarter', 'year'] as const).flatMap(pk => goalsOf(pk, periodKey(pk, mon))) : [];
    return <>
      {pro && <section className="panel span-all"><div className="panel-h"><h2>Цели недели</h2></div>
        {goalBlock('week', mon)}
        {ups.length > 0 && <div className="goal-ups"><span>Большие цели</span>{ups.map(g => <button key={g.id} className="chip" onClick={() => open(g.period, periodRange(g.period, g.periodKey)[0])}>{PERIOD_NAMES[g.period]}: {g.title} <small>{g.progress}%</small></button>)}</div>}
      </section>}
      <div className="wk" role="tablist">{week.map((d, i) => { const n = ofDay(d), done = n.filter(t => t.done).length; return <button key={d} role="tab" aria-selected={d === day} className={`wk-d ${d === day ? 'on' : ''} ${d === today ? 'today' : ''}`} onClick={() => setDay(d)}>
        <span>{d === today ? 'сег' : WD[i]}</span><b>{parseDay(d).getUTCDate()}</b><i>{n.length ? `${done}/${n.length}` : '·'}</i></button>; })}</div>
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
      <section className="panel">
        <div className="panel-h"><h2>Заметки</h2><small>{notes.filter(n => !n.done).length || ''}</small></div>
        {notes.length ? <div className="notes-l">{notes.map(n => <div key={n.id} className={`note-r ${n.done ? 'done' : ''}`}>
          <button className={`cbx ${n.done ? 'on' : ''}`} aria-label={n.done ? 'Вернуть' : 'Готово'} onClick={() => noteDone(n)}><Icon name="check" className="" /></button>
          <span className="note-t">{n.source === 'voice' && <Icon name="mic" className="ic note-mic" />}{n.text}</span>
          <button className="ico" aria-label="Удалить заметку" onClick={() => noteDel(n)}><Icon name="trash" /></button></div>)}</div>
          : <p className="hint" style={{ textAlign: 'left', margin: 2 }}>Мысли и идеи без срока. Можно надиктовать: «Записать» → «Голосом».</p>}
        <form className="task-add" style={{ marginTop: 8 }} onSubmit={async e => { e.preventDefault(); if (!noteText.trim()) return; await api('/api/plans/notes', { method: 'POST', body: { text: noteText } }).catch(() => {}); setNoteText(''); setV(x => x + 1); }}>
          <input className="in" value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Новая заметка…" enterKeyHint="done" />
          <button className="primary" disabled={!noteText.trim()}><Icon name="plus" /></button>
        </form>
      </section>
    </>;
  };
  const monthView = () => {
    const lead = (parseDay(from).getUTCDay() + 6) % 7, n = parseDay(to).getUTCDate();
    const weeks: string[] = []; for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) weeks.push(d);
    const wg = weeks.flatMap(w => goalsOf('week', w));
    return <>
      <section className="panel"><div className="panel-h"><h2>Цели месяца</h2></div>{goalBlock('month', key)}</section>
      <section className="panel"><div className="panel-h"><h2>Цели недель</h2></div>
        {wg.length ? rows(wg) : <p className="hint" style={{ textAlign: 'left', margin: 2 }}>Цели недель ставят на вкладке «Неделя» — здесь они соберутся вместе.</p>}</section>
      <section className="panel span-all"><div className="panel-h"><h2>Задачи по дням</h2><small>нажми на день — откроется неделя</small></div>
        <div className="mcal">{WD.map(w => <span key={w} className="mcal-wd">{w}</span>)}{Array.from({ length: lead }, (_, i) => <span key={`p${i}`} className="mcal-c pad" />)}
          {Array.from({ length: n }, (_, i) => { const d = addDays(from, i), list = ofDay(d), done = list.filter(t => t.done).length;
            return <button key={d} className={`mcal-c ${d === today ? 'today' : ''} ${list.length && done === list.length ? 'all' : ''}`} onClick={() => open('week', d)} aria-label={`${i + 1}: ${list.length ? `${done} из ${list.length}` : 'задач нет'}`}>
              <b>{i + 1}</b>{list.length > 0 && <><span className="mcal-dots">{list.slice(0, 4).map((t, j) => <i key={j} className={t.done ? 'on' : ''} />)}</span><small>{done}/{list.length}</small></>}</button>; })}</div>
      </section>
    </>;
  };
  const bigView = () => {
    const subK: PeriodKind = k === 'quarter' ? 'month' : 'quarter';
    const subs: string[] = []; for (let d = from; d <= to; d = shiftPeriod(subK, d, 1)) subs.push(periodKey(subK, d));
    return <>
      <section className="panel span-all"><div className="panel-h"><h2>Цели · {periodLabel(k, key)}</h2></div>{goalBlock(k, key)}</section>
      <div className="plan-subs">{subs.map(sk => { const gs = goalsOf(subK, sk); return <section key={sk} className="panel"><div className="panel-h"><h2>{periodLabel(subK, sk)}</h2></div>
        {gs.length ? rows(gs) : <p className="hint" style={{ textAlign: 'left', margin: 2 }}>Целей нет.</p>}
        <button className="link-btn" onClick={() => open(subK, periodRange(subK, sk)[0])}>Открыть {subK === 'month' ? 'месяц' : 'квартал'} ›</button></section>; })}</div>
    </>;
  };

  return <div className="day plans-page">
    <header className="dayhead">
      <button className="nav" onClick={() => go(-1)} aria-label="Назад"><Icon name="chevL" /></button>
      <div className="daytitle"><span>планы · {PERIOD_NAMES[k].toLowerCase()}</span><b>{periodLabel(k, key)}</b></div>
      <button className="nav" onClick={() => go(1)} aria-label="Вперёд"><Icon name="chev" /></button>
    </header>
    {pro && <div className="st-bar plan-bar"><div className="seg-tabs" role="tablist">{PERIOD_KINDS.map(p => <button key={p} role="tab" aria-selected={k === p} className={k === p ? 'on' : ''} onClick={() => { setKind(p); buzz(6); }}>{PERIOD_NAMES[p]}</button>)}</div>
      {!isNow && <button className="btn-accent" onClick={() => open(k, today)}>{NOW_BTN[k]}</button>}</div>}
    {k === 'week' ? weekView() : k === 'month' ? monthView() : bigView()}
    {!pro && <button className="pro-card" onClick={() => onPro('Цели и повторы')}>
      <span className="chip-ic" style={{ ['--c' as string]: 'var(--orange)' }}><Icon name="repeat" /></span>
      <span className="mid"><b>Цели на неделю–год и повторяющиеся задачи</b><small>в Pro или в своём наборе «Цели и повторы»</small></span>
      <span className="lock">PRO</span>
    </button>}
    <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.g ? 'Цель' : sheet ? `Цель на ${PERIOD_ACC[sheet.kind]}` : ''}>
      {sheet && <GoalForm key={sheet.g?.id ?? `${sheet.kind}-${sheet.key}`} g={sheet.g} kind={sheet.kind} pkey={sheet.key} parents={formParents} onDone={() => { setSheet(null); changed(); }} />}
    </Sheet>
  </div>;
}
