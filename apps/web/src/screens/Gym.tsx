/**
 * «Зал» (раздел Pro): начать тренировку, план на сегодня, «повторить», счётчики, тренировки по неделям, мышцы за месяц,
 * планы, мои упражнения с рекордами, журнал. Идущая тренировка — по подходам: прошлый раз подсказкой, отметка подхода
 * включает отдых, черновик хранится в базе (начал на телефоне — видно на компьютере).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EQUIP, EXERCISES, GYM_GROUPS, KIND_NAMES, setText, workoutTitle, type Exercise, type GymKind } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { fmt, fmt1, plural } from '../lib/format';
import { buzz } from '../lib/motion';
import { Bars, HBars, human } from '../components/Charts';
import { GymIcon } from '../components/GymIcon';
import { GI } from '../components/gym-icons';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toasts';

type S = { kg?: number | null; reps?: number | null; seconds?: number | null; minutes?: number | null; km?: number | null };
interface LiveSet { kg: string; reps: string; seconds: string; minutes: string; km: string; done: boolean }
interface LiveEx { key: string; name: string; icon: string; group: string; kind: GymKind; equip: string; sets: LiveSet[] }
interface Live { editing: string | null; start: string; day: string; time: string; title: string; note: string; past: boolean; minutes: string; planId: string | null; ex: LiveEx[] }
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'], WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const n = (v: string) => Number(String(v).replace(',', '.')) || 0;
const blank = (): LiveSet => ({ kg: '', reps: '', seconds: '', minutes: '', km: '', done: false });
const toLiveEx = (ex: Exercise, sets: number | LiveSet[] = 3): LiveEx => ({ key: ex.id, name: ex.name, icon: ex.icon, group: ex.group, kind: ex.kind, equip: ex.equip, sets: Array.isArray(sets) ? sets : Array.from({ length: sets }, blank) });
const COLS: Record<GymKind, Array<[keyof LiveSet, string, 'decimal' | 'numeric']>> = { w: [['kg', 'кг', 'decimal'], ['reps', 'повт.', 'numeric']], bw: [['kg', '+кг', 'decimal'], ['reps', 'повт.', 'numeric']], t: [['seconds', 'сек', 'numeric']], c: [['minutes', 'мин', 'numeric'], ['km', 'км', 'decimal']] };
const toSet = (s: LiveSet): S => ({ kg: s.kg ? n(s.kg) : null, reps: s.reps ? Math.round(n(s.reps)) : null, seconds: s.seconds ? Math.round(n(s.seconds)) : null, minutes: s.minutes ? n(s.minutes) : null, km: s.km ? n(s.km) : null });
const fromSet = (s: S, done = true): LiveSet => ({ kg: s.kg ? String(s.kg) : '', reps: s.reps ? String(s.reps) : '', seconds: s.seconds ? String(s.seconds) : '', minutes: s.minutes ? String(s.minutes) : '', km: s.km ? String(s.km) : '', done });
// черновик в новом формате; старый (из прошлой версии журнала) не открываем
const isLive = (l: any): l is Live => !!l && Array.isArray(l.ex) && l.ex.every((x: any) => x && typeof x.key === 'string' && x.kind && Array.isArray(x.sets)) && typeof l.start === 'string';
const clock = (start: string) => { const sec = Math.max(0, Math.floor((Date.now() - Date.parse(start)) / 1000)), h = Math.floor(sec / 3600); return `${h ? `${h}:` : ''}${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; };
const bestText = (kind: GymKind, b: any) => kind === 'w' && b?.kg ? `рекорд ${fmt1(b.kg)} кг` : kind === 'bw' && b?.reps ? `до ${b.reps} повт.` : kind === 'c' && b?.km ? `до ${fmt1(b.km)} км` : kind === 't' && b?.seconds ? `до ${setText({ seconds: b.seconds }, 't')}` : '';

/* ---------------- выбор упражнений ---------------- */
function Picker({ custom, onAdd, onCustom }: { custom: Exercise[]; onAdd: (list: Exercise[]) => void; onCustom: (ex: Exercise) => void }) {
  const toast = useToast(), [q, setQ] = useState(''), [g, setG] = useState(''), [sel, setSel] = useState<string[]>([]), [form, setForm] = useState(false);
  const [v, setV] = useState({ name: '', group: 'chest', kind: 'w' as GymKind, equip: 'mach', icon: 'machine' });
  const all = [...EXERCISES, ...custom], list = all.filter(x => (!g || x.group === g) && (!q || x.name.toLowerCase().includes(q.toLowerCase().trim())));
  if (form) return <form className="form" onSubmit={async e => {
    e.preventDefault();
    try { const ex = await api<Exercise>('/api/gym/exercises', { method: 'POST', body: v }); buzz([8, 30, 8]); onCustom(ex); onAdd([ex]); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); }
  }}>
    <label className="fld"><span>Название</span><input className="in" required maxLength={60} value={v.name} onChange={e => setV({ ...v, name: e.target.value })} placeholder="Например: Жим Смита" autoFocus /></label>
    <div className="fld"><span>Группа мышц</span><div className="chips">{Object.entries(GYM_GROUPS).map(([k, [nm, c]]) => <button type="button" key={k} className={`chip ${v.group === k ? 'on' : ''}`} onClick={() => setV({ ...v, group: k })}><i className="dot" style={{ background: c }} />{nm}</button>)}</div></div>
    <div className="fld"><span>Что записывать</span><div className="chips">{(Object.keys(KIND_NAMES) as GymKind[]).map(k => <button type="button" key={k} className={`chip ${v.kind === k ? 'on' : ''}`} onClick={() => setV({ ...v, kind: k })}>{KIND_NAMES[k]}</button>)}</div></div>
    <div className="fld"><span>Снаряд</span><div className="chips">{Object.entries(EQUIP).map(([k, nm]) => <button type="button" key={k} className={`chip ${v.equip === k ? 'on' : ''}`} onClick={() => setV({ ...v, equip: k })}>{nm}</button>)}</div></div>
    <div className="fld"><span>Иконка</span><div className="gp-icons">{Object.keys(GI).map(k => <button type="button" key={k} className={`gp-icon ${v.icon === k ? 'on' : ''}`} onClick={() => setV({ ...v, icon: k })} aria-label={k}><GymIcon icon={k} group={v.group} size="sm" /></button>)}</div></div>
    <div className="ob-nav"><button type="button" className="ghost" onClick={() => setForm(false)}>Назад</button><button className="primary">Создать и добавить</button></div>
  </form>;
  return <div className="form">
    <div className="fp-search"><Icon name="search" /><input className="in" value={q} onChange={e => setQ(e.target.value)} placeholder="Найти упражнение" aria-label="Поиск" /></div>
    <div className="chips gp-groups"><button className={`chip ${!g ? 'on' : ''}`} onClick={() => setG('')}>Все</button>{Object.entries(GYM_GROUPS).map(([k, [nm, c]]) => <button key={k} className={`chip ${g === k ? 'on' : ''}`} onClick={() => setG(k)}><i className="dot" style={{ background: c }} />{nm}</button>)}</div>
    {list.length ? <div className="gp-grid">{list.map(x => { const i = sel.indexOf(x.id); return <button key={x.id} className={`gp-i ${i >= 0 ? 'on' : ''}`} onClick={() => { setSel(s => i >= 0 ? s.filter(k => k !== x.id) : [...s, x.id]); buzz(6); }} aria-pressed={i >= 0}>
      <GymIcon icon={x.icon} group={x.group} /><b>{x.name}</b><span>{GYM_GROUPS[x.group]?.[0]}{EQUIP[x.equip] ? ` · ${EQUIP[x.equip]}` : ''}</span>{i >= 0 && <i className="gp-n">{i + 1}</i>}</button>; })}</div>
      : <p className="card-note">Не нашёл. Создай своё упражнение — кнопка ниже.</p>}
    <div className="ob-nav gp-foot"><button type="button" className="ghost" onClick={() => { setV(x => ({ ...x, name: q, group: g || x.group })); setForm(true); }}><Icon name="plus" />Своё</button>
      <button className="primary" disabled={!sel.length} onClick={() => onAdd(sel.map(id => all.find(x => x.id === id)!))}>{sel.length ? `Добавить (${sel.length})` : 'Выбери упражнения'}</button></div>
  </div>;
}

