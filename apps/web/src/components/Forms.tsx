/**
 * Формы в листах: приём пищи (с подсказками «моё»), напиток, шаги, вес, задача.
 * Каждая форма сама отправляет запрос и сообщает onDone — экран перечитывает день.
 */
import { useEffect, useState } from 'react';
import { DRINKS, PERIOD_NAMES, REPEAT_KINDS, REPEAT_NAMES, WD_ORDER, type RepeatKind } from '@bortjournal/core';
import { api, ApiError, type Drink, type Goal, type Meal, type TaskFull } from '../lib/api';
import { fmt } from '../lib/format';
import { buzz } from '../lib/motion';
import { useToast } from './Toasts';

const SLOTS: Array<[string, string]> = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин'], ['snack', 'Перекус']];
const guessSlot = (t: string) => { const h = +t.slice(0, 2); return h >= 5 && h < 11 ? 'breakfast' : h >= 11 && h < 16 ? 'lunch' : h >= 18 && h < 22 ? 'dinner' : 'snack'; };
const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function useSubmit(onDone: () => void) {
  const toast = useToast(), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); buzz([8, 30, 8]); if (ok) toast(ok); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось сохранить', { err: true }); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

export function MealForm({ day, time, meal, onDone }: { day: string; time?: string; meal?: Meal; onDone: () => void }) {
  const [v, setV] = useState({ name: meal?.name ?? '', kcal: meal ? String(meal.kcal) : '', protein: meal ? String(meal.protein) : '', fat: meal ? String(meal.fat) : '', carbs: meal ? String(meal.carbs) : '', time: meal?.time ?? time ?? nowHm(), slot: meal?.slot ?? '' });
  const [mine, setMine] = useState<Array<{ name: string; kcal: number; protein: number; fat: number; carbs: number; uses: number }>>([]);
  const { busy, run } = useSubmit(onDone);
  useEffect(() => { const id = setTimeout(() => api<{ items: typeof mine }>(`/api/food/mine?q=${encodeURIComponent(v.name.trim())}`).then(r => setMine(r.items), () => {}), 200); return () => clearTimeout(id); }, [v.name]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }));
  const slot = v.slot || guessSlot(v.time);
  const body = { day, time: v.time, slot, name: v.name, kcal: v.kcal || 0, protein: v.protein || 0, fat: v.fat || 0, carbs: v.carbs || 0 };
  return <form className="form" onSubmit={e => { e.preventDefault(); run(() => meal ? api(`/api/food/meals/${meal.id}`, { method: 'PUT', body }) : api('/api/food/meals', { method: 'POST', body }), meal ? 'Сохранено' : `${v.name} — ${fmt(Number(v.kcal) || 0)} ккал`); }}>
    <label className="fld"><span>Что ел</span><input id="meal-name" className="in" value={v.name} onChange={set('name')} placeholder="Овсянка с бананом" required autoComplete="off" /></label>
    {mine.length > 0 && !meal && <div className="chips chips-scroll" aria-label="Мои блюда">{mine.slice(0, 8).map(f => <button type="button" key={f.name} className="chip" onClick={() => { setV(x => ({ ...x, name: f.name, kcal: String(f.kcal), protein: String(f.protein), fat: String(f.fat), carbs: String(f.carbs) })); buzz(6); }}>{f.name}<small>{fmt(f.kcal)}</small></button>)}</div>}
    <div className="grid4f">
      <label className="fld"><span>Ккал</span><input id="meal-kcal" className="in" inputMode="numeric" value={v.kcal} onChange={set('kcal')} placeholder="0" required /></label>
      <label className="fld"><span>Белки</span><input id="meal-p" className="in" inputMode="decimal" value={v.protein} onChange={set('protein')} placeholder="0" /></label>
      <label className="fld"><span>Жиры</span><input id="meal-f" className="in" inputMode="decimal" value={v.fat} onChange={set('fat')} placeholder="0" /></label>
      <label className="fld"><span>Углев.</span><input id="meal-c" className="in" inputMode="decimal" value={v.carbs} onChange={set('carbs')} placeholder="0" /></label>
    </div>
    <div className="chips" role="radiogroup" aria-label="Приём пищи">{SLOTS.map(([k, n]) => <button type="button" key={k} className={`chip ${slot === k ? 'on' : ''}`} onClick={() => setV(x => ({ ...x, slot: k }))}>{n}</button>)}
      <input id="meal-time" className="in" type="time" value={v.time} onChange={set('time')} style={{ width: 'auto', padding: '8px 12px', borderRadius: 999 }} aria-label="Время" /></div>
    <div className="row-btns sticky-cta">
      {meal && <button type="button" className="danger" onClick={() => run(() => api(`/api/food/entries/${meal.id}`, { method: 'DELETE' }), 'Удалено')}>Удалить</button>}
      <button className="primary" disabled={busy}>{meal ? 'Сохранить' : 'Записать'}</button>
    </div>
  </form>;
}

