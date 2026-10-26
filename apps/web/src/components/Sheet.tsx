/**
 * Лист снизу: выезжает пружиной, тянется пальцем, закрывается смахиванием вниз
 * (по расстоянию или по скорости), отпущенный раньше — возвращается на место.
 * Длинное содержимое прокручивается внутри; тянуть лист можно, когда прокрутка в начале.
 * На широком экране — окно по центру: проявляется с лёгким подъёмом, без перетаскивания.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { buzz, spring } from '../lib/motion';
import { useWide } from '../lib/wide';

export function Sheet({ open, onClose, title, children, tall = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; tall?: boolean }) {
  const sheet = useRef<HTMLDivElement>(null), scrim = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const y = useRef(1), stop = useRef<() => void>(() => {}), wide = useWide(), modal = useRef(wide);
  modal.current = wide;
  const place = (v: number) => {
    y.current = v; const el = sheet.current;
    if (el) {
      if (modal.current) { el.style.transform = `translate(-50%, calc(-50% + ${v * 28}px)) scale(${1 - v * 0.04})`; el.style.opacity = String(Math.max(0, 1 - v * 1.4)); }
      else { el.style.transform = `translateY(${v * 105}%)`; el.style.opacity = ''; }
      // закрытый лист прячем совсем: когда поле в открытом листе получает фокус, браузер сдвигает .app,
      // и закрытые листы, стоящие сразу за нижним краем, выглядывали бы снизу
      el.style.visibility = v >= 0.999 ? 'hidden' : '';
    }
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - v));
  };
  useEffect(() => { place(y.current); }, [wide]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    stop.current();
    stop.current = open ? spring(y.current, 0, place, { stiffness: 340, damping: 30 }) : spring(y.current, 1, place, { stiffness: 300, damping: 32 });
    if (open) { buzz(8); if (body.current) body.current.scrollTop = 0; }
  }, [open]);

  useEffect(() => {
    const el = sheet.current!; let y0: number | null = null, t0 = 0, h = 1, last = 0, armed = false;
    const down = (e: PointerEvent) => {
      if (modal.current) return;
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

  // фокус: при открытии — в лист (первое поле или сам лист), Tab не уходит за его край, после закрытия — туда, откуда открыли
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement as HTMLElement | null;
    const el = sheet.current!;
    const focusables = () => [...el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null || x === document.activeElement);
    const t = setTimeout(() => {
      if (el.contains(document.activeElement)) return; // поле с autoFocus уже в фокусе
      // на телефоне — на заголовок: фокус в поле вызвал бы клавиатуру при каждом открытии листа
      const first = (modal.current ? focusables().find(x => x.matches('input,select,textarea')) : undefined) ?? el.querySelector<HTMLElement>('h2') ?? el;
      if (first === el || first.tagName === 'H2') { first.setAttribute('tabindex', '-1'); }
      first.focus({ preventScroll: true });
    }, 60);
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables(); if (!list.length) return;
      const a = list[0]!, z = list[list.length - 1]!;
      if (e.shiftKey && (document.activeElement === a || !el.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (document.activeElement === z || !el.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
    };
    addEventListener('keydown', k);
    return () => {
      clearTimeout(t); removeEventListener('keydown', k);
      const to = back.current; if (to && document.contains(to) && !to.closest('[inert]')) to.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  // поверх всего приложения: лист из прокручиваемого экрана иначе оказался бы внизу прокрутки
  const host = typeof document !== 'undefined' ? document.querySelector('.app') ?? document.body : null;
  const ui = <>
    <div ref={scrim} className={`scrim ${open ? 'on' : ''}`} onClick={onClose} />
    <div ref={sheet} className={`sheet ${tall ? 'tall' : ''} ${wide ? 'modal' : ''}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!open} inert={!open || undefined}>
      {!wide && <div className="grab" />}
      <button className="x" onClick={onClose} aria-label="Закрыть">×</button>
      {title && <h2>{title}</h2>}
      <div className="sheet-body" ref={body}>{open ? children : null}</div>
    </div>
  </>;
  return host ? createPortal(ui, host) : ui;
}
