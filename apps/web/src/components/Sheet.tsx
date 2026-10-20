/**
 * Лист снизу: выезжает пружиной, тянется пальцем, закрывается смахиванием вниз
 * (по расстоянию или по скорости), отпущенный раньше — возвращается на место.
 * Длинное содержимое прокручивается внутри; тянуть лист можно, когда прокрутка в начале.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { buzz, spring } from '../lib/motion';

export function Sheet({ open, onClose, title, children, tall = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; tall?: boolean }) {
  const sheet = useRef<HTMLDivElement>(null), scrim = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const y = useRef(1), stop = useRef<() => void>(() => {});
  const place = (v: number) => { y.current = v; if (sheet.current) sheet.current.style.transform = `translateY(${v * 105}%)`; if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - v)); };

  useEffect(() => {
    stop.current();
    stop.current = open ? spring(y.current, 0, place, { stiffness: 340, damping: 30 }) : spring(y.current, 1, place, { stiffness: 300, damping: 32 });
    if (open) { buzz(8); if (body.current) body.current.scrollTop = 0; }
  }, [open]);

  useEffect(() => {
    const el = sheet.current!; let y0: number | null = null, t0 = 0, h = 1, last = 0, armed = false;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('button,input,textarea,select,label,a,[data-nodrag]')) return;
      // внутри прокрутки тянем лист, только если она в самом начале
      armed = !t.closest('.sheet-body') || (body.current?.scrollTop ?? 0) <= 0;
      if (!armed) return;
      y0 = e.clientY; t0 = performance.now(); h = el.offsetHeight; last = 0; stop.current();
    };
    const move = (e: PointerEvent) => {
      if (y0 === null) return; last = e.clientY - y0;
      if (last < 4 && (body.current?.scrollHeight ?? 0) > (body.current?.clientHeight ?? 0) && last < 0) return;
      if (last > 0) { el.setPointerCapture(e.pointerId); place(last / h / 1.05); } else place(last / h / 6);
    };
    const up = () => {
      if (y0 === null) return; const v = last / Math.max(1, performance.now() - t0); y0 = null;
      if (last > h * 0.25 || v > 0.6) onClose(); else stop.current = spring(y.current, 0, place, { stiffness: 380, damping: 30 });
    };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }, [onClose]);

  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open, onClose]);

  return <>
    <div ref={scrim} className={`scrim ${open ? 'on' : ''}`} onClick={onClose} />
    <div ref={sheet} className={`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!open} inert={!open || undefined}>
      <div className="grab" />
      {title && <h2>{title}</h2>}
      <div className="sheet-body" ref={body}>{open ? children : null}</div>
    </div>
  </>;
}
