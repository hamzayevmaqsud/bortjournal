/**
 * Закладка в шапке каждой страницы: запускает обучение этой страницы.
 * Лента свисает с верхнего края экрана над своим местом в шапке: видно кончик с «?», иногда она сама чуть тянется вниз,
 * при наведении и фокусе выезжает. Место в шапке остаётся за ней (слот), лента поднята к верху экрана на --hang.
 * Запуск — через контекст из App: там решают, закрыть ли лист и не идёт ли уже другое обучение.
 */
import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { TOUR_NAME, type TourId } from './tours';
import '../styles/help.css';

export const TourStart = createContext<(id: TourId) => void>(() => {});

export function HelpButton({ tour, className = '' }: { tour: TourId; className?: string }) {
  const start = useContext(TourStart), label = `Как пользоваться: ${TOUR_NAME[tour]}`, slot = useRef<HTMLSpanElement>(null);
  // насколько слот ниже верха экрана (с учётом прокрутки) — на столько поднять ленту
  useLayoutEffect(() => {
    const el = slot.current, screen = el?.closest<HTMLElement>('.screen'); if (!el || !screen) return;
    const place = () => { el.style.setProperty('--hang', `${Math.max(0, Math.round(el.getBoundingClientRect().top - screen.getBoundingClientRect().top + screen.scrollTop))}px`); };
    place();
    const ro = new ResizeObserver(place); ro.observe(screen); if (screen.firstElementChild) ro.observe(screen.firstElementChild);
    addEventListener('resize', place);
    return () => { ro.disconnect(); removeEventListener('resize', place); };
  }, []);
  return <span className={`help-slot ${className}`} ref={slot}>
    <button type="button" className="help-btn" data-tour="help" onClick={() => start(tour)} aria-label={label} title={label}>
      <span className="help-rib" aria-hidden="true"><span className="help-peek"><span className="help-q">?</span></span></span>
    </button>
  </span>;
}
