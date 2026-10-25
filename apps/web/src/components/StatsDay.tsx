/**
 * Подробности дня в статистике: оценка по частям (как «Оценка дня»), что записано против норм и кнопка «Открыть день».
 * Панель раскрывается под календарём; фокус — на заголовок, Esc закрывает и возвращает фокус на день.
 */
import { useEffect, useRef, useState } from 'react';
import { parseDay } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { fmt, fmt1, fmt2, plural } from '../lib/format';
import { humanLong, ScoreRing, verdict } from './Charts';

const WDF = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MIN = (m: number) => m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`;
const LEVEL: Record<string, [string, string]> = { good: ['в норме', 'ok'], warn: ['чуть больше', 'warn'], bad: ['перебор', 'bad'], low: ['мало', 'warn'] };

interface Detail {
  day: string; isToday: boolean; future: boolean; any: boolean; score: number | null;
  parts: Array<{ area: string; name: string; v: number }>;
  norms: { kcal: number; protein: number; water: number; steps: number; study: number };
  facts: { meals: number; kcal: number; protein: number; kcalLevel: string; waterMl: number; steps: number; weightKg: number | null; tasks: number; tasksDone: number; studyMin: number; quizTotal: number; quizAnswered: number; workouts: number; gymMin: number; pages: number; spent: number | null; currency: string | null };
}

function Row({ name, value, of, tag, tone, v }: { name: string; value: string; of?: string; tag?: string; tone?: string; v?: number }) {
  return <li className={value === '—' ? 'off' : ''}>
    <span className="sd-k">{name}</span>
    <span className="sd-v"><b>{value}</b>{of && <small> {of}</small>}{tag && <em className={`sd-tag ${tone ?? ''}`}>{tag}</em>}</span>
    {v !== undefined && <span className="sd-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, v))}%` }} /></span>}
  </li>;
}

export function DayDetail({ day, has, onClose, onOpenDay }: { day: string; has: (f: string) => boolean; onClose: () => void; onOpenDay?: (day: string) => void }) {
  const [d, setD] = useState<Detail | null>(null), [err, setErr] = useState('');
  const head = useRef<HTMLHeadingElement>(null), back = useRef<Element | null>(null);
  useEffect(() => { back.current = document.activeElement; }, []);
  useEffect(() => {
    let off = false; setD(null); setErr('');
    api<Detail>(`/api/stats/day?day=${day}`).then(x => { if (!off) setD(x); }, e => { if (!off) setErr(e instanceof ApiError ? e.message : 'Не получилось загрузить день'); });
    return () => { off = true; };
  }, [day]);
  useEffect(() => { if (d) head.current?.focus({ preventScroll: true }); }, [d]);
  const close = () => { onClose(); const b = back.current as HTMLElement | null; if (b?.isConnected) b.focus(); };
  const title = `${humanLong(day)}, ${WDF[parseDay(day).getUTCDay()]}`;
  return <section className="sd" aria-label={`День: ${title}`} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
    <header className="sd-head">
      <span className="sd-ring">{d && d.score !== null && <><ScoreRing v={d.score} size={56} sw={6} /><b>{d.score}</b></>}</span>
      <div className="sd-title"><h3 ref={head} tabIndex={-1}>{title}</h3>
        <p>{!d ? (err || 'Загружаю…') : d.isToday ? `сегодня, пока · ${verdict(d.score, d.any)}` : verdict(d.score, d.any)}</p></div>
      <button type="button" className="sd-x" onClick={close} aria-label="Закрыть подробности дня">×</button>
    </header>
    {d && !d.future && <>
      {d.parts.length > 0 && <div className="ov-parts sd-parts" aria-label="Из чего сложилась оценка">
        {d.parts.map(p => <span key={p.area} className={`ov-part ${p.v >= 99 ? 'ok' : ''}`}>{p.v >= 99 ? '✓' : `${p.v}%`} {p.name}</span>)}
        {d.facts.workouts > 0 && <span className="ov-part bonus">+ зал</span>}
        {d.facts.pages > 0 && <span className="ov-part bonus">+ чтение</span>}
      </div>}
      {!d.any ? <p className="card-note">В этот день ничего не записано. {onOpenDay ? 'Можно открыть день и дописать задним числом.' : ''}</p>
        : <ul className="sd-facts">
          <Row name="Еда" value={d.facts.meals ? fmt(d.facts.kcal) : '—'} of={d.facts.meals ? `из ${fmt(d.norms.kcal)} ккал` : 'не записана'} v={d.facts.meals ? d.facts.kcal / d.norms.kcal * 100 : undefined} tag={LEVEL[d.facts.kcalLevel]?.[0]} tone={LEVEL[d.facts.kcalLevel]?.[1]} />
          {d.norms.protein > 0 && d.facts.meals > 0 && <Row name="Белок" value={fmt(d.facts.protein)} of={`из ${fmt(d.norms.protein)} г`} v={d.facts.protein / d.norms.protein * 100} />}
          <Row name="Вода" value={d.facts.waterMl ? fmt1(d.facts.waterMl / 1000) : '—'} of={`из ${fmt1(d.norms.water / 1000)} л`} v={d.facts.waterMl / d.norms.water * 100} />
          <Row name="Шаги" value={d.facts.steps ? fmt(d.facts.steps) : '—'} of={`из ${fmt(d.norms.steps)}`} v={d.facts.steps / d.norms.steps * 100} />
          {d.facts.weightKg !== null && <Row name="Вес" value={fmt1(d.facts.weightKg)} of="кг" />}
          {d.facts.tasks > 0 && <Row name="Задачи" value={String(d.facts.tasksDone)} of={`из ${d.facts.tasks}`} v={d.facts.tasksDone / d.facts.tasks * 100} />}
          {(has('study') || d.facts.studyMin > 0) && <Row name="Учёба" value={d.facts.studyMin ? MIN(d.facts.studyMin) : '—'} of={`из ${MIN(d.norms.study)}`} v={d.facts.studyMin / d.norms.study * 100} />}
          {d.facts.quizTotal > 0 && <Row name="Вопросы" value={String(d.facts.quizAnswered)} of={`из ${d.facts.quizTotal}`} v={d.facts.quizAnswered / d.facts.quizTotal * 100} />}
          {(has('gym') || d.facts.workouts > 0) && <Row name="Зал" value={d.facts.workouts ? `${d.facts.workouts} ${plural(d.facts.workouts, 'тренировка', 'тренировки', 'тренировок')}` : '—'} of={d.facts.gymMin ? `· ${MIN(d.facts.gymMin)}` : d.facts.workouts ? '' : 'не было'} />}
          {d.facts.pages > 0 && <Row name="Чтение" value={String(d.facts.pages)} of="стр." />}
          {d.facts.spent !== null && has('budget') && <Row name="Потрачено" value={d.facts.spent ? fmt2(d.facts.spent) : '—'} of={d.facts.currency ?? ''} />}
        </ul>}
    </>}
    {onOpenDay && !d?.future && <div className="sd-foot">
      <button type="button" className="sd-open" onClick={() => onOpenDay(day)}>{d?.isToday ? 'Открыть сегодня' : 'Открыть день'}</button>
      <span className="card-note">Зал и чтение — бонус к оценке.</span>
    </div>}
  </section>;
}
