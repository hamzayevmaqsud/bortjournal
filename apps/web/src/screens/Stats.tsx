/**
 * «Статистика» (Pro): обзор (оценка дня, календарь с кольцами, год клетками, дни недели, рекорды), еда, тело,
 * итог недели и достижения. Цифры считает сервер (/api/stats/*, /api/awards) по правилам старого журнала.
 */
import { useCallback, useEffect, useState } from 'react';
import { addDays, parseDay } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { fmt, fmt1, plural } from '../lib/format';
import { buzz } from '../lib/motion';
import { Icon } from '../components/Icon';
import { HelpButton } from '../components/HelpButton';
import { Bars, Delta, Donut, HBars, human, humanLong, MonthCal, ScoreRing, scoreColor, YearHeat } from '../components/Charts';
import { DayDetail } from '../components/StatsDay';
import { Face } from '../components/DayMood';
import '../styles/stats2.css';
import '../styles/mood.css';

export type StatsTab = 'overview' | 'food' | 'body' | 'study' | 'money' | 'books' | 'week' | 'awards';
// вкладки разделов Pro показываются, только если раздел открыт
const TABS: Array<[StatsTab, string, string?]> = [['overview', 'Обзор'], ['food', 'Еда'], ['body', 'Тело'], ['study', 'Учёба', 'study'], ['money', 'Деньги', 'budget'], ['books', 'Книги', 'books'], ['week', 'Неделя'], ['awards', 'Награды']];
const MINUTES = (m: number) => m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`;
const money = (v: number, cur: string) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: v >= 100 ? 0 : 2 })} ${cur}`;
const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const PALETTE = ['var(--books)', 'var(--study)', 'var(--food)', 'var(--water)', 'var(--mustard)', 'var(--navy)', 'var(--gym)', 'var(--steps)'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'], WDN = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WDL = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
const TIER_C = ['#B0713F', '#8C99A6', '#CFA232', '#D9622B'];
const lab = (n: number) => (d: string) => n <= 7 ? WD[parseDay(d).getUTCDay()]! : n <= 31 ? String(+d.slice(8, 10)) : `${+d.slice(8, 10)}.${d.slice(5, 7)}`;
const every = (n: number) => n <= 7 ? 1 : n <= 31 ? 5 : n <= 90 ? 14 : 60;
const big = (v: number) => v >= 1e6 ? `${fmt1(v / 1e6)} млн` : v >= 1e4 ? `${fmt1(v / 1e3)} тыс` : fmt(v);

function useLoad<T>(url: string | null) {
  const [d, setD] = useState<T | null>(null), [err, setErr] = useState('');
  useEffect(() => { if (!url) return; let off = false; setErr(''); api<T>(url).then(x => { if (!off) setD(x); }, e => { if (!off) setErr(e instanceof ApiError ? e.message : 'Не получилось загрузить'); }); return () => { off = true; }; }, [url]);
  return { d, err };
}
const Skel = () => <div className="wgrid"><div className="skel span12" style={{ height: 180 }} /><div className="skel span7" style={{ height: 320 }} /><div className="skel span5" style={{ height: 320 }} /></div>;
const Kpi = ({ name, value, sub, tone }: { name: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) => <div className={`kpi ${tone ?? ''}`}><span>{name}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;

/* ---------------- обзор ---------------- */
const WDF = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const HEAT_MIN = 14;
const sign = (v: number, f: (n: number) => string = fmt) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`;
const dni = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
type WMetric = { key: string; name: string; unit: string; cur: number | null; prev: number | null; norm?: number; of?: number; better: boolean | null; note: string };
// значение и разница для плитки «Неделя к неделе»
const WFMT: Record<string, { v: (n: number) => string; d: (n: number) => string }> = {
  score: { v: n => `${n}%`, d: n => `${sign(n)} п.` },
  kcal: { v: n => fmt(n), d: n => `${sign(n)} ккал` },
  water: { v: n => `${fmt1(n / 1000)} л`, d: n => `${sign(n / 1000, fmt1)} л` },
  steps: { v: n => fmt(n), d: n => sign(n) },
  weight: { v: n => `${sign(n, fmt1)} кг`, d: n => `${sign(n, fmt1)} кг` },
  tasks: { v: n => String(n), d: n => sign(n) },
  study: { v: n => MINUTES(n), d: n => `${sign(n)} мин` },
  gym: { v: n => String(n), d: n => sign(n) },
  spent: { v: n => fmt(n), d: n => sign(n) },
  mood: { v: n => `${fmt1(n)} из 5`, d: n => sign(n, fmt1) }
};
const NEED: Record<string, string> = { study: 'study', gym: 'gym', spent: 'budget', tasks: 'plans' };

function WeekVsWeek({ w, has }: { w: any; has: (f: string) => boolean }) {
  const ms = (w.metrics as WMetric[]).filter(m => !NEED[m.key] || has(NEED[m.key]!));
  const empty = !w.days && !w.prevDays;
  return <section className="wc span12 wk2" data-tour="stats-week">
    <div className="card-head"><h2>Неделя к неделе</h2><span className="wk2-range">{human(w.from)} — {human(w.to)} <small>против {human(w.prevFrom)} — {human(w.prevTo)}</small></span></div>
    {empty ? <p className="card-note">Здесь появится сравнение: последние 7 дней против 7 до них — оценка, калории, вода, шаги и всё, что ты ведёшь. Нужна хотя бы пара дней с записями.</p> : <>
      {w.insights.length > 0 ? <ul className="wk2-ins">{w.insights.map((x: string, k: number) => <li key={x} className={k ? 'weak' : 'strong'}><Icon name={k ? 'target' : 'star'} />{x}</li>)}</ul>
        : !w.moodInsight && <p className="card-note">{w.days < 2 ? `Подсказки появятся, когда за последние 7 дней наберётся хотя бы 2 дня с записями — сейчас ${w.days}.` : 'Всё, что ведёшь, держится ровно — ни явных побед, ни провалов.'}</p>}
      {w.moodInsight && <p className="wk2-mood"><Face n={4} />{w.moodInsight}</p>}
      <div className="wk2-grid">{ms.map(m => {
        const F = WFMT[m.key] ?? WFMT.gym!, d = m.cur !== null && m.prev !== null && m.key !== 'weight' ? m.cur - m.prev : null;
        const tone = m.better === null ? '' : m.better ? 'good' : 'bad';
        return <div key={m.key} className={`wk2-m ${tone}`}>
          <span className="wk2-n">{m.name}</span>
          <b>{m.cur === null ? '—' : F.v(m.cur)}{m.key === 'tasks' && m.of ? <small> из {m.of}</small> : null}</b>
          <small className="wk2-note">{m.note}</small>
          <span className="wk2-d">{m.prev === null ? <em>раньше не было</em> : <>было {F.v(m.prev)}{d !== null && d !== 0 && <i className={tone}>{d > 0 ? '▲' : '▼'} {F.d(d)}</i>}{d === 0 && <i>так же</i>}</>}</span>
          {m.better !== null && <span className="sr-only">{m.better ? 'лучше, чем неделей раньше' : 'хуже, чем неделей раньше'}</span>}
        </div>;
      })}</div>
      <p className="card-note">Сегодня не считается — день ещё идёт. Зелёный — лучше, красный — хуже: для калорий лучше ближе к норме, для трат — меньше.</p>
    </>}
  </section>;
}

function Weekdays({ wd, pastDays }: { wd: Array<{ avg: number | null; n: number }> | null; pastDays: number }) {
  if (!wd) return <p className="card-note">Когда появится хотя бы один завершённый день с записями, здесь будет видно, какой день недели у тебя сильнее.</p>;
  const has = wd.map((x, k) => [x, k] as const).filter(([x]) => x.avg !== null), best = has.slice().sort((a, b) => b[0].avg! - a[0].avg!)[0]!, worst = has.slice().sort((a, b) => a[0].avg! - b[0].avg!)[0]!;
  return <>
    <Bars rows={wd.map((x, k) => ({ label: WDN[k]!, v: x.avg ?? 0, hint: x.avg === null ? `${WDN[k]}: пока нет данных` : `${WDN[k]}: в среднем ${x.avg}% · ${dni(x.n)}`, color: x.avg !== null && k === best[1] && has.length > 1 ? 'var(--gym)' : null }))} color="var(--navy)" max={100} values unit="%" />
    <p className="card-note">{has.length > 1 ? <>Сильнейший день — <b>{WDF[best[1]]}</b>, в среднем {best[0].avg}%{has.length > 2 && worst[1] !== best[1] && worst[0].avg! < best[0].avg! ? `; тяжелее всего — ${WDF[worst[1]]}, ${worst[0].avg}%` : ''}.</>
      : `Пока есть только ${WDF[best[1]]} — ${best[0].avg}%. Через неделю будет с чем сравнить.`}
      {pastDays < 14 ? ` Считаю по ${pastDays} ${plural(pastDays, 'дню', 'дням', 'дням')} — картина уточнится через пару недель.` : ' Средняя оценка завершённых дней с записями.'}</p>
  </>;
}

function Overview({ has, onOpenDay }: { has: (f: string) => boolean; onOpenDay?: (day: string) => void }) {
  const [month, setMonth] = useState<string | null>(null), [pick, setPick] = useState<{ day: string; at: 'cal' | 'heat' } | null>(null);
  const { d, err } = useLoad<any>(`/api/stats/overview${month ? `?month=${month}` : ''}`);
  if (err) return <p className="form-err">{err}</p>;
  if (!d) return <Skel />;
  const c = d.calendar, shift = (k: number) => { const [y, m] = c.month.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + k, 1)); setMonth(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`); setPick(p => p?.at === 'cal' ? null : p); buzz(6); };
  const choose = (day: string, at: 'cal' | 'heat') => { setPick(p => p?.day === day && p.at === at ? null : { day, at }); buzz(6); };
  const panel = (at: 'cal' | 'heat') => pick?.at === at ? <DayDetail key={pick.day} day={pick.day} has={has} onClose={() => setPick(null)} onOpenDay={onOpenDay} /> : null;
  const y = d.year, todayRec = c.cells.find((x: any) => x.day === d.today)?.any, showHeat = y.active >= HEAT_MIN;
  return <div className="wgrid ov2">
    <section className="wc span12 ov-hero" data-tour="stats-score">
      <div className="ov-score">
        <span className="ov-ring"><ScoreRing v={d.score.now} size={128} sw={13} /><b>{d.score.now}%</b><small>сегодня, пока</small></span>
        <div><span className="ov-k">Оценка дня</span>
          <p className="ov-parts">{d.score.parts.length ? d.score.parts.map((p: any) => <span key={p.area} className={`ov-part ${p.v >= 99 ? 'ok' : ''}`}>{p.v >= 99 ? '✓' : `${p.v}%`} {p.name}</span>) : 'Записывай еду, воду, шаги или учёбу — из этого складывается оценка.'}</p>
          <p className="card-note">{d.score.avg7 === null ? 'За прошлые 7 дней записей не было — среднее появится завтра.' : <>Среднее за 7 дней — <b>{d.score.avg7}%</b> по {d.score.days7} {plural(d.score.days7, 'дню', 'дням', 'дням')} с записями (пустые дни и сегодня не в счёт).</>} Зал и чтение добавляют бонус.</p></div>
      </div>
      <div className="ov-nums">
        <div><b>{d.nums.active365}</b><span>{plural(d.nums.active365, 'день', 'дня', 'дней')} с записями за год</span></div>
        <div><b>{d.nums.perfect365}</b><span>{plural(d.nums.perfect365, 'идеальный день', 'идеальных дня', 'идеальных дней')} (95%+)</span></div>
        <div><b>{d.nums.streak}</b><span>{plural(d.nums.streak, 'день', 'дня', 'дней')} подряд · рекорд {d.nums.bestStreak}</span></div>
        <div className="hot"><b>{d.nums.tiers}</b><span>{plural(d.nums.tiers, 'ступень', 'ступени', 'ступеней')} достижений</span></div>
      </div>
    </section>
    <WeekVsWeek w={d.week} has={has} />
    <section className="wc span7" data-tour="calendar">
      <div className="card-head"><h2>Календарь</h2><div className="cal-nav"><button onClick={() => shift(-1)} aria-label="Предыдущий месяц"><Icon name="chevL" /></button><b aria-live="polite">{c.title}</b><button onClick={() => shift(1)} disabled={c.isCurrent} aria-label="Следующий месяц"><Icon name="chev" /></button></div></div>
      <MonthCal lead={c.lead} cells={c.cells} today={d.today} selected={pick?.at === 'cal' ? pick.day : null} onPick={x => choose(x.day, 'cal')} />
      <div className="legend"><span><i style={{ background: 'var(--mustard)' }} />идеально ★</span><span><i style={{ background: 'var(--gym)' }} />70%+</span><span><i style={{ background: 'var(--steps)' }} />40%+</span><span><i style={{ background: 'var(--text-3)' }} />начало</span><span><i className="k-gymdot" />зал</span>{c.cells.some((x: any) => x.frozen) && <span><i className="k-ice" />заморожен</span>}</div>
      {panel('cal') ?? <p className="card-note st2-hint">Нажми на день — покажу, из чего сложилась оценка и что записано.</p>}
    </section>
    <section className="wc span5">
      <div className="card-head"><h2>Как идёт {c.name}</h2></div>
      <div className="ov-big"><b>{c.avg ?? <span className="nodata">нет</span>}{c.avg !== null && c.avg !== undefined && <small>%</small>}</b>
        <span>{c.avgDays ? `средняя оценка по ${c.avgDays} ${plural(c.avgDays, 'завершённому дню', 'завершённым дням', 'завершённым дням')} с записями` : 'средняя появится после первого завершённого дня с записями'}{c.prevAvg !== null ? ` · в прошлом месяце ${c.prevAvg}%` : ''}</span></div>
      <p className="ov-motto">{c.line}</p>
      <ul className="ov-list">
        <li><span>Дней с записями{c.isCurrent && todayRec ? ' (с сегодняшним)' : ''}</span><b>{c.days}</b></li>
        <li><span>Идеальных дней ★ (95%+)</span><b>{c.perfect}</b></li>
        {c.best && <li><span>Лучший день</span><b>{human(c.best.day)} · {c.best.score}%</b></li>}
        <li><span>Средняя за 30 дней · к прошлым 30</span><b>{d.last30}% <Delta cur={d.last30} prev={d.prev30} /></b></li>
      </ul>
      <p className="card-note">Средние — только по дням с записями: пустой день не тянет вниз, а сегодняшний, пока идёт, не учитывается.</p>
    </section>
    <section className="wc span12 hm-card" data-tour="stats-year">
      <div className="card-head"><h2>{showHeat && y.first && y.first > addDays(d.today, -360) ? 'Дни с первой записи' : 'Год по дням'}</h2>{showHeat && y.first && <span className="wk2-range">с {humanLong(y.first < y.cells[0].day ? y.cells[0].day : y.first)}</span>}</div>
      {showHeat ? <>
        <YearHeat cells={y.cells} today={d.today} first={y.first} selected={pick?.at === 'heat' ? pick.day : null} onPick={day => choose(day, 'heat')} />
        <div className="hm-legend" aria-hidden="true"><span>нет записей</span><i className="none" /><i style={{ background: 'var(--text-3)' }} /><i style={{ background: 'var(--steps)' }} /><i style={{ background: 'var(--gym)' }} /><i style={{ background: 'var(--mustard)' }} /><span>идеально ★</span><span className="hm-lt"><i className="today" />сегодня</span>{y.cells.some((x: any) => x.frozen) && <span className="hm-lt"><i className="ice" />заморожен</span>}</div>
        {panel('heat') ?? <p className="card-note">Каждая клетка — день, цвет — его оценка. Нажми на клетку — покажу подробности.</p>}
      </> : <div className="hm-soon">
        <p><b>Здесь появится твой год</b> — пока {dni(y.active)} с записями. Карта дней откроется с {HEAT_MIN}-го дня.</p>
        <span className="wbar" role="progressbar" aria-valuemin={0} aria-valuemax={HEAT_MIN} aria-valuenow={y.active} aria-label="Дней с записями до карты года"><i style={{ width: `${Math.min(100, y.active / HEAT_MIN * 100)}%`, background: 'var(--gym)' }} /></span>
      </div>}
    </section>
    <section className="wc span6"><div className="card-head"><h2>Дни недели</h2></div><Weekdays wd={d.weekdays} pastDays={d.pastDays} /></section>
    <section className="wc span6"><div className="card-head"><h2>Рекорды</h2></div>
      <ul className="rec-list">{d.records.map((r: any) => <li key={r.name}><span className="rec-ic"><Icon name={r.icon} /></span><div><span>{r.name}</span><small>{/^\d{4}-/.test(r.sub) ? humanLong(r.sub) : r.sub.replace(/с (\d{4}-\d{2}-\d{2})/, (_: string, x: string) => `с ${human(x)}`)}</small></div><b>{/^\d+$/.test(r.value) ? fmt(+r.value) : r.value}{r.unit ? <small> {r.unit}</small> : null}</b></li>)}</ul>
    </section>
  </div>;
}

