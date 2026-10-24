/**
 * «Совет дня» на экране «Сегодня»: одна спокойная подсказка по сегодняшним записям — с 17:00, пока день ещё можно поправить.
 * «×» прячет совет до завтра (в памяти браузера). По воскресеньям и понедельникам рядом — ссылка на «Итог недели».
 */
import { useEffect, useState } from 'react';
import { parseDay } from '@bortjournal/core';
import { api, type Today } from '../lib/api';
import { Icon } from './Icon';
import '../styles/insights.css';

export interface DayTipItem { key: string; text: string; tone: 'nudge' | 'good'; action?: 'meal' | 'water' | 'steps' | 'plans' | 'gym' | 'study' | 'quiz' }
interface TipsResp { day: string; evening: boolean; tip: DayTipItem | null; more: DayTipItem[] }

const HIDE = 'lumi.tip.hidden', EVENING = 17 * 60;
const hiddenOn = () => { try { return localStorage.getItem(HIDE) ?? ''; } catch { return ''; } };
const ACT: Record<string, string> = { meal: 'Записать еду', water: 'Записать воду', steps: 'Записать шаги', plans: 'Открыть планы', gym: 'Открыть зал', study: 'Учёба', quiz: 'Ответить' };

export function DayTip({ data, today, onMeal, onWater, onSteps, onGo, onPro, onWeek }: {
  data: Today | null; today: string; onMeal: () => void; onWater: () => void; onSteps: () => void; onGo: (tab: string) => void; onPro: (what: string) => void; onWeek?: () => void;
}) {
  const [r, setR] = useState<TipsResp | null>(null), [hidden, setHidden] = useState(hiddenOn), [more, setMore] = useState(false);
  const evening = !!data?.isToday && data.now.minutes >= EVENING;
  // перечитываем совет, только когда поменялось что-то из записанного за день
  const f = data?.parts.food, sig = data ? [f?.kcal, f?.protein, f?.waterMl, data.parts.body?.steps, data.parts.plans?.tasks.filter(t => t.done).length, data.parts.plans?.tasks.length, data.events.length].join('|') : '';
  useEffect(() => {
    if (!evening || hidden === today) return;
    let live = true;
    api<TipsResp>('/api/insights/today').then(x => { if (live) setR(x); }, () => {});
    return () => { live = false; };
  }, [evening, hidden, today, sig]);

  const wd = parseDay(today).getUTCDay(), weekLink = !!onWeek && !!data?.isToday && (wd === 0 || wd === 1);
  const tip = evening && hidden !== today && r?.day === today ? r.tip : null;
  if (!tip && !weekLink) return null;
  const act = (a: DayTipItem['action']) => {
    if (a === 'meal') onMeal(); else if (a === 'water') onWater(); else if (a === 'steps') onSteps(); else if (a === 'plans') onGo('plans');
    else if (a === 'gym') onPro('Зал'); else if (a === 'study') onPro('Учёба'); else if (a === 'quiz') onPro('Вопросы дня');
  };
  const hide = () => { try { localStorage.setItem(HIDE, today); } catch { /* без памяти — спрячем до перезагрузки */ } setHidden(today); };

  return <div className="tip-zone">
    {tip && <section className={`tip-card ${tip.tone === 'good' ? 'good' : ''}`} aria-label="Совет на вечер">
      <span className="tip-mark" aria-hidden="true"><Icon name={tip.tone === 'good' ? 'star' : 'moon'} /></span>
      <div className="tip-main">
        <small className="tip-k">{tip.tone === 'good' ? 'Хороший день' : 'Совет на вечер'}</small>
        <p className="tip-text">{tip.text}</p>
        {more && r!.more.length > 0 && <ul className="tip-more">{r!.more.map(t => <li key={t.key}>{t.text}</li>)}</ul>}
        <div className="tip-acts">
          {tip.action && <button type="button" className="tip-act" onClick={() => act(tip.action)}>{ACT[tip.action]}<Icon name="chev" /></button>}
          {r!.more.length > 0 && <button type="button" className="tip-link" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? 'Скрыть' : `Ещё ${r!.more.length}`}</button>}
        </div>
      </div>
      <button type="button" className="tip-x" aria-label="Скрыть совет до завтра" title="Скрыть до завтра" onClick={hide}>×</button>
    </section>}
    {weekLink && <button type="button" className="week-link" onClick={onWeek}><Icon name="stats" />Итог недели<Icon name="chev" /></button>}
  </div>;
}