/* ---------------- карточка упражнения ---------------- */
function ExerciseInfo({ k, onAdd }: { k: string; onAdd?: (ex: Exercise) => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api<any>(`/api/gym/exercise/${encodeURIComponent(k)}`).then(setD, () => setD(false)); }, [k]);
  if (d === false) return <p className="card-note">Упражнение не найдено.</p>;
  if (!d) return <div className="skel" style={{ height: 260 }} />;
  const c: Exercise = d.ex, b = d.best, color = GYM_GROUPS[c.group]?.[1] ?? 'var(--gym)';
  const metric = (s: S) => c.kind === 'w' ? s.kg ?? 0 : c.kind === 'bw' ? s.reps ?? 0 : c.kind === 't' ? s.seconds ?? 0 : s.km || s.minutes || 0;
  const unit = c.kind === 'w' ? 'кг' : c.kind === 'bw' ? 'повт.' : c.kind === 't' ? 'с' : d.history.some((h: any) => h.sets.some((s: S) => s.km)) ? 'км' : 'мин';
  const pts = d.history.slice(0, 24).reverse().map((h: any) => ({ label: human(h.day), v: Math.max(...h.sets.map(metric)) })).filter((p: any) => p.v);
  const kpis: Array<[string, string]> = c.kind === 'w' ? [['Рекорд веса', b.kg ? `${fmt1(b.kg)} кг` : '—'], ['Расчётный максимум', b.rm ? `${fmt1(b.rm)} кг` : '—']]
    : c.kind === 'bw' ? [['Больше всего повторов', b.reps ? String(b.reps) : '—'], ['С отягощением', b.kg ? `+${fmt1(b.kg)} кг` : '—']]
    : c.kind === 't' ? [['Дольше всего', b.seconds ? setText({ seconds: b.seconds }, 't') : '—']] : [['Дальше всего', b.km ? `${fmt1(b.km)} км` : '—']];
  return <div className="form">
    <div className="ex-hero"><GymIcon icon={c.icon} group={c.group} size="xl" /><div><h3>{c.name}</h3><span>{GYM_GROUPS[c.group]?.[0]}{EQUIP[c.equip] ? ` · ${EQUIP[c.equip]}` : ''} · {KIND_NAMES[c.kind]}</span></div></div>
    <div className="ex-kpis">{[...kpis, ['Тренировок', String(d.workouts)], ['Подходов', String(d.sets)]].map(([nm, v]) => <div key={nm}><span>{nm}</span><b>{v}</b></div>)}</div>
    {pts.length > 1 ? <div><h4 className="sub-h">Лучший подход по тренировкам, {unit}</h4><Bars rows={pts.map((p: any) => ({ label: p.label, v: p.v, hint: `${p.label}: ${fmt1(p.v)} ${unit}` }))} color={color} every={Math.max(1, Math.ceil(pts.length / 6))} format={fmt1} values={pts.length <= 10} /></div>
      : <p className="card-note">После двух тренировок с этим упражнением здесь появится график прогресса.</p>}
    {c.kind === 'w' && <p className="card-note">Расчётный максимум — вес на один раз по формуле Эпли из подходов до 12 повторов.</p>}
    <h4 className="sub-h">История</h4>
    {d.history.length ? <ul className="ex-hist">{d.history.slice(0, 15).map((h: any) => <li key={h.workoutId}><span>{human(h.day)}</span><b>{h.sets.map((s: S) => setText(s, c.kind)).join(', ')}</b></li>)}</ul> : <p className="card-note">Ещё не делал.</p>}
    {onAdd && <button className="primary" onClick={() => onAdd(c)}><Icon name="plus" />Добавить в тренировку</button>}
  </div>;
}