/* ---------------- еда ---------------- */
function FoodStats({ n }: { n: number }) {
  const { d, err } = useLoad<any>(`/api/stats/food?days=${n}`);
  if (err) return <p className="form-err">{err}</p>;
  if (!d) return <Skel />;
  const L = lab(n), C: Record<string, string> = { good: 'var(--gym)', warn: 'var(--mustard)', low: 'var(--mustard)', bad: 'var(--bad)' };
  return <>
    <div className="kpis">
      <Kpi name="Ккал в день" value={d.logged ? fmt(d.avgKcal) : '—'} sub={d.logged ? <>норма {fmt(d.norms.kcal)} <Delta cur={d.avgKcal} prev={d.prevKcal} good="none" /></> : 'нет записей'} />
      <Kpi name="Белок в день" value={d.logged ? <>{fmt(d.avgProtein)}<small>г</small></> : '—'} sub={<>норма {fmt(d.norms.protein)} г <Delta cur={d.avgProtein} prev={d.prevProtein} /></>} />
      <Kpi name="Дней в норме" value={<>{d.inNorm}<small>из {d.logged}</small></>} sub={d.logged ? `${Math.round(d.inNorm / d.logged * 100)}% дней · перебор ${d.over}` : ''} tone="k-good" />
      <Kpi name="Вода в день" value={<>{fmt1(d.waterAvg / 1000)}<small>л</small></>} sub={`норма ${fmt1(d.norms.water / 1000)} л · ${d.waterDays} дн. закрыто`} tone="k-water" />
    </div>
    <div className="wgrid">
      <section className="wc span12"><div className="card-head"><h2>Калории по дням</h2></div>
        <Bars rows={d.rows.map((r: any) => ({ label: L(r.day), v: r.kcal, hint: `${human(r.day)}: ${fmt(r.kcal)} ккал`, color: r.meals && r.day < d.rows.at(-1).day ? C[r.level] : null }))} color="var(--food)" target={d.norms.kcal} unit="ккал" every={every(n)} />
        <div className="legend"><span><i style={{ background: 'var(--gym)' }} />в норме</span><span><i style={{ background: 'var(--mustard)' }} />мимо</span><span><i style={{ background: 'var(--bad)' }} />перебор</span><span><i style={{ background: 'var(--food)' }} />сегодня</span></div>
      </section>
      <section className="wc span6"><div className="card-head"><h2>Белок, г</h2></div><Bars rows={d.rows.map((r: any) => ({ label: L(r.day), v: r.protein, hint: `${human(r.day)}: ${fmt(r.protein)} г` }))} color="var(--navy)" target={d.norms.protein || undefined} unit="г" every={every(n)} /></section>
      <section className="wc span6"><div className="card-head"><h2>Из чего калории</h2></div>
        {d.macro ? <><div className="macro-wrap"><Donut parts={[{ name: 'Белки', v: d.macro.protein, color: 'var(--navy)' }, { name: 'Жиры', v: d.macro.fat, color: 'var(--mustard)' }, { name: 'Углеводы', v: d.macro.carbs, color: 'var(--food)' }]} center={<><b>{fmt(d.avgKcal)}</b><small>ккал/день</small></>} />
          <ul className="macro-list">{([['Белки', d.macro.protein, 'var(--navy)', '10–35%'], ['Жиры', d.macro.fat, 'var(--mustard)', '20–35%'], ['Углеводы', d.macro.carbs, 'var(--food)', '45–65%']] as const).map(([nm, v, c, r]) => <li key={nm}><i style={{ background: c }} /><span>{nm}</span><b>{v}%</b><em>{r}</em></li>)}</ul></div>
          <p className="card-note">Справа — здоровый диапазон по рекомендациям (AMDR).</p></> : <p className="card-note">Нет записей еды за период.</p>}
      </section>
      <section className="wc span6"><div className="card-head"><h2>Вода, л</h2></div><Bars rows={d.rows.map((r: any) => ({ label: L(r.day), v: Math.round(r.waterMl / 100) / 10, hint: `${human(r.day)}: ${fmt1(r.waterMl / 1000)} л` }))} color="var(--water)" target={d.norms.water / 1000} unit="л" every={every(n)} format={fmt1} /></section>
      <section className="wc span6"><div className="card-head"><h2>Чаще всего ешь</h2></div>
        {d.top.length ? <HBars rows={d.top.map((x: any) => ({ label: x.name, v: x.n, text: `${x.n}× · ${fmt(x.kcal)} ккал` }))} color="var(--food)" /> : <p className="card-note">Пока нет блюд за период.</p>}</section>
    </div>
  </>;
}

