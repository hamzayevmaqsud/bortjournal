/**
 * Анкета первого запуска — короткая, вокруг целей: имя → зачем ты здесь (и разделы) → тело и нормы (только если ведёшь еду) →
 * привычки → напоминания → итог. Любой шаг можно пропустить, всё меняется потом в профиле.
 * Сохраняется одним запросом в конце; повтор из профиля открывает анкету с прошлыми ответами.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ACTIVITY, AIMS, AIM_KEYS, GOALS, HABITS_PRESELECT, PACE, REMIND_PLAN, REMIND_WHEN, TRIAL_DAYS, aimsOf, computePlan, habitsFor, needsBody, planGoalFor,
  remindFor, remindKinds, sectionsFor, stepsGoal, waterGoal, type ActivityLevel, type Aim, type Goal, type Pace, type RemindWhen
} from '@bortjournal/core';
import { api, ApiError, type PlanResult } from '../lib/api';
import { fmt, fmt1 } from '../lib/format';
import { buzz } from '../lib/motion';
import { pushSupported, subscribeHere } from '../lib/push';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { useProviders } from '../lib/oauth';
import '../styles/onboarding.css';

export interface OnboardingValues { name: string; sex: '' | 'm' | 'f'; age: string; height: string; weight: string; activity: ActivityLevel; steps: string; goal: Goal; pace: Pace; target: string }

/** что можно вести: от выбора зависят «Сегодня», нижняя панель и нужна ли анкета тела */
export const TRACK: Array<[string, string, string]> = [['food', 'Еда и вес', 'калории, БЖУ, цель по весу'], ['water', 'Вода', 'норма и напитки'], ['steps', 'Шаги', 'цель на день'], ['tasks', 'Задачи и планы', 'день, неделя, повторы'],
  ['gym', 'Зал', 'подходы и рекорды'], ['study', 'Учёба', 'конспекты и вопросы'], ['budget', 'Бюджет', 'сколько можно тратить'], ['books', 'Книги', 'чтение и цель года']];
const AIM_COLOR: Record<Aim, string> = { weight: 'var(--food)', muscle: 'var(--gym)', water: 'var(--water)', move: 'var(--steps)', routine: 'var(--quiz)', study: 'var(--study)', plans: 'var(--orange)', money: 'var(--money)', books: 'var(--books)' };
const NORMS = [['kcal', 'Калории', 'ккал', 800, 6000], ['protein', 'Белок', 'г', 0, 400], ['water', 'Вода', 'мл', 500, 6000], ['steps', 'Шаги', 'в день', 1000, 50000]] as const;
type NormKey = (typeof NORMS)[number][0];
type Step = 'name' | 'goals' | 'body' | 'norms' | 'habits' | 'remind' | 'done';
type Kinds = Record<string, boolean>;
interface Saved { plan: PlanResult | null; settings: Record<string, any>; habits: string[] }

// телефон в русской раскладке ставит запятую: «85,5»
const num = (x: string) => Number(x.replace(',', '.').trim()) || 0;