const DRINK_LIST = Object.entries(DRINKS).filter(([k]) => k !== 'custom');
export function DrinkForm({ day, time, drink, onDone }: { day: string; time?: string; drink?: Drink; onDone: () => void }) {
  const [type, setType] = useState(drink?.type ?? 'water'), [ml, setMl] = useState(drink ? String(drink.ml) : '250'), [t, setT] = useState(drink?.time ?? time ?? nowHm());
  const [custom, setCustom] = useState({ name: drink?.name ?? '', kcalPer100: drink?.kcalPer100 ? String(drink.kcalPer100) : '', sugarPer100: drink?.sugarPer100 ? String(drink.sugarPer100) : '' });
  const { busy, run } = useSubmit(onDone);
  const body = { day, time: t, type, ml: Number(ml), ...(type === 'custom' ? custom : {}) };
  return <form className="form" onSubmit={e => { e.preventDefault(); run(() => drink ? api(`/api/food/drinks/${drink.id}`, { method: 'PUT', body }) : api('/api/food/drinks', { method: 'POST', body }), drink ? 'Сохранено' : `${type === 'custom' ? custom.name || 'Напиток' : DRINKS[type]!.name}, ${ml} мл`); }}>
    <div className="chips">{[...DRINK_LIST, ['custom', DRINKS.custom!] as const].map(([k, d]) => <button type="button" key={k} className={`chip ${type === k ? 'on' : ''}`} onClick={() => setType(k)}>{d.name}</button>)}</div>
    {type === 'custom' && <div className="grid2">
      <label className="fld" style={{ gridColumn: '1/-1' }}><span>Название</span><input className="in" value={custom.name} onChange={e => setCustom(x => ({ ...x, name: e.target.value }))} placeholder="Лимонад" /></label>
      <label className="fld"><span>Ккал на 100 мл</span><input className="in" inputMode="decimal" value={custom.kcalPer100} onChange={e => setCustom(x => ({ ...x, kcalPer100: e.target.value }))} placeholder="0" /></label>
      <label className="fld"><span>Сахар на 100 мл</span><input className="in" inputMode="decimal" value={custom.sugarPer100} onChange={e => setCustom(x => ({ ...x, sugarPer100: e.target.value }))} placeholder="0" /></label>
    </div>}
    <div className="chips">{[200, 250, 330, 500, 1000].map(x => <button type="button" key={x} className={`chip ${Number(ml) === x ? 'on' : ''}`} onClick={() => setMl(String(x))}>{x} мл</button>)}</div>
    <div className="grid2">
      <label className="fld"><span>Объём, мл</span><input id="drink-ml" className="in" inputMode="numeric" value={ml} onChange={e => setMl(e.target.value)} required /></label>
      <label className="fld"><span>Время</span><input className="in" type="time" value={t} onChange={e => setT(e.target.value)} /></label>
    </div>
    <div className="row-btns">
      {drink && <button type="button" className="danger" onClick={() => run(() => api(`/api/food/entries/${drink.id}`, { method: 'DELETE' }), 'Удалено')}>Удалить</button>}
      <button className="primary" disabled={busy}>{drink ? 'Сохранить' : 'Записать'}</button>
    </div>
  </form>;
}