/* ---------------- учёба ---------------- */
function StudyStats({ n }: { n: number }) {
  const { d, err } = useLoad<any>(`/api/study/stats?days=${n}`);
  if (err) return <p className="form-err">{err}</p>;
  if (!d) return <Skel />;
  const L = lab(n), top = d.categories[0]?.minutes || 1;
  return <>
    <div className="kpis">
      <Kpi name="Учёба" value={<>{fmt1(d.total / 60)}<small>ч</small></>} sub={<>{MINUTES(Math.round(d.total / n))} в день <Delta cur={d.total} prev={d.prevTotal} /></>} tone="k-study" />
      <Kpi name="Дней с учёбой" value={<>{d.activeDays}<small>из {n}</small></>} sub={`цель ${MINUTES(d.goal)} закрыта ${d.goalDays} ${plural(d.goalDays, 'раз', 'раза', 'раз')}`} tone="k-good" />
      <Kpi name="Ответов" value={d.answers.n} sub={d.answers.n ? `верно ${Math.round(d.answers.good / d.answers.n * 100)}%` : 'ещё нет'} />
      <Kpi name="Тем" value={d.topics} sub={`${d.categories.length} ${plural(d.categories.length, 'направление', 'направления', 'направлений')}`} />
    </div>
    <div className="wgrid">
      <section className="wc span12"><div className="card-head"><h2>Минуты по дням</h2></div>
        <Bars rows={d.perDay.map((r: any) => ({ label: L(r.day), v: r.minutes, hint: `${human(r.day)}: ${MINUTES(r.minutes)}`, color: r.minutes >= d.goal ? 'var(--gym)' : null }))} color="var(--study)" target={d.goal} unit="мин" every={every(n)} /></section>
      <section className="wc span6"><div className="card-head"><h2>Направления</h2></div>
        {d.categories.length ? <HBars rows={d.categories.map((c: any) => ({ label: c.name, v: c.minutes / top * 100, text: MINUTES(c.minutes) }))} color="var(--study)" /> : <p className="card-note">Записывай занятия с направлением — появится разбивка.</p>}</section>
      <section className="wc span6"><div className="card-head"><h2>Точность ответов, %</h2></div>
        {d.accuracy.length ? <Bars rows={d.accuracy.map((a: any) => ({ label: L(a.day), v: a.pct, hint: `${human(a.day)}: ${a.pct}% из ${a.n}`, color: a.pct >= 80 ? 'var(--gym)' : a.pct < 50 ? 'var(--bad)' : null }))} color="var(--mustard)" target={80} unit="%" every={Math.max(1, Math.round(d.accuracy.length / 6))} /> : <p className="card-note">Отвечай на вопросы дня — появится график.</p>}</section>
    </div>
  </>;
}

