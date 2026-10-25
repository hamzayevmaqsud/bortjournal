/**
 * Неделя под датой на «Сегодня»: семь дней пн–вс выбранного дня, сегодня отмечено, выбранный — залит.
 * Нажал на день — открылся этот день; ‹ › — соседняя неделя. «К сегодня» не нужно: сегодня всегда видно в ленте.
 * Вперёд — не дальше чем на неделю от сегодня (как раньше у стрелок).
 */
import { addDays, parseDay } from '@bortjournal/core';
import { Icon } from './Icon';
import '../styles/today.css';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function WeekStrip({ day, today, onPick }: { day: string; today: string; onPick: (d: string) => void }) {
  const dow = (parseDay(day).getUTCDay() + 6) % 7, mon = addDays(day, -dow), max = addDays(today, 7);
  const days = Array.from({ length: 7 }, (_, k) => addDays(mon, k));
  return <nav className="weekstrip" aria-label="Дни недели" data-tour="date">
    <button type="button" className="ws-arrow" onClick={() => onPick(addDays(day, -7))} aria-label="Предыдущая неделя"><Icon name="chevL" /></button>
    {days.map((d, k) => {
      const dt = parseDay(d), on = d === day, now = d === today;
      return <button type="button" key={d} className={`ws-day ${on ? 'on' : ''} ${now ? 'today' : ''}`} disabled={d > max}
        aria-current={on ? 'date' : undefined} aria-label={`${WD[k]}, ${dt.getUTCDate()} ${MONG[dt.getUTCMonth()]}${now ? ', сегодня' : ''}`} onClick={() => onPick(d)}>
        <span>{now ? 'сег' : WD[k]}</span><b>{dt.getUTCDate()}</b>
      </button>;
    })}
    <button type="button" className="ws-arrow" disabled={addDays(mon, 7) > max} onClick={() => { const n = addDays(day, 7); onPick(n > max ? max : n); }} aria-label="Следующая неделя"><Icon name="chev" /></button>
  </nav>;
}
