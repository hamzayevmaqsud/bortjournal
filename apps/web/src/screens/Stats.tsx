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
import { Bars, Delta, Donut, HBars, human, humanLong, MonthCal, ScoreRing, scoreColor, YearHeat } from '../components/Charts';

export type StatsTab = 'overview' | 'food' | 'body' | 'week' | 'awards';
const TABS: Array<[StatsTab, string]> = [['overview', 'Обзор'], ['food', 'Еда'], ['body', 'Тело'], ['week', 'Неделя'], ['awards', 'Награды']];
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
function Overview() {
  const [month, setMonth] = useState<string | null>(null);
  const { d, err } = useLoad<any>(`/api/stats/overview${month ? `?month=${month}` : ''}`);
  if (err) return <p className="form-err">{err}</p>;
  if (!d) return <Skel />;
  const c = d.calendar, shift = (k: number) => { const [y, m] = c.month.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + k, 1)); setMonth(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`); buzz(6); };
  const wd = d.weekdays as number[] | null, best = wd ? wd.indexOf(Math.max(...wd)) : -1, worst = wd ? wd.indexOf(Math.min(...wd.map(v => v || 999))) : -1;
  return <div className="wgrid">
    <section className="wc span12 ov-hero">
      <div className="ov-score">
        <span className="ov-ring"><ScoreRing v={d.score.now} size={128} sw={13} /><b>{d.score.now}%</b><small>сегодня, пока</small></span>
        <div><span className="ov-k">Оценка дня</span>
          <p className="ov-parts">{d.score.parts.length ? d.score.parts.map((p: any) => <span key={p.area} className={`ov-part ${p.v >= 99 ? 'ok' : ''}`}>{p.v >= 99 ? '✓' : `${p.v}%`} {p.name}</span>) : 'Записывай еду, воду, шаги или учёбу — из этого складывается оценка.'}</p>
          <p className="card-note">Среднее за 7 дней — {d.score.avg7}%. Зал и чтение добавляют бонус.</p></div>
      </div>
      <div className="ov-nums">
        <div><b>{d.nums.active365}</b><span>активных дней за год</span></div>
        <div><b>{d.nums.perfect365}</b><span>{plural(d.nums.perfect365, 'идеальный день', 'идеальных дня', 'идеальных дней')}</span></div>
        <div><b>{d.nums.streak}</b><span>серия сейчас · рекорд {d.nums.bestStreak}</span></div>
        <div className="hot"><b>{d.nums.tiers}</b><span>ступеней достижений</span></div>
      </div>
    </section>
    <section className="wc span7">
      <div className="card-head"><h2>Календарь</h2><div className="cal-nav"><button onClick={() => shift(-1)} aria-label="Предыдущий месяц"><Icon name="chevL" /></button><b>{c.title}</b><button onClick={() => shift(1)} disabled={c.isCurrent} aria-label="Следующий месяц"><Icon name="chev" /></button></div></div>
      <MonthCal lead={c.lead} cells={c.cells} today={d.today} />
      <div className="legend"><span><i style={{ background: 'var(--mustard)' }} />идеально ★</span><span><i style={{ background: 'var(--gym)' }} />70%+</span><span><i style={{ background: 'var(--steps)' }} />40%+</span><span><i style={{ background: 'var(--text-3)' }} />начало</span><span><i className="k-gymdot" />зал</span></div>
    </section>
    <section className="wc span5">
      <div className="card-head"><h2>Как идёт {c.name}</h2></div>
      <div className="ov-big"><b>{c.avg ?? <span className="nodata">нет</span>}{c.avg !== null && c.avg !== undefined && <small>%</small>}</b><span>средняя оценка{c.prevAvg !== null ? ` · в прошлом ${c.prevAvg}%` : ''}</span></div>
      <p className="ov-motto">{c.line}</p>
      <ul className="ov-list">
        <li><span>Дней с записями</span><b>{c.days}</b></li>
        <li><span>Идеальных дней ★</span><b>{c.perfect}</b></li>
        {c.best && <li><span>Лучший день</span><b>{human(c.best.day)} · {c.best.score}%</b></li>}
        <li><span>30 дней против прошлых 30</span><b>{d.last30}% <Delta cur={d.last30} prev={d.prev30} /></b></li>
      </ul>
    </section>
    <section className="wc span12"><div className="card-head"><h2>Год по дням</h2></div><YearHeat days={d.year} /><p className="card-note">Каждая клетка — день, цвет — его оценка. Золотые — идеальные.</p></section>
    <section className="wc span6"><div className="card-head"><h2>Дни недели</h2></div>
      {wd ? <><Bars rows={wd.map((v, k) => ({ label: WDN[k]!, v, hint: `${WDN[k]}: в среднем ${v}%` }))} color="var(--navy)" max={100} values unit="%" />
        <p className="card-note">Лучше всего получается {WDL[best]}{wd[worst] && worst !== best ? `, тяжелее всего — ${WDL[worst]}` : ''}.</p></> : <p className="card-note">Нужна хотя бы неделя записей.</p>}
    </section>
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

export function Stats({ wide, tab: start, onBack }: { wide: boolean; tab?: StatsTab; onBack: () => void }) {
  const [tab, setTab] = useState<StatsTab>(start ?? 'overview'), [n, setN] = useState(30);
  useEffect(() => { if (start) setTab(start); }, [start]);
  const pick = useCallback((t: StatsTab) => { setTab(t); buzz(6); }, []);
  const sub = tab === 'overview' ? 'как ты живёшь — в цифрах' : tab === 'week' ? 'что получилось и на чём сфокусироваться' : tab === 'awards' ? '4 ступени: бронза, серебро, золото, легенда' : `последние ${n === 365 ? 'год' : `${n} дней`}`;
  return <div className="day stats-page">
    <header className="dayhead">
      {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
      <div className="daytitle"><span>{sub}</span><b>{tab === 'week' ? 'Итог недели' : tab === 'awards' ? 'Достижения' : 'Статистика'}</b></div>
    </header>
    <div className="st-bar">
      <div className="seg-tabs" role="tablist">{TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>{t}</button>)}</div>
      {(tab === 'food' || tab === 'body') && <div className="seg-tabs sm">{[7, 30, 90, 365].map(r => <button key={r} className={r === n ? 'on' : ''} onClick={() => setN(r)}>{r === 365 ? 'год' : `${r} дн`}</button>)}</div>}
    </div>
    {tab === 'overview' && <Overview />}
    {tab === 'food' && <FoodStats n={n} />}
    {tab === 'body' && <BodyStats n={n} />}
    {tab === 'week' && <Week />}
    {tab === 'awards' && <Awards />}
  </div>;
}
// цвет оценки — и для других экранов
export { scoreColor };