/** initial — тело из профиля, settings — прошлые ответы (повтор анкеты); onCancel — выйти, ничего не меняя */
export function Onboarding({ onDone, initial, settings, onCancel }: { onDone: () => void; initial?: Partial<OnboardingValues>; settings?: Record<string, any>; onCancel?: () => void }) {
  const toast = useToast(), S = settings ?? {}, redo = !!onCancel;
  const [at, setAt] = useState<Step>('name'), [busy, setBusy] = useState(false), [saved, setSaved] = useState<Saved | null>(null);
  const [name, setName] = useState(String(S.name ?? initial?.name ?? ''));

  // цели и разделы: разделы выводятся из целей, поверх — то, что включили или выключили руками
  const [aims, setAims] = useState<Aim[]>(() => aimsOf(S.goals));
  const [manual, setManual] = useState<{ on: string[]; off: string[] }>(() => {
    if (!Array.isArray(S.sections)) return { on: [], off: [] };
    const d = sectionsFor(aimsOf(S.goals)), s = S.sections as string[];
    return { on: s.filter(k => !d.includes(k)), off: d.filter(k => !s.includes(k)) };
  });
  const derived = sectionsFor(aims), sections = TRACK.map(t => t[0]).filter(k => (derived.includes(k) || manual.on.includes(k)) && !manual.off.includes(k));
  const toggleAim = (a: Aim) => { setAims(x => x.includes(a) ? x.filter(y => y !== a) : AIM_KEYS.filter(k => k === a || x.includes(k))); setPicked(null); buzz(6); };
  const toggleSection = (k: string) => {
    const on = sections.includes(k);
    setManual(m => on ? { on: m.on.filter(x => x !== k), off: derived.includes(k) ? [...m.off, k] : m.off } : { on: derived.includes(k) ? m.on : [...m.on, k], off: m.off.filter(x => x !== k) });
    buzz(6);
  };

  // тело и план — те же формулы, что посчитает сервер
  const [v, setV] = useState<OnboardingValues>(() => ({ name: '', sex: '', age: '', height: '', weight: '', activity: 'sed', steps: '6000', goal: planGoalFor(aimsOf(S.goals)), pace: 'mid', target: '', ...initial }));
  const goalTouched = useRef(!!initial?.goal);
  useEffect(() => { if (!goalTouched.current) setV(x => ({ ...x, goal: planGoalFor(aims) })); }, [aims]);
  const set = (k: keyof OnboardingValues) => (x: string) => setV(s => ({ ...s, [k]: x }));
  const [skipBody, setSkipBody] = useState(false);
  const W = num(v.weight), age = num(v.age), height = num(v.height);
  const bodyNeed = !v.sex ? 'Выбери пол — от него зависит норма калорий.' : !(age >= 14 && age <= 100) ? 'Укажи возраст от 14 до 100.' : !(height >= 120 && height <= 230) ? 'Рост — от 120 до 230 см.' : !(W >= 30 && W <= 300) ? 'Вес — от 30 до 300 кг.' : '';
  const plan = !bodyNeed ? computePlan({ sex: v.sex as 'm' | 'f', age, height, goal: v.goal, pace: v.pace, steps: +v.steps }, W, v.activity, +v.steps) : null;
  const calc: Record<NormKey, number> | null = plan ? { kcal: plan.kcal, protein: plan.protein, water: waterGoal(v.sex, v.activity), steps: stepsGoal(+v.steps) } : null;
  const [edit, setEdit] = useState<Partial<Record<NormKey, string>>>({});
  const normOf = (k: NormKey) => edit[k] ?? String(calc?.[k] ?? '');
  const targetBad = v.goal !== 'maintain' && v.target.trim() !== '' && !(num(v.target) >= 30 && num(v.target) <= 300);
  const normBad = NORMS.find(([k, , , lo, hi]) => edit[k] !== undefined && !(num(edit[k]!) >= lo && num(edit[k]!) <= hi));
  const withBody = needsBody(sections) && !skipBody && !bodyNeed;

  // привычки: подсказки по целям, первые отмечены; уже заведённые — не дублируем
  const ideas = habitsFor(aims), [have, setHave] = useState<string[]>([]), [picked, setPicked] = useState<string[] | null>(null);
  useEffect(() => { if (redo) api<{ items: Array<{ title: string }> }>('/api/habits').then(r => setHave(r.items.map(h => h.title.toLowerCase())), () => {}); }, [redo]);
  const fresh = ideas.filter(h => !have.includes(h.title.toLowerCase()));
  const chosen = picked ?? fresh.slice(0, HABITS_PRESELECT).map(h => h.title);
  const togglePick = (t: string) => { setPicked(chosen.includes(t) ? chosen.filter(x => x !== t) : [...chosen, t]); buzz(6); };

  // напоминания: время суток включает свои виды, каждый можно поправить
  const canPush = pushSupported();
  const [when, setWhen] = useState<RemindWhen[]>(['day', 'evening']);
  const [kinds, setKinds] = useState<Kinds | null>(() => S.remind ? Object.fromEntries(REMIND_PLAN.map(r => [r.kind, S.remind[r.kind] !== false])) : null);
  const rel = remindFor(sections), curKinds: Kinds = kinds ?? remindKinds(sections, when);
  const toggleWhen = (w: RemindWhen) => {
    const on = !when.includes(w); setWhen(on ? [...when, w] : when.filter(x => x !== w));
    setKinds({ ...curKinds, ...Object.fromEntries(rel.filter(r => r.when === w).map(r => [r.kind, on])) }); buzz(6);
  };
  const [remindSkip, setRemindSkip] = useState(false), [push, setPush] = useState<'off' | 'on' | 'busy'>('off');
  useEffect(() => { if (canPush) navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => s && setPush('on'), () => {}); }, [canPush]);
  const enablePush = async () => {
    setPush('busy');
    try {
      const { key } = await api<{ key: string }>('/api/push');
      const r = await subscribeHere(key);
      if (!r) { setPush('off'); toast('Уведомления запрещены — их можно разрешить позже в настройках браузера', { err: true }); return; }
      setPush('on'); buzz([10, 40, 10]);
    } catch (e) { setPush('off'); toast(e instanceof ApiError ? e.message : 'Не получилось включить уведомления', { err: true }); }
  };

  const steps: Step[] = ['name', 'goals', ...(needsBody(sections) ? ['body', 'norms'] as Step[] : []), 'habits', ...(canPush ? ['remind'] as Step[] : [])];
  const idx = steps.indexOf(at), last = idx === steps.length - 1;
  const need = at === 'goals' ? (!aims.length ? 'Выбери хотя бы одну цель — или нажми «Пропустить».' : !sections.length ? 'Оставь хотя бы один раздел.' : '')
    : at === 'body' ? bodyNeed
    : at === 'norms' ? (targetBad ? 'Желаемый вес — от 30 до 300 кг.' : normBad ? `${normBad[1]}: от ${fmt(normBad[3])} до ${fmt(normBad[4])}.` : '')
    : '';

  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (at !== 'name') head.current?.focus({ preventScroll: true }); }, [at]);

  const save = async (opts: { remindSkip?: boolean } = {}) => {
    setBusy(true);
    const R = remindFor(sections), noRemind = opts.remindSkip ?? remindSkip;
    const body: Record<string, unknown> = {
      name: name.trim(), goals: aims, sections: sections.length ? sections : sectionsFor(aims),
      habits: ideas.filter(h => chosen.includes(h.title) && !have.includes(h.title.toLowerCase()))
    };
    if (withBody) {
      Object.assign(body, { sex: v.sex, age: v.age, height: v.height, weight: String(W), activity: v.activity, steps: v.steps, goal: v.goal, pace: v.pace, target: v.goal === 'maintain' || !v.target.trim() ? null : String(num(v.target)) });
      const n = Object.fromEntries(NORMS.filter(([k]) => edit[k] !== undefined && num(edit[k]!) !== calc?.[k]).map(([k]) => [k, num(edit[k]!)]));
      if (Object.keys(n).length) body.norms = n;
    }
    // напоминания: со своего шага — как выбрано; без шага (браузер без уведомлений) — по разделам, но только в первый раз
    if (canPush && !noRemind) body.remind = { off: false, kinds: Object.fromEntries(REMIND_PLAN.map(r => [r.kind, R.some(x => x.kind === r.kind) && !!curKinds[r.kind]])) };
    else if (!canPush && !redo) body.remind = { kinds: remindKinds(body.sections as string[], ['morning', 'day', 'evening']) };
    try { setSaved(await api<Saved>('/api/profile/onboarding', { method: 'POST', body })); setAt('done'); buzz([10, 40, 10]); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось сохранить — попробуй ещё раз', { err: true }); }
    finally { setBusy(false); }
  };
  const go = (to: number) => { const s = steps[to]; if (!s) return; if (s === 'body') setSkipBody(false); setAt(s); buzz(6); };
  const next = () => { if (need || busy) return; if (last) void save(); else go(idx + 1); };
  const skip = () => {
    if (at === 'name') setName('');
    if (at === 'goals') { setAims([]); setManual({ on: [], off: [] }); setPicked(null); }
    if (at === 'body') { setSkipBody(true); go(steps.indexOf('habits')); return; }
    if (at === 'norms') setEdit({});
    if (at === 'habits') setPicked([]);
    if (at === 'remind') { setRemindSkip(true); void save({ remindSkip: true }); return; }
    if (last) void save(); else go(idx + 1);
  };
  const back = () => go(at === 'habits' && skipBody ? steps.indexOf('body') : idx - 1);

  if (at === 'done' && saved) return <Done saved={saved} name={name.trim()} sections={sections} redo={redo} onDone={onDone} />;

  return <main className="onb">
    <form className="onb-card" noValidate onSubmit={e => { e.preventDefault(); next(); }}>
      <header className="onb-top">
        <div className="onb-progress" role="progressbar" aria-label="Анкета" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={idx + 1} aria-valuetext={`Шаг ${idx + 1} из ${steps.length}`}>
          {steps.map((s, i) => <i key={s} className={i < idx ? 'done' : i === idx ? 'on' : ''} />)}
        </div>
        <span className="onb-count">{idx + 1} из {steps.length}</span>
      </header>

      <section className="onb-step" key={at} aria-live="polite">
        {at === 'name' && <>
          {!redo && <p className="onb-eyebrow">Привет! Настроим Lumi под тебя — это около минуты</p>}
          <h1 ref={head} tabIndex={-1}>Как тебя зовут?</h1>
          <p className="onb-lead">Будем здороваться по имени. Можно оставить пустым.</p>
          <input className="in onb-name" autoFocus autoComplete="given-name" maxLength={40} placeholder="Имя" aria-label="Имя" value={name} onChange={e => setName(e.target.value)} />
        </>}

        {at === 'goals' && <>
          <h1 ref={head} tabIndex={-1}>Зачем ты здесь?</h1>
          <p className="onb-lead">Выбери всё, что откликается, — Lumi подберёт разделы, привычки и советы.</p>
          <div className="onb-aims">{AIM_KEYS.map(k => { const on = aims.includes(k); return <button type="button" key={k} className={`onb-aim ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleAim(k)} style={{ ['--c' as string]: AIM_COLOR[k] }}>
            <span className="chip-ic"><Icon name={AIMS[k].icon} /></span><span className="onb-aim-t"><b>{AIMS[k].name}</b><small>{AIMS[k].hint}</small></span><span className="onb-tick" aria-hidden="true"><Icon name="check" /></span>
          </button>; })}</div>
          <div className="onb-sections">
            <h2>Разделы на главном</h2>
            <p>{aims.length ? 'Подобрали по целям — нажми, чтобы убрать или добавить.' : 'Пока базовые — выбери цели выше или отметь сам.'}</p>
            <div className="onb-chips">{TRACK.map(([k, n]) => { const on = sections.includes(k); return <button type="button" key={k} className={`onb-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleSection(k)}>{on && <Icon name="check" />}{n}</button>; })}</div>
          </div>
        </>}

        {at === 'body' && <>
          <h1 ref={head} tabIndex={-1}>Немного о тебе</h1>
          <p className="onb-lead">По этим данным посчитаем калории, белок и воду. Видно только тебе.</p>
          <Field label="Пол"><div className="onb-seg">{([['m', 'Мужчина'], ['f', 'Женщина']] as const).map(([k, n]) => <button type="button" key={k} className={v.sex === k ? 'on' : ''} aria-pressed={v.sex === k} onClick={() => { set('sex')(k); buzz(6); }}>{n}</button>)}</div></Field>
          <div className="onb-grid3">
            <label className="onb-num"><span>Возраст</span><input className="in" inputMode="numeric" value={v.age} onChange={e => set('age')(e.target.value)} placeholder="30" /></label>
            <label className="onb-num"><span>Рост, см</span><input className="in" inputMode="numeric" value={v.height} onChange={e => set('height')(e.target.value)} placeholder="175" /></label>
            <label className="onb-num"><span>Вес, кг</span><input className="in" inputMode="decimal" value={v.weight} onChange={e => set('weight')(e.target.value)} placeholder="75" /></label>
          </div>
          <Field label="Тренировки и работа"><div className="onb-chips">{(Object.keys(ACTIVITY) as ActivityLevel[]).map(k => <button type="button" key={k} className={`onb-chip ${v.activity === k ? 'on' : ''}`} aria-pressed={v.activity === k} onClick={() => set('activity')(k)}>{ACTIVITY[k].name}</button>)}</div>
            <small className="onb-hint">{ACTIVITY[v.activity].hint}</small></Field>
          <Field label="Шагов в обычный день"><div className="onb-chips">{['3000', '6000', '9000', '12000'].map(s => <button type="button" key={s} className={`onb-chip ${v.steps === s ? 'on' : ''}`} aria-pressed={v.steps === s} onClick={() => set('steps')(s)}>{fmt(+s)}</button>)}</div></Field>
        </>}

        {at === 'norms' && <>
          <h1 ref={head} tabIndex={-1}>Цель и нормы</h1>
          <Field label="Что с весом"><div className="onb-seg">{(Object.keys(GOALS) as Goal[]).map(k => <button type="button" key={k} className={v.goal === k ? 'on' : ''} aria-pressed={v.goal === k} onClick={() => { goalTouched.current = true; set('goal')(k); setEdit(e => ({ ...e, kcal: undefined, protein: undefined })); buzz(6); }}>{GOALS[k].name}</button>)}</div></Field>
          {v.goal !== 'maintain' && <div className="onb-row">
            <Field label="Темп"><div className="onb-chips">{(['soft', 'mid', 'hard'] as Pace[]).map(k => { const pc = PACE[v.goal as 'lose' | 'gain'][k]; return <button type="button" key={k} className={`onb-chip ${v.pace === k ? 'on' : ''}`} aria-pressed={v.pace === k} onClick={() => set('pace')(k)}>{pc.name}<small>{v.goal === 'lose' ? '−' : '+'}{pc.kcal}</small></button>; })}</div></Field>
            <label className="onb-num onb-target"><span>Желаемый вес, кг</span><input className="in" inputMode="decimal" value={v.target} onChange={e => set('target')(e.target.value)} placeholder={String(Math.round(W * (v.goal === 'lose' ? 0.9 : 1.05)) || 70)} /></label>
          </div>}
          {calc && <>
            <div className="onb-norms">{NORMS.map(([k, n, unit]) => { const edited = edit[k] !== undefined && num(edit[k]!) !== calc[k]; return <label key={k} className={`onb-norm ${edited ? 'edited' : ''}`}>
              <span>{n}</span>
              <span className="onb-norm-v"><input inputMode="numeric" value={normOf(k)} style={{ width: `${Math.max(2, normOf(k).length) + 0.5}ch` }} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value.replace(/\s/g, '') }))} aria-label={`${n}, ${unit}`} /><small>{unit}</small></span>
              {edited ? <button type="button" className="onb-reset" onClick={() => setEdit(x => ({ ...x, [k]: undefined }))}>по расчёту {fmt(calc[k])}</button> : <em>по расчёту</em>}
            </label>; })}</div>
            <p className="onb-note">Из расчёта по росту, весу, возрасту и активности — можно поменять.{plan && plan.weeklyKg < -0.01 ? ` Так уходит ≈ ${fmt1(-plan.weeklyKg)} кг в неделю.` : plan && plan.weeklyKg > 0.01 ? ` Так набирается ≈ ${fmt1(plan.weeklyKg)} кг в неделю.` : ''}</p>
            {plan?.notes.map(n => <p key={n} className="onb-note">{n}</p>)}
          </>}
        </>}

        {at === 'habits' && <>
          <h1 ref={head} tabIndex={-1}>Пара привычек на каждый день</h1>
          <p className="onb-lead">Отметь две-три — они появятся на «Сегодня». Свои добавишь там же.</p>
          <div className="onb-habits">{ideas.map(h => { const had = have.includes(h.title.toLowerCase()), on = had || chosen.includes(h.title); return <button type="button" key={h.title} className={`onb-habit ${on ? 'on' : ''}`} aria-pressed={on} disabled={had} onClick={() => togglePick(h.title)}>
            <span className="onb-emoji" aria-hidden="true">{h.icon}</span><b>{h.title}</b>{had ? <small>уже есть</small> : <span className="onb-tick" aria-hidden="true"><Icon name="check" /></span>}
          </button>; })}</div>
        </>}

        {at === 'remind' && <>
          <h1 ref={head} tabIndex={-1}>Когда напоминать?</h1>
          <p className="onb-lead">Только о том, что ты ведёшь, и каждое — не чаще раза в день.</p>
          <div className="onb-seg onb-when">{(Object.keys(REMIND_WHEN) as RemindWhen[]).filter(w => rel.some(r => r.when === w)).map(w => <button type="button" key={w} className={when.includes(w) ? 'on' : ''} aria-pressed={when.includes(w)} onClick={() => toggleWhen(w)}>
            <Icon name={w === 'evening' ? 'moon' : 'sun'} />{REMIND_WHEN[w]}</button>)}</div>
          <div className="onb-rem">{rel.map(r => <label key={r.kind} className="onb-rem-row"><span><b>{r.name}</b><small>{REMIND_WHEN[r.when].toLowerCase()} · {r.time}</small></span>
            <input type="checkbox" className="switch" checked={!!curKinds[r.kind]} onChange={e => setKinds({ ...curKinds, [r.kind]: e.target.checked })} /></label>)}</div>
          <div className={`onb-push ${push === 'on' ? 'on' : ''}`}>
            {push === 'on' ? <><Icon name="check" /><span>Уведомления на этом устройстве включены</span></>
              : <><span>Чтобы напоминания приходили, разреши уведомления на этом устройстве.</span><button type="button" className="onb-push-btn" disabled={push === 'busy'} onClick={enablePush}>{push === 'busy' ? 'Жду ответа…' : 'Разрешить'}</button></>}
          </div>
        </>}
      </section>

      <footer className="onb-nav">
        {need && <p className="onb-need" role="status">{need}</p>}
        <div className="onb-btns">
          {idx > 0 ? <button type="button" className="onb-back" onClick={back}>Назад</button> : onCancel ? <button type="button" className="onb-back" onClick={onCancel}>Отмена</button> : <span />}
          <button type="button" className="onb-skip" disabled={busy} onClick={skip}>Пропустить</button>
          <button type="submit" className="primary onb-next" disabled={!!need || busy}>{busy ? <span className="spin" /> : last ? 'Готово' : 'Дальше'}</button>
        </div>
      </footer>
    </form>
  </main>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="onb-field" role="group" aria-label={label}><span className="onb-label">{label}</span>{children}</div>;
}

