/**
 * Графики статистики: столбики с линией нормы, бублик долей, горизонтальные полосы, календарь месяца с кольцами,
 * год клетками. Одна ось, тонкие метки, подписи — цветом текста; наведение или касание показывает значение.
 */
import { useState, type ReactNode } from 'react';
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
export interface CalCell { day: string; score: number | null; parts: Array<{ name: string; v: number }>; gym: boolean; pages: number }
export function MonthCal({ lead, cells, today, onPick }: { lead: number; cells: CalCell[]; today: string; onPick?: (c: CalCell) => void }) {
  return <div className="sc-cal">
    {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(w => <span key={w} className="sc-wd">{w}</span>)}
    {Array.from({ length: lead }, (_, k) => <span key={`p${k}`} />)}
    {cells.map(c => {
      const fut = c.score === null, s = c.score ?? 0, tip = fut ? human(c.day) : `${humanLong(c.day)}: ${s}%${c.parts.length ? ' — ' + c.parts.map(p => `${p.name} ${p.v}%`).join(', ') : ''}${c.gym ? ', зал' : ''}${c.pages ? `, чтение ${c.pages} стр.` : ''}`;
      return <button key={c.day} type="button" className={`sc-cell ${fut ? 'fut' : ''} ${s >= 95 ? 'perfect' : ''} ${c.day === today ? 'today' : ''}`} disabled={fut} title={tip} aria-label={tip} onClick={() => onPick?.(c)}>
        <ScoreRing v={s} /><span className="sc-n">{+c.day.slice(8, 10)}</span>{s >= 95 && <i className="sc-star">★</i>}{c.gym && <i className="sc-gym" />}
      </button>;
    })}
  </div>;
}

/* ---------- год клетками ---------- */
export function YearHeat({ days }: { days: Array<{ day: string; score: number }> }) {
  const cell = 12, gap = 3, L = 24, T = 16, weeks = Math.ceil(days.length / 7);
  const W = L + weeks * (cell + gap), H = T + 7 * (cell + gap);
  let lastM = -1;
  return <div className="yh-wrap"><svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W * 0.85 }} role="img" aria-label="Год по дням">
    {['пн', '', 'ср', '', 'пт', '', ''].map((w, k) => w && <text key={k} x="0" y={T + k * (cell + gap) + 10}>{w}</text>)}
    {days.map((d, i) => {
      const w = Math.floor(i / 7), k = i % 7, x = L + w * (cell + gap), y = T + k * (cell + gap), mo = +d.day.slice(5, 7) - 1;
      const label = k === 0 && mo !== lastM && +d.day.slice(8, 10) <= 7 ? (lastM = mo, <text key={`m${i}`} x={x} y="10">{MON[mo]}</text>) : null;
      return <g key={d.day}>{label}<rect x={x} y={y} width={cell} height={cell} rx="3" fill={scoreColor(d.score)} opacity={d.score ? 1 : 0.55}><title>{humanLong(d.day)}: {d.score ? `${d.score}%` : 'нет записей'}</title></rect></g>;
    })}
  </svg></div>;
}

export function Delta({ cur, prev, good = 'up' }: { cur: number; prev: number; good?: 'up' | 'down' | 'none' }) {
  if (!prev || !isFinite(cur)) return null;
  const d = cur - prev, p = Math.round(d / prev * 100);
  if (!Math.round(Math.abs(d) * 10)) return <span className="dl">как раньше</span>;
  const better = good === 'up' ? d > 0 : good === 'down' ? d < 0 : null;
  return <span className={`dl ${better === null ? '' : better ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(p)}%</span>;
}