/* ---------------- идущая тренировка ---------------- */
function LiveView({ live, setLive, custom, onFinish, onCancel, onInfo }: { live: Live; setLive: (l: Live | null, save?: boolean) => void; custom: Exercise[]; onFinish: () => void; onCancel: () => void; onInfo: (k: string) => void }) {
  const [hint, setHint] = useState<Record<string, any>>({}), [, tick] = useState(0), [rest, setRest] = useState<number | null>(null), [pick, setPick] = useState(false), [busy, setBusy] = useState(false);
  const keys = live.ex.map(x => x.key).join(',');
  useEffect(() => { if (keys) api<any>(`/api/gym/hints?keys=${encodeURIComponent(keys)}${live.editing ? `&skip=${live.editing}` : ''}`).then(setHint, () => {}); }, [keys, live.editing]);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (rest !== null && rest <= Date.now()) { setRest(null); buzz([200, 100, 200]); } });
  const upd = (fn: (l: Live) => void) => { const c = structuredClone(live); fn(c); setLive(c, true); };
  const done = live.ex.reduce((a, x) => a + x.sets.filter(s => s.done).length, 0), all = live.ex.reduce((a, x) => a + x.sets.length, 0);
  const vol = live.ex.reduce((a, x) => a + x.sets.filter(s => s.done).reduce((b, s) => b + n(s.kg) * n(s.reps), 0), 0);
  const left = rest ? Math.max(0, Math.ceil((rest - Date.now()) / 1000)) : 0;
  return <div className="gym-live">
    <div className="gl-top">
      <div className="gl-title"><span className="ov-k">{live.editing ? 'Правка тренировки' : live.past ? 'Прошедшая тренировка' : 'Тренировка идёт'}</span>
        <input className="gl-name" maxLength={60} placeholder={workoutTitle(live.ex.map(x => ({ group: x.group, sets: x.sets.length })))} value={live.title} onChange={e => upd(l => { l.title = e.target.value; })} aria-label="Название тренировки" /></div>
      {!live.past && <div className="gl-clock" aria-label="Время тренировки">{clock(live.start)}</div>}
      <div className="gl-actions"><button className="ghost" onClick={onCancel}>{live.editing ? 'Отмена' : 'Отменить'}</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { await onFinish(); } finally { setBusy(false); } }}><Icon name="check" />{live.editing ? 'Сохранить' : 'Завершить'}</button></div>
    </div>
    {live.past && <div className="gl-past">
      <label className="fld"><span>Дата</span><input className="in" type="date" value={live.day} onChange={e => upd(l => { l.day = e.target.value; })} /></label>
      <label className="fld"><span>Начало</span><input className="in" type="time" value={live.time} onChange={e => upd(l => { l.time = e.target.value; })} /></label>
      <label className="fld"><span>Длилась, мин</span><input className="in" inputMode="numeric" placeholder="60" value={live.minutes} onChange={e => upd(l => { l.minutes = e.target.value; })} /></label>
    </div>}
    <div className="gl-sum"><span><b>{live.ex.length}</b> {plural(live.ex.length, 'упражнение', 'упражнения', 'упражнений')}</span><span><b>{done}</b> из {all} подходов</span>{vol > 0 && <span><b>{fmt(vol)}</b> кг объём</span>}</div>
    {live.ex.map((x, i) => { const h = hint[x.key], prev = h?.prev, cols = COLS[x.kind]; return <article className="gx" key={`${x.key}${i}`} style={{ ['--gc' as string]: GYM_GROUPS[x.group]?.[1] }}>
      <header className="gx-head">
        <button className="gx-ic-btn" onClick={() => onInfo(x.key)} aria-label="История упражнения"><GymIcon icon={x.icon} group={x.group} /></button>
        <div className="gx-name"><b>{x.name}</b><span>{GYM_GROUPS[x.group]?.[0]}{EQUIP[x.equip] ? ` · ${EQUIP[x.equip]}` : ''}{bestText(x.kind, h?.best) ? ` · ${bestText(x.kind, h?.best)}` : ''}</span></div>
        <button className="ico del" onClick={() => upd(l => { l.ex.splice(i, 1); })} aria-label="Убрать упражнение">×</button>
      </header>
      {prev && <p className="gx-prev">Прошлый раз · {human(prev.day)}: {prev.sets.map((s: S) => setText(s, x.kind)).join(', ')}</p>}
      <div className={`gs-grid gs-${cols.length}`}>
        <span className="gs-h">№</span><span className="gs-h">Прошлый</span>{cols.map(([, nm]) => <span key={nm} className="gs-h">{nm}</span>)}<span /><span />
        {x.sets.map((s, j) => { const hp: S | undefined = prev?.sets[j] ?? prev?.sets.at(-1), own = j ? x.sets[j - 1] : null; return [
          <span key={`n${j}`} className={`gs-n ${s.done ? 'done' : ''}`}>{j + 1}</span>,
          <span key={`p${j}`} className="gs-prev">{hp ? setText(hp, x.kind) : '—'}</span>,
          ...cols.map(([f, nm, im]) => { const ph = (hp as any)?.[f] ?? (own ? n(own[f] as string) || '' : ''); return <input key={`${f}${j}`} className={`gs-in ${s.done ? 'done' : ''}`} inputMode={im} autoComplete="off" aria-label={`${nm}, подход ${j + 1}`} placeholder={ph ? String(ph).replace('.', ',') : ''} value={s[f] as string} onChange={e => upd(l => { (l.ex[i]!.sets[j] as any)[f] = e.target.value; })} />; }),
          <button key={`d${j}`} className={`gs-ok ${s.done ? 'on' : ''}`} aria-pressed={s.done} aria-label={`Подход ${j + 1} сделан`} onClick={() => upd(l => {
            const set = l.ex[i]!.sets[j]!; set.done = !set.done;
            // пустой подход по отметке берёт подсказку: прошлый раз или предыдущий подход
            if (set.done) for (const [f] of cols) if (!set[f] && ((hp as any)?.[f] || (own && own[f]))) (set as any)[f] = String((hp as any)?.[f] ?? own![f]);
            if (set.done && !live.past) { setRest(Date.now() + 90_000); buzz([10, 30, 10]); }
          })}><Icon name="check" /></button>,
          <button key={`x${j}`} className="gs-x" aria-label="Убрать подход" onClick={() => upd(l => { l.ex[i]!.sets.splice(j, 1); })}>×</button>
        ]; })}
      </div>
      <button className="add-row gx-addset" onClick={() => upd(l => { l.ex[i]!.sets.push(blank()); })}><Icon name="plus" />Подход</button>
    </article>; })}
    <button className="gx-add" onClick={() => setPick(true)}><Icon name="plus" />Добавить упражнение</button>
    <label className="fld"><span>Заметка</span><textarea className="in" rows={2} value={live.note} placeholder="Самочувствие, что улучшить в следующий раз" onChange={e => upd(l => { l.note = e.target.value; })} /></label>
    {rest && <div className="rest-bar"><span>Отдых</span><b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>
      <button onClick={() => setRest(r => (r ?? Date.now()) - 15_000)}>−15</button><button onClick={() => setRest(r => (r ?? Date.now()) + 15_000)}>+15</button><button className="ico" onClick={() => setRest(null)} aria-label="Закончить отдых">×</button></div>}
    <Sheet open={pick} onClose={() => setPick(false)} title="Упражнения" tall>
      <Picker custom={custom} onCustom={() => {}} onAdd={list => { upd(l => { l.ex.push(...list.map(ex => toLiveEx(ex))); }); setPick(false); buzz([8, 30, 8]); }} />
    </Sheet>
  </div>;
}

