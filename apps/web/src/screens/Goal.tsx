/**
 * «Цель и прогноз»: путь к желаемому весу с вехами, что делать каждый день, факт против плана, график, активность недели
 * и подробный разбор «почему такие цифры». Всё считает сервер (/api/goal) по формулам старого журнала.
 */
import { useCallback, useEffect, useState } from 'react';
import { addDays, parseDay } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { fmt, fmt1, MONG, plural } from '../lib/format';
import { buzz } from '../lib/motion';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { WeightChart } from '../components/WeightChart';

interface GoalData {
  today: string;
  profile: { sex: string; age: number; height: number; goal: 'lose' | 'gain' | 'maintain'; goalName: string; paceName: string | null; target: number | null; start: number; bodyFat: number | null };
  weight: { now: number; last: { day: string; kg: number } | null; byTrend: boolean; weekly: number; span: number; recentCount: number };
  plan: { kcal: number; protein: number; fat: number; carbs: number; bmr: number; tdee: number; delta: number; weeklyKg: number; bmi: number; bodyFat: number; lbm: number; notes: string[]; sim4: number; sim12: number; sim26: number };
  steps: { steps: number; measured: boolean; days: number; goal: number; today: number; kcalPer3000: number };
  fact: { intake: number; intakeDays: number; tdee: number | null };
  level: string; levels: Array<{ level: string; name: string; hint: string; kcal: number }>;
  path: null | { start: number; target: number; total: number; passed: number; pct: number; reached: boolean; weeks: number | null; planWeeks: number | null; byFact: boolean; ticks: Array<{ kg: number; at: number }>; milestones: Array<{ kg: number; weeks: number | null }> };
  series: { history: Array<{ day: string; kg: number }>; plan: Array<{ day: string; kg: number }>; fact: Array<{ day: string; kg: number }> };
  eatenToday: { kcal: number; protein: number };
  recalculated: { from: number; to: number } | null;
}