/* ---------------- деньги ---------------- */
function MoneyStats({ n }: { n: number }) {
  const { d, err } = useLoad<any>(`/api/budget/stats?days=${n}`);
  if (err) return <p className="form-err">{err}</p>;
  if (!d) return <Skel />;
  if (!d.configured) return <div className="wgrid"><section className="wc span12"><p className="card-note">Бюджет ещё не настроен. Задай сумму на месяц в разделе «Бюджет» — здесь появятся траты, категории и месяцы.</p><a className="primary" href="#budget">Настроить бюджет</a></section></div>;
  const L = lab(n), cur = d.currency;
  return <>
    <div className="kpis">
      <Kpi name="Потрачено" value={money(d.total, cur)} sub={d.prevTotal ? <><Delta cur={d.total} prev={d.prevTotal} good="down" /> к прошлому периоду</> : 'за период'} tone="k-money" />
      <Kpi name="В день" value={money(d.total / n, cur)} sub={`ровный лимит ${money(d.base, cur)}`} />
      <Kpi name="Дней в рамках" value={d.inLimit} sub="не вышел за дневной лимит" tone="k-good" />
      <Kpi name="Доходы" value={money(d.income, cur)} sub="за период" />
    </div>
    <div className="wgrid">
      <section className="wc span12"><div className="card-head"><h2>Траты по дням</h2></div>
        <Bars rows={d.perDay.map((r: any) => ({ label: L(r.day), v: r.spent, hint: `${human(r.day)}: ${money(r.spent, cur)}`, color: r.spent > d.base * 1.5 ? 'var(--bad)' : null }))} color="var(--money)" target={d.base} unit={cur} every={every(n)} /></section>
      <section className="wc span6"><div className="card-head"><h2>По категориям</h2></div>
        {d.byCat.length ? <div className="macro-wrap"><Donut parts={d.byCat.map((c: any) => ({ name: c.name, v: c.sum, color: c.color }))} center={<><b>{money(d.total, cur)}</b><small>всего</small></>} />
          <ul className="macro-list">{d.byCat.map((c: any) => <li key={c.key}><i style={{ background: c.color }} /><span>{c.name}</span><b>{Math.round(c.sum / d.total * 100)}%</b><em>{money(c.sum, cur)}</em></li>)}</ul></div>
          : <p className="card-note">Трат за период нет.</p>}</section>
      <section className="wc span6"><div className="card-head"><h2>По месяцам</h2></div>
        <Bars rows={d.periods.map((p: any) => ({ label: MON[+p.from.slice(5, 7) - 1]!, v: Math.round(p.spent), hint: `${human(p.from)} — ${human(p.to)}: ${money(p.spent, cur)}`, color: p.spent > d.amount ? 'var(--bad)' : null }))} color="var(--money)" target={d.amount} unit={cur} values /></section>
    </div>
  </>;
}