/* ---------------- план ---------------- */
function PlanForm({ plan, from, onDone }: { plan?: any; from?: { title: string; exercises: Array<{ key: string; name: string; ex: Exercise; sets: S[] }> }; onDone: () => void }) {
  const toast = useToast();
  const src: Array<{ key: string; name: string; ex: Exercise; sets: number }> = from ? from.exercises.map(e => ({ key: e.key, name: e.ex.name, ex: e.ex, sets: e.sets.length || 3 })) : (plan?.exercises ?? []).map((e: any) => ({ key: e.exerciseKey ?? e.ex.id, name: e.name, ex: e.ex, sets: e.sets }));
  const [v, setV] = useState({ name: plan?.name ?? from?.title ?? '', weekdays: (plan?.weekdays ?? []) as number[], time: plan?.time ?? '19:00' });
  const save = async () => {
    try { await api(plan ? `/api/gym/plans/${plan.id}` : '/api/gym/plans', { method: plan ? 'PUT' : 'POST', body: { ...v, exercises: src.map(e => ({ key: e.key, name: e.name, sets: e.sets })) } }); buzz([8, 30, 8]); toast(plan ? 'План сохранён' : 'План создан'); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); }
  };
  return <div className="form">
    <label className="fld"><span>Название</span><input className="in" maxLength={40} value={v.name} onChange={e => setV({ ...v, name: e.target.value })} placeholder="Грудь и трицепс" /></label>
    <div className="fld"><span>Дни</span><div className="chips">{WD_ORDER.map(d => <button type="button" key={d} className={`chip ${v.weekdays.includes(d) ? 'on' : ''}`} onClick={() => setV({ ...v, weekdays: v.weekdays.includes(d) ? v.weekdays.filter(x => x !== d) : [...v.weekdays, d] })}>{WD[d]}</button>)}</div></div>
    <label className="fld"><span>Время</span><input className="in" type="time" value={v.time ?? ''} onChange={e => setV({ ...v, time: e.target.value })} style={{ width: 'auto' }} /></label>
    <div className="fld"><span>Упражнения · {src.length}</span><div className="gp-plan-list">{src.map(e => <span key={e.key}><GymIcon icon={e.ex.icon} group={e.ex.group} size="sm" />{e.name}<small>{e.sets} подх.</small></span>)}</div></div>
    <button className="primary" onClick={save}>{plan ? 'Сохранить' : 'Создать план'}</button>
    {plan && <button className="ghost danger" onClick={async () => { await api(`/api/gym/plans/${plan.id}`, { method: 'DELETE' }); toast('План удалён'); onDone(); }}>Удалить план</button>}
  </div>;
}