const MONP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const MONN = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const when = (today: string, weeks: number | null, names = MONP) => { if (weeks === null || !isFinite(weeks)) return null; const d = parseDay(addDays(today, Math.round(weeks * 7))); return `${names[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const kg2 = (v: number) => (Math.round(Math.abs(v) * 100) / 100).toLocaleString('ru-RU');
const kgWeek = (v: number) => Math.abs(v) < 0.005 ? '±0 кг/нед' : `${v > 0 ? '+' : '−'}${kg2(v)} кг/нед`;

export function Goal({ wide, onBack, onWeigh, onRedo, onChanged }: { wide: boolean; onBack: () => void; onWeigh: () => void; onRedo: () => void; onChanged: () => void }) {
  const toast = useToast(), [g, setG] = useState<GoalData | null>(null), [err, setErr] = useState(''), [noProfile, setNoProfile] = useState(false), [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { const d = await api<GoalData>('/api/goal'); setG(d); if (d.recalculated) { toast(`План пересчитан: ${fmt(d.recalculated.from)} → ${fmt(d.recalculated.to)} ккал`); onChanged(); } }
    catch (e) { if (e instanceof ApiError && e.status === 409) setNoProfile(true); else setErr(e instanceof ApiError ? e.message : 'Не получилось загрузить'); }
  }, [toast, onChanged]);
  useEffect(() => { load(); }, [load]);

  const setLevel = async (level: string) => {
    if (!g || level === g.level) return; setBusy(level); buzz(6);
    try { const d = await api<GoalData>('/api/goal/activity', { method: 'PUT', body: { level } }); setG(d); toast(`Калории на неделю: ${fmt(d.plan.kcal)}`); onChanged(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); } finally { setBusy(''); }
  };

  const head = <header className="dayhead">
    {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
    <div className="daytitle"><span>цель{g ? ` · ${g.profile.goalName.toLowerCase()}${g.profile.paceName ? `, ${g.profile.paceName.toLowerCase()} темп` : ''}` : ''}</span><b>План и прогноз</b></div>
    <button className="nav" onClick={onRedo} aria-label="Изменить цель" title="Изменить цель"><Icon name="edit" /></button>
  </header>;
  // анкеты нет — это не ошибка, а первый шаг: объясняем зачем и даём кнопку
  if (noProfile) return <div className="day goal-page">{head}<section className="wc goal-empty">
    <h2>План ещё не посчитан</h2>
    <p>Журнал считает калории, белок и срок до цели по короткой анкете: рост, вес, активность и чего хочешь добиться. Это займёт минуту.</p>
    <button className="primary" onClick={onRedo}>Пройти анкету</button></section></div>;
  if (err) return <div className="day goal-page">{head}<p className="form-err">{err}</p></div>;
  if (!g) return <div className="day goal-page">{head}<div className="skel" style={{ height: 220 }} /><div className="skel" style={{ height: 160 }} /><div className="skel" style={{ height: 300 }} /></div>;

  const p = g.profile, pl = g.plan, dir = p.goal === 'gain' ? 1 : -1, path = g.path, w = g.weight;

  /* 1. путь к цели */
  const hero = path ? <section className="wc goal-hero span12">
    <div className="gh-top">
      <div><span className="gh-k">{p.goalName}</span><h2>{fmt1(path.start)} → {fmt1(path.target)} кг</h2></div>
      <div className="gh-now"><b>{fmt1(w.now)} кг</b><span>сейчас{w.byTrend ? ' по тренду' : ''}</span><button className="btn-accent" onClick={onWeigh}><Icon name="plus" />Взвеситься</button></div>
    </div>
    <div className="gh-track" role="img" aria-label={`Пройдено ${fmt1(path.passed)} из ${fmt1(path.total)} кг`}>
      <i className="gh-fill" style={{ width: `${path.pct}%` }} />
      {path.ticks.map(t => <span key={t.kg} className="gh-tick" style={{ left: `${t.at}%` }}><em>{fmt1(t.kg)}</em></span>)}
      <span className={`gh-me ${path.pct < 8 ? 'l' : path.pct > 92 ? 'r' : ''}`} style={{ left: `${path.pct}%` }}><b>ты здесь</b></span>
    </div>
    <div className="gh-ends"><span>старт {fmt1(path.start)}</span><b>пройдено {fmt1(path.passed)} из {fmt1(path.total)} кг · {path.pct}%</b><span>цель {fmt1(path.target)}</span></div>
    <p className="gh-eta">{path.reached ? <><b>Цель достигнута.</b> Поставь новую или переключись на «держать форму».</>
      : when(g.today, path.weeks) ? <>Дойдёшь примерно в <b>{when(g.today, path.weeks)}</b>{path.byFact && path.planWeeks !== null && when(g.today, path.planWeeks) !== when(g.today, path.weeks) ? <span className="muted"> · по расчёту — в {when(g.today, path.planWeeks)}</span> : null}{!w.byTrend ? <span className="muted"> · по расчёту, уточнится, когда накопятся замеры</span> : null}</>
      : 'При текущем темпе цель не приближается.'}</p>
    <div className="miles">{path.milestones.map((m, k) => <div key={m.kg} className={`mile ${k === path.milestones.length - 1 && m.kg === path.target ? 'goal' : ''}`}><b>{fmt1(m.kg)} кг</b><span>{when(g.today, m.weeks, MONN) ? `≈ ${when(g.today, m.weeks, MONN)}` : '—'}</span></div>)}</div>
  </section> : <section className="wc goal-hero span12">
    <div className="gh-top">
      <div><span className="gh-k">{p.goalName}</span><h2>{p.goal === 'maintain' ? `Держим ≈ ${fmt1(p.start)} кг` : `${fmt1(p.start)} кг → ?`}</h2></div>
      <div className="gh-now"><b>{fmt1(w.now)} кг</b><span>сейчас{w.byTrend ? ' по тренду' : ''}</span><button className="btn-accent" onClick={onWeigh}><Icon name="plus" />Взвеситься</button></div>
    </div>
    <p className="gh-eta">{p.goal === 'maintain' ? (Math.abs(w.now - p.start) <= 1.5 ? 'Вес в коридоре ±1,5 кг — всё как задумано.' : `Вес ушёл на ${fmt1(Math.abs(w.now - p.start))} кг от цели — поправь калории.`) : 'Желаемый вес не указан — задай его, и появятся срок и вехи.'}</p>
    {p.goal !== 'maintain' && <button className="btn-accent" style={{ alignSelf: 'flex-start' }} onClick={onRedo}>Указать желаемый вес</button>}
  </section>;

  /* 2. каждый день */
  const left = pl.kcal - g.eatenToday.kcal;
  const daily = <section className="wc span12 goal-daily">
    <div className="card-head"><h2>Что делать каждый день</h2></div>
    <div className="dos">
      <div className="do solid s-orange"><span className="do-k">Ешь до</span><b>{fmt(pl.kcal)}</b><span className="do-u">ккал в день</span><span className="do-t">{g.eatenToday.kcal ? (left >= 0 ? `сегодня осталось ${fmt(left)}` : `сегодня перебор ${fmt(-left)}`) : 'сегодня ещё ничего не записано'}</span></div>
      <div className="do solid s-navy"><span className="do-k">Белок</span><b>{fmt(pl.protein)}</b><span className="do-u">граммов в день</span><span className="do-t">сегодня {fmt(g.eatenToday.protein)} г</span></div>
      <div className="do solid s-mustard"><span className="do-k">Шаги</span><b>{fmt(g.steps.goal)}+</b><span className="do-u">в день</span><span className="do-t">{g.steps.today ? `сегодня ${fmt(g.steps.today)}` : 'сегодня не записаны'} · в среднем {fmt(g.steps.steps)}</span></div>
    </div>
    <p className="card-note">Калории посчитаны так, чтобы {p.goal === 'lose' ? `терять ≈ ${kg2(pl.weeklyKg)} кг в неделю` : p.goal === 'gain' ? `набирать ≈ ${kg2(pl.weeklyKg)} кг в неделю` : 'вес стоял на месте'}. Каждые +3 000 шагов — ещё ≈ {fmt(g.steps.kcalPer3000)} ккал расхода.</p>
  </section>;

  /* 3. как идёшь */
  let status;
  if (!w.byTrend) status = <div className="verdict wait"><b>Пока мало данных</b><span>Нужно 3 взвешивания минимум за неделю — сейчас {w.recentCount}. Взвешивайся утром натощак 2–3 раза в неделю, и журнал покажет реальный темп.</span></div>;
  else {
    const plan = pl.weeklyKg, fact = w.weekly, r = plan ? fact / plan : 0;
    const v: [string, string] = p.goal === 'maintain' ? (Math.abs(fact) < 0.15 ? ['good', 'Вес держится'] : ['warn', fact > 0 ? 'Вес растёт' : 'Вес снижается'])
      : r < 0 ? ['bad', p.goal === 'lose' ? 'Вес растёт, а не снижается' : 'Вес снижается, а не растёт']
      : r < 0.7 ? ['warn', 'Медленнее плана'] : r > 1.4 ? ['warn', p.goal === 'lose' ? 'Быстрее плана — слишком быстро' : 'Быстрее плана — лишнее уходит в жир'] : r > 1.05 ? ['good', 'Чуть быстрее плана'] : ['good', 'Идёшь по плану'];
    const mx = Math.max(Math.abs(plan), Math.abs(fact), 0.1), t = g.fact.tdee;
    const why = t !== null ? (Math.abs(t - pl.tdee) > 150 ? `Твой реальный расход ≈ ${fmt(t)} ккал — ${t > pl.tdee ? 'выше' : 'ниже'} расчёта (${fmt(pl.tdee)}), поэтому темп ${(t > pl.tdee) === (p.goal === 'lose') ? 'быстрее' : 'медленнее'}.${v[0] !== 'good' || r > 1.4 ? ` Чтобы идти ровно по плану, ешь ≈ ${fmt(Math.round((t + pl.delta) / 10) * 10)} ккал.` : ''}` : `Реальный расход ≈ ${fmt(t)} ккал — совпадает с расчётом.`)
      : 'Записывай еду каждый день — тогда журнал посчитает твой реальный расход.';
    status = <>
      <div className={`verdict ${v[0]}`}><b>{v[1]}</b><span>За {w.span} {plural(w.span, 'день', 'дня', 'дней')} {dir < 0 ? (fact < 0 ? 'ушло' : 'прибавилось') : (fact > 0 ? 'прибавилось' : 'ушло')} ≈ {fmt1(Math.abs(fact * w.span / 7))} кг.</span></div>
      <div className="pace">
        <div><span>План</span><i><b style={{ width: `${Math.abs(plan) / mx * 100}%`, background: 'var(--orange)' }} /></i><em>{kgWeek(plan)}</em></div>
        <div><span>Факт</span><i><b style={{ width: `${Math.abs(fact) / mx * 100}%`, background: 'var(--navy)' }} /></i><em>{kgWeek(fact)}</em></div>
      </div>
      <p className="card-note">{why}</p>
    </>;
  }

  /* 6. почему такие цифры */
  const act = g.levels.find(l => l.level === g.level)!;
  const lines = [
    `Основной обмен ${fmt(pl.bmr)} ккал — столько тело тратит в полном покое (${p.bodyFat ? 'формула Кэтча — МакАрдла по твоему проценту жира' : 'формула Миффлина — Сан Жеора'}).`,
    `Тренировки «${act.name.toLowerCase()}» и ходьба ${fmt(g.steps.steps)} шагов в день${g.steps.measured ? ` (среднее за ${g.steps.days} дн. по записям)` : ' (оценка — запиши шаги, и план возьмёт реальные)'}. Итого расход ${fmt(pl.tdee)} ккал — при таких калориях вес стоит на месте.`,
    p.goal === 'maintain' ? `Цель ${fmt(pl.kcal)} ккал — поддержка.` : `Цель ${fmt(pl.kcal)} ккал = расход ${pl.delta < 0 ? '−' : '+'} ${fmt(Math.abs(pl.delta))}. Это ${kgWeek(pl.weeklyKg)}, около ${fmt1(Math.abs(pl.weeklyKg * 30 / 7))} кг в месяц.`,
    ...(p.goal !== 'maintain' ? [`Прогноз: через 4 недели ≈ ${fmt1(pl.sim4)} кг, через 12 — ≈ ${fmt1(pl.sim12)} кг, через полгода — ≈ ${fmt1(pl.sim26)} кг. Темп постепенно снижается: чем меньше вес, тем меньше расход.`] : []),
    `Белок ${fmt(pl.protein)} г (≈2 г на кг безжировой массы — ${fmt1(pl.lbm)} кг при жире ≈${pl.bodyFat}%${p.bodyFat ? '' : ', оценка по ИМТ'}), жиры ${fmt(pl.fat)} г, углеводы ${fmt(pl.carbs)} г.`,
    ...pl.notes
  ];

  return <div className="day goal-page">
    {head}
    <div className="wgrid">
      {hero}
      {daily}
      <section className="wc span5"><div className="card-head"><h2>Как идёшь</h2></div>{status}</section>
      <section className="wc span7"><div className="card-head"><h2>Вес</h2></div><WeightChart {...g.series} today={g.today} /></section>
      <section className="wc span12">
        <div className="card-head"><h2>Активность на этой неделе</h2></div>
        <div className="acts">{g.levels.map(l => <button key={l.level} className={`act ${l.level === g.level ? 'on' : ''}`} onClick={() => setLevel(l.level)} disabled={!!busy}>
          <b>{l.name}</b><span>{l.hint}</span><em>{busy === l.level ? '…' : `${fmt(l.kcal)} ккал`}</em></button>)}</div>
        <p className="card-note">Выбери, сколько тренировок будет на неделе — калории пересчитаются. Шаги учитываются отдельно: {g.steps.measured ? `в среднем ${fmt(g.steps.steps)} в день за ${g.steps.days} дн` : `пока оценка ${fmt(g.steps.steps)} в день — записывай шаги, и план возьмёт реальные`}.</p>
      </section>
      <section className="wc span12">
        <details className="more-block"><summary>Почему такие цифры</summary><ul className="goal-lines">{lines.map(l => <li key={l}>{l}</li>)}</ul>
          <p className="card-note">Формулы ошибаются на ±10% для конкретного человека, поэтому журнал сверяет расчёт с твоими замерами веса и записями еды.</p></details>
        <details className="more-block"><summary>Профиль</summary><div className="chips" style={{ marginTop: 10 }}>
          {[p.sex === 'm' ? 'Мужчина' : 'Женщина', `${p.age} лет`, `${p.height} см`, `ИМТ ${fmt1(pl.bmi)}`, `жир ≈${pl.bodyFat}%`, `обмен в покое ${fmt(pl.bmr)} ккал`, `расход ${fmt(pl.tdee)} ккал`, `старт ${+(g.series.plan[0]?.day ?? g.today).slice(8, 10)} ${MONG[+(g.series.plan[0]?.day ?? g.today).slice(5, 7) - 1]}`].map(c => <span key={c} className="chip">{c}</span>)}
        </div><button className="btn-accent" style={{ marginTop: 12 }} onClick={onRedo}><Icon name="edit" />Изменить данные и цель</button></details>
      </section>
    </div>
  </div>;
}
