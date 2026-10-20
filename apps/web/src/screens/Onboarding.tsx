/**
 * Анкета первого запуска: 5 коротких шагов → план калорий и БЖУ по формулам журнала.
 * Шаги сменяются сдвигом; итог считает сервер (те же формулы, что видит «Цель»).
 */
import { useState } from 'react';
import { ACTIVITY, GOALS, PACE, TRIAL_DAYS, computePlan, type ActivityLevel, type Goal, type Pace } from '@bortjournal/core';
import { api, ApiError, type PlanResult } from '../lib/api';
import { fmt, fmt1 } from '../lib/format';
import { buzz } from '../lib/motion';
import { useToast } from '../components/Toasts';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [res, setRes] = useState<PlanResult | null>(null);
  const [v, setV] = useState({ name: '', sex: '' as '' | 'm' | 'f', age: '', height: '', weight: '', activity: 'sed' as ActivityLevel, steps: '6000', goal: 'lose' as Goal, pace: 'mid' as Pace, target: '' });
  const set = (k: keyof typeof v) => (x: string) => setV(s => ({ ...s, [k]: x }));
  // телефон в русской раскладке ставит запятую: «85,5»
  const num = (x: string) => Number(x.replace(',', '.').trim()) || 0, W = num(v.weight);
  const ok = [!!v.sex && +v.age >= 14 && +v.age <= 100, num(v.height) >= 120 && num(v.height) <= 230 && W >= 30 && W <= 300, true, true, true][step];
  // предпросмотр плана прямо в анкете — та же формула, что посчитает сервер
  const preview = v.sex && num(v.age) && num(v.height) && W ? computePlan({ sex: v.sex, age: num(v.age), height: num(v.height), goal: v.goal, pace: v.pace, steps: +v.steps }, W, v.activity, +v.steps) : null;
  const next = async () => {
    buzz(6);
    if (step < 3) { setStep(step + 1); return; }
    setBusy(true);
    try { const r = await api<{ plan: PlanResult }>('/api/profile/onboarding', { method: 'POST', body: { ...v, weight: String(W), target: v.goal === 'maintain' ? null : v.target ? String(num(v.target)) : null } }); setRes(r.plan); setStep(4); buzz([10, 40, 10]); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось посчитать', { err: true }); }
    finally { setBusy(false); }
  };
  const Opt = ({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub?: string }) => <button type="button" className={`ob-opt ${on ? 'on' : ''}`} onClick={() => { onClick(); buzz(6); }}><b>{title}</b>{sub && <small>{sub}</small>}</button>;

  return <main className="ob">
    <div className="ob-dots" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
    <div className="ob-step" key={step}>
      {step === 0 && <>
        <h1>Давай познакомимся</h1><p>По этим данным журнал посчитает норму калорий, белка и воды.</p>
        <input className="in" placeholder="Как тебя зовут (по желанию)" value={v.name} onChange={e => set('name')(e.target.value)} />
        <div className="ob-row"><Opt on={v.sex === 'm'} onClick={() => set('sex')('m')} title="Мужчина" /><Opt on={v.sex === 'f'} onClick={() => set('sex')('f')} title="Женщина" /></div>
        <label className="fld"><span>Возраст</span><input className="in big" inputMode="numeric" value={v.age} onChange={e => set('age')(e.target.value)} placeholder="30" /></label>
      </>}
      {step === 1 && <>
        <h1>Рост и вес</h1><p>Вес сегодня — от него журнал покажет реальный темп.</p>
        <div className="grid2">
          <label className="fld"><span>Рост, см</span><input className="in big" inputMode="numeric" value={v.height} onChange={e => set('height')(e.target.value)} placeholder="175" /></label>
          <label className="fld"><span>Вес, кг</span><input className="in big" inputMode="decimal" value={v.weight} onChange={e => set('weight')(e.target.value)} placeholder="75" /></label>
        </div>
      </>}
      {step === 2 && <>
        <h1>Активность на этой неделе</h1><p>Только тренировки и работа — шаги посчитаем отдельно.</p>
        <div className="ob-list">{(Object.keys(ACTIVITY) as ActivityLevel[]).map(k => <Opt key={k} on={v.activity === k} onClick={() => set('activity')(k)} title={ACTIVITY[k].name} sub={ACTIVITY[k].hint} />)}</div>
        <label className="fld"><span>Шагов в обычный день</span><div className="chips">{['3000', '6000', '9000', '12000'].map(s => <button type="button" key={s} className={`chip ${v.steps === s ? 'on' : ''}`} onClick={() => set('steps')(s)}>{fmt(+s)}</button>)}</div></label>
      </>}
      {step === 3 && <>
        <h1>Цель</h1>
        <div className="ob-list">{(Object.keys(GOALS) as Goal[]).map(k => <Opt key={k} on={v.goal === k} onClick={() => set('goal')(k)} title={GOALS[k].name} sub={GOALS[k].hint} />)}</div>
        {v.goal !== 'maintain' && <>
          <div className="ob-row">{(['soft', 'mid', 'hard'] as Pace[]).map(k => { const pc = PACE[v.goal as 'lose' | 'gain'][k]; return <Opt key={k} on={v.pace === k} onClick={() => set('pace')(k)} title={pc.name} sub={`${v.goal === 'lose' ? '−' : '+'}${pc.kcal} ккал`} />; })}</div>
          <label className="fld"><span>Желаемый вес, кг (по желанию)</span><input className="in" inputMode="decimal" value={v.target} onChange={e => set('target')(e.target.value)} placeholder={v.goal === 'lose' ? String(Math.round(W * 0.9) || 70) : String(Math.round(W * 1.05) || 80)} /></label>
        </>}
        {preview && <p className="ob-preview">≈ <b>{fmt(preview.kcal)} ккал</b> в день · {preview.weeklyKg < 0 ? '−' : '+'}{fmt1(Math.abs(preview.weeklyKg))} кг в неделю</p>}
      </>}
      {step === 4 && res && <>
        <h1>Твой план</h1>
        <div className="ob-plan">
          <div><b>{fmt(res.kcal)}</b><small>ккал в день</small></div>
          <div><b>{fmt(res.protein)}</b><small>г белка</small></div>
          <div><b>{fmt1(res.water / 1000)}</b><small>л воды</small></div>
          <div><b>{fmt(res.steps)}</b><small>шагов</small></div>
        </div>
        <p>{res.weeklyKg < -0.01 ? `Так уходит ≈ ${fmt1(-res.weeklyKg)} кг в неделю` : res.weeklyKg > 0.01 ? `Так набирается ≈ ${fmt1(res.weeklyKg)} кг в неделю` : 'Вес держится на месте'}{res.weeks ? ` — до цели примерно ${Math.ceil(res.weeks)} нед.` : '.'}</p>
        {res.notes.map(n => <p key={n} className="hint" style={{ textAlign: 'left' }}>{n}</p>)}
        <div className="ob-trial"><b>{TRIAL_DAYS} дней Pro бесплатно</b><span>Фото еды с ИИ, зал, учёба, бюджет и книги открыты. Потом — по подписке или своим набором, а еда, вода, шаги, задачи, цель и статистика остаются бесплатными.</span></div>
      </>}
    </div>
    <div className="ob-nav">
      {step > 0 && step < 4 && <button className="ghost" onClick={() => setStep(step - 1)}>Назад</button>}
      {step < 4 ? <button className="primary" disabled={!ok || busy} onClick={next}>{step === 3 ? (busy ? 'Считаю…' : 'Посчитать план') : 'Дальше'}</button>
        : <button className="primary" onClick={onDone}>Начать</button>}
    </div>
  </main>;
}
