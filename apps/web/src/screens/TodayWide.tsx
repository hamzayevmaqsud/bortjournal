/**
 * «Сегодня» — раскладка веб-версии журнала и на компьютере, и на телефоне: крупная дата, сводка «план · вес · серия»,
 * лента дня, сетка сплошных плиток (крем, синий, горчица, оранжевый, шалфей, персик).
 * На телефоне плитки идут столбиком, у ленты нет подписей и итогов, а шапку дня можно смахнуть влево-вправо.
 */
import { can } from '../lib/features';
import { useEffect, useRef, useState } from 'react';
import { parseDay } from '@bortjournal/core';
import { api, type Subscription, type Today as TodayData } from '../lib/api';
import { fmt, fmt1, fmt2, MONG, plural, WDF } from '../lib/format';
import { buzz, spring, useCountUp } from '../lib/motion';
import { Icon } from '../components/Icon';
import { Arc } from '../components/Ring';
import { Tasks } from '../components/Tasks';
import { marksOf, Timeline, type Mark } from '../components/Timeline';
import { useToast } from '../components/Toasts';

const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const greet = (hm: string) => { const h = +hm.slice(0, 2); return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; };

function Big({ v, of, unit, dec, dec2 }: { v: number; of?: string; unit?: string; dec?: boolean; dec2?: boolean }) {
  const n = useCountUp(v);
  return <div className="wbig"><b>{dec2 ? fmt2(n) : dec ? fmt1(n) : fmt(n)}</b>{of && <small>/ {of}</small>}{unit && <small>{unit}</small>}</div>;
}

function RingBox({ v, max, color }: { v: number; max: number; color: string }) {
  return <span className="ringbox"><Arc size={132} sw={12} color={color} p={max ? v / max : 0} /><em>{max ? Math.round(v / max * 100) : 0}%</em></span>;
}

