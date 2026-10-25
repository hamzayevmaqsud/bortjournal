/**
 * Графики статистики: столбики с линией нормы, бублик долей, горизонтальные полосы, календарь месяца с кольцами,
 * год клетками. Одна ось, тонкие метки, подписи — цветом текста; наведение или касание показывает значение.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmt, MONG } from '../lib/format';

export const scoreColor = (s: number) => s >= 95 ? 'var(--mustard)' : s >= 70 ? 'var(--gym)' : s >= 40 ? 'var(--steps)' : s > 0 ? 'var(--text-3)' : 'var(--track)';
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const human = (d: string) => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`;
export const humanLong = (d: string) => `${+d.slice(8, 10)} ${MONG[+d.slice(5, 7) - 1]}`;

/* ---------- столбики ---------- */
export interface Bar { label: string; v: number; hint: string; color?: string | null }
export function Bars({ rows, color, target, unit = '', every = 1, values = false, max: maxArg, format = fmt }: { rows: Bar[]; color: string; target?: number; unit?: string; every?: number; values?: boolean; max?: number; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = maxArg ?? Math.max(1, target ? target * 1.15 : 0, ...rows.map(r => r.v)) * 1.05;
  const tp = target ? 100 - target / max * 100 : null;
  return <div className="bars" onPointerLeave={() => setHover(null)}>
    <div className="bars-plot">
      {tp !== null && <div className="bars-target" style={{ top: `${tp}%` }}><span>{format(target!)} {unit}</span></div>}
      {rows.map((r, i) => <div key={i} className={`bar-col ${hover === i ? 'on' : ''}`} onPointerEnter={() => setHover(i)} onClick={() => setHover(i)}>
        {values && r.v > 0 && <em>{format(r.v)}</em>}
        <i style={{ height: `${Math.min(100, r.v / max * 100)}%`, background: r.color ?? color, animationDelay: `${Math.min(i, 40) * 12}ms` }} />
      </div>)}
      {hover !== null && rows[hover] && <div className="bars-tip" style={{ left: `${(hover + 0.5) / rows.length * 100}%` }}>{rows[hover]!.hint}</div>}
    </div>
    <div className="bars-x">{rows.map((r, i) => <span key={i}>{i % every === 0 ? r.label : ''}</span>)}</div>
  </div>;
}

/* ---------- бублик ---------- */
export function Donut({ parts, size = 150, center }: { parts: Array<{ name: string; v: number; color: string }>; size?: number; center?: ReactNode }) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1, r = size / 2 - 12, C = 2 * Math.PI * r;
  let off = 0;
  return <div className="donut" style={{ width: size, height: size }}>
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map(p => `${p.name} ${Math.round(p.v / total * 100)}%`).join(', ')}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={18} />
      {parts.map(p => { const len = p.v / total * C, el = <circle key={p.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={18} strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`}><title>{p.name}: {Math.round(p.v / total * 100)}%</title></circle>; off += len; return el; })}
    </svg>
    {center && <div className="donut-c">{center}</div>}
  </div>;
}

/* ---------- горизонтальные полосы ---------- */
export function HBars({ rows, color }: { rows: Array<{ label: string; v: number; text: string }>; color: string }) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return <div className="hbars">{rows.map(r => <div key={r.label} className="hbar"><span className="hb-l">{r.label}</span><span className="hb-t"><i style={{ width: `${r.v / max * 100}%`, background: color }} /></span><span className="hb-v">{r.text}</span></div>)}</div>;
}

/* ---------- кольцо оценки ---------- */
export function ScoreRing({ v, size = 36, sw = 3.5 }: { v: number; size?: number; sw?: number }) {
  const r = (size - sw) / 2 - 1, C = 2 * Math.PI * r;
  return <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={sw} />
    {v > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(v)} strokeWidth={sw} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(100, v) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="sr-fg" />}
  </svg>;
}

/* ---------- календарь месяца ---------- */
/** словами: «идеальный день», «нет записей»… — для подписей и деталей дня */
export const verdict = (s: number | null, any = true) => s === null ? 'ещё впереди' : !any ? 'нет записей' : s >= 95 ? 'идеальный день' : s >= 70 ? 'сильный день' : s >= 40 ? 'неплохо' : 'только начало';
/** «23 октября: 100%, идеальный день» */
export const dayLabel = (day: string, s: number | null, any = true, today?: string) => `${humanLong(day)}${day === today ? ', сегодня' : ''}: ${s === null ? 'ещё впереди' : any ? `${s}%, ${verdict(s, any)}` : 'нет записей'}`;
export interface CalCell { day: string; score: number | null; any?: boolean; parts: Array<{ name: string; v: number }>; gym: boolean; pages: number; frozen?: boolean }
/** снежинка: день закрыт заморозкой серии */
const ICE = <svg className="sc-ice" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /></svg>;
export function MonthCal({ lead, cells, today, onPick, selected }: { lead: number; cells: CalCell[]; today: string; onPick?: (c: CalCell) => void; selected?: string | null }) {
  return <div className="sc-cal">
    {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(w => <span key={w} className="sc-wd" aria-hidden="true">{w}</span>)}
    {Array.from({ length: lead }, (_, k) => <span key={`p${k}`} />)}
    {cells.map(c => {
      const fut = c.score === null, any = c.any ?? !!c.score, s = c.score ?? 0, label = `${dayLabel(c.day, c.score, any, today)}${c.gym ? ', зал' : ''}${c.frozen ? ', заморожен — серия не прервалась' : ''}`;
      return <button key={c.day} type="button" className={`sc-cell ${fut ? 'fut' : ''} ${s >= 95 ? 'perfect' : ''} ${c.day === today ? 'today' : ''} ${selected === c.day ? 'sel' : ''} ${any || fut ? '' : 'empty'} ${c.frozen ? 'frozen' : ''}`} disabled={fut} title={label} aria-label={label} aria-pressed={onPick ? selected === c.day : undefined} onClick={() => onPick?.(c)}>
        <ScoreRing v={s} /><span className="sc-n">{+c.day.slice(8, 10)}</span>{s >= 95 && <i className="sc-star" aria-hidden="true">★</i>}{c.gym && <i className="sc-gym" aria-hidden="true" />}{c.frozen && ICE}
      </button>;
    })}
  </div>;
}

/* ---------- год клетками ---------- */
/** недели — столбцы (пн сверху), будущих дней нет, дни до первой записи — пустые места; подписи месяцев над неделей с 1-м числом */
export function YearHeat({ cells, today, first, selected, onPick }: { cells: Array<{ day: string; score: number | null; frozen?: boolean }>; today: string; first: string | null; selected?: string | null; onPick?: (day: string) => void }) {
  const ref = useRef<HTMLDivElement>(null), weeks = Math.ceil(cells.length / 7);
  useEffect(() => { const el = ref.current; if (el) el.scrollLeft = el.scrollWidth; }, [cells.length]);
  const marks: Array<{ w: number; m: number }> = [];
  cells.forEach((c, i) => { if (c.day.endsWith('-01')) marks.push({ w: Math.floor(i / 7), m: +c.day.slice(5, 7) - 1 }); });
  if (cells[0] && (marks[0]?.w ?? 99) >= 3) marks.unshift({ w: 0, m: +cells[0].day.slice(5, 7) - 1 });
  return <div className="hm-scroll" ref={ref}>
    <div className={`hm ${weeks <= 26 ? 'few' : ''}`} style={{ ['--weeks' as string]: weeks }}>
      <div className="hm-months" aria-hidden="true">{marks.map(x => <span key={`${x.w}-${x.m}`} style={{ gridColumn: `${x.w + 1} / span 3` }}>{MON[x.m]}</span>)}</div>
      <div className="hm-wd" aria-hidden="true">{['пн', '', 'ср', '', 'пт', '', 'вс'].map((w, k) => <span key={k}>{w}</span>)}</div>
      <div className="hm-cells" role="group" aria-label="Дни по неделям">
        {cells.map(c => {
          if (first && c.day < first) return <span key={c.day} className="hm-c pad" aria-hidden="true" />;
          const any = c.score !== null, s = c.score ?? 0, label = `${dayLabel(c.day, c.score === null ? 0 : c.score, any, today)}${c.frozen ? ', заморожен' : ''}`;
          return <button key={c.day} type="button" className={`hm-c ${any ? '' : 'none'} ${c.frozen ? 'frozen' : ''} ${s >= 95 ? 'perfect' : ''} ${c.day === today ? 'today' : ''} ${selected === c.day ? 'sel' : ''}`}
            style={any ? { background: scoreColor(Math.max(1, s)) } : undefined} title={label} aria-label={label} aria-pressed={selected === c.day}
            tabIndex={any || c.day === today ? 0 : -1} onClick={() => onPick?.(c.day)} />;
        })}
      </div>
    </div>
  </div>;
}

export function Delta({ cur, prev, good = 'up' }: { cur: number; prev: number; good?: 'up' | 'down' | 'none' }) {
  if (!prev || !isFinite(cur)) return null;
  const d = cur - prev, p = Math.round(d / prev * 100);
  if (!Math.round(Math.abs(d) * 10)) return <span className="dl">как раньше</span>;
  const better = good === 'up' ? d > 0 : good === 'down' ? d < 0 : null;
  return <span className={`dl ${better === null ? '' : better ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(p)}%</span>;
}
