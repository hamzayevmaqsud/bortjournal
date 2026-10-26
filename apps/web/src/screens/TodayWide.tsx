/**
 * «Сегодня» — раскладка веб-версии журнала и на компьютере, и на телефоне: крупная дата, сводка «план · вес · серия»,
 * лента дня, сетка сплошных плиток (крем, синий, горчица, оранжевый, шалфей, персик).
 * На телефоне плитки идут столбиком, у ленты нет подписей и итогов, а шапку дня можно смахнуть влево-вправо.
 */
import { can } from '../lib/features';
import { g } from '../lib/gender';
import { useEffect, useRef, useState } from 'react';
import { addDays, diffDays, parseDay, parseWhen } from '@bortjournal/core';
import { api, type Subscription, type Today as TodayData } from '../lib/api';
import { fmt, fmt1, fmt2, MONG, plural, WDF } from '../lib/format';
import { buzz, spring, useCountUp } from '../lib/motion';
import { Icon } from '../components/Icon';
import { useLook } from '../lib/look';
import { HelpButton } from '../components/HelpButton';
import { WeekStrip } from '../components/WeekStrip';
import { Arc } from '../components/Ring';
import { Habits } from '../components/Habits';
import { Tasks } from '../components/Tasks';
import { marksOf, Timeline, type Mark } from '../components/Timeline';
import { useToast } from '../components/Toasts';
import { DayTip } from '../components/DayTip';
import { DayMood } from '../components/DayMood';

const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
/** заморозки серии в ответе /api/today */
type TodayFz = TodayData & { freeze?: { left: number; max: number; usedYesterday: boolean; frozen: string[] } };
const FREEZE_HINT = 'Заморозка закрывает пустой день, и серия не прерывается. +1 за каждые 7 дней подряд, в запасе до 2.';
/** приветствие по времени суток: обращение и тёплая строка под настроение */
const greet = (hm: string): [string, string] => {
  const h = +hm.slice(0, 2);
  return h >= 5 && h < 11 ? ['Доброе утро', 'Новый день — чистая страница']
    : h >= 11 && h < 17 ? ['Добрый день', 'Как идёт твой день?']
    : h >= 17 && h < 23 ? ['Добрый вечер', 'Самое время подвести итог']
    : ['Доброй ночи', 'Маяк горит — можно отдыхать'];
};

function Big({ v, of, unit, dec, dec2 }: { v: number; of?: string; unit?: string; dec?: boolean; dec2?: boolean }) {
  const n = useCountUp(v);
  return <div className="wbig"><b>{dec2 ? fmt2(n) : dec ? fmt1(n) : fmt(n)}</b>{of && <small>/ {of}</small>}{unit && <small>{unit}</small>}</div>;
}

/** «Оценка дня» на «Сегодня»: процент дня и что осталось — конкретно (ккал, литры, шаги, задачи); то же, что в статистике */
interface DayDetail { isToday: boolean; future: boolean; score: number | null; parts: Array<{ area: string; name: string; v: number }>;
  norms: { kcal: number; protein: number; water: number; steps: number; study: number }; facts: { kcal: number; protein: number; meals: number; waterMl: number; steps: number; tasks: number; tasksDone: number; studyMin: number; quizTotal: number; quizAnswered: number } }