export function TodayWide({ wide = true, data, day, today, sub, still, onDay, onAdd, onDelete, onEdit, onToggleTask, onGo, onPro, onPaywall, onSteps, onWeight, onWater, onMeal, onAddWater, onTaskAdded, onTaskOpen }: {
  wide?: boolean; data: TodayData | null; day: string; today: string; sub: Subscription; still: boolean;
  onDay: (dir: number) => void; onAdd: (time?: string) => void; onDelete: (m: Mark) => void; onEdit: (m: Mark) => void; onToggleTask: (id: string) => void;
  onGo: (tab: string) => void; onPro: (what: string) => void; onPaywall: () => void;
  onSteps: () => void; onWeight: () => void; onWater: () => void; onMeal: () => void; onAddWater: (ml: number) => void; onTaskAdded: () => void; onTaskOpen: () => void;
}) {
  const toast = useToast(), [title, setTitle] = useState(''), [busy, setBusy] = useState(false);
  const dt = parseDay(day), off = Math.round((dt.getTime() - parseDay(today).getTime()) / 864e5);
  const rel = off === 0 ? 'сегодня' : off === -1 ? 'вчера' : off === 1 ? 'завтра' : '';
  const P = data?.parts ?? {}, food = P.food, body = P.body, study = P.study, gym = P.gym, tasks = P.plans?.tasks ?? [];
  const marks = data ? marksOf(data.events, tasks) : [];
  const done = tasks.filter(t => t.done).length;

  // смахивание шапки на телефоне: тянется за пальцем, отпущенная — листает день или возвращается
  const head = useRef<HTMLElement>(null), page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = head.current; if (!el || wide) return;
    const slide = (x: number) => { if (page.current) page.current.style.transform = x ? `translateX(${x}px)` : ''; };
    let x0: number | null = null, y0 = 0, t0 = 0, lock: boolean | null = null;
    const down = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('button')) return; x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); lock = null; };
    const move = (e: PointerEvent) => { if (x0 === null) return; const dx = e.clientX - x0, dy = e.clientY - y0; if (lock === null && Math.hypot(dx, dy) > 8) lock = Math.abs(dx) > Math.abs(dy); if (lock) slide(dx * 0.5); };
    const up = (e: PointerEvent) => { if (x0 === null) return; const dx = e.clientX - x0, v = dx / Math.max(1, performance.now() - t0); x0 = null;
      if (lock && (Math.abs(dx) > 70 || Math.abs(v) > 0.5)) { slide(0); onDay(dx < 0 ? 1 : -1); } else spring(dx * 0.5, 0, slide); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }, [onDay, wide]);
  // новый день приезжает с той стороны, куда листали
  const lastDay = useRef(day);
  useEffect(() => {
    if (lastDay.current === day || !page.current) { lastDay.current = day; return; }
    const dir = day > lastDay.current ? 1 : -1, el = page.current; lastDay.current = day; buzz(8);
    spring(dir * 50, 0, x => { el.style.transform = x ? `translateX(${x}px)` : ''; el.style.opacity = String(1 - Math.abs(x) / 70); }, { stiffness: 300, damping: 26 });
  }, [day]);

  const sums: Record<string, string> = {
    food: food?.kcal ? `${fmt(food.kcal)} ккал` : 'нет записей',
    water: food ? `${fmt1(food.waterMl / 1000)} из ${fmt1(food.norm.water / 1000)} л` : '—',
    study: study?.minutes ? `${study.minutes} мин` : '—',
    gym: gym?.workouts.length ? `${gym.workouts.length} ${plural(gym.workouts.length, 'тренировка', 'тренировки', 'тренировок')}` : '—',
    task: tasks.length ? `${done} из ${tasks.length}` : '—',
  };

  const addTask = async () => {
    const t = title.trim(); if (!t || busy) return;
    setBusy(true);
    try { await api('/api/plans/tasks', { method: 'POST', body: { title: t, day } }); setTitle(''); onTaskAdded(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Не получилось', { err: true }); } finally { setBusy(false); }
  };
  const proBtn = (what: string, label: string, ic: string) => <button className="btn-accent" onClick={() => onPro(what)}><Icon name={ic} />{label}{!can(sub, what) && <span className="lock">PRO</span>}</button>;

  return <div className={`wide-page ${wide ? '' : 'narrow'}`} ref={page}>
    <header className="hero" ref={head}>
      <div className="hero-left">
        <span className="hero-wd">{rel ? `${rel} · ` : ''}{WDF[dt.getUTCDay()]}</span>
        <h1 className="hero-day">{dt.getUTCDate()}<span>{MONG[dt.getUTCMonth()]}</span></h1>
      </div>
      <div className="hero-side">
        <div className="datenav">
          <button onClick={() => onDay(-1)} aria-label="Предыдущий день"><Icon name="chevL" /></button>
          <button className={`cur ${off ? 'not-today' : ''}`} onClick={() => off && onDay(-off)} title="К сегодняшнему дню">{rel || WDF[dt.getUTCDay()]} · {dt.getUTCDate()} {MON[dt.getUTCMonth()]}</button>
          <button onClick={() => onDay(1)} aria-label="Следующий день"><Icon name="chev" /></button>
        </div>
        {data && <span className="greet">{greet(data.now.hm)}{data.name ? `, ${data.name}` : ''}.</span>}
        {data && <div className="statgroup">
          <button onClick={() => onPro('Цель и прогноз')}><i><Icon name="today" />план</i><b>{fmt(data.plan.kcal)}<small>ккал</small></b><span>белок {fmt(data.plan.protein)} г</span></button>
          <button onClick={onWeight}><i><Icon name="steps" />вес</i><b>{body?.weight ? fmt1(body.weight.kg) : '—'}<small>кг</small></b><span className={body?.weight?.today ? '' : 'go'}>{body?.weight?.today ? (data.isToday ? 'сегодня' : 'в этот день') : 'взвеситься →'}</span></button>
          <button className="hot" onClick={() => onPro('Статистика')}><i><Icon name="flame" />серия</i><b>{data.streak}<small>{plural(data.streak, 'день', 'дня', 'дней')}</small></b><span>подряд</span></button>
        </div>}
      </div>
    </header>

    {sub.source === 'trial' && <button className="trial-bar" onClick={onPaywall}><Icon name="flame" /><span>Пробный Pro: <b>ещё {sub.daysLeft} {plural(sub.daysLeft ?? 0, 'день', 'дня', 'дней')}</b> — потом еда, вода, шаги, задачи, цель и статистика остаются бесплатными</span><em>Тарифы</em></button>}
    {!sub.pro && sub.ended && <button className="trial-bar" onClick={onPaywall}><Icon name="flame" /><span>Pro закончился — еда, вода, шаги, задачи, цель и статистика остаются</span><em>Продлить</em></button>}

    {!data ? <div className="wgrid"><div className="skel" style={{ gridColumn: 'span 12', height: 260 }} /><div className="skel" style={{ gridColumn: 'span 4', height: 230 }} /><div className="skel" style={{ gridColumn: 'span 4', height: 230 }} /><div className="skel" style={{ gridColumn: 'span 4', height: 230 }} /></div> : <>
      <section className="panel tl-panel">
        <Timeline marks={marks} now={data.isToday ? data.now.hm : null} still={still} pro={can(sub, 'study') || can(sub, 'gym')} sums={wide ? sums : undefined} onAdd={t => onAdd(t)} onDelete={onDelete} onEdit={onEdit} onToggleTask={onToggleTask} />
        <p className="tl-hint">{wide ? 'Нажми на пустое место дорожки — добавишь запись на это время. Нажми на отметку — изменишь её.' : 'Нажми пустое место — запись на это время, отметку — изменить.'}</p>
      </section>

      <div className="wgrid">
        {food && <section className="wc c-food" style={{ ['--i' as string]: 0 }}>
          <div className="card-head"><h2>Еда</h2><div className="card-actions">{proBtn('Фото и описание еды', 'Фото', 'camera')}<button className="btn-accent" onClick={onMeal}><Icon name="plus" />Приём</button></div></div>
          <div className="ring-row"><RingBox v={food.kcal} max={food.norm.kcal} color="var(--food)" />
            <div className="ring-meta"><Big v={food.kcal} of={`${fmt(food.norm.kcal)} ккал`} />
              <div className="wmacros"><span><em>Б</em>{fmt(food.protein)}<i>/{fmt(food.norm.protein)}</i></span><span><em>Ж</em>{fmt(food.fat)}</span><span><em>У</em>{fmt(food.carbs)}</span></div></div>
          </div>
          <button className="card-link" onClick={() => onGo('food')}>{food.kcal ? `Осталось ${fmt(Math.max(0, food.norm.kcal - food.kcal))} ккал — все приёмы` : 'Ещё ничего не ел'}<Icon name="chev" /></button>
        </section>}

        {food && <section className="wc solid s-navy c-water" style={{ ['--i' as string]: 1 }}>
          <div className="card-head"><h2>Вода</h2><div className="card-actions"><button className="btn-accent" onClick={onWater}><Icon name="plus" />Напиток</button></div></div>
          <div className="ring-row"><RingBox v={food.waterMl} max={food.norm.water} color="var(--water-on-navy)" />
            <div className="ring-meta"><Big v={food.waterMl / 1000} dec of={`${fmt1(food.norm.water / 1000)} л`} />
              <div className="chips-row"><button className="chip" onClick={() => onAddWater(250)}>+250 мл</button><button className="chip" onClick={() => onAddWater(500)}>+500 мл</button></div></div>
          </div>
          <p className="card-note">{food.waterMl >= food.norm.water ? 'Норма воды на сегодня выпита' : `Ещё ${fmt1((food.norm.water - food.waterMl) / 1000)} л до нормы`}</p>
        </section>}

        {body && <section className="wc solid s-mustard c-steps" style={{ ['--i' as string]: 2 }}>
          <div className="card-head"><h2>Шаги</h2><div className="card-actions"><button className="btn-accent" onClick={onSteps}><Icon name="plus" />Записать</button></div></div>
          <Big v={body.steps} of={fmt(body.stepsGoal)} />
          <span className="wbar"><i style={{ width: `${Math.min(100, body.stepsGoal ? body.steps / body.stepsGoal * 100 : 0)}%` }} /></span>
          <p className="card-note">{!body.steps ? 'Шаги за день ещё не записаны' : body.steps >= body.stepsGoal ? 'Цель по шагам выполнена' : `Осталось ${fmt(body.stepsGoal - body.steps)} шагов`}</p>
        </section>}

        {study || gym || (P.budget?.configured && P.budget.leftToday !== undefined) || P.books?.reading ? <>
          {study && <section className="wc solid s-orange span7 c-study" style={{ ['--i' as string]: 3 }}>
            <div className="card-head"><h2>{study.quiz?.left ? 'Вопросы дня' : 'Учёба'}</h2><div className="card-actions"><button className="btn-accent" onClick={() => onPro(study.quiz?.left ? 'Вопросы дня' : 'Учёба')}>Открыть</button></div></div>
            {study.quiz?.left ? <><Big v={study.quiz.left} unit={`${plural(study.quiz.left, 'вопрос', 'вопроса', 'вопросов')} на сегодня`} /><p className="card-note">{study.quiz.total > study.quiz.left ? `Уже ответил на ${study.quiz.total - study.quiz.left}` : 'По твоим конспектам'}</p></>
              : <><Big v={study.minutes} of={`${study.goal} мин`} /><p className="card-note">{study.minutes ? 'Занятия сегодня' : 'Ни одного занятия'}</p></>}
          </section>}
          {gym && <section className="wc solid s-sage span5 c-gym" style={{ ['--i' as string]: 4 }}>
            <div className="card-head"><h2>Зал</h2><div className="card-actions"><button className="btn-accent" onClick={() => onPro('Зал')}><Icon name="plus" />Тренировка</button></div></div>
            {gym.workouts.length ? gym.workouts.map(w => <p key={w.id} className="card-line"><b>{w.title}</b>{w.time ? ` · ${w.time}` : ''}{w.minutes ? ` · ${w.minutes} мин` : ''}</p>)
              : <p className="card-note">{gym.plan ? `По плану: ${gym.plan.name}${gym.plan.time ? ` в ${gym.plan.time}` : ''} · ${gym.plan.exercises} упр.` : 'Сегодня зал ещё впереди'}</p>}
          </section>}
          {P.budget?.configured && P.budget.leftToday !== undefined && <section className="wc span6 c-budget" style={{ ['--i' as string]: 5 }}>
            <div className="card-head"><h2>Бюджет</h2><div className="card-actions"><button className="btn-accent" onClick={() => onPro('Бюджет')}><Icon name="plus" />Трата</button></div></div>
            <Big v={Math.abs(P.budget.leftToday)} dec2 unit={P.budget.leftToday >= 0 ? `${P.budget.currency} можно сегодня` : `${P.budget.currency} перерасход`} />
            <p className="card-note">Лимит дня {fmt2(P.budget.allow ?? 0)} {P.budget.currency}</p>
          </section>}
          {P.books?.reading && <section className="wc span6 c-books" style={{ ['--i' as string]: 6 }}>
            <div className="card-head"><h2>Читаю</h2><div className="card-actions"><button className="btn-accent" onClick={() => onPro('Книги')}>Открыть</button></div></div>
            <p className="card-line"><b>{P.books.reading.title}</b></p>
            <span className="wbar" style={{ ['--c' as string]: 'var(--books)' }}><i style={{ width: `${P.books.reading.pct}%` }} /></span>
            <p className="card-note">{P.books.reading.pct}% · стр. {P.books.reading.page}{P.books.reading.pages ? ` из ${P.books.reading.pages}` : ''}{P.books.reading.todayPages ? ` · сегодня +${P.books.reading.todayPages}` : ''}</p>
          </section>}
        </> : sub.pro ? null : <section className="wc solid s-navy span12 pro-teaser c-teaser" style={{ ['--i' as string]: 3 }}>
          <div><span className="lock">PRO</span><h3>Зал, учёба, бюджет, книги</h3><p className="card-note">Фото еды с подсчётом ИИ, цели на год и повторы. Бери весь Pro или только нужные разделы — со скидкой за набор.</p></div>
          <button className="btn-accent" onClick={onPaywall}>Посмотреть тарифы<Icon name="chev" /></button>
        </section>}

        <section className="wc span7 c-tasks" style={{ ['--i' as string]: 7 }}>
          <div className="card-head"><h2>{data.isToday ? 'Задачи на сегодня' : 'Задачи'}</h2><div className="card-actions"><span className="count">{done} из {tasks.length}</span><button className="btn-accent" onClick={() => onGo('plans')}>Планы</button></div></div>
          <form className="task-add" onSubmit={e => { e.preventDefault(); addTask(); }}>
            <input className="in" value={title} onChange={e => setTitle(e.target.value)} placeholder="Новая задача на этот день…" aria-label="Новая задача" />
            <button type="button" className="more-btn" onClick={onTaskOpen} aria-label="Время, важность, заметка">•••</button>
            <button className="primary" disabled={!title.trim() || busy}><Icon name="plus" />Добавить</button>
          </form>
          <Tasks tasks={tasks} onToggle={onToggleTask} onOpen={() => onGo('plans')} empty="Задач на этот день нет." />
        </section>

        {body && <section className="wc solid s-peach span5 c-weight" style={{ ['--i' as string]: 8 }}>
          <div className="card-head"><h2>Вес</h2><div className="card-actions"><button className="btn-accent" onClick={onWeight}><Icon name="plus" />Записать</button></div></div>
          {body.weight ? <Big v={body.weight.kg} dec unit="кг" /> : <div className="wbig"><b>—</b></div>}
          <p className="card-note">{body.weight?.today ? (data.isToday ? 'Записан сегодня' : 'Записан в этот день') : body.weight?.day ? `Последний раз — ${parseDay(body.weight.day).getUTCDate()} ${MONG[parseDay(body.weight.day).getUTCMonth()]}. Взвесься утром натощак.` : 'Взвесься утром натощак — журнал покажет реальный темп.'}</p>
        </section>}
      </div>
    </>}
  </div>;
}
