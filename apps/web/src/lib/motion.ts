/** Движение без библиотек: пружина, плавные числа, отклик вибрацией */
import { useEffect, useRef, useState } from 'react';

export const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* iPhone не даёт сайтам вибрацию */ } };

/** пружина: from → to, onUpdate на каждом кадре; возвращает «стоп» */
export function spring(from: number, to: number, onUpdate: (x: number) => void, { stiffness = 260, damping = 26, velocity = 0, onDone }: { stiffness?: number; damping?: number; velocity?: number; onDone?: () => void } = {}) {
  if (reduceMotion()) { onUpdate(to); onDone?.(); return () => {}; }
  let x = from, v = velocity, last = performance.now(), raf = 0;
  const step = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000); last = now;
    const a = -stiffness * (x - to) - damping * v; v += a * dt; x += v * dt;
    if (Math.abs(v) < 0.02 && Math.abs(x - to) < 0.3) { onUpdate(to); onDone?.(); return; }
    onUpdate(x); raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** число, которое плавно «доезжает» до нового значения */
export function useCountUp(target: number, dur = 700) {
  const [v, setV] = useState(0), from = useRef(0);
  useEffect(() => {
    if (reduceMotion()) { setV(target); from.current = target; return; }
    const start = from.current, t0 = performance.now(); let raf = 0;
    const f = (t: number) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), x = start + (target - start) * e; setV(x); from.current = x; if (k < 1) raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

/** значение, которое меняется на следующем кадре — чтобы CSS-переход стартовал с нуля */
export function useNextFrame<T>(value: T, initial: T) {
  const [v, setV] = useState(initial);
  useEffect(() => { const id = requestAnimationFrame(() => setV(value)); return () => cancelAnimationFrame(id); }, [value]);
  return v;
}