/* ---------------- книги ---------------- */
function BooksStats({ n }: { n: number }) {
  const { d, err } = useLoad<any>(`/api/books/stats?days=${n}`);
  if (err) return <p className="form-err">{err}</p>;
  if (!d) return <Skel />;
  const L = lab(n), done = d.genres.reduce((a: number, g: any) => a + g.n, 0);
  return <>
    <div className="kpis">
      <Kpi name="Страниц" value={fmt(d.total)} sub={<>{fmt1(d.total / n)} в день · {d.readDays} дн. с чтением <Delta cur={d.total} prev={d.prevTotal} /></>} tone="k-books" />
      <Kpi name={`Книг за ${d.year}`} value={<>{d.doneYear}<small>из {d.goal}</small></>} sub="цель года" tone="k-good" />
      <Kpi name="Скорость" value={d.speed ? <>{d.speed}<small>стр/день</small></> : 'нет'} sub="от начала до конца книги" />
      <Kpi name="Серия чтения" value={d.streak} sub={`${plural(d.streak, 'день', 'дня', 'дней')} подряд`} />
    </div>
    <div className="wgrid">
      <section className="wc span12"><div className="card-head"><h2>Страниц по дням</h2></div>
        {d.total ? <Bars rows={d.perDay.map((r: any) => ({ label: L(r.day), v: r.pages, hint: `${human(r.day)}: ${r.pages} стр.` }))} color="var(--books)" unit="стр." every={every(n)} /> : <p className="card-note">Отмечай прочитанные страницы в «Книгах» — появится график.</p>}</section>
      <section className="wc span6"><div className="card-head"><h2>Прочитано по месяцам {d.year}</h2></div>
        <Bars rows={d.months.map((m: any, k: number) => ({ label: MON[k]!, v: m.n, hint: `${MON[k]}: ${m.titles.join(', ') || 'нет'}` }))} color="var(--books)" values max={2} /></section>
      <section className="wc span6"><div className="card-head"><h2>Жанры</h2></div>
        {d.genres.length ? <div className="macro-wrap"><Donut parts={d.genres.map((g: any, k: number) => ({ name: g.name, v: g.n, color: PALETTE[k % PALETTE.length]! }))} center={<><b>{done}</b><small>{plural(done, 'книга', 'книги', 'книг')}</small></>} />
          <ul className="macro-list">{d.genres.map((g: any, k: number) => <li key={g.name}><i style={{ background: PALETTE[k % PALETTE.length] }} /><span>{g.name}</span><b>{g.n}</b></li>)}</ul></div>
          : <p className="card-note">Дочитанных книг пока нет.</p>}</section>
    </div>
  </>;
}

