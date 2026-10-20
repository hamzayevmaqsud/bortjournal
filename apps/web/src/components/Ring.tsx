/** Кольцо прогресса: дуга догоняет значение пружиной, число плавно доезжает */
import { useCountUp, useNextFrame } from '../lib/motion';
import { fmt, fmt1 } from '../lib/format';

export function Arc({ size, sw, color, p }: { size: number; sw: number; color: string; p: number }) {
  const r = (size - sw) / 2, C = 2 * Math.PI * r, shown = useNextFrame(Math.min(1, Math.max(0, p)), 0);
  return <svg viewBox={`0 0 ${size} ${size}`}>
    <circle className="bg" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} />
    <circle className="fg" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - shown)} />
  </svg>;
}

export function Ring({ value, max, color, label, shown, decimals = 0, onClick }: { value: number; max: number; color: string; label: string; shown: number; decimals?: 0 | 1; onClick?: () => void }) {
  const n = useCountUp(shown), pct = max ? Math.round(Math.min(999, value / max * 100)) : 0;
  return <button className="ring" onClick={onClick} aria-label={`${label}: ${pct}%`}>
    <span className="ring-g"><Arc size={60} sw={7} color={color} p={max ? value / max : 0} /><em>{pct}%</em></span>
    <b>{decimals ? fmt1(n) : fmt(n)}</b><small>{label}</small>
  </button>;
}

export function BigRing({ value, max, color }: { value: number; max: number; color: string }) {
  const n = useCountUp(value, 900);
  return <div className="big-ring"><Arc size={184} sw={16} color={color} p={max ? value / max : 0} /><div className="center"><b>{fmt(n)}</b><small>ккал съедено</small></div></div>;
}
