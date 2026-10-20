/**
 * Лента дня полосами: дорожка на раздел, шкала 06–24, линия «сейчас».
 * Нажатие на отметку — карточка записи; на пустое место — «Записать» на это время.
 */
import { useEffect, useRef, useState } from 'react';
import type { DayEvent, Task } from '../lib/api';
import { fmt, fmt1, hmToMin, minToHm } from '../lib/format';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';

const T0 = 6 * 60, SPAN = 18 * 60;
const pct = (t: string) => Math.max(0, Math.min(100, (hmToMin(t) - T0) / SPAN * 100));

export interface Mark { id: string; lane: string; time: string; title: string; sub?: string; value?: string; color: string; icon: string; kcal?: number; ml?: number; min?: number; open?: boolean; task?: boolean; deletable?: boolean }
const LANES: Array<[string, string, string, string]> = [['food', 'food', 'var(--food)', 'Еда'], ['water', 'drop', 'var(--water)', 'Вода'], ['study', 'study', 'var(--study)', 'Учёба'], ['gym', 'gym', 'var(--gym)', 'Зал'], ['task', 'task', 'var(--orange)', 'Задачи']];

/** события дня → отметки на дорожках */
export function marksOf(events: DayEvent[], tasks: Task[]): Mark[] {
  const out: Mark[] = [];
  for (const e of events) {
    if (!e.time || !e.id) continue;
    if (e.kind === 'meal') out.push({ id: e.id, lane: 'food', time: e.time, title: e.title, value: `${fmt(e.value ?? 0)} ккал`, color: 'var(--food)', icon: 'food', kcal: e.value ?? 0, deletable: true });
    else if (e.kind === 'drink') out.push({ id: e.id, lane: 'water', time: e.time, title: e.title, value: `${fmt(e.value ?? 0)} мл`, color: 'var(--water)', icon: 'drop', ml: e.value ?? 0, deletable: true });
    else if (e.kind === 'session') out.push({ id: e.id, lane: 'study', time: e.time, title: e.title, value: e.value ? `${e.value} мин` : '', color: 'var(--study)', icon: 'study', min: e.value ?? 30 });
    else if (e.kind === 'workout') out.push({ id: e.id, lane: 'gym', time: e.time, title: e.title, value: e.value ? `${e.value} мин` : '', color: 'var(--gym)', icon: 'gym', min: e.value ?? 60 });
  }
  for (const t of tasks) if (t.time) out.push({ id: t.id, lane: 'task', time: t.time, title: t.title, sub: t.done ? 'сделано' : 'задача', value: t.done ? '✓' : '', color: 'var(--orange)', icon: 'task', open: !t.done, task: true });
  return out;
}