/* ---------------- тело ---------------- */
function BodyStats({ n }: { n: number }) {
  const { d, err } = useLoad<any>(`/api/stats/body?days=${n}`);
  if (err) return <p className="form-err">{err}</p>;
  if (!d) return <Skel />;
  const L = lab(n), wd = d.weekdays as number[], bw = wd.indexOf(Math.max(...wd));
  const ws = d.weights as Array<{ day: string; kg: number }>, lo = ws.length ? Math.min(...ws.map(w => w.kg)) : 0, hi = ws.length ? Math.max(...ws.map(w => w.kg)) : 0;
  return <>
    <div className="kpis">
      <Kpi name="Шагов в день" value={d.logged ? fmt(d.avg) : '—'} sub={<>цель {fmt(d.goal)} <Delta cur={d.avg} prev={d.prevAvg} /></>} tone="k-steps" />
      <Kpi name="Дней с целью" value={<>{d.hit}<small>из {d.logged}</small></>} sub={d.logged ? `${Math.round(d.hit / d.logged * 100)}% дней с записью` : ''} tone="k-good" />
      <Kpi name="Всего шагов" value={big(d.total)} sub={d.best.steps ? `рекорд ${fmt(d.best.steps)} · ${human(d.best.day)}` : ''} />
      <Kpi name="Вес за период" value={d.change === null ? '—' : <>{d.change > 0 ? '+' : d.change < 0 ? '−' : ''}{fmt1(Math.abs(d.change))}<small>кг</small></>} sub={ws.length ? `${ws.length} ${plural(ws.length, 'замер', 'замера', 'замеров')} · сейчас ${fmt1(ws.at(-1)!.kg)} кг` : 'нет замеров'} />
    </div>
    <div className="wgrid">
      <section className="wc span12"><div className="card-head"><h2>Шаги по дням</h2></div>
        <Bars rows={d.steps.map((s: any) => ({ label: L(s.day), v: s.steps, hint: `${human(s.day)}: ${fmt(s.steps)} шагов`, color: s.steps >= d.goal ? 'var(--gym)' : null }))} color="var(--steps)" target={d.goal} unit="шагов" every={every(n)} /></section>
      <section className="wc span6"><div className="card-head"><h2>Шаги по дням недели</h2></div>
        <Bars rows={wd.map((v, k) => ({ label: WDN[k]!, v, hint: `${WDN[k]}: в среднем ${fmt(v)}` }))} color="var(--steps)" target={d.goal} values format={v => fmt1(v / 1000) + 'к'} />
        {d.logged >= 7 && <p className="card-note">Больше всего ходишь в {WDL[bw]}.</p>}</section>
      <section className="wc span6"><div className="card-head"><h2>Вес</h2></div>
        {ws.length > 1 ? <div className="wline"><svg viewBox="0 0 300 120" preserveAspectRatio="none">{(() => { const x = (i: number) => 6 + i / (ws.length - 1) * 288, y = (v: number) => 10 + (hi === lo ? 50 : (1 - (v - lo) / (hi - lo)) * 100); return <><path d={ws.map((w, i) => `${i ? 'L' : 'M'}${x(i)},${y(w.kg)}`).join(' ')} className="wl" />{ws.map((w, i) => <circle key={w.day} cx={x(i)} cy={y(w.kg)} r="3" className="wd"><title>{human(w.day)}: {fmt1(w.kg)} кг</title></circle>)}</>; })()}</svg>
          <div className="wline-x"><span>{human(ws[0]!.day)} · {fmt1(ws[0]!.kg)}</span><span>{fmt1(ws.at(-1)!.kg)} · {human(ws.at(-1)!.day)}</span></div></div> : <p className="card-note">Нужно хотя бы два замера за период.</p>}</section>
    </div>
  </>;
}

