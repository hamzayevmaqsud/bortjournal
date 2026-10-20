/**
 * «Сегодня»: шапка дня (смахни влево-вправо), план/вес/серия, кольца, «что ждёт»,
 * лента дня полосами и задачи.
 */
import { useEffect, useRef } from 'react';
import { parseDay } from '@bortjournal/core';
import type { Subscription, Today as TodayData } from '../lib/api';
import { fmt, fmt1, fmt2, MONG, plural, WDF } from '../lib/format';
import { buzz, spring } from '../lib/motion';
import { Icon } from '../components/Icon';
import { Ring } from '../components/Ring';
import { Tasks } from '../components/Tasks';
import { marksOf, Timeline, TimelineSum, type Mark } from '../components/Timeline';

export function Today({ data, day, today, sub, still, onDay, onAdd, onDelete, onEdit, onToggleTask, onGo, onPro, onPaywall, onSteps, onWeight, onWater, onTask }: {
  data: TodayData | null; day: string; today: string; sub: Subscription; still: boolean;
  onDay: (dir: number) => void; onAdd: (time?: string) => void; onDelete: (m: Mark) => void; onEdit: (m: Mark) => void; onToggleTask: (id: string) => void;
  onGo: (tab: string) => void; onPro: (what: string) => void; onPaywall: () => void;
  onSteps: () => void; onWeight: () => void; onWater: () => void; onTask: () => void;
}) {
  const box = useRef<HTMLDivElement>(null), dt = parseDay(day), off = Math.round((parseDay(day).getTime() - parseDay(today).getTime()) / 864e5);
  const rel = off === 0 ? 'сегодня' : off === -1 ? 'вчера' : off === 1 ? 'завтра' : '';

  // смахивание шапки дня: тянется за пальцем, отпущенная — уезжает или возвращается
  const head = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = head.current!, slide = (x: number) => { if (box.current) box.current.style.transform = `translateX(${x}px)`; };
    let x0: number | null = null, y0 = 0, t0 = 0, lock: boolean | null = null;
    const down = (e: PointerEvent) => { x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); lock = null; };
    const move = (e: PointerEvent) => { if (x0 === null) return; const dx = e.clientX - x0, dy = e.clientY - y0; if (lock === null && Math.hypot(dx, dy) > 8) lock = Math.abs(dx) > Math.abs(dy); if (lock) slide(dx * 0.5); };
    const up = (e: PointerEvent) => { if (x0 === null) return; const dx = e.clientX - x0, v = dx / Math.max(1, performance.now() - t0); x0 = null;
      if (lock && (Math.abs(dx) > 70 || Math.abs(v) > 0.5)) onDay(dx < 0 ? 1 : -1); else spring(dx * 0.5, 0, slide); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }, [onDay]);

  // новый день приезжает с той стороны, куда смахнули
  const lastDay = useRef(day);
  useEffect(() => {
    if (lastDay.current === day || !box.current) { lastDay.current = day; return; }
    const dir = day > lastDay.current ? 1 : -1; lastDay.current = day;
    const el = box.current; buzz(8);
    spring(dir * 60, 0, x => { el.style.transform = `translateX(${x}px)`; el.style.opacity = String(1 - Math.abs(x) / 70); }, { stiffness: 300, damping: 26 });
  }, [day]);

  const P = data?.parts ?? {}, food = P.food, body = P.body, study = P.study, tasks = P.plans?.tasks ?? [];
  const marks = data ? marksOf(data.events, tasks) : [];
  const rows: Array<{ key: string; icon: string; c: string; title: string; sub: string; pro: string }> = [];
  if (data?.isToday && study?.quiz.left) rows.push({ key: 'quiz', icon: 'quiz', c: 'var(--quiz)', title: 'Вопросы дня', sub: `${study.quiz.left} ${plural(study.quiz.left, 'ждёт', 'ждут', 'ждут')} ответа · пара минут`, pro: 'Учёба' });
  if (P.budget?.configured && P.budget.leftToday !== undefined) rows.push({ key: 'budget', icon: 'money', c: 'var(--money)', title: P.budget.leftToday >= 0 ? `Можно потратить ${fmt2(P.budget.leftToday)} ${P.budget.currency}` : `Перерасход ${fmt2(-P.budget.leftToday)} ${P.budget.currency}`, sub: `лимит дня ${fmt2(P.budget.allow ?? 0)} ${P.budget.currency}`, pro: 'Бюджет' });
  if (P.books?.reading) { const b = P.books.reading; rows.push({ key: 'books', icon: 'books', c: 'var(--books)', title: b.title, sub: `${b.pct}% · стр. ${b.page}${b.pages ? ` из ${b.pages}` : ''}${b.todayPages ? ` · сегодня +${b.todayPages}` : ''}`, pro: 'Книги' }); }
  if (P.gym?.plan && !P.gym.workouts.length && data?.isToday) rows.push({ key: 'gym', icon: 'gym', c: 'var(--gym)', title: `Сегодня тренировка: ${P.gym.plan.name}`, sub: `по плану${P.gym.plan.time ? ` в ${P.gym.plan.time}` : ''} · ${P.gym.plan.exercises} упр.`, pro: 'Зал' });

  return <div className="day" ref={box}>
    <header className="dayhead" ref={head}>
      <button className="nav" onClick={() => onDay(-1)} aria-label="Предыдущий день"><Icon name="chevL" /></button>
      <button className="daytitle" onClick={() => off && onDay(-off)} title="К сегодняшнему дню">
        <span className={off ? 'past' : ''}>{rel ? `${rel} · ` : ''}{WDF[dt.getUTCDay()]}</span><b>{dt.getUTCDate()} {MONG[dt.getUTCMonth()]}</b>
      </button>
      <button className="nav" onClick={() => onDay(1)} aria-label="Следующий день"><Icon name="chev" /></button>
    </header>

    {sub.source === 'trial' && <button className="trial-bar" onClick={onPaywall}><Icon name="flame" /><span>Пробный Pro: <b>ещё {sub.daysLeft} {plural(sub.daysLeft ?? 0, 'день', 'дня', 'дней')}</b></span><em>Тарифы</em></button>}
    {!sub.pro && sub.ended && <button className="trial-bar" onClick={onPaywall}><Icon name="flame" /><span>Pro закончился — еда, вода, шаги и задачи остаются</span><em>Продлить</em></button>}

    {!data ? <><div className="skel" style={{ height: 66 }} /><div className="skel" style={{ height: 120 }} /><div className="skel" style={{ height: 220 }} /></> : <>
      <div className="stats">
        <button className="stat" onClick={() => onPro('Цель и прогноз')}><i>План</i><b>{fmt(data.plan.kcal)}</b><small>ккал</small></button>
        <button className="stat" onClick={onWeight}><i>Вес</i><b>{body?.weight ? fmt1(body.weight.kg) : '—'}</b><small>{body?.weight?.today ? (data.isToday ? 'кг сегодня' : 'кг в этот день') : data.isToday ? 'взвеситься' : 'кг, последний'}</small></button>
        <button className={`stat ${data.streak ? 'hot' : ''}`} onClick={() => onPro('Статистика')}><i><Icon name="flame" />Серия</i><b>{data.streak}</b><small>{plural(data.streak, 'день', 'дня', 'дней')}</small></button>
      </div>

      <section className="panel"><div className="rings">
        {food && <Ring value={food.kcal} max={food.norm.kcal} color="var(--food)" shown={food.kcal} label={`Еда · из ${fmt(food.norm.kcal)}`} onClick={() => onGo('food')} />}
        {food && <Ring value={food.waterMl} max={food.norm.water} color="var(--water)" shown={food.waterMl / 1000} decimals={1} label={`Вода · из ${fmt1(food.norm.water / 1000)} л`} onClick={onWater} />}
        {body && <Ring value={body.steps} max={body.stepsGoal} color="var(--steps)" shown={body.steps / 1000} decimals={1} label={`Шаги · из ${fmt1(body.stepsGoal / 1000)}к`} onClick={onSteps} />}
        {study && <Ring value={study.minutes} max={study.goal} color="var(--study)" shown={study.minutes} label={`Учёба · из ${study.goal} мин`} onClick={() => onPro('Учёба')} />}
      </div></section>

      {rows.length > 0 && <div className="rows">{rows.map(r => <button key={r.key} className="row" onClick={() => onPro(r.pro)}>
        <span className="chip-ic" style={{ ['--c' as string]: r.c }}><Icon name={r.icon} /></span><span className="mid"><b>{r.title}</b><small>{r.sub}</small></span><Icon name="chev" className="ic chev" />
      </button>)}</div>}

      <section className="panel">
        <div className="panel-h"><h2>Лента дня</h2><small>нажми отметку или пустое место</small></div>
        <Timeline marks={marks} pro={sub.pro} now={data.isToday ? data.now.hm : null} still={still} onAdd={t => onAdd(t)} onDelete={onDelete} onEdit={onEdit} onToggleTask={onToggleTask} />
        <TimelineSum kcal={food?.kcal ?? 0} ml={food?.waterMl ?? 0} done={tasks.filter(t => t.done).length} total={tasks.length} />
      </section>

      <section className="panel">
        <div className="panel-h"><h2>{data.isToday ? 'Задачи на сегодня' : 'Задачи'}</h2><small>{tasks.filter(t => t.done).length} из {tasks.length}</small></div>
        <Tasks tasks={tasks} onToggle={onToggleTask} onOpen={() => onGo('plans')} empty="Задач на этот день нет." />
        <button className="add-row" onClick={onTask}><Icon name="plus" />Задача на этот день</button>
      </section>
    </>}
  </div>;
}
