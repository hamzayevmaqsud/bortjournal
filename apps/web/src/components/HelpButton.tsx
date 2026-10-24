/**
 * «?» в шапке каждой страницы: запускает обучение этой страницы.
 * Запуск — через контекст из App: там решают, закрыть ли лист и не идёт ли уже другое обучение.
 */
import { createContext, useContext } from 'react';
import { TOUR_NAME, type TourId } from './tours';
import '../styles/help.css';

export const TourStart = createContext<(id: TourId) => void>(() => {});

/** маленький маяк: луч вращается вокруг башни — бьёт влево, на миг смотрит на тебя (вспышка) и уходит вправо (styles/help.css) */
function Lighthouse() {
  return <svg viewBox="0 0 24 24" width="26" height="26">
    <defs><radialGradient id="hb-f"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".35" stopColor="#FFF1C8" stopOpacity=".9" /><stop offset="1" stopColor="#F4CF74" stopOpacity="0" /></radialGradient><linearGradient id="hb-g" x1="0" x2="1"><stop offset="0" stopColor="#FFF4D6" stopOpacity="1" /><stop offset=".45" stopColor="#FFE3A0" stopOpacity=".75" /><stop offset="1" stopColor="#F4CF74" stopOpacity="0" /></linearGradient></defs>
    <path className="hb-beam" d="M12 6.7 L44 2.2 L44 11.2 Z" fill="url(#hb-g)" />
    <path d="M9.4 5.4 L12 2.6 L14.6 5.4 Z" fill="#E5733C" />
    <rect className="hb-lamp" x="10" y="5.4" width="4" height="2.6" rx=".4" fill="#F4CF74" />
    <circle className="hb-flare" cx="12" cy="6.7" r="6" fill="url(#hb-f)" />
    <path d="M9.6 8 H14.4 L15.6 21 H8.4 Z" fill="#FBF4E6" />
    <path d="M9.35 11 H14.65 L14.95 14.2 H9.05 Z M8.75 17.3 H15.25 L15.6 21 H8.4 Z" fill="#E5733C" />
  </svg>;
}

export function HelpButton({ tour, className = '' }: { tour: TourId; className?: string }) {
  const start = useContext(TourStart), label = `Как пользоваться: ${TOUR_NAME[tour]}`;
  return <button type="button" className={`help-btn ${className}`} data-tour="help" onClick={() => start(tour)} aria-label={label} title={label}>
    <span className="help-mark" aria-hidden="true"><Lighthouse /></span>
    <span className="help-txt" aria-hidden="true">Подсказки</span>
  </button>;
}