export function NumberForm({ kind, day, value, onDone }: { kind: 'steps' | 'weight'; day: string; value: number | null; onDone: (v: number | null) => void }) {
  const [v, setV] = useState(value ? String(value) : ''), { busy, run } = useSubmit(() => onDone(v === '' ? null : Number(v.replace(',', '.')) || null));
  const steps = kind === 'steps';
  return <form className="form" onSubmit={e => { e.preventDefault(); run(() => api('/api/body/day', { method: 'PUT', body: { day, [steps ? 'steps' : 'weightKg']: v === '' ? null : v } }), steps ? `Шаги: ${fmt(Number(v) || 0)}` : `Вес ${v} кг записан`); }}>
    <input id={`num-${kind}`} className="in big" inputMode={steps ? 'numeric' : 'decimal'} value={v} onChange={e => setV(e.target.value)} placeholder={steps ? '8 000' : '75,0'} autoFocus aria-label={steps ? 'Шагов за день' : 'Вес, кг'} />
    {steps && <div className="chips" style={{ justifyContent: 'center' }}>{[1000, 2000, 5000].map(x => <button type="button" key={x} className="chip" onClick={() => setV(s => String((Number(s) || 0) + x))}>+{fmt(x)}</button>)}</div>}
    <p className="hint">{steps ? 'Сколько шагов за день — из шагомера телефона или часов.' : 'Взвешивайся утром натощак — так цифры честнее.'}</p>
    <button className="primary" disabled={busy}>Сохранить</button>
  </form>;
}

const WDS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/**
 * Задача. С набором «Цели и повторы» — ещё цель (из целей недели, месяца, квартала и года этого дня) и повтор.
 * Новая задача с повтором — это серия; у задачи серии правка повтора меняет все будущие задачи.
 */
