/**
 * «Еда» — как в веб-версии журнала. День: цветные кнопки записи, кольцо дня с полосками Б/Ж/У и воды, записи по приёмам
 * пищи (правка, удаление с «Вернуть»), напитки, «чем закрыть норму». Анализ (Pro): календарь питания, клетчатка/сахар/соль,
 * вода и кофеин, баланс БЖУ против AMDR, когда ешь за 7 дней, отчёт за неделю. День листается стрелками.
 */
import { can } from '../lib/features';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, parseDay } from '@bortjournal/core';
import { api, ApiError, type Drink, type FoodDay, type Meal, type Subscription } from '../lib/api';
import { fmt, fmt1, plural, WDF } from '../lib/format';
import { judge, judgeCaf, judgeNut, judgeWater, type Verdict } from '../lib/judge';
import { buzz, useCountUp, useNextFrame } from '../lib/motion';
import { Donut, HBars, human } from '../components/Charts';
import { Icon } from '../components/Icon';
import { HelpButton } from '../components/HelpButton';
import { Arc } from '../components/Ring';
import { useToast } from '../components/Toasts';

const SLOTS: Array<[string, string]> = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин'], ['snack', 'Перекусы']];
// завтрак 5–11, обед 11–16, ужин 18–22, остальное — перекус (как в старом журнале)
const slotOf = (m: { slot: string | null; time: string | null }) => {
  if (m.slot && SLOTS.some(s => s[0] === m.slot)) return m.slot;
  const t = m.time ? +m.time.slice(0, 2) * 60 + +m.time.slice(3) : null;
  return t === null ? 'snack' : t >= 300 && t < 660 ? 'breakfast' : t >= 660 && t < 960 ? 'lunch' : t >= 1080 && t < 1320 ? 'dinner' : 'snack';
};
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MN = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export const Chip = ({ v }: { v: Verdict }) => <span className={`st st-${v.lvl}`}><i aria-hidden="true">{v.icon}</i>{v.text}</span>;
function Meter({ v, max, color, size = 132, sw = 12 }: { v: number; max: number; color: string; size?: number; sw?: number }) {
  return <span className="meter" style={{ width: size, height: size }}><Arc size={size} sw={sw} color={color} p={max ? v / max : 0} /><em>{max ? Math.round(v / max * 100) : 0}%<small>нормы</small></em></span>;
}
function SBar({ name, v, norm, unit, color, f = fmt }: { name: string; v: number; norm: number; unit: string; color: string; f?: (n: number) => string }) {
  const r = norm ? v / norm : 0, over = r > 1.03, w = useNextFrame(Math.min(100, r * 100), 0);
  return <div className="sb"><div className="sb-top"><span className="sb-name"><i style={{ background: color }} />{name}</span><span className="sb-val"><b>{f(v)}</b>{norm ? <> / {f(norm)}</> : null} {unit}{over && <em> ▲ +{f(v - norm)}</em>}</span></div>
    <div className="sb-track"><i style={{ width: `${w}%`, background: over ? `color-mix(in srgb, ${color} 62%, #000)` : color }} /></div></div>;
}