/* ---------------- экран ---------------- */
export function Gym({ wide, version, onBack, onChanged }: { wide: boolean; version: number; onBack: () => void; onChanged: () => void }) {
  const toast = useToast(), [o, setO] = useState<any>(null), [live, setLiveState] = useState<Live | null>(null), [sheet, setSheet] = useState<null | { kind: 'info'; key: string } | { kind: 'plan'; plan?: any; from?: any } | { kind: 'start' }>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined), loaded = useRef(false);
  const load = useCallback(async () => {
    try { const d = await api<any>('/api/gym/overview'); setO(d); if (!loaded.current) { loaded.current = true; setLiveState(isLive(d.live) ? d.live : null); } }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось загрузить', { err: true }); }
  }, [toast]);
  useEffect(() => { load(); }, [load, version]);
  // черновик — в базу через секунду после последней правки
  const setLive = (l: Live | null, save = false) => {
    setLiveState(l); clearTimeout(saveTimer.current);
    if (save) saveTimer.current = setTimeout(() => api('/api/gym/live', { method: 'PUT', body: { live: l } }).catch(() => {}), 800);
  };
  const begin = (l: Partial<Live>) => { const v: Live = { editing: null, start: new Date().toISOString(), day: o.today, time: nowHm(), title: '', note: '', past: false, minutes: '', planId: null, ex: [], ...l }; setLive(v, true); setSheet(null); buzz([10, 40, 10]); };
  const fromWorkout = (w: any, edit = false): Partial<Live> => ({ editing: edit ? w.id : null, title: edit ? w.title : '', day: edit ? w.day : o.today, time: edit ? w.time ?? '' : nowHm(), past: edit, minutes: edit && w.minutes ? String(w.minutes) : '', note: edit ? w.note ?? '' : '',
    ex: w.exercises.map((e: any) => toLiveEx(e.ex, edit ? e.sets.map((s: S) => fromSet(s)) : e.sets.map(() => blank()))) });
  const finish = async () => {
    if (!live) return;
    const exercises = live.ex.map(x => ({ key: x.key, name: x.name, sets: x.sets.filter(s => s.done || n(s.reps) || n(s.seconds) || n(s.minutes) || n(s.km)).map(toSet) })).filter(x => x.sets.length);
    if (!exercises.length) { toast('Отметь хотя бы один подход', { err: true }); return; }
    const minutes = live.past ? (live.minutes ? Math.round(n(live.minutes)) : null) : Math.max(1, Math.round((Date.now() - Date.parse(live.start)) / 60000));
    const body = { day: live.day, time: live.time, title: live.title, note: live.note, minutes, planId: live.planId, exercises, fromLive: true };
    try {
      clearTimeout(saveTimer.current);
      const r = await api<any>(live.editing ? `/api/gym/workouts/${live.editing}` : '/api/gym/workouts', { method: live.editing ? 'PUT' : 'POST', body });
      setLive(null); buzz([10, 40, 10, 40, 20]);
      toast(r.prs?.length ? `Новый рекорд: ${r.prs.slice(0, 2).join(', ')}!` : live.editing ? 'Сохранено' : `Готово: ${r.sets} ${plural(r.sets, 'подход', 'подхода', 'подходов')}${r.volume ? `, ${fmt(r.volume)} кг` : ''}${minutes ? `, ${minutes} мин` : ''}`);
      onChanged(); load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось сохранить', { err: true }); }
  };
  const cancel = async () => { clearTimeout(saveTimer.current); await api('/api/gym/live', { method: 'DELETE' }).catch(() => {}); setLive(null); toast(live?.editing ? 'Правка отменена' : 'Тренировка отменена'); };
  const remove = async (w: any) => { try { await api(`/api/gym/workouts/${w.id}`, { method: 'DELETE' }); toast(`«${w.title}» удалена`); onChanged(); load(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); } };

  const head = <header className="dayhead">
    {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
    <div className="daytitle"><span>{o?.total ? `${o.total} ${plural(o.total, 'тренировка', 'тренировки', 'тренировок')}` : 'тренировки по подходам'}</span><b>Зал</b></div>
    {o && !live && <button className="nav" onClick={() => begin({ past: true, day: o.today, time: '19:00' })} aria-label="Записать прошедшую" title="Записать прошедшую"><Icon name="edit" /></button>}
  </header>;
  const sheets = <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.kind === 'plan' ? (sheet.plan ? 'План тренировки' : 'Новый план') : sheet?.kind === 'start' ? 'Начать тренировку' : 'Упражнение'} tall={sheet?.kind !== 'plan'}>
    {sheet?.kind === 'info' && <ExerciseInfo k={sheet.key} />}
    {sheet?.kind === 'plan' && <PlanForm plan={sheet.plan} from={sheet.from} onDone={() => { setSheet(null); load(); }} />}
    {sheet?.kind === 'start' && o && <Picker custom={o.custom} onCustom={() => {}} onAdd={list => begin({ ex: list.map(ex => toLiveEx(ex)) })} />}
  </Sheet>;
  if (!o) return <div className="day gym-page">{head}<div className="skel" style={{ height: 140 }} /><div className="skel" style={{ height: 300 }} /></div>;
  if (live) return <div className="day gym-page">{head}<LiveView live={live} setLive={setLive} custom={o.custom} onFinish={finish} onCancel={cancel} onInfo={k => setSheet({ kind: 'info', key: k })} />{sheets}</div>;

  const todayPlan = !o.trainedToday ? o.plans.find((p: any) => p.today) : null;
  return <div className="day gym-page">
    {head}
    <div className="wgrid">
      <div className="gym-hero span12">
        {todayPlan && <button className="gym-start" onClick={() => begin({ title: todayPlan.name, planId: todayPlan.id, ex: todayPlan.exercises.map((e: any) => toLiveEx(e.ex, e.sets)) })}><GymIcon icon="dumbbell" group="shoulders" /><span><b>Сегодня: {todayPlan.name}</b><small>по плану{todayPlan.time ? ` в ${todayPlan.time}` : ''} · {todayPlan.exercises.length} упр. — начать</small></span></button>}
        <button className={`gym-start ${todayPlan ? 'alt' : ''}`} onClick={() => setSheet({ kind: 'start' })}><GymIcon icon="dumbbell" group="shoulders" /><span><b>Начать тренировку</b><small>подходы, вес и отдых — по ходу</small></span></button>
        {o.repeat.length > 0 && <div className="gym-repeat"><span className="ov-k">Повторить</span>{o.repeat.map((w: any) => <button key={w.id} className="gym-rep" onClick={() => { const full = o.recent.find((r: any) => r.id === w.id); if (full) begin(fromWorkout(full)); }}>
          <span className="gym-rep-ics">{w.exercises.slice(0, 4).map((e: any, i: number) => <GymIcon key={i} icon={e.icon} group={e.group} size="sm" />)}</span><b>{w.title}</b><small>{human(w.day)} · {w.exercises.length} упр.</small></button>)}</div>}
      </div>
      {!o.total ? <section className="wc span12 solid s-sage"><div className="card-head"><h2>Как это работает</h2></div>
        <ol className="steps"><li>Нажми «Начать тренировку» и выбери упражнения — у каждого своя иконка.</li><li>Вписывай вес и повторы, отмечай подход галочкой — включится отдых.</li><li>В следующий раз журнал подскажет прошлые веса и покажет рекорды.</li></ol></section> : <>
        <div className="kpis span12">
          <div className="kpi k-good"><span>За 7 дней</span><b>{o.kpi.week}</b><small>{plural(o.kpi.week, 'тренировка', 'тренировки', 'тренировок')}</small></div>
          <div className="kpi k-good"><span>За 30 дней</span><b>{o.kpi.month}</b><small>{fmt1(o.kpi.perWeek)} в неделю</small></div>
          <div className="kpi"><span>Объём недели</span><b>{fmt1(o.kpi.volumeWeek / 1000)}<small>т</small></b><small>вес × повторы</small></div>
          <div className="kpi"><span>Новых рекордов</span><b>{o.kpi.newPr}</b><small>за 30 дней</small></div>
        </div>
        <section className="wc span7"><div className="card-head"><h2>Тренировок в неделю</h2></div><Bars rows={o.weeks.map((w: any) => ({ label: human(w.from).replace(/ .*/, ''), v: w.n, hint: `неделя с ${human(w.from)}: ${w.n}` }))} color="var(--gym)" max={7} values /></section>
        <section className="wc span5"><div className="card-head"><h2>Мышцы за 30 дней · подходы</h2></div>
          {o.groups.length ? <><div className="hbars">{o.groups.map((g: any) => { const mx = o.groups[0].sets; return <div className="hbar" key={g.group}><span className="hb-l">{g.name}</span><span className="hb-t"><i style={{ width: `${g.sets / mx * 100}%`, background: g.color }} /></span><span className="hb-v">{g.sets}</span></div>; })}</div>
            {o.missing.length > 0 && <p className="card-note">Не было: {o.missing.map((m: string) => m.toLowerCase()).join(', ')}.</p>}</> : <p className="card-note">Тренировок за месяц не было.</p>}</section>
      </>}
      <section className="wc span12"><div className="card-head"><h2>Планы тренировок</h2></div>
        {o.plans.length ? <div className="gp-plans">{o.plans.map((p: any) => <div key={p.id} className={`gp-plan ${p.today ? 'today' : ''}`}>
          <div className="gp-plan-ics">{p.exercises.slice(0, 5).map((e: any, i: number) => <GymIcon key={i} icon={e.ex.icon} group={e.ex.group} size="sm" />)}</div>
          <div className="gp-plan-m"><b>{p.name}</b><span>{WD_ORDER.filter(d => p.weekdays.includes(d)).map(d => WD[d]).join(', ') || 'дни не выбраны'}{p.time ? ` · ${p.time}` : ''} · {p.exercises.length} упр.{p.today && <em> · сегодня</em>}</span></div>
          <button className="btn-accent" onClick={() => begin({ title: p.name, planId: p.id, ex: p.exercises.map((e: any) => toLiveEx(e.ex, e.sets)) })}>Начать</button>
          <button className="ico" onClick={() => setSheet({ kind: 'plan', plan: p })} aria-label="Изменить план"><Icon name="edit" /></button>
        </div>)}</div> : <p className="card-note">План — тренировка по расписанию: «Грудь — пн, чт в 19:00». В свой день он встанет первым. Создай его из любой тренировки в журнале — кнопка «В план».</p>}
      </section>
      {o.myExercises.length > 0 && <section className="wc span12"><div className="card-head"><h2>Мои упражнения</h2></div>
        <div className="gym-ex">{o.myExercises.slice(0, 24).map((m: any) => <button key={m.key} className="gym-ex-i" onClick={() => setSheet({ kind: 'info', key: m.key })}><GymIcon icon={m.ex.icon} group={m.ex.group} /><span><b>{m.ex.name}</b><small>{[bestText(m.ex.kind, m.best), `${m.times}×`, human(m.day)].filter(Boolean).join(' · ')}</small></span></button>)}</div></section>}
      {o.recent.length > 0 && <section className="wc span12"><div className="card-head"><h2>Журнал</h2></div>
        {o.recent.map((w: any) => <article className="gw" key={w.id}>
          <header className="gw-head"><div><b>{w.title}</b><span>{human(w.day)}{w.time ? ` · ${w.time}` : ''}{w.minutes ? ` · ${w.minutes} мин` : ''}{w.volume ? ` · ${fmt(w.volume)} кг` : ''}</span></div>
            <div className="gw-act">{w.exercises.length > 0 && <><button className="btn-accent" onClick={() => begin(fromWorkout(w))}><Icon name="repeat" />Повторить</button><button className="btn-accent" onClick={() => setSheet({ kind: 'plan', from: { title: w.title, exercises: w.exercises } })}><Icon name="plans" />В план</button></>}
              <button className="ico" onClick={() => begin(fromWorkout(w, true))} aria-label="Изменить"><Icon name="edit" /></button><button className="ico del" onClick={() => remove(w)} aria-label="Удалить">×</button></div></header>
          <ul className="gw-ex">{w.exercises.map((e: any, i: number) => <li key={i}><button onClick={() => setSheet({ kind: 'info', key: e.key })}><GymIcon icon={e.ex.icon} group={e.ex.group} size="sm" /><span>{e.ex.name}</span></button><em>{e.sets.map((s: S) => setText(s, e.ex.kind)).join(', ')}</em></li>)}</ul>
          {w.note && <p className="card-note">{w.note}</p>}
        </article>)}</section>}
    </div>
    {sheets}
  </div>;
}
