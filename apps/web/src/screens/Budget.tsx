/**
 * «Бюджет» (раздел Pro) — по мотивам Budget OK: сумма на месяц делится на оставшиеся дни. Сколько можно потратить
 * сегодня, что будет завтра, остаток месяца, запись расхода и дохода по категориям, траты по дням и по категориям.
 */
import { useQuick } from '../lib/quick';
import { useCallback, useEffect, useState } from 'react';
import { addDays, CURRENCIES, MONEY_CATS, parseAmount } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { plural } from '../lib/format';
import { buzz } from '../lib/motion';
import { Bars, Donut, human } from '../components/Charts';
import { Icon } from '../components/Icon';
import { HelpButton } from '../components/HelpButton';
import { Arc } from '../components/Ring';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toasts';

const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const money = (v: number, cur: string) => `${(Math.round(v * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${cur}`;
const catOf = (kind: string, k: string) => MONEY_CATS[kind === 'in' ? 'in' : 'out'].find(c => c[0] === k) ?? ['other', 'Другое', '#A19682'];

function Setup({ s, onDone }: { s?: { amount: number; startDay: number; savings: number; currency: string }; onDone: () => void }) {
  const toast = useToast(), [v, setV] = useState({ amount: s ? String(s.amount) : '', startDay: s?.startDay ?? 1, savings: s?.savings ? String(s.savings) : '', currency: s?.currency ?? '₼' });
  return <form className="form" onSubmit={async e => {
    e.preventDefault();
    try { await api('/api/budget/settings', { method: 'PUT', body: v }); buzz([8, 30, 8]); toast('Бюджет настроен'); onDone(); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); }
  }}>
    <div className="grid2">
      <label className="fld"><span>Сумма на месяц, {v.currency}</span><input className="in big" inputMode="decimal" required placeholder="1500" value={v.amount} onChange={e => setV({ ...v, amount: e.target.value })} /></label>
      <label className="fld"><span>Отложить в копилку</span><input className="in big" inputMode="decimal" placeholder="0" value={v.savings} onChange={e => setV({ ...v, savings: e.target.value })} /></label>
    </div>
    <div className="fld"><span>Месяц начинается</span><div className="chips">{[1, 5, 10, 15, 20, 25].map(d => <button type="button" key={d} className={`chip ${v.startDay === d ? 'on' : ''}`} onClick={() => setV({ ...v, startDay: d })}>{d}-го</button>)}
      <input className="in" inputMode="numeric" style={{ width: 70, padding: '8px 10px' }} value={v.startDay} onChange={e => setV({ ...v, startDay: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} aria-label="Число" /></div></div>
    <div className="fld"><span>Валюта</span><div className="chips">{CURRENCIES.map(c => <button type="button" key={c} className={`chip ${v.currency === c ? 'on' : ''}`} onClick={() => setV({ ...v, currency: c })}>{c}</button>)}</div></div>
    <p className="card-note">Например, день зарплаты. Копилка вычитается из суммы сразу, а доходы внутри месяца к ней прибавляются.</p>
    <button className="primary">{s ? 'Сохранить' : 'Начать'}</button>
  </form>;
}

function EntryForm({ day, cur, entry, onDone }: { day: string; cur: string; entry?: any; onDone: () => void }) {
  const toast = useToast(), [kind, setKind] = useState<'out' | 'in'>(entry?.kind ?? 'out');
  const [v, setV] = useState({ amount: entry ? String(entry.amount) : '', category: entry?.category ?? 'food', note: entry?.note ?? '', time: entry?.time ?? nowHm() });
  const cats = MONEY_CATS[kind], cat = cats.some(c => c[0] === v.category) ? v.category : cats[0]![0], total = parseAmount(v.amount);
  const save = async () => {
    try { await api(entry ? `/api/budget/entries/${entry.id}` : '/api/budget/entries', { method: entry ? 'PUT' : 'POST', body: { day: entry?.day ?? day, kind, category: cat, amount: v.amount, note: v.note, time: v.time } }); buzz([8, 30, 8]); toast(`${kind === 'in' ? '+' : '−'}${money(total, cur)}${v.note ? ` · ${v.note}` : ''}`); setV({ ...v, amount: '', note: '' }); onDone(); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); }
  };
  return <form className="form m-form" onSubmit={e => { e.preventDefault(); save(); }}>
    <div className="seg2" role="tablist"><button type="button" className={kind === 'out' ? 'on' : ''} onClick={() => setKind('out')}>Расход</button><button type="button" className={kind === 'in' ? 'on' : ''} onClick={() => setKind('in')}>Доход</button></div>
    <div className={`m-amount ${kind}`}><span className="m-sign">{kind === 'in' ? '+' : '−'}</span><input inputMode="decimal" autoComplete="off" required placeholder="0" value={v.amount} onChange={e => setV({ ...v, amount: e.target.value })} aria-label="Сумма" /><span className="m-cur">{cur}</span></div>
    {v.amount.includes('+') && total > 0 && <p className="card-note">= {money(total, cur)}</p>}
    <div className="m-cats" role="radiogroup" aria-label="Категория">{cats.map(([k, n, c]) => <button type="button" key={k} role="radio" aria-checked={cat === k} className={`m-cat ${cat === k ? 'on' : ''}`} style={{ ['--dot' as string]: c }} onClick={() => setV({ ...v, category: k })}><i />{n}</button>)}</div>
    <div className="grid2"><input className="in" maxLength={80} placeholder="Заметка: что купил, где" value={v.note} onChange={e => setV({ ...v, note: e.target.value })} /><input className="in" type="time" value={v.time} onChange={e => setV({ ...v, time: e.target.value })} aria-label="Время" /></div>
    <button className={`primary ${kind === 'in' ? 'in' : ''}`}><Icon name="plus" />{entry ? 'Сохранить' : kind === 'in' ? 'Добавить доход' : 'Добавить расход'}</button>
  </form>;
}