export function Timeline({ marks, now, still, pro = true, sums, onAdd, onDelete, onEdit, onToggleTask }: {
  marks: Mark[]; now: string | null; still: boolean; pro?: boolean;
  /** итог по дорожке справа — только на широком экране */ sums?: Record<string, string>;
  onAdd: (time: string) => void; onDelete: (m: Mark) => void; onEdit?: (m: Mark) => void; onToggleTask: (id: string) => void;
}) {
  const [sel, setSel] = useState<{ m: Mark; left: number; top: number; ox: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const off = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.pop,.mk')) setSel(null); }; addEventListener('pointerdown', off); return () => removeEventListener('pointerdown', off); }, []);

  const openPop = (m: Mark, el: HTMLElement) => {
    const pr = box.current!.getBoundingClientRect(), mr = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(pr.width - 240, mr.left - pr.left + mr.width / 2 - 116));
    setSel({ m, left, top: mr.bottom - pr.top + 8, ox: mr.left - pr.left + mr.width / 2 - left }); buzz(6);
  };
  const lastMeal = now ? marks.filter(m => m.lane === 'food' && m.time <= now).map(m => m.time).sort().pop() : undefined;
  let n = 0;

  return <div ref={box} className={`tl-wrap ${still ? 'still' : ''}`} style={{ position: 'relative' }}>
    <div className={`tl ${sums ? 'wide' : ''}`}>
      <div className="tl-axis">{['06', '09', '12', '15', '18', '21', '24'].map((h, i) => <span key={h} style={{ left: `${i / 6 * 100}%` }}>{h}</span>)}</div>
      <div className="tl-body">
        {now && <div className="tl-now" style={{ left: `calc(var(--lw) + (100% - var(--lw) - var(--sw)) * ${pct(now) / 100})` }}><b>сейчас {now}</b></div>}
        {LANES.filter(([lane]) => pro || (lane !== 'study' && lane !== 'gym') || marks.some(m => m.lane === lane)).map(([lane, icon, color, name]) => (
          <div className="lane" key={lane}>
            <span className="lane-ic" style={{ ['--c' as string]: color }} title={name}><Icon name={icon} /><span className="lane-name">{name}</span></span>
            <div className="track" aria-label={`${name}: нажми, чтобы добавить`} onClick={e => {
              if ((e.target as HTMLElement).closest('.mk')) return;
              const r = e.currentTarget.getBoundingClientRect();
              onAdd(minToHm(Math.round((T0 + (e.clientX - r.left) / r.width * SPAN) / 15) * 15));
            }}>
              {lane === 'food' && now && lastMeal && hmToMin(now) - hmToMin(lastMeal) >= 180 &&
                <div className="gap" style={{ left: `${pct(lastMeal)}%`, width: `${pct(now) - pct(lastMeal)}%` }}><span>{Math.floor((hmToMin(now) - hmToMin(lastMeal)) / 60)} ч без еды</span></div>}
              {marks.filter(m => m.lane === lane).map(m => {
                const d = `${(n++ * 0.045).toFixed(3)}s`;
                const w = m.kcal ? 9 + Math.min(9, m.kcal / 90) : m.ml ? 7 + Math.min(6, m.ml / 100) : 10;
                const style = m.min ? { ['--c' as string]: m.color, left: `${pct(m.time)}%`, ['--len' as string]: `${Math.max(5, m.min / SPAN * 100)}%`, ['--d' as string]: d }
                  : { ['--c' as string]: m.color, left: `${pct(m.time)}%`, ['--w' as string]: `${w.toFixed(1)}px`, ['--d' as string]: d };
                return <button key={m.id} className={`mk ${m.min ? 'bar' : ''} ${m.open ? 'open' : ''} ${sel?.m.id === m.id ? 'sel' : ''}`} style={style} aria-label={`${m.time} ${m.title}`} onClick={e => { e.stopPropagation(); openPop(m, e.currentTarget); }} />;
              })}
            </div>
            {sums && <span className="lane-sum">{sums[lane] ?? '—'}</span>}
          </div>
        ))}
      </div>
    </div>
    {sel && <div className="pop" style={{ left: sel.left, top: sel.top, ['--ox' as string]: `${sel.ox}px` }}>
      <div className="pop-h"><span className="chip-ic" style={{ ['--c' as string]: sel.m.color }}><Icon name={sel.m.icon} /></span>
        <span className="mid"><b>{sel.m.title}</b><small>{sel.m.time}{sel.m.sub ? ` · ${sel.m.sub}` : ''}</small></span>{sel.m.value && <span className="pop-v">{sel.m.value}</span>}</div>
      <div className="pop-act">
        {sel.m.task ? <button onClick={() => { setSel(null); onToggleTask(sel.m.id); }}>{sel.m.open ? 'Сделано' : 'Вернуть'}</button> : null}
        {sel.m.deletable && onEdit && !sel.m.id.startsWith('tmp-') ? <button onClick={() => { const m = sel.m; setSel(null); onEdit(m); }}>Изменить</button> : null}
        {sel.m.deletable ? <button className="del" onClick={() => { const m = sel.m; setSel(null); onDelete(m); }}>Удалить</button> : null}
        {!sel.m.task && !sel.m.deletable ? <button onClick={() => setSel(null)}>Закрыть</button> : null}
      </div>
    </div>}
  </div>;
}

export function TimelineSum({ kcal, ml, done, total }: { kcal: number; ml: number; done: number; total: number }) {
  return <div className="tl-sum"><div><b>{fmt(kcal)}</b><small>ккал</small></div><div><b>{fmt1(ml / 1000)} л</b><small>воды</small></div><div><b>{done}/{total}</b><small>задач</small></div></div>;
}
