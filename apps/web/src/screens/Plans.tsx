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

const WDF = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const dayTitle = (d: string, today: string) => { const dt = parseDay(d), name = `${dt.getUTCDate()} ${MONG[dt.getUTCMonth()]}`;
  return d === today ? `Сегодня, ${name}` : d === addDays(today, 1) ? `Завтра, ${name}` : d === addDays(today, -1) ? `Вчера, ${name}` : `${WDF[dt.getUTCDay()]![0]!.toUpperCase()}${WDF[dt.getUTCDay()]!.slice(1)}, ${name}`; };

/**
 * Две вкладки: «Задачи» — то, что открывают каждый день (полоса недели, задачи дня с полем ввода прямо в списке,
 * просроченные, без даты, заметки) и «Цели» — цели по периодам и календарь месяца.
 */
export function Plans({ today, sub, version, onAdd, onOpen, onPro, onChanged }: {
  today: string; sub: Subscription; version: number;
  onAdd: (day: string | null) => void; onOpen: (t: TaskFull) => void; onPro: (what: string) => void; onChanged: () => void;
}) {
  const pro = can(sub, 'plans'), toast = useToast();
  const [mode, setMode] = useState<'tasks' | 'goals'>('tasks');
  const [day, setDay] = useState(today), [kind, setKind] = useState<PeriodKind>('week'), [anchor, setAnchor] = useState(today);
  const [items, setItems] = useState<TaskFull[] | null>(null), [overdue, setOverdue] = useState<TaskFull[]>([]), [goals, setGoals] = useState<Goal[]>([]), [weekGoals, setWeekGoals] = useState<Goal[]>([]), [v, setV] = useState(0);
  const [sheet, setSheet] = useState<null | { g?: Goal; kind: PeriodKind; key: string }>(null), [formParents, setFormParents] = useState<Goal[]>([]);
  const [notes, setNotes] = useState<Note[]>([]), [noteText, setNoteText] = useState(''), [title, setTitle] = useState(''), [busy, setBusy] = useState(false);
  const mon = mondayOf(day), sun = addDays(mon, 6);
  const gKey = periodKey(kind, anchor), [gFrom, gTo] = periodRange(kind, gKey);
  // задачи: неделя выбранного дня + без даты; цели: видимый период (или неделя — для сводки на вкладке задач)
  const [from, to] = mode === 'goals' && kind !== 'week' ? [gFrom, gTo] : mode === 'goals' ? [gFrom, gTo] : [mon, sun];
  const load = useCallback(async () => {
    try { setItems((await api<{ items: TaskFull[] }>(`/api/plans/tasks?from=${from}&to=${to}`)).items); } catch { setItems([]); }
    api<{ items: Note[] }>('/api/plans/notes').then(r => setNotes(r.items), () => {});
    // просроченные: последние 60 дней, не сделаны, не из повтора (повторы не копятся)
    api<{ items: TaskFull[] }>(`/api/plans/tasks?from=${addDays(today, -60)}&to=${addDays(today, -1)}`).then(r => setOverdue(r.items.filter(t => t.day && !t.done && !t.repeat)), () => {});
    if (pro) {
      api<{ items: Goal[] }>(`/api/plans/goals?from=${from}&to=${to}`).then(r => setGoals(r.items), () => setGoals([]));
      api<{ items: Goal[] }>(`/api/plans/goals?from=${mon}&to=${sun}`).then(r => setWeekGoals(r.items.filter(g => g.period === 'week')), () => {});
    }
  }, [from, to, pro, today, mon, sun]);
  useEffect(() => { load(); }, [load, version, v]);
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
  const addTask = async (d: string | null) => {
    const t = title.trim(); if (!t || busy) return; setBusy(true);
    try { await api('/api/plans/tasks', { method: 'POST', body: { title: t, day: d } }); setTitle(''); buzz([8, 30, 8]); changed(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); } finally { setBusy(false); }
  };
  // перетаскивание задачи на день недели или в «Без даты» (мышью, на компьютере)
  const [over, setOver] = useState<string | null>(null);
  const moveTo = async (id: string, d: string | null) => {
    const t = (items ?? []).find(x => x.id === id); if (!t || t.day === d) return;
    setItems(xs => xs?.map(x => x.id === id ? { ...x, day: d } : x) ?? xs);
    try { await api(`/api/plans/tasks/${id}`, { method: 'PUT', body: { title: t.title, day: d, time: d ? t.time : null, prio: t.prio, note: t.note ?? '' } }); buzz(8); toast(d ? `«${t.title}» → ${dayTitle(d, today).toLowerCase()}` : `«${t.title}» — без даты`); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось перенести', { err: true }); }
    changed();
  };
  const drop = (d: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('text/x-task')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(d ?? 'none'); } },
    onDragLeave: () => setOver(o => o === (d ?? 'none') ? null : o),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/x-task'); if (id) moveTo(id, d); }
  });
  const moveOverdue = async () => {
    const list = overdue; setOverdue([]);
    for (const t of list) await api(`/api/plans/tasks/${t.id}`, { method: 'PUT', body: { title: t.title, day: today, time: t.time, prio: t.prio, note: t.note ?? '' } }).catch(() => {});
    toast(`Перенесено на сегодня: ${list.length}`); setDay(today); changed();
  };
  const byId = new Map(goals.map(g => [g.id, g]));
  const goalsOf = (pk: PeriodKind, pkey: string) => goals.filter(g => g.period === pk && g.periodKey === pkey);
  const rows = (gs: Goal[]) => <div className="goals-l">{gs.map(g => <GoalRow key={g.id} g={g} parent={g.parentId ? byId.get(g.parentId) : undefined} onToggle={() => toggleGoal(g.id)} onOpen={() => setSheet({ g, kind: g.period, key: g.periodKey })} />)}</div>;
  const goalBlock = (pk: PeriodKind, pkey: string) => { const gs = goalsOf(pk, pkey); return <>
    {gs.length ? rows(gs) : <p className="hint" style={{ textAlign: 'left', margin: 2 }}>Целей на {pk === 'week' ? 'эту неделю' : periodLabel(pk, pkey).toLowerCase()} пока нет.</p>}
    <button className="add-row" onClick={() => setSheet({ kind: pk, key: pkey })}><Icon name="plus" />Цель на {PERIOD_ACC[pk]}</button></>; };
  const openGoals = (pk: PeriodKind, d: string) => { setMode('goals'); setKind(pk); setAnchor(d); };

  /* ---------- задачи ---------- */
  const tasksView = () => {
    const week = Array.from({ length: 7 }, (_, i) => addDays(mon, i)), list = ofDay(day), undated = ofDay(null), done = list.filter(t => t.done).length;
    const wgDone = weekGoals.filter(g => g.progress >= 100).length;
    return <>
      <div className="wk-bar">
        <button className="nav" onClick={() => setDay(addDays(day, -7))} aria-label="Прошлая неделя"><Icon name="chevL" /></button>
        <div className="wk" role="tablist">{week.map((d, i) => { const n = ofDay(d), dn = n.filter(t => t.done).length; return <button key={d} role="tab" aria-selected={d === day} className={`wk-d ${d === day ? 'on' : ''} ${d === today ? 'today' : ''} ${over === d ? 'drop' : ''}`} onClick={() => setDay(d)} {...drop(d)}>
          <span>{d === today ? 'сег' : WD[i]}</span><b>{parseDay(d).getUTCDate()}</b><i className={n.length && dn === n.length ? 'all' : ''}>{n.length ? `${dn}/${n.length}` : '·'}</i></button>; })}</div>
        <button className="nav" onClick={() => setDay(addDays(day, 7))} aria-label="Следующая неделя"><Icon name="chev" /></button>
      </div>
      {day === today && overdue.length > 0 && <div className="overdue"><span><b>Просрочено {overdue.length}</b> · {overdue.slice(0, 2).map(t => t.title).join(', ')}{overdue.length > 2 ? '…' : ''}</span><button className="btn-accent" onClick={moveOverdue}>На сегодня</button></div>}
      <section className="panel day-panel">
        <div className="panel-h"><h2 className="day-title">{dayTitle(day, today)}</h2><small>{list.length ? `${done} из ${list.length}` : ''}</small></div>
        <form className="task-add" onSubmit={e => { e.preventDefault(); addTask(day); }}>
          <input className="in" value={title} onChange={e => setTitle(e.target.value)} placeholder="Новая задача…" aria-label="Новая задача" enterKeyHint="done" />
          <button type="button" className="more-btn" onClick={() => onAdd(day)} aria-label="Время, повтор, цель, заметка" title="Время, повтор, цель, заметка">•••</button>
          <button className="primary" disabled={!title.trim() || busy} aria-label="Добавить"><Icon name="plus" /></button>
        </form>
        {items === null ? <div className="skel" style={{ height: 90 }} /> : <Tasks draggable tasks={list} onToggle={toggle} onOpen={id => { const t = list.find(x => x.id === id); if (t) onOpen(t); }} empty={day === today ? 'На сегодня задач нет — добавь первую выше.' : 'На этот день задач нет.'} />}
      </section>
      {pro && <button className="goal-sum" onClick={() => openGoals('week', day)}>
        <span className="chip-ic" style={{ ['--c' as string]: 'var(--orange)' }}><Icon name="target" /></span>
        <span className="mid"><b>Цели недели</b><small>{weekGoals.length ? `${wgDone} из ${weekGoals.length} выполнено · ${weekGoals.slice(0, 2).map(g => g.title).join(', ')}` : 'поставь 1–3 цели на неделю'}</small></span><Icon name="chev" className="ic chev" /></button>}
      <section className={`panel ${over === 'none' ? 'drop' : ''}`} {...drop(null)}>
        <div className="panel-h"><h2>Без даты</h2><small>{undated.length ? `${undated.length} ${plural(undated.length, 'задача', 'задачи', 'задач')}` : ''}</small></div>
        <Tasks draggable tasks={undated} onToggle={toggle} onOpen={id => { const t = undated.find(x => x.id === id); if (t) onOpen(t); }} empty="То, что сделать когда-нибудь." />
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
          <button className="primary" disabled={!noteText.trim()} aria-label="Добавить заметку"><Icon name="plus" /></button>
        </form>
      </section>
    </>;
  };

  /* ---------- цели ---------- */
  const goalsView = () => {
    if (!pro) return <button className="pro-card" onClick={() => onPro('Цели и повторы')}>
      <span className="chip-ic" style={{ ['--c' as string]: 'var(--orange)' }}><Icon name="repeat" /></span>
      <span className="mid"><b>Цели на неделю–год и повторяющиеся задачи</b><small>в Pro или в своём наборе «Цели и повторы»</small></span>
      <span className="lock">PRO</span></button>;
    const key = gKey, from2 = gFrom, to2 = gTo, isNow = key === periodKey(kind, today);
    const nav = <div className="plan-bar">
      <div className="seg-tabs" role="tablist">{PERIOD_KINDS.map(p => <button key={p} role="tab" aria-selected={kind === p} className={kind === p ? 'on' : ''} onClick={() => { setKind(p); buzz(6); }}>{PERIOD_NAMES[p]}</button>)}</div>
      <div className="period-nav"><button className="nav" onClick={() => setAnchor(shiftPeriod(kind, anchor, -1))} aria-label="Назад"><Icon name="chevL" /></button><b>{periodLabel(kind, key)}</b><button className="nav" onClick={() => setAnchor(shiftPeriod(kind, anchor, 1))} aria-label="Вперёд"><Icon name="chev" /></button>
        {!isNow && <button className="btn-accent" onClick={() => setAnchor(today)}>Сейчас</button>}</div>
    </div>;
    if (kind === 'week') {
      const ups = (['month', 'quarter', 'year'] as const).flatMap(pk => goalsOf(pk, periodKey(pk, key)));
      return <>{nav}
        <section className="panel span-all"><div className="panel-h"><h2>Цели недели</h2></div>{goalBlock('week', key)}</section>
        {ups.length > 0 && <section className="panel span-all"><div className="panel-h"><h2>Большие цели</h2></div>{rows(ups)}</section>}
      </>;
    }
    if (kind === 'month') {
      const lead = (parseDay(from2).getUTCDay() + 6) % 7, n = parseDay(to2).getUTCDate();
      const weeks: string[] = []; for (let d = mondayOf(from2); d <= to2; d = addDays(d, 7)) weeks.push(d);
      const wg = weeks.flatMap(w => goalsOf('week', w));
      return <>{nav}
        <section className="panel"><div className="panel-h"><h2>Цели месяца</h2></div>{goalBlock('month', key)}</section>
        <section className="panel"><div className="panel-h"><h2>Цели недель</h2></div>{wg.length ? rows(wg) : <p className="hint" style={{ textAlign: 'left', margin: 2 }}>Цели недель ставят на вкладке «Неделя» — здесь они соберутся вместе.</p>}</section>
        <section className="panel span-all"><div className="panel-h"><h2>Задачи по дням</h2><small>нажми на день — откроются его задачи</small></div>
          <div className="mcal">{WD.map(w => <span key={w} className="mcal-wd">{w}</span>)}{Array.from({ length: lead }, (_, i) => <span key={`p${i}`} className="mcal-c pad" />)}
            {Array.from({ length: n }, (_, i) => { const d = addDays(from2, i), list = ofDay(d), dn = list.filter(t => t.done).length;
              return <button key={d} className={`mcal-c ${d === today ? 'today' : ''} ${list.length && dn === list.length ? 'all' : ''}`} onClick={() => { setDay(d); setMode('tasks'); }} aria-label={`${i + 1}: ${list.length ? `${dn} из ${list.length}` : 'задач нет'}`}>
                <b>{i + 1}</b>{list.length > 0 && <><span className="mcal-dots">{list.slice(0, 4).map((t, j) => <i key={j} className={t.done ? 'on' : ''} />)}</span><small>{dn}/{list.length}</small></>}</button>; })}</div>
        </section>
      </>;
    }
    const subK: PeriodKind = kind === 'quarter' ? 'month' : 'quarter';
    const subs: string[] = []; for (let d = from2; d <= to2; d = shiftPeriod(subK, d, 1)) subs.push(periodKey(subK, d));
    return <>{nav}
      <section className="panel span-all"><div className="panel-h"><h2>Цели · {periodLabel(kind, key)}</h2></div>{goalBlock(kind, key)}</section>
      <div className="plan-subs">{subs.map(sk => { const gs = goalsOf(subK, sk); return <section key={sk} className="panel"><div className="panel-h"><h2>{periodLabel(subK, sk)}</h2></div>
        {gs.length ? rows(gs) : <p className="hint" style={{ textAlign: 'left', margin: 2 }}>Целей нет.</p>}
        <button className="link-btn" onClick={() => { setKind(subK); setAnchor(periodRange(subK, sk)[0]); }}>Открыть {subK === 'month' ? 'месяц' : 'квартал'} ›</button></section>; })}</div>
    </>;
  };

  return <div className="day plans-page">
    <header className="dayhead">
      <div className="daytitle"><span>{mode === 'tasks' ? (mon <= today && today <= sun ? 'эта неделя' : periodLabel('week', mon)) : 'цели по периодам'}</span><b>Планы</b></div>
      {mode === 'tasks' && day !== today && <button className="btn-accent" onClick={() => setDay(today)}>Сегодня</button>}
    </header>
    <div className="st-bar"><div className="seg-tabs" role="tablist">{([['tasks', 'Задачи'], ['goals', 'Цели']] as const).map(([m, n]) => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); buzz(6); }}>{n}</button>)}</div></div>
    {mode === 'tasks' ? tasksView() : goalsView()}
    <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.g ? 'Цель' : sheet ? `Цель на ${PERIOD_ACC[sheet.kind]}` : ''}>
      {sheet && <GoalForm key={sheet.g?.id ?? `${sheet.kind}-${sheet.key}`} g={sheet.g} kind={sheet.kind} pkey={sheet.key} parents={formParents} onDone={() => { setSheet(null); changed(); }} />}
    </Sheet>
  </div>;
}