function DayScore({ day, version }: { day: string; version: string }) {
  const [d, setD] = useState<DayDetail | null>(null);
  useEffect(() => { let live = true; api<DayDetail>(`/api/stats/day?day=${day}`).then(x => { if (live) setD(x); }, () => {}); return () => { live = false; }; }, [day, version]);
  if (!d || d.future || d.score === null || !d.parts.length) return null;
  const f = d.facts, n = d.norms, left: string[] = [];
  for (const p of d.parts) {
    if (p.v >= 99) continue;
    if (p.area === 'food' && f.kcal < n.kcal) left.push(`${fmt(n.kcal - f.kcal)} ккал`);
    else if (p.area === 'protein' && n.protein && f.protein < n.protein) left.push(`${fmt(n.protein - f.protein)} г белка`);
    else if (p.area === 'water' && f.waterMl < n.water) left.push(`${fmt1((n.water - f.waterMl) / 1000)} л воды`);
    else if (p.area === 'steps' && f.steps < n.steps) left.push(`${fmt(n.steps - f.steps)} шагов`);
    else if (p.area === 'study' && f.studyMin < n.study) left.push(`${n.study - f.studyMin} мин учёбы`);
    else if (p.area === 'tasks' && f.tasks > f.tasksDone) left.push(`${f.tasks - f.tasksDone} ${plural(f.tasks - f.tasksDone, 'задача', 'задачи', 'задач')}`);
    else if (p.area === 'quiz' && f.quizTotal > f.quizAnswered) left.push(`${f.quizTotal - f.quizAnswered} ${plural(f.quizTotal - f.quizAnswered, 'вопрос', 'вопроса', 'вопросов')}`);
  }
  const line = d.score >= 95 ? 'Идеальный день — всё в норме.' : !left.length ? 'Всё главное сделано.' : `${d.isToday ? 'Осталось' : 'Не хватило'}: ${left.join(', ')}.`;
  return <section className="wc c-score span7">
    <div className="card-head"><h2>Оценка дня</h2><span className="count">{d.isToday ? 'день ещё идёт' : 'итог дня'}</span></div>
    <div className="ds-row">
      <RingBox v={d.score} max={100} color="var(--orange)" />
      <div className="ds-meta">
        <p className="ds-line">{line}</p>
        <div className="ds-parts">{d.parts.map(p => <span key={p.area} className={p.v >= 99 ? 'ok' : ''} style={{ ['--w' as string]: `${Math.max(3, p.v)}%` }}><b>{p.v >= 99 ? '✓' : `${p.v}%`}</b>{p.name}</span>)}</div>
      </div>
    </div>
  </section>;
}

function RingBox({ v, max, color }: { v: number; max: number; color: string }) {
  return <span className="ringbox"><Arc size={132} sw={12} color={color} p={max ? v / max : 0} /><em>{max ? Math.round(v / max * 100) : 0}%</em></span>;
}