export function TaskForm({ day, task, plans = false, onDone }: { day: string | null; task?: TaskFull; plans?: boolean; onDone: () => void }) {
  const [v, setV] = useState({ title: task?.title ?? '', day: task ? task.day : day, time: task?.time ?? '', prio: task?.prio ?? false, note: task?.note ?? '', goalId: task?.goalId ?? '' });
  const [rep, setRep] = useState<{ kind: RepeatKind | ''; days: number[] }>({ kind: '', days: [] }), [series, setSeries] = useState<{ text: string; rule: { kind: RepeatKind; days?: number[] } } | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const { busy, run } = useSubmit(onDone);
  const days = Array.from({ length: 7 }, (_, k) => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  useEffect(() => { if (!plans) return; const ref = v.day ?? days[0]!; api<{ items: Goal[] }>(`/api/plans/goals?from=${ref}&to=${ref}`).then(r => setGoals(r.items), () => {}); }, [plans, v.day]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (plans && task?.seriesId) api<any>(`/api/plans/series/${task.seriesId}`).then(s => { setSeries(s); setRep({ kind: s.rule.kind, days: s.rule.days ?? [] }); }, () => {}); }, [plans, task?.seriesId]);
  const body = { ...v, time: v.time || null, goalId: v.goalId || null };
  const repBody = () => ({ ...body, rule: { kind: rep.kind, days: rep.days }, startOn: v.day });
  const submit = () => {
    if (plans && rep.kind && !task) return run(() => api('/api/plans/series', { method: 'POST', body: repBody() }), 'Повторяющаяся задача добавлена');
    if (plans && task?.seriesId && series && rep.kind && (rep.kind !== series.rule.kind || rep.days.join() !== (series.rule.days ?? []).join() || v.title !== task.title || v.time !== (task.time ?? '') || v.prio !== task.prio))
      return run(() => api(`/api/plans/series/${task.seriesId}`, { method: 'PUT', body: repBody() }), 'Все будущие повторы изменены');
    if (plans && task && !task.seriesId && rep.kind) return run(async () => { await api(`/api/plans/series`, { method: 'POST', body: repBody() }); await api(`/api/plans/tasks/${task.id}`, { method: 'DELETE' }); }, 'Теперь задача повторяется');
    return run(() => task ? api(`/api/plans/tasks/${task.id}`, { method: 'PUT', body }) : api('/api/plans/tasks', { method: 'POST', body }), task ? 'Сохранено' : 'Задача добавлена');
  };
  const goalName = (g: Goal) => `${PERIOD_NAMES[g.period]}: ${g.title}`;
  return <form className="form" onSubmit={e => { e.preventDefault(); if (rep.kind === 'days' && !rep.days.length) return; submit(); }}>
    <input id="task-title" className="in" value={v.title} onChange={e => setV(x => ({ ...x, title: e.target.value }))} placeholder="Что нужно сделать?" required autoComplete="off" />
    <div className="chips">{days.map((d, k) => <button type="button" key={d} className={`chip ${v.day === d ? 'on' : ''}`} onClick={() => setV(x => ({ ...x, day: d }))}>{k === 0 ? 'Сегодня' : k === 1 ? 'Завтра' : `${WDS[new Date(d + 'T12:00').getDay()]} ${+d.slice(8)}`}</button>)}
      {!rep.kind && <button type="button" className={`chip ${!v.day ? 'on' : ''}`} onClick={() => setV(x => ({ ...x, day: null, time: '' }))}>Без даты</button>}</div>
    <div className="grid2">
      <label className="fld"><span>Время</span><input className="in" type="time" value={v.time} disabled={!v.day} onChange={e => setV(x => ({ ...x, time: e.target.value }))} /></label>
      <div className="fld"><span>Важность</span><button type="button" className={`chip ${v.prio ? 'on' : ''}`} style={{ padding: '13px' }} onClick={() => setV(x => ({ ...x, prio: !x.prio }))}>! Важная</button></div>
    </div>
    {plans && goals.length > 0 && <label className="fld"><span>Цель</span><select className="in" value={v.goalId} onChange={e => setV(x => ({ ...x, goalId: e.target.value }))}><option value="">— без цели —</option>{goals.map(g => <option key={g.id} value={g.id}>{goalName(g)}</option>)}</select></label>}
    {plans && v.day && <div className="fld"><span>{series ? `Повтор · сейчас ${series.text}` : 'Повтор'}</span>
      <div className="chips">{(['', ...REPEAT_KINDS] as const).map(r => (!series || r) && <button type="button" key={r || 'none'} className={`chip ${rep.kind === r ? 'on' : ''}`} onClick={() => setRep(x => ({ ...x, kind: r }))}>{r ? REPEAT_NAMES[r] : 'Не повторять'}</button>)}</div>
      {rep.kind === 'days' && <div className="chips" style={{ marginTop: 8 }}>{WD_ORDER.map(w => <button type="button" key={w} className={`chip ${rep.days.includes(w) ? 'on' : ''}`} onClick={() => setRep(x => ({ ...x, days: x.days.includes(w) ? x.days.filter(d => d !== w) : [...x.days, w] }))}>{WDS[w]}</button>)}</div>}
      {rep.kind === 'days' && !rep.days.length && <small className="form-err">Выбери дни недели</small>}
      {series && <small className="hint" style={{ textAlign: 'left' }}>Название, время, важность и повтор меняются у всех будущих задач этой серии. Заметка и цель — только у этой.</small>}
    </div>}
    <label className="fld"><span>Заметка</span><textarea className="in" rows={2} value={v.note} onChange={e => setV(x => ({ ...x, note: e.target.value }))} placeholder="Детали, ссылки" /></label>
    <div className="row-btns">
      {task && <button type="button" className="danger" onClick={() => run(() => api(`/api/plans/tasks/${task.id}`, { method: 'DELETE' }), 'Задача удалена')}>{task.seriesId ? 'Удалить только эту' : 'Удалить'}</button>}
      <button className="primary" disabled={busy}>{task ? 'Сохранить' : 'Добавить'}</button>
    </div>
    {task?.seriesId && plans && <button type="button" className="ghost danger" onClick={() => run(() => api(`/api/plans/series/${task.seriesId}`, { method: 'DELETE' }), 'Повторы удалены')}>Удалить все повторы</button>}
  </form>;
}