export function Budget({ wide, version, onBack, onChanged, quick }: { wide: boolean; version: number; onBack: () => void; onChanged: () => void; quick?: number }) {
  const toast = useToast(), [day, setDay] = useState<string | null>(null), [o, setO] = useState<any>(null), [sheet, setSheet] = useState<null | 'settings' | { entry: any }>(null);
  const load = useCallback(async () => { try { setO(await api<any>(`/api/budget/overview${day ? `?day=${day}` : ''}`)); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось загрузить', { err: true }); } }, [day, toast]);
  useEffect(() => { load(); }, [load, version]);
  useQuick(quick, !!o, () => { const i = document.querySelector<HTMLInputElement>('.screen[data-pos="center"] .m-amount input'); i?.scrollIntoView({ block: 'center', behavior: 'smooth' }); i?.focus({ preventScroll: true }); });
  const done = () => { setSheet(null); load(); onChanged(); };
  const remove = async (e: any) => { try { await api(`/api/budget/entries/${e.id}`, { method: 'DELETE' }); toast('Запись удалена'); done(); } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } };

  const head = <header className="dayhead">
    {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
    <div className="daytitle"><span>{o?.configured ? `${human(o.from)} — ${human(o.to)}` : 'сколько можно потратить сегодня'}</span><b>Бюджет</b></div>
    {o?.configured && <button className="nav" data-tour="bud-edit" onClick={() => setSheet('settings')} aria-label="Настроить" title="Настроить"><Icon name="edit" /></button>}
    <HelpButton tour="budget" />
  </header>;
  if (!o) return <div className="day budget-page">{head}<div className="skel" style={{ height: 200 }} /><div className="skel" style={{ height: 300 }} /></div>;
  if (!o.configured) return <div className="day budget-page">{head}<section className="wc" data-tour="bud-setup"><div className="card-head"><h2>Сколько у тебя на месяц?</h2></div>
    <p className="card-note">Журнал разделит сумму на дни и каждый день будет показывать, сколько можно потратить. Потратил меньше — остаток перейдёт на следующие дни, перерасход — завтрашний лимит станет меньше.</p><Setup onDone={done} /></section></div>;

  const cur = o.settings.currency, d = o.day, isToday = d === o.now, over = o.leftToday < 0, k = o.allow ? Math.min(1, o.today / o.allow) : o.today ? 1 : 0;
  return <div className="day budget-page">
    {head}
    <div className="bud-nav"><div className="datenav">
      <button onClick={() => setDay(addDays(d, -1))} aria-label="Предыдущий день"><Icon name="chevL" /></button>
      <button className={`cur ${isToday ? '' : 'not-today'}`} onClick={() => setDay(null)}>{isToday ? 'сегодня' : human(d)}</button>
      <button onClick={() => setDay(addDays(d, 1))} aria-label="Следующий день"><Icon name="chev" /></button></div></div>
    <div className="wgrid">
      <section className={`wc span12 bud-hero ${over ? 'over' : ''}`} data-tour="bud-hero">
        <span className="meter bud-ring"><Arc size={150} sw={14} color={over ? 'var(--bad)' : 'var(--money)'} p={k} /><em>{Math.round(k * 100)}%<small>потрачено</small></em></span>
        <div className="bud-main">
          <span className="ov-k">{over ? 'Перерасход' : isToday ? 'Сегодня можно потратить' : d > o.now ? 'В этот день можно будет' : 'В этот день оставалось'}</span>
          <b className="bud-v">{over ? '−' : ''}{money(Math.abs(o.leftToday), cur)}</b>
          <span className="bud-s">лимит дня {money(o.allow, cur)} · потрачено {money(o.today, cur)}</span>
          <span className="bud-tip">{o.tomorrow !== null ? (over ? `Завтра на день будет ${money(o.tomorrow, cur)}` : o.tomorrow > o.allow + 0.005 ? `Если больше не тратить — завтра ${money(o.tomorrow, cur)}` : `Завтра — ${money(o.tomorrow, cur)}`) : 'Последний день периода'}</span>
        </div>
        <div className="bud-side">
          <div><span>Осталось в месяце</span><b className={o.leftPeriod < 0 ? 'neg' : ''}>{money(o.leftPeriod, cur)}</b><small>из {money(o.total, cur)}</small></div>
          <div><span>До {human(addDays(o.to, 1))}</span><b>{o.daysLeft} {plural(o.daysLeft, 'день', 'дня', 'дней')}</b><small>{human(o.from)} — {human(o.to)}</small></div>
        </div>
      </section>
      <section className="wc span5" data-tour="bud-add"><div className="card-head"><h2>Записать</h2></div><EntryForm day={d} cur={cur} onDone={done} /></section>
      <section className="wc span7" data-tour="bud-list"><div className="card-head"><h2>{isToday ? 'Сегодня' : human(d)}</h2>{o.ops.length > 0 && <span className="count">{o.ops.length} {plural(o.ops.length, 'запись', 'записи', 'записей')}</span>}</div>
        {o.ops.length ? <ul className="m-list">{o.ops.map((x: any) => { const [, n, c] = catOf(x.kind, x.category); return <li key={x.id} className="m-row">
          <i className="m-dot" style={{ background: c }} /><button className="m-txt" onClick={() => setSheet({ entry: x })}><b>{x.note || n}</b><span>{x.note ? n : ''}{x.note && x.time ? ' · ' : ''}{x.time ?? ''}</span></button>
          <b className={`m-sum ${x.kind === 'in' ? 'in' : ''}`}>{x.kind === 'in' ? '+' : '−'}{money(x.amount, cur)}</b>
          <button className="ico" onClick={() => setSheet({ entry: x })} aria-label="Изменить"><Icon name="edit" /></button><button className="ico del" onClick={() => remove(x)} aria-label="Удалить">×</button></li>; })}</ul>
          : <p className="card-note">{isToday ? 'Сегодня трат ещё нет.' : 'В этот день записей нет.'}</p>}
      </section>
      <section className="wc span7"><div className="card-head"><h2>По дням</h2></div>
        <Bars rows={o.days.map((x: any) => ({ label: String(+x.day.slice(8, 10)), v: x.spent, hint: `${human(x.day)}: ${money(x.spent, cur)}`, color: x.spent > o.base * 1.5 ? 'var(--bad)' : null }))} color="var(--money)" target={o.base} unit={cur} every={5} />
        <p className="card-note">Линия — ровный лимит {money(o.base, cur)} в день. В среднем тратишь {money(o.avgPerDay, cur)} в день.</p></section>
      <section className="wc span5" data-tour="bud-cats"><div className="card-head"><h2>Куда уходят деньги</h2></div>
        {o.byCat.length ? <div className="macro-wrap"><Donut parts={o.byCat.map((x: any) => ({ name: x.name, v: x.sum, color: x.color }))} center={<><b>{money(o.spent, cur)}</b><small>за месяц</small></>} />
          <ul className="macro-list">{o.byCat.map((x: any) => <li key={x.key}><i style={{ background: x.color }} /><span>{x.name}</span><b>{money(x.sum, cur)}</b><em>{Math.round(x.sum / o.spent * 100)}%</em></li>)}</ul></div>
          : <p className="card-note">Траты за месяц появятся здесь.</p>}</section>
    </div>
    <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet === 'settings' ? 'Настройки бюджета' : 'Запись'}>
      {sheet === 'settings' && <Setup s={o.settings} onDone={done} />}
      {sheet && sheet !== 'settings' && <EntryForm day={sheet.entry.day} cur={cur} entry={sheet.entry} onDone={done} />}
    </Sheet>
  </div>;
}