export function TodayWide({ wide = true, data, day, today, sub, still, settings = {}, onReminders, onSettingsSaved, onDay, onAdd, onDelete, onEdit, onToggleTask, onGo, onPro, onPaywall, onSteps, onWeight, onWater, onMeal, onAddWater, onTaskAdded, onTaskOpen, onWeek, onJournal }: {
  wide?: boolean; data: TodayData | null; day: string; today: string; sub: Subscription; still: boolean; settings?: Record<string, any>; onReminders?: () => void; onSettingsSaved?: (s: Record<string, unknown>) => void;
  onDay: (dir: number) => void; onAdd: (time?: string) => void; onDelete: (m: Mark) => void; onEdit: (m: Mark) => void; onToggleTask: (id: string) => void;
  onGo: (tab: string) => void; onPro: (what: string) => void; onPaywall: () => void;
  onSteps: () => void; onWeight: () => void; onWater: () => void; onMeal: () => void; onAddWater: (ml: number) => void; onTaskAdded: (title: string) => void; onTaskOpen: () => void; onWeek?: () => void;
  /** отметили настроение — серия могла измениться */
  onJournal?: () => void;
}) {
  const toast = useToast(), [title, setTitle] = useState(''), [busy, setBusy] = useState(false);
  const look = useLook(); // значок серии — за уровень
  // «Итог недели» — по воскресеньям и понедельникам (как в «Совете дня»)
  const weekLink = !!onWeek && day === today && [0, 1].includes(parseDay(today).getUTCDay());
  const dt = parseDay(day), off = Math.round((dt.getTime() - parseDay(today).getTime()) / 864e5);
  const rel = off === 0 ? 'сегодня' : off === -1 ? 'вчера' : off === 1 ? 'завтра' : '';
  const P = data?.parts ?? {}, food = P.food, body = P.body, study = P.study, gym = P.gym, tasks = P.plans?.tasks ?? [];
  const marks = data ? marksOf(data.events, tasks, data.calendar) : [];
  const done = tasks.filter(t => t.done).length;
  // что человек выбрал вести (в анкете или профиле); не выбрано ничего — показываем всё
  const chosen = settings.sections as string[] | undefined, has = (k: string) => !chosen || chosen.includes(k);
  const [wideCols, setWideCols] = useState(() => matchMedia('(min-width:1101px)').matches);
  useEffect(() => { const m = matchMedia('(min-width:1101px)'), on = () => setWideCols(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  // чек-лист первого дня: пока не пройден и не скрыт
  const steps: Array<[string, boolean, () => void]> = [];
  if (has('food') && food) steps.push([g('Запиши, что ел сегодня', 'Запиши, что ела сегодня'), food.kcal > 0, onMeal]);
  if (has('water') && food) steps.push(['Выпей стакан воды — нажми «+250»', food.waterMl > 0, () => onAddWater(250)]);
  if (has('tasks')) steps.push(['Добавь задачу на сегодня', tasks.length > 0, onTaskOpen]);
  steps.push(['Включи напоминания', !!settings.remindSeen, () => { onReminders?.(); saveSettings({ remindSeen: true }); }]);
  const saveSettings = async (body: Record<string, unknown>) => { try { const r = await api<{ settings: Record<string, unknown> }>('/api/profile/settings', { method: 'PUT', body }); onSettingsSaved?.(r.settings); } catch { /* не страшно */ } };
  const showList = !settings.checklistDone && !!data?.isToday && steps.some(s => !s[1]);
  // заморозки серии; вчера спасла заморозка — сказать один раз за день
  const fz = (data as TodayFz | null)?.freeze;
  useEffect(() => {
    if (!fz?.usedYesterday || !data) return;
    const k = `lumi.freeze.${data.now.day}`;
    try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch { /* без памяти — скажем ещё раз, не страшно */ }
    toast(`Вчера серию спасла заморозка — ${fz.left ? `${plural(fz.left, 'осталась', 'осталось', 'осталось')} ${fz.left}` : 'заморозок больше нет'}`);
  }, [fz?.usedYesterday, fz?.left, data?.now.day]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // «завтра в 19:00», «в пятницу» — задача уходит в свой день и время; в этот день — сразу видна в списке
    const w = parseWhen(t, day), to = w.day ?? day;
    try {
      await api('/api/plans/tasks', { method: 'POST', body: { title: w.title, day: to, time: w.time } }); setTitle('');
      if (to === day) onTaskAdded(w.title); else toast(`«${w.title}» → ${to === addDays(day, 1) ? 'завтра' : to.slice(8, 10) + '.' + to.slice(5, 7)}${w.time ? `, ${w.time}` : ''}`);
    }
    catch (e) { toast(e instanceof Error ? e.message : 'Не получилось', { err: true }); } finally { setBusy(false); }
  };
  const proBtn = (what: string, label: string, ic: string, tour?: string) => <button className="btn-accent" data-tour={tour} onClick={() => onPro(what)}><Icon name={ic} />{label}{!can(sub, what) && <span className="lock">PRO</span>}</button>;

  return <div className={`wide-page ${wide ? '' : 'narrow'}`} ref={page}>
    <header className="hero" ref={head}>
      <div className="hero-left">
        <span className="hero-wd">{rel ? `${rel} · ` : ''}{WDF[dt.getUTCDay()]}</span>
        <h1 className="hero-day">{dt.getUTCDate()}<span>{MONG[dt.getUTCMonth()]}</span></h1>
        <WeekStrip day={day} today={today} onPick={d => onDay(diffDays(day, d))} />
        {wide && weekLink && <button type="button" className="week-link hero-week" onClick={onWeek}><Icon name="stats" />Итог недели<Icon name="chev" /></button>}
      </div>
      <div className="hero-side">
        <HelpButton tour="today" />
        {data && (() => { const [hi, line] = greet(data.now.hm), name = data.name && data.name !== 'Гость' ? data.name : '';
          return <p className="greet"><span className="greet-hi">{hi}{name ? `, ${name}` : ''}</span><span className="greet-line">{line}</span></p>; })()}
        {data && <div className="statgroup" data-tour="stats">
          {has('food') && <button onClick={() => onPro('Цель и прогноз')}><i><Icon name="today" />план</i><b>{fmt(data.plan.kcal)}<small>ккал</small></b><span>{data.plan.protein ? `белок ${fmt(data.plan.protein)} г` : 'норма по анкете'}</span></button>}
          {has('food') && <button onClick={onWeight}><i><Icon name="steps" />вес</i><b>{body?.weight ? fmt1(body.weight.kg) : '—'}<small>кг</small></b><span className={body?.weight?.today ? '' : 'go'}>{body?.weight?.today ? (data.isToday ? 'сегодня' : 'в этот день') : 'взвеситься →'}</span></button>}
          <button className="hot" onClick={() => onPro('Статистика')} title={fz ? FREEZE_HINT + (fz.frozen.length ? ` Заморожено: ${fz.frozen.map(d => d === addDays(data.now.day, -1) ? 'вчера' : `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}`).join(', ')}.` : '') : undefined}
            aria-label={`Серия: ${data.streak} ${plural(data.streak, 'день', 'дня', 'дней')} подряд${fz ? `, заморозок в запасе: ${fz.left}${fz.usedYesterday ? ', вчера заморожен' : ''}` : ''}. Открыть статистику`}>
            <i><Icon name={look.streak} />серия</i><b>{data.streak}<small>{plural(data.streak, 'день', 'дня', 'дней')}</small></b>
            <span>подряд{fz && <> · <em className="st-fz"><Icon name="snow" className="" />{fz.usedYesterday ? <>вчера<span className="fz-w"> заморожен</span></> : <><span className="fz-w">заморозок </span>{fz.left}</>}</em></>}</span></button>
        </div>}
      </div>
    </header>
    {/* главное действие — фото тарелки — сразу на первом экране телефона, без прокрутки и без «Записать» */}
    {has('food') && <button type="button" className="snap-food" onClick={() => onPro('Фото и описание еды')}><Icon name="camera" /><span><b>Сфотографировать еду</b><small>ИИ посчитает калории за пару секунд</small></span>{!can(sub, 'Фото и описание еды') && <span className="lock">PRO</span>}</button>}
    <DayTip data={data} today={today} onMeal={onMeal} onWater={onWater} onSteps={onSteps} onGo={onGo} onPro={onPro} onWeek={wide ? undefined : onWeek} />

    {sub.source === 'trial' && <button className="trial-bar" onClick={onPaywall}><Icon name="flame" /><span>Пробный Pro: <b>ещё {sub.daysLeft} {plural(sub.daysLeft ?? 0, 'день', 'дня', 'дней')}</b> — потом еда, вода, шаги, задачи, цель и статистика остаются бесплатными</span><em>Тарифы</em></button>}
    {!sub.pro && sub.ended && <button className="trial-bar" onClick={onPaywall}><Icon name="flame" /><span>Pro закончился — еда, вода, шаги, задачи, цель и статистика остаются</span><em>Продлить</em></button>}

    {showList && <section className="panel first-day">
      <div className="panel-h"><h2>Первые шаги</h2><button className="link-btn" onClick={() => saveSettings({ checklistDone: true })}>Скрыть</button></div>
      <div className="fd-list">{steps.map(([t, ok, go]) => <button key={t} className={`fd-i ${ok ? 'ok' : ''}`} onClick={ok ? undefined : go} disabled={ok}>
        <span className={`cbx ${ok ? 'on' : ''}`}><Icon name="check" className="" /></span><span>{t}</span>{!ok && <Icon name="chev" className="ic chev" />}</button>)}</div>
      <span className="wbar"><i style={{ width: `${steps.filter(s => s[1]).length / steps.length * 100}%`, background: 'var(--good)' }} /></span>
    </section>}
    {!data ? <div className="wgrid"><div className="skel" style={{ gridColumn: 'span 12', height: 260 }} /><div className="skel" style={{ gridColumn: 'span 4', height: 230 }} /><div className="skel" style={{ gridColumn: 'span 4', height: 230 }} /><div className="skel" style={{ gridColumn: 'span 4', height: 230 }} /></div> : <>
      <section className="panel tl-panel" data-tour="timeline">
        <Timeline marks={marks} allDay={(data.calendar ?? []).filter(c => !c.time).map(c => c.title)} now={data.isToday ? data.now.hm : null} still={still} pro={can(sub, 'study') || can(sub, 'gym')} has={has} sums={wide ? sums : undefined} onAdd={t => onAdd(t)} onDelete={onDelete} onEdit={onEdit} onToggleTask={onToggleTask} />
        <p className="tl-hint">{wide ? 'Нажми на пустое место дорожки — добавишь запись на это время. Нажми на отметку — изменишь её.' : 'Нажми пустое место — запись на это время, отметку — изменить.'}</p>
      </section>

      <div className="wgrid">
        {food && has('food') && <section className="wc c-food" style={{ ['--i' as string]: 0 }}>
          <div className="card-head"><h2>Еда</h2><div className="card-actions">{proBtn('Фото и описание еды', 'Фото', 'camera', 'photo')}<button className="btn-accent" onClick={onMeal}><Icon name="plus" />Приём</button></div></div>
          <div className="ring-row"><RingBox v={food.kcal} max={food.norm.kcal} color="var(--food)" />
            <div className="ring-meta"><Big v={food.kcal} of={`${fmt(food.norm.kcal)} ккал`} />
              <div className="wmacros"><span><em>Б</em>{fmt(food.protein)}<i>/{fmt(food.norm.protein)}</i></span><span><em>Ж</em>{fmt(food.fat)}</span><span><em>У</em>{fmt(food.carbs)}</span></div></div>
          </div>
          <button className="card-link" onClick={() => onGo('food')}>{food.kcal ? `Осталось ${fmt(Math.max(0, food.norm.kcal - food.kcal))} ккал — все приёмы` : 'Записей еды пока нет'}<Icon name="chev" /></button>
        </section>}

        {food && has('water') && <section className="wc solid s-navy c-water" style={{ ['--i' as string]: 1 }}>
          <div className="card-head"><h2>Вода</h2><div className="card-actions"><button className="btn-accent" onClick={onWater}><Icon name="plus" />Напиток</button></div></div>
          <div className="ring-row"><RingBox v={food.waterMl} max={food.norm.water} color="var(--water-on-navy)" />
            <div className="ring-meta"><Big v={food.waterMl / 1000} dec of={`${fmt1(food.norm.water / 1000)} л`} />
              <div className="chips-row" data-tour="water"><button className="chip" onClick={() => onAddWater(250)}>+250 мл</button><button className="chip" onClick={() => onAddWater(500)}>+500 мл</button></div></div>
          </div>
          <p className="card-note">{food.waterMl >= food.norm.water ? 'Норма воды на сегодня выпита' : `Ещё ${fmt1((food.norm.water - food.waterMl) / 1000)} л до нормы`}</p>
        </section>}

        {body && has('steps') && <section className="wc solid s-mustard c-steps" style={{ ['--i' as string]: 2 }}>
          <div className="card-head"><h2>Шаги</h2><div className="card-actions"><button className="btn-accent" onClick={onSteps}><Icon name="plus" />Записать</button></div></div>
          <div className="ring-row"><RingBox v={body.steps} max={body.stepsGoal} color="var(--navy)" />
            <div className="ring-meta"><Big v={body.steps} of={`${fmt(body.stepsGoal)} шагов`} /></div>
          </div>
          <p className="card-note">{!body.steps ? 'Шаги за день ещё не записаны' : body.steps >= body.stepsGoal ? 'Цель по шагам выполнена' : `Осталось ${fmt(body.stepsGoal - body.steps)} шагов`}</p>
        </section>}

        {(() => {
          // второстепенные разделы — компактными строками: одна карточка вместо четырёх
          const quiz = !!study?.quiz?.left && has('study');
          const rows: Array<[string, string, string, string, () => void]> = [];
          if (study && !quiz && has('study')) rows.push(['study', 'var(--study)', 'Учёба', study.minutes ? `${study.minutes} из ${study.goal} мин сегодня` : g('сегодня ещё не занимался', 'сегодня ещё не занималась'), () => onPro('Учёба')]);
          if (gym && has('gym')) rows.push(['gym', 'var(--gym)', 'Зал', gym.workouts.length ? gym.workouts.map(w => w.title).join(', ') : gym.plan ? `по плану: ${gym.plan.name}${gym.plan.time ? ` в ${gym.plan.time}` : ''}` : 'сегодня без тренировки', () => onPro('Зал')]);
          if (P.budget?.configured && P.budget.leftToday !== undefined && has('budget')) rows.push(['money', 'var(--money)', 'Бюджет', P.budget.leftToday >= 0 ? `${fmt2(P.budget.leftToday)} ${P.budget.currency} можно сегодня` : `перерасход ${fmt2(-P.budget.leftToday)} ${P.budget.currency}`, () => onPro('Бюджет')]);
          if (P.books?.reading && has('books')) rows.push(['books', 'var(--books)', 'Читаю', `${P.books.reading.title} · ${P.books.reading.pct}%${P.books.reading.todayPages ? ` · +${P.books.reading.todayPages} стр.` : ''}`, () => onPro('Книги')]);
          const side = <>
            {quiz && <section className="wc solid s-orange span5 c-study" style={{ ['--i' as string]: 3 }}>
              <div className="card-head"><h2>Вопросы дня</h2><div className="card-actions"><button className="btn-accent" onClick={() => onPro('Вопросы дня')}>Ответить</button></div></div>
              <Big v={study!.quiz!.left} unit={`${plural(study!.quiz!.left, 'вопрос', 'вопроса', 'вопросов')} на сегодня`} />
              <p className="card-note">{study!.quiz!.total > study!.quiz!.left ? `${g('Уже ответил', 'Уже ответила')} на ${study!.quiz!.total - study!.quiz!.left}` : 'По твоим конспектам'}</p>
            </section>}
            {rows.length > 0 && <section className="wc span5 c-more" style={{ ['--i' as string]: 4 }}>
              <div className="card-head"><h2>Остальное сегодня</h2></div>
              <div className="today-rows">{rows.map(([ic, c, name, sum, go]) => <button key={ic} className="today-row" onClick={go}>
                <span className="chip-ic" style={{ ['--c' as string]: c }}><Icon name={ic} /></span><span className="mid"><b>{name}</b><small>{sum}</small></span><Icon name="chev" className="ic chev" /></button>)}</div>
            </section>}
            {!rows.length && !quiz && !sub.pro && <section className="wc solid s-navy span5 pro-teaser c-teaser" style={{ ['--i' as string]: 3 }}>
              <div><span className="lock">PRO</span><h3>Зал, учёба, бюджет, книги</h3><p className="card-note">Фото еды с подсчётом ИИ, цели на год и повторы. Бери весь Pro или только нужные разделы — со скидкой за набор.</p></div>
              <button className="btn-accent" onClick={onPaywall}>Посмотреть тарифы<Icon name="chev" /></button>
            </section>}
          </>;
          // на компьютере правая колонка — «Остальное» и привычки (колонки выходят одной высоты), на телефоне — карточки по порядку
          return wide && wideCols ? <div className="today-side">{side}<Habits day={day} today={today} isToday={data.isToday} /></div> : side;
        })()}

        {(() => {
          // задачи и сразу под ними привычки; на компьютере — одной колонкой слева от «Остального»
          const two = wide && wideCols;
          const main = <>
            {/* пересчитать, когда меняются записи дня: еда, вода, шаги, задачи */}
            <DayScore day={day} version={`${food?.kcal ?? 0}|${food?.waterMl ?? 0}|${body?.steps ?? 0}|${done}|${tasks.length}`} />
            {has('tasks') && <section className="wc span7 c-tasks" style={{ ['--i' as string]: 7 }}>
              <div className="card-head"><h2>Задачи</h2><div className="card-actions"><span className="count">{done} из {tasks.length}</span><button className="btn-accent" onClick={() => onGo('plans')}>Планы</button></div></div>
              <form className="task-add" onSubmit={e => { e.preventDefault(); addTask(); }}>
                <input className="in" value={title} onChange={e => setTitle(e.target.value)} placeholder="Новая задача…" aria-label="Новая задача" />
                <button type="button" className="more-btn" onClick={onTaskOpen} aria-label="Время, важность, заметка">•••</button>
                <button className="primary" disabled={!title.trim() || busy}><Icon name="plus" />Добавить</button>
              </form>
              <Tasks tasks={tasks} onToggle={onToggleTask} onOpen={() => onGo('plans')} empty="Задач на этот день нет." />
            </section>}
            {!two && <Habits day={day} today={today} isToday={data.isToday} />}
            <DayMood day={day} today={today} minutes={data.now.minutes} onSaved={onJournal} />
          </>;
          return wide && wideCols ? <div className="today-main">{main}</div> : main;
        })()}

      </div>
    </>}
  </div>;
}