/* ---------------- итог недели ---------------- */
function Week() {
  const [mon, setMon] = useState<string | null>(null);
  const { d, err } = useLoad<any>(`/api/stats/week${mon ? `?mon=${mon}` : ''}`);
  if (err) return <p className="form-err">{err}</p>;
  if (!d) return <Skel />;
  const WDF = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
  return <div className="wgrid">
    <section className="wc span12 rv-hero">
      <div className="rv-top"><div className="cal-nav"><button onClick={() => setMon(addDays(d.mon, -7))} aria-label="Неделя раньше"><Icon name="chevL" /></button><b>{d.isThis ? 'эта неделя' : `${human(d.mon)} — ${human(d.sun)}`}</b><button onClick={() => setMon(addDays(d.mon, 7))} disabled={!d.canNext} aria-label="Неделя позже"><Icon name="chev" /></button></div></div>
      <div className="rv-body">
        <span className="ov-ring"><ScoreRing v={d.score} size={128} sw={13} /><b>{d.score}%</b><small>в среднем</small></span>
        <div className="rv-main">
          <p className="rv-motto">{d.motto}</p>
          {d.prevScore !== null && <p className="card-note">Прошлая неделя — {d.prevScore}% <Delta cur={d.score} prev={d.prevScore} /></p>}
          <div className="rv-days">{d.scores.map((s: number | null, k: number) => <div key={k} className={`rv-day ${d.best?.k === k ? 'best' : ''} ${s === null ? 'fut' : ''}`} title={s === null ? '' : `${WDF[k]}: ${s}%`}>
            <span>{WDN[k]}</span>{s === null ? <i /> : <ScoreRing v={s} />}<b>{s ?? ''}</b>{d.best?.k === k && <em>★</em>}</div>)}</div>
          {d.best && <p className="rv-best">★ Лучший день — <b>{WDF[d.best.k]}</b>, {d.best.score}%{d.best.parts.length ? `: ${d.best.parts.join(', ')}` : ''}</p>}
        </div>
      </div>
    </section>
    <div className="kpis span12">{d.kpis.map((k: any) => <Kpi key={k.name} name={k.name} value={<>{k.name === 'Шагов' ? big(k.value) : String(k.value).replace('.', ',')}{k.of ? <small>из {k.of}</small> : null}</>} sub={!d.prevLogged ? '' : k.value === k.prev ? 'как на прошлой' : k.prev ? <><Delta cur={k.value} prev={k.prev} /> к прошлой</> : 'на прошлой не было'} />)}</div>
    <section className="wc span6"><div className="card-head"><h2>Получилось · {d.wins.length}</h2></div>{d.wins.length ? <ul className="rv-list ok">{d.wins.map((x: string) => <li key={x}><Icon name="check" />{x}</li>)}</ul> : <p className="card-note">Пока нечем похвастаться — всё впереди.</p>}</section>
    <section className="wc span6"><div className="card-head"><h2>Не получилось · {d.misses.length}</h2></div>{d.misses.length ? <ul className="rv-list miss">{d.misses.map((x: string) => <li key={x}><span className="x">×</span>{x}</li>)}</ul> : <p className="card-note">Всё, что ведёшь, — в норме. Отличная неделя.</p>}</section>
    {d.focus.length > 0 && <section className="wc span12 solid s-navy"><div className="card-head"><h2>Фокус на следующую неделю</h2></div><ol className="rv-focus">{d.focus.map((x: string) => <li key={x}>{x}</li>)}</ol><p className="card-note">Одна-две вещи, а не всё сразу, — так привычки приживаются.</p></section>}
  </div>;
}