/** итог: что включено — разделы, нормы, привычки, напоминания */
function Done({ saved, name, sections, redo, onDone }: { saved: Saved; name: string; sections: string[]; redo: boolean; onDone: () => void }) {
  const { beta } = useProviders();
  const s = saved.settings, R = s.remind ?? {}, on = remindFor(sections).filter(r => R[r.kind] !== false).length;
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus({ preventScroll: true }); }, []);
  return <main className="onb">
    <div className="onb-card onb-done">
      <section className="onb-step">
        <span className="onb-done-mark" aria-hidden="true"><Icon name="check" /></span>
        <h1>Готово{name ? `, ${name}` : ''}! Вот твой день</h1>
        <p className="onb-lead">Всё это можно поменять в профиле — и пройти анкету заново.</p>
        <ul className="onb-sum">
          <li><b>Разделы</b><span>{TRACK.filter(t => sections.includes(t[0])).map(t => t[1]).join(', ')}</span></li>
          {saved.plan && <li><b>Нормы</b><span className="onb-sum-n">
            <i><em>{fmt(s.kcal)}</em> ккал</i><i><em>{fmt(s.protein)}</em> г белка</i><i><em>{fmt1(s.water / 1000)}</em> л воды</i><i><em>{fmt(s.steps)}</em> шагов</i></span></li>}
          <li><b>Привычки</b><span>{saved.habits.length ? saved.habits.join(' · ') : 'пока без новых — добавишь на «Сегодня»'}</span></li>
          <li><b>Напоминания</b><span>{R.off ? 'выключены' : on ? `${on} — ${remindFor(sections).filter(r => R[r.kind] !== false).map(r => r.name.toLowerCase()).join(', ')}` : 'не выбраны'}</span></li>
        </ul>
        {saved.plan && <p className="onb-note">Нормы — ориентир по общепринятым формулам, а не медицинская рекомендация. При заболеваниях или беременности сначала посоветуйся с врачом.</p>}
        {!redo && (beta
          ? <p className="onb-trial"><b>Бета — всё бесплатно.</b> Фото еды с ИИ, зал, учёба, бюджет и книги открыты. О платных функциях предупредим заранее.</p>
          : <p className="onb-trial"><b>{TRIAL_DAYS} дней Pro бесплатно.</b> Фото еды с ИИ, зал, учёба, бюджет и книги открыты. Потом еда, вода, шаги, задачи, цель и статистика остаются бесплатными.</p>)}
      </section>
      <footer className="onb-nav"><div className="onb-btns"><button ref={btn} type="button" className="primary onb-next onb-wide" onClick={onDone}>Открыть «Сегодня»</button></div></footer>
    </div>
  </main>;
}
