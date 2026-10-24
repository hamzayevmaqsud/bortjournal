/**
 * «?» в шапке каждой страницы: запускает обучение этой страницы.
 * Запуск — через контекст из App: там решают, закрыть ли лист и не идёт ли уже другое обучение.
 */
import { createContext, useContext } from 'react';
import { TOUR_NAME, type TourId } from './tours';
import '../styles/help.css';

export const TourStart = createContext<(id: TourId) => void>(() => {});

export function HelpButton({ tour, className = '' }: { tour: TourId; className?: string }) {
  const start = useContext(TourStart), label = `Как пользоваться: ${TOUR_NAME[tour]}`;
  return <button type="button" className={`help-btn ${className}`} data-tour="help" onClick={() => start(tour)} aria-label={label} title={label}>
    <span aria-hidden="true">?</span>
  </button>;
}