/* ---------------- день ---------------- */
function DayView({ day, today, sub, version, onAddMeal, onAddDrink, onMeal, onDrink, onPro, onAnalysis, onChanged }: {
  day: string; today: string; sub: Subscription; version: number;
  onAddMeal: () => void; onAddDrink: () => void; onMeal: (m: Meal) => void; onDrink: (d: Drink) => void; onPro: (what: string) => void; onAnalysis: () => void; onChanged: () => void;
}) {
  const toast = useToast(), [d, setD] = useState<FoodDay | null>(null), [norm, setNorm] = useState<any>(null), [gap, setGap] = useState<any>(null), [more, setMore] = useState(false);
  const hidden = useRef(new Set<string>()), [, force] = useState(0);
  const shownKcal = useCountUp(d?.totals.kcal ?? 0);
  const load = useCallback(async () => {
    try {
      const [f, t] = await Promise.all([api<FoodDay>(`/api/food/day?day=${day}`), api<any>(`/api/today?day=${day}`)]);
      setD(f); setNorm(t.parts.food?.norm ?? null);
      if (can(sub, 'food') && day === today) api<any>(`/api/food/analysis?day=${day}`).then(a => setGap(a.gap), () => setGap(null)); else setGap(null);
    } catch { /* сеть — оставим прошлое */ }
  }, [day, today, sub]);
  useEffect(() => { load(); }, [load, version]);
  const live = day === today;
  if (!d || !norm) return <div className="wgrid"><div className="skel span12" style={{ height: 90 }} /><div className="skel span12" style={{ height: 260 }} /><div className="skel span12" style={{ height: 240 }} /></div>;

  // удаление: сразу с экрана, на сервер — через 5 секунд, если не вернули
  const remove = (id: string, title: string) => {
    hidden.current.add(id); force(x => x + 1); buzz(14);
    const tm = setTimeout(async () => { try { await api(`/api/food/entries/${id}`, { method: 'DELETE' }); onChanged(); await load(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось удалить', { err: true }); } finally { hidden.current.delete(id); force(x => x + 1); } }, 5000);
    toast(`«${title}» удалено`, { undo: () => { clearTimeout(tm); hidden.current.delete(id); force(x => x + 1); } });
  };
  const water = async (ml: number) => {
    buzz([8, 40, 8]);
    try { await api('/api/food/drinks', { method: 'POST', body: { day, time: live ? undefined : '12:00', type: 'water', ml } }); toast(`+${ml} мл воды`); onChanged(); load(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); }
  };
  const addCombo = async (items: Array<{ name: string; kcal: number; protein: number; fat: number; carbs: number }>) => {
    try { await api('/api/food/meals/batch', { method: 'POST', body: { day, items } }); buzz([8, 30, 8]); toast(`Записано: ${items.map(i => i.name).join(' + ')}`); onChanged(); load(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); }
  };

  const meals = d.meals.filter(m => !hidden.current.has(m.id)), drinks = d.drinks.filter(x => !hidden.current.has(x.id));
  const t = d.totals, st = judge('kcal', t.kcal, norm.kcal, live);
  const tile = (cls: string, ic: string, title: string, sub2: string, on: () => void, lock = false) => <button className={`add-tile ${cls}`} onClick={on}><span className="at-ic"><Icon name={ic} /></span><span className="mid"><b>{title}</b><small>{sub2}</small></span>{lock && <span className="lock">PRO</span>}</button>;
  return <div className="wgrid">
    <div className="add-tiles span12" data-tour="food-add">
      {tile('t-photo', 'camera', 'Фото еды', 'ИИ разберёт тарелку и посчитает', () => onPro('Фото и описание еды'), !can(sub, 'food'))}
      {tile('t-text', 'edit', 'Описать текстом', '«гречка 200 г, грудка» — ИИ посчитает', () => onPro('Описание еды'), !can(sub, 'food'))}
      {tile('t-search', 'search', 'Найти в справочнике', 'КБЖУ на 100 г и твои блюда', () => onPro('Поиск по базе продуктов'), !can(sub, 'food'))}
      {tile('t-manual', 'plus', 'Вручную', 'название и калории, БЖУ по желанию', onAddMeal)}
      {tile('t-drink', 'drop', 'Вода и напитки', 'вода, чай, кофе, сок — по мл', onAddDrink)}
    </div>
    <section className="wc span12" data-tour="food-sum">
      <div className="card-head"><h2>{live ? 'Сегодня' : human(day)}</h2></div>
      <div className="summary">
        <div className="summary-ring"><Meter v={t.kcal} max={norm.kcal} color="var(--c-kcal)" size={150} sw={13} />
          <div className="summary-k"><b>{fmt(shownKcal)}</b> / {fmt(norm.kcal)} ккал</div><Chip v={st} />
          {!!t.draft?.kcal && <small className="summary-draft">в т. ч. {fmt(t.draft.kcal)} ккал по фото — ждут подтверждения</small>}</div>
        <div className="summary-bars">
          <SBar name="Белки" v={t.protein} norm={norm.protein} unit="г" color="var(--c-prot)" />
          <SBar name="Жиры" v={t.fat} norm={norm.fat} unit="г" color="var(--c-fat)" />
          <SBar name="Углеводы" v={t.carbs} norm={norm.carbs} unit="г" color="var(--c-carb)" />
          <SBar name="Вода" v={t.waterMl / 1000} norm={norm.water / 1000} unit="л" color="var(--c-water)" f={fmt1} />
          <button className="link-btn" onClick={onAnalysis}>Подробнее: клетчатка, сахар, соль, кофеин, баланс БЖУ ›{!can(sub, 'food') && <span className="lock">PRO</span>}</button>
        </div>
      </div>
    </section>
    <section className="wc span12" data-tour="food-list">
      <div className="card-head"><h2>{live ? 'Записи за сегодня' : `Записи за ${human(day)}`}</h2></div>
      {SLOTS.map(([k, name]) => { const items = meals.filter(m => slotOf(m) === k); if (!items.length) return null; return <div className="slot" key={k}>
        <div className="slot-head"><b>{name}</b><span className="slot-kcal">{fmt(items.reduce((a, m) => a + m.kcal, 0))} ккал</span></div>
        <div className="list">{items.map(m => <div className="item" key={m.id}>
          <span className="item-time">{m.time ?? ''}</span>
          <button className="item-main" onClick={() => onMeal(m)}><b>{m.name}</b><small>Б {fmt1(m.protein)} · Ж {fmt1(m.fat)} · У {fmt1(m.carbs)}{m.source === 'photo' ? ' · по фото' : m.source === 'text' ? ' · по описанию' : ''}</small></button>
          <span className="item-k"><b>{fmt(m.kcal)}</b><small>ккал</small></span>
          <button className="ico" onClick={() => onMeal(m)} aria-label="Изменить"><Icon name="edit" /></button>
          <button className="ico del" onClick={() => remove(m.id, m.name)} aria-label="Удалить">×</button>
        </div>)}</div>
      </div>; })}
      {!meals.length && <p className="card-note">{live ? 'Еды сегодня ещё нет. Сфотографируй, опиши текстом или запиши вручную — кнопки выше.' : 'Еды за этот день нет.'}</p>}
      <div className="slot slot-drinks">
        <div className="slot-head"><b>Напитки</b>{drinks.length > 0 && <span className="slot-kcal">{fmt1(t.waterMl / 1000)} л воды{drinks.some(x => x.kcal) ? ` · ${fmt(drinks.reduce((a, x) => a + x.kcal, 0))} ккал` : ''}</span>}
          <span className="slot-quick" data-tour="food-water"><button className="slot-btn" onClick={() => water(250)}><Icon name="plus" />Вода 250</button><button className="slot-btn" onClick={() => water(500)}><Icon name="plus" />500</button></span></div>
        {drinks.length > 0 && <div className="drinks-list">{drinks.map(x => <span className="drink-chip" key={x.id}><i />{x.time && <em>{x.time}</em>}<button onClick={() => onDrink(x)}><b>{x.title}</b> {fmt(x.ml)} мл</button><button className="ico del" onClick={() => remove(x.id, x.title)} aria-label="Удалить">×</button></span>)}</div>}
      </div>
    </section>
    {gap && <section className="wc span12 gap-card">
      <div className="card-head"><h2>Чем закрыть норму</h2></div>
      <p className="gap-head">{gap.remKcal <= 50 ? <>{gap.remKcal < -50 ? `Калории уже выше нормы на ${fmt(-gap.remKcal)}.` : 'Калории на сегодня закрыты.'} {gap.remProtein > 10 ? `Белка не хватает ${fmt(gap.remProtein)} г.` : 'Белок тоже в порядке.'}</>
        : <>Осталось <b>{fmt(gap.remKcal)} ккал</b>{gap.remProtein > 0 ? <> и <b>{fmt(gap.remProtein)} г белка</b></> : ', белок закрыт'}.</>}</p>
      {gap.options.length ? gap.options.slice(0, more ? 3 : 1).map((o: any) => <div className="gap-opt" key={o.items.map((i: any) => i.name).join('+')}>
        <div className="mid"><b>{o.items.map((i: any) => i.name).join(' + ')}</b><span>{fmt(o.kcal)} ккал · белок {fmt1(o.protein)} г{o.mine ? ' · из твоего' : ''}</span>
          <small>{gap.remKcal <= 50 ? 'самый лёгкий способ добрать белок' : `${gap.remProtein > 8 ? (o.protein >= gap.remProtein * 0.9 ? 'белок закрыт' : `белка останется ${fmt(gap.remProtein - o.protein)} г`) : 'по калориям'}, ${o.kcal <= gap.remKcal ? `останется ${fmt(gap.remKcal - o.kcal)} ккал` : `перебор ${fmt(o.kcal - gap.remKcal)} ккал`}`}</small></div>
        <button className="btn-accent" onClick={() => addCombo(o.items)}><Icon name="plus" />Записать</button></div>) : <p className="card-note">{gap.remKcal <= 50 ? 'Дальше — вода, чай, овощи без масла.' : 'Подходящих вариантов не нашлось — запиши побольше своей еды, и подсказки станут точнее.'}</p>}
      {gap.options.length > 1 && <button className="link-btn" onClick={() => setMore(x => !x)}>{more ? 'Скрыть варианты' : `Ещё ${gap.options.length - 1} ${plural(gap.options.length - 1, 'вариант', 'варианта', 'вариантов')} ›`}</button>}
    </section>}
  </div>;
}

/* ---------------- анализ ---------------- */
function Analysis({ day, setDay, version }: { day: string; setDay: (d: string) => void; version: number }) {
  const [month, setMonth] = useState<string | null>(null), [a, setA] = useState<any>(null), [err, setErr] = useState('');
  useEffect(() => { setErr(''); api<any>(`/api/food/analysis?day=${day}${month ? `&month=${month}` : ''}`).then(setA, e => setErr(e instanceof ApiError ? e.message : 'Не получилось загрузить')); }, [day, month, version]);
  if (err) return <p className="form-err">{err}</p>;
  if (!a) return <div className="wgrid"><div className="skel span5" style={{ height: 420 }} /><div className="skel span7" style={{ height: 420 }} /></div>;
  const c = a.calendar, t = a.totals, N = a.norms, nn = a.nutNorms, live = a.live;
  const [y, m] = c.month.split('-').map(Number), shift = (k: number) => { const x = new Date(Date.UTC(y, m - 1 + k, 1)); setMonth(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`); };
  const nut: Array<['fiber' | 'sugar' | 'salt', string, string, string]> = [['fiber', 'Клетчатка', 'var(--c-fiber)', 'не меньше'], ['sugar', 'Сахар', 'var(--c-sugar)', 'до'], ['salt', 'Соль', 'var(--c-salt)', 'до']];
  const SPLIT: Record<string, [string, string]> = { protein: ['Белки', 'var(--c-prot)'], fat: ['Жиры', 'var(--c-fat)'], carbs: ['Углеводы', 'var(--c-carb)'] };
  const TIME_C = ['#F2B48C', '#E3874F', '#B9531F', '#7A2A17'];
  return <div className="wgrid">
    <section className="wc span5">
      <div className="card-head"><h2>Календарь питания</h2><div className="cal-nav"><button onClick={() => shift(-1)} aria-label="Предыдущий месяц"><Icon name="chevL" /></button><b>{MN[m - 1]} {y}</b><button onClick={() => shift(1)} disabled={c.isCurrent} aria-label="Следующий месяц"><Icon name="chev" /></button></div></div>
      <div className="fcal">{['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(w => <span key={w} className="fcal-wd">{w}</span>)}
        {Array.from({ length: c.lead }, (_, k) => <span key={`p${k}`} />)}
        {c.cells.map((x: any) => { const tip = x.kcal ? `${human(x.day)}: ${fmt(x.kcal)} из ${fmt(N.kcal)} ккал, белок ${x.protein} из ${N.protein} г` : `${human(x.day)}: нет записей`;
          return <button key={x.day} className={`fcal-c lv-${x.level} ${x.live ? 'today' : ''} ${x.day === day ? 'sel' : ''}`} disabled={x.fut} title={tip} aria-label={tip} onClick={() => { setDay(x.day); buzz(6); }}>
            <span>{+x.day.slice(8, 10)}</span>{x.level !== 'none' && <i className="fcal-ic">{x.level === 'good' ? '✓' : x.level === 'low' ? '▼' : '▲'}</i>}{x.proteinOk && <i className="fcal-p" />}</button>; })}
      </div>
      <p className="wk-sum">{c.logged ? <>В норме <b>{c.good} из {c.logged}</b> {plural(c.logged, 'дня', 'дней', 'дней')} с записями · белок закрыт <b>{c.protein}</b></> : 'В этом месяце завершённых дней с записями нет.'}</p>
      <div className="legend"><span><i style={{ background: 'var(--st-good)' }} />в норме</span><span><i style={{ background: 'var(--st-warn)' }} />мимо нормы</span><span><i style={{ background: 'var(--st-bad)' }} />перебор</span><span><i className="k-prot" />белок закрыт</span></div>
    </section>
    <section className="wc span7">
      <div className="card-head"><h2>Клетчатка, сахар, соль, вода · {live ? 'сегодня' : human(day)}</h2></div>
      {t.nut ? <><div className="meters">{nut.map(([k, name, color, pre]) => <div className="meter-cell" key={k}><Meter v={t[k]} max={nn[k]} color={color} size={96} sw={10} />
        <div className="meter-name"><i style={{ background: color }} />{name}</div><div className="meter-val"><b>{fmt1(t[k])}</b> г · {pre} {nn[k]} г</div><Chip v={judgeNut(k, t[k], nn[k], live)} /></div>)}</div>
        <p className="card-note">{t.nut < t.entries ? `Посчитано по ${t.nut} из ${t.entries} записей — у записанных вручную без этих полей данных нет. ` : ''}Нормы: клетчатка — EFSA, сахар — ВОЗ (до 10% калорий, сахара всего), соль — ВОЗ до 5 г.</p></>
        : <p className="card-note dashed">Клетчатка, сахар и соль считаются там, где они известны: еда по фото или тексту и напитки. Пока таких записей за день нет.</p>}
      <div className="meters m2">
        <div className="meter-cell"><Meter v={t.waterMl} max={N.water} color="var(--c-water)" size={96} sw={10} /><div className="meter-name"><i style={{ background: 'var(--c-water)' }} />Вода</div><div className="meter-val"><b>{fmt1(t.waterMl / 1000)}</b> / {fmt1(N.water / 1000)} л</div><Chip v={judgeWater(t.waterMl, N.water, live)} /></div>
        <div className="meter-cell"><Meter v={t.caffeine} max={a.cafMax} color="var(--c-caf)" size={96} sw={10} /><div className="meter-name"><i style={{ background: 'var(--c-caf)' }} />Кофеин</div><div className="meter-val"><b>{fmt(t.caffeine)}</b> / {a.cafMax} мг</div><Chip v={judgeCaf(t.caffeine, a.cafMax)} /></div>
      </div>
      <p className="card-note">Вода — по рекомендации EFSA (≈2 л напитков в день, плюс добавка за тренировки). Чай и кофе засчитываются, пиво — нет. Кофеин — до {a.cafMax} мг в день.</p>
    </section>
    <section className="wc span6">
      <div className="card-head"><h2>Баланс БЖУ · {live ? 'сегодня' : human(day)}</h2></div>
      {a.split ? <div className="split">
        <Donut parts={a.split.map((s: any) => ({ name: SPLIT[s.key]![0], v: s.kcal, color: SPLIT[s.key]![1] }))} size={168} center={<><b>{fmt(a.split.reduce((x: number, s: any) => x + s.kcal, 0))}</b><small>ккал из БЖУ</small></>} />
        <div className="split-rows">{a.split.map((s: any) => { const [lo, hi] = s.range, v: Verdict = s.pct < lo ? { lvl: 'low', icon: '▼', text: `ниже нормы ${lo}–${hi}%` } : s.pct > hi ? { lvl: 'warn', icon: '▲', text: `выше нормы ${lo}–${hi}%` } : { lvl: 'good', icon: '✓', text: `норма ${lo}–${hi}%` };
          return <div className="split-row" key={s.key}><span className="split-name"><i style={{ background: SPLIT[s.key]![1] }} />{SPLIT[s.key]![0]}</span>
            <span className="split-bar"><span className="split-band" style={{ left: `${lo}%`, width: `${hi - lo}%` }} /><span className="split-mark" style={{ left: `${Math.min(100, s.pct)}%`, background: SPLIT[s.key]![1] }} /></span><b className="split-pct">{s.pct}%</b><Chip v={v} /></div>; })}
          <p className="card-note">Полоса — здоровый диапазон доли калорий (AMDR), точка — твой день.</p>
          {a.goal === 'lose' && a.split[0].pct > 25 && <p className="card-note">На похудении белка больше обычного — это нормально: он сохраняет мышцы. Углеводы при этом могут быть ниже 45%.</p>}
        </div></div> : <p className="card-note">Запиши еду с БЖУ — и здесь появится баланс.</p>}
    </section>
    <section className="wc span6">
      <div className="card-head"><h2>Когда ешь · 7 дней</h2></div>
      {a.timing ? <div className="split">
        <Donut parts={a.timing.slots.map((s: any, i: number) => ({ name: s.name, v: s.pct, color: TIME_C[i]! }))} size={168} center={<><b>{a.timing.days} {plural(a.timing.days, 'день', 'дня', 'дней')}</b><small>с записями</small></>} />
        <div className="split-rows">{a.timing.slots.map((s: any, i: number) => <div className="split-row slim" key={s.key}><span className="split-name"><i style={{ background: TIME_C[i] }} />{s.name} <small>{s.hint}</small></span><b className="split-pct">{s.pct}%</b><span className="muted">{fmt(s.perDay)} ккал/день</span></div>)}
          <p className="card-note">По времени из записей. «ккал/день» — в среднем за {a.timing.days} {plural(a.timing.days, 'день', 'дня', 'дней')} с записями из последних 7.</p>
          {a.timing.days >= 3 && <Chip v={a.timing.late > 0.25 ? { lvl: 'warn', icon: '▲', text: `Поздно съедается ${Math.round(a.timing.late * 100)}% калорий — это мешает сну и чаще ведёт к перееданию` } : { lvl: 'good', icon: '✓', text: 'Поздних калорий немного' }} />}
        </div></div> : <p className="card-note">Здесь будет видно, в какое время ты съедаешь больше всего. Время берётся из записей еды.</p>}
    </section>
    <section className="wc span12">
      <div className="card-head"><h2>Отчёт за неделю</h2></div>
      {a.report ? <>
        <div className="report-kpis">
          <div><b>{fmt(a.report.avgKcal)}</b><span>ккал в среднем<br />норма {fmt(N.kcal)}</span></div>
          <div><b>{fmt(a.report.avgProtein)} г</b><span>белка в среднем<br />норма {N.protein} г</span></div>
          <div><b>{a.report.ok} из {a.report.days}</b><span>дней в норме<br />по калориям</span></div>
          <div><b>{a.report.okP} из {a.report.days}</b><span>дней белок<br />закрыт</span></div>
        </div>
        <div className="report-cols">
          <div><h3 className="sub-h">Главные источники калорий</h3><HBars rows={a.report.top.map((x: any) => ({ label: x.name, v: x.pct, text: `${x.pct}%` }))} color="var(--c-kcal)" /></div>
          <div><h3 className="sub-h">Что видно</h3><ul className="goal-lines">{a.report.notes.map((n: string) => <li key={n}>{n}</li>)}
            {a.report.best && <li>Ближе всего к норме — {human(a.report.best.best.day)} ({fmt(a.report.best.best.kcal)} ккал), больше всего — {human(a.report.best.worst.day)} ({fmt(a.report.best.worst.kcal)} ккал).</li>}</ul></div>
        </div>
        <p className="card-note">За {a.report.days} {plural(a.report.days, 'день', 'дня', 'дней')} с записями из последних 7 (без сегодняшнего).</p>
      </> : <p className="card-note">Отчёт появится, когда за последнюю неделю будет хотя бы 2 дня с записями.</p>}
    </section>
  </div>;
}

export function Food({ today, sub, version, wide, onAddMeal, onAddDrink, onMeal, onDrink, onPro, onChanged }: {
  today: string; sub: Subscription; version: number; wide: boolean;
  onAddMeal: (day: string) => void; onAddDrink: (day: string) => void; onMeal: (m: Meal) => void; onDrink: (d: Drink) => void; onPro: (what: string, day?: string) => void; onChanged: () => void;
}) {
  const [day, setDay] = useState(today), [tab, setTab] = useState<'day' | 'analysis'>('day');
  useEffect(() => { setDay(today); }, [today]);
  const dt = parseDay(day), off = Math.round((dt.getTime() - parseDay(today).getTime()) / 864e5);
  const rel = off === 0 ? 'сегодня' : off === -1 ? 'вчера' : off === 1 ? 'завтра' : '';
  const toAnalysis = () => { if (!can(sub, 'food')) { onPro('Анализ еды'); return; } setTab('analysis'); buzz(6); };
  return <div className={`day food-page2 ${wide ? '' : 'narrow'}`}>
    <header className="fp-top">
      <div className="daytitle"><span className={off ? 'past' : ''}>{rel ? `${rel}, ` : ''}{dt.getUTCDate()} {MON[dt.getUTCMonth()]} · {WDF[dt.getUTCDay()]}</span><b>Еда</b></div>
      <HelpButton tour="food" />
      <div className="fp-ctrl">
        <div className="seg-tabs" role="tablist" data-tour="food-tabs"><button role="tab" aria-selected={tab === 'day'} className={tab === 'day' ? 'on' : ''} onClick={() => setTab('day')}>День</button><button role="tab" aria-selected={tab === 'analysis'} className={tab === 'analysis' ? 'on' : ''} onClick={toAnalysis}>Анализ{!can(sub, 'food') && <span className="lock">PRO</span>}</button></div>
        <div className="datenav" data-tour="food-date">
          <button onClick={() => setDay(addDays(day, -1))} aria-label="Предыдущий день"><Icon name="chevL" /></button>
          <button className={`cur ${off ? 'not-today' : ''}`} onClick={() => setDay(today)}>{rel || human(day)}{rel && wide ? ` · ${human(day)}` : ''}</button>
          <button onClick={() => setDay(addDays(day, 1))} disabled={day >= addDays(today, 7)} aria-label="Следующий день"><Icon name="chev" /></button>
        </div>
      </div>
    </header>
    {tab === 'day' ? <DayView day={day} today={today} sub={sub} version={version} onAddMeal={() => onAddMeal(day)} onAddDrink={() => onAddDrink(day)} onMeal={onMeal} onDrink={onDrink} onPro={w => onPro(w, day)} onAnalysis={toAnalysis} onChanged={onChanged} />
      : <Analysis day={day} setDay={setDay} version={version} />}
  </div>;
}
