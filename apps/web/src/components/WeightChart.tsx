/**
 * Вес и прогноз: замеры (точки), план от старта (пунктир), «если так пойдёт дальше» (точки-пунктир).
 * Одна ось кг; линия «сегодня»; наведение или касание показывает ближайший замер.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffDays } from '@bortjournal/core';
import { fmt1, MONG } from '../lib/format';

interface Pt { day: string; kg: number }
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const human = (d: string) => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`;

export function WeightChart({ history, plan, fact, today }: { history: Pt[]; plan: Pt[]; fact: Pt[]; today: string }) {
  const box = useRef<SVGSVGElement>(null), wrap = useRef<HTMLDivElement>(null), [hover, setHover] = useState<Pt | null>(null);
  // рисуем в настоящую ширину — подписи остаются читаемыми и на телефоне
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e!.contentRect.width); if (w > 0) setW(w); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = W < 500 ? 230 : 300, pt = 26, pb = 30, pl = 44, pr = 14;
  const g = useMemo(() => {
    const all = [...history, ...plan, ...fact];
    if (all.length < 2) return null;
    const d0 = all.reduce((a, x) => x.day < a ? x.day : a, all[0]!.day), d1 = all.reduce((a, x) => x.day > a ? x.day : a, all[0]!.day);
    const span = Math.max(1, diffDays(d0, d1)), vals = all.map(x => x.kg), lo = Math.min(...vals) - 0.6, hi = Math.max(...vals) + 0.6;
    const x = (d: string) => pl + (W - pl - pr) * diffDays(d0, d) / span, y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
    const path = (ps: Pt[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
    return { d0, d1, lo, hi, x, y, path };
  }, [history, plan, fact, W, H]);
  if (!g) return <p ref={wrap as never} className="hint" style={{ textAlign: 'left' }}>Запиши вес хотя бы пару раз — здесь появится график и прогноз.</p>;

  const move = (cx: number) => {
    const r = box.current!.getBoundingClientRect(), sx = (cx - r.left) / r.width * W;
    let best: Pt | null = null, bd = Infinity;
    for (const p of history) { const d = Math.abs(g.x(p.day) - sx); if (d < bd) { bd = d; best = p; } }
    setHover(bd < 40 ? best : null);
  };
  const grid = [g.hi - 0.6, (g.hi + g.lo) / 2, g.lo + 0.6];
  const tx = g.x(today), showToday = today >= g.d0 && today <= g.d1;
  return <div className="wchart" ref={wrap}>
    <svg ref={box} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Вес и прогноз" onPointerMove={e => move(e.clientX)} onPointerLeave={() => setHover(null)}>
      {grid.map(v => <g key={v}><line x1={pl} x2={W - pr} y1={g.y(v)} y2={g.y(v)} className="gl" /><text x={pl - 8} y={g.y(v) + 4} textAnchor="end">{fmt1(v)}</text></g>)}
      {showToday && <g><line x1={tx} x2={tx} y1={pt} y2={H - pb} className="today" /><text x={tx} y={pt - 8} textAnchor="middle">сегодня</text></g>}
      {plan.length > 1 && <path d={g.path(plan)} className="ln plan" />}
      {fact.length > 1 && <path d={g.path(fact)} className="ln fact" />}
      {history.length > 1 && <path d={g.path(history)} className="ln hist" />}
      {history.map(p => <circle key={p.day} cx={g.x(p.day)} cy={g.y(p.kg)} r={hover?.day === p.day ? 6 : 4} className="dot" />)}
      {hover && <g className="tip" transform={`translate(${Math.min(W - pr - 120, Math.max(pl, g.x(hover.day) - 60))},${Math.max(4, g.y(hover.kg) - 46)})`}>
        <rect width="120" height="34" rx="9" /><text x="60" y="15" textAnchor="middle" className="t1">{fmt1(hover.kg)} кг</text><text x="60" y="28" textAnchor="middle" className="t2">{+hover.day.slice(8, 10)} {MONG[+hover.day.slice(5, 7) - 1]}</text>
      </g>}
      <text x={pl} y={H - 8}>{human(g.d0)}</text><text x={W - pr} y={H - 8} textAnchor="end">{human(g.d1)}</text>
    </svg>
    <div className="legend">
      {history.length > 0 && <span><i className="k-hist" />твой вес</span>}
      {plan.length > 0 && <span><i className="k-plan" />по плану</span>}
      {fact.length > 0 && <span><i className="k-fact" />если так пойдёт дальше</span>}
    </div>
  </div>;
}