/* ---------------- достижения ---------------- */
function Medal({ x, size = 64 }: { x: any; size?: number }) {
  const col = x.tier ? TIER_C[x.tier - 1] : 'var(--track)', r = size / 2 - 4, C = 2 * Math.PI * r;
  return <div className={`medal ${x.tier ? '' : 'locked'}`} style={{ ['--mc' as string]: col, ['--dc' as string]: `var(--${x.color})`, width: size, height: size }}>
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true"><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth="5" />
      {x.next && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dc)" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - x.progress)} transform={`rotate(-90 ${size / 2} ${size / 2})`} opacity=".55" />}</svg>
    <span className="medal-ic"><Icon name={x.icon} /></span></div>;
}
function Awards() {
  const { d, err } = useLoad<any>('/api/awards');
  if (err) return <p className="form-err">{err}</p>;
  if (!d) return <Skel />;
  const list = (d.list as any[]).slice().sort((a, b) => b.tier - a.tier || b.progress - a.progress), left = 4 - d.total % 4;
  return <>
    <section className="wc aw-hero">
      <div className="aw-level"><span>Уровень</span><b>{d.level}</b><small>{left} {plural(left, 'ступень', 'ступени', 'ступеней')} до следующего · открыто {d.total} из {d.max}</small></div>
      <div className="aw-tiers">{d.tiers.map((n: string, k: number) => <div key={n} style={{ ['--mc' as string]: TIER_C[k] }}><i /><b>{list.filter(x => x.tier > k).length}</b><span>{n}</span></div>)}</div>
      {d.near.length > 0 && <div className="aw-near"><span className="ov-k">Ближе всего</span>{d.near.map((x: any) => <div key={x.key} className="aw-near-i"><b>{x.name}</b><span>{big(x.value)} / {big(x.next)} {x.unit}</span><span className="wbar"><i style={{ width: `${Math.round(x.progress * 100)}%`, background: 'var(--mustard)' }} /></span></div>)}</div>}
    </section>
    {d.recent.length > 0 && <><h3 className="aw-sec">Недавно получено</h3><div className="aw-recent">{d.recent.map((r: any) => <div key={`${r.key}${r.tier}`} className="aw-chip" style={{ ['--mc' as string]: TIER_C[r.tier] }}><i /><b>{r.name}</b><span>{d.tiers[r.tier]} · {human(r.day)}</span></div>)}</div></>}
    <h3 className="aw-sec">Все достижения</h3>
    <div className="aw-grid">{list.map((x, i) => <article key={x.key} className={`aw-card ${x.tier ? '' : 'locked'}`} style={{ ['--i' as string]: i }}>
      <Medal x={x} />
      <div className="aw-body"><b>{x.name}</b><span className="aw-tier" style={{ ['--mc' as string]: x.tier ? TIER_C[x.tier - 1] : 'var(--text-3)' }}>{x.tier ? d.tiers[x.tier - 1] : 'Ещё не открыто'}</span>
        <p>{x.next ? `${big(x.value)} из ${big(x.next)} ${x.unit}` : `${big(x.value)} ${x.unit} — максимум`}</p>
        <div className="aw-pips">{x.thresholds.map((t: number, k: number) => <i key={k} className={k < x.tier ? 'on' : ''} style={{ ['--mc' as string]: TIER_C[k] }} title={`${d.tiers[k]}: ${big(t)}`} />)}</div></div>
    </article>)}</div>
  </>;
}

export function Stats({ wide, tab: start, has = () => true, onBack, onOpenDay }: { wide: boolean; tab?: StatsTab; has?: (feature: string) => boolean; onBack: () => void; onOpenDay?: (day: string) => void }) {
  const [tab, setTab] = useState<StatsTab>(start ?? 'overview'), [n, setN] = useState(30);
  useEffect(() => { if (start) setTab(start); }, [start]);
  const pick = useCallback((t: StatsTab) => { setTab(t); buzz(6); }, []);
  const sub = tab === 'overview' ? 'как ты живёшь — в цифрах' : tab === 'week' ? 'что получилось и на чём сфокусироваться' : tab === 'awards' ? '4 ступени: бронза, серебро, золото, легенда' : `последние ${n === 365 ? 'год' : `${n} дней`}`;
  return <div className="day stats-page">
    <header className="dayhead">
      {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
      <div className="daytitle"><span>{sub}</span><b>{tab === 'week' ? 'Итог недели' : tab === 'awards' ? 'Достижения' : 'Статистика'}</b></div>
      <HelpButton tour="stats" />
    </header>
    <div className="st-bar">
      <div className="seg-tabs" role="tablist" data-tour="stats-tabs">{TABS.filter(([, , f]) => !f || has(f)).map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>{t}</button>)}</div>
      {['food', 'body', 'study', 'money', 'books'].includes(tab) && <div className="seg-tabs sm">{[7, 30, 90, 365].map(r => <button key={r} className={r === n ? 'on' : ''} onClick={() => setN(r)}>{r === 365 ? 'год' : `${r} дн`}</button>)}</div>}
    </div>
    {tab === 'overview' && <Overview has={has} onOpenDay={onOpenDay} />}
    {tab === 'food' && <FoodStats n={n} />}
    {tab === 'body' && <BodyStats n={n} />}
    {tab === 'study' && <StudyStats n={n} />}
    {tab === 'money' && <MoneyStats n={n} />}
    {tab === 'books' && <BooksStats n={n} />}
    {tab === 'week' && <Week />}
    {tab === 'awards' && <Awards />}
  </div>;
}
// цвет оценки — и для других экранов
export { scoreColor };
