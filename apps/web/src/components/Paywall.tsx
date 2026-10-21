/**
 * Экран тарифов: «Pro — всё» или «Свой набор» (только нужные разделы; цена складывается из разделов,
 * но всегда ниже Pro). «Покупка» пока имитация — деньги не списываются; управление подпиской.
 * Оплату потом заменит настоящая платёжка, экран останется тем же. Цену своего набора пересчитывает сервер.
 */
import { useMemo, useState } from 'react';
import { BUNDLE_DISCOUNT, customPrice, FEATURES, PACKS, packPrice, PRICES, type PackKey, type PriceId } from '@bortjournal/core';
import { api, ApiError, type Subscription } from '../lib/api';
import { featureOf } from '../lib/features';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';
import { nativeApp } from '../lib/oauth';
import { useToast } from './Toasts';

// «20 октября 2027» — без «г.», чтобы точка в конце фразы не удваивалась
const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
const usd = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const packName = (k: string) => PACKS.find(p => p.key === k)?.name ?? k;
const word = (n: number) => n === 1 ? 'раздел' : n < 5 ? 'раздела' : 'разделов';

export function SubStatus({ sub }: { sub: Subscription }) {
  if (sub.features?.length && !sub.pro) return <span className="sub-pill pro">Свой набор · {sub.features.length}</span>;
  if (!sub.pro) return <span className="sub-pill off">Бесплатный тариф</span>;
  if (sub.beta) return <span className="sub-pill pro">Бета · всё открыто</span>;
  if (sub.source === 'trial') return <span className="sub-pill trial">Пробный Pro · ещё {sub.daysLeft} дн.</span>;
  if (sub.source === 'free') return <span className="sub-pill pro">Pro навсегда</span>;
  return <span className="sub-pill pro">Pro · {sub.plan === 'year' ? 'год' : 'месяц'}</span>;
}

/** бета — всё открыто; в приложении для iPhone цен нет: цифровую подписку там можно продавать только через Apple */
export function Paywall(props: { sub: Subscription; focus?: string; onChange: (s: Subscription) => void; onClose: () => void }) {
  if (props.sub.beta || nativeApp()) return <div className="pw pw-info">
    <div className="pw-hero"><h2>{props.sub.beta ? 'Сейчас всё открыто' : 'Подписка'}</h2>
      <p>{props.sub.beta ? 'Идёт закрытая бета: все разделы — еда с ИИ, зал, учёба, бюджет, книги, цели и повторы — бесплатно. Спасибо, что помогаешь сделать журнал лучше!' : props.sub.pro ? 'Все разделы открыты.' : 'Оформление подписки в приложении появится скоро. Еда, вода, шаги, задачи, цель, статистика и напоминания — бесплатно.'}</p></div>
    {props.sub.beta && <p className="card-note">Что понравилось, что мешает — напиши в профиле: «Написать разработчику».</p>}
    <button className="primary" onClick={props.onClose}>Понятно</button>
  </div>;
  return <PaywallInner {...props} />;
}
function PaywallInner({ sub, focus, onChange, onClose }: { sub: Subscription; focus?: string; onChange: (s: Subscription) => void; onClose: () => void }) {
  const toast = useToast(), focusKey = focus ? featureOf(focus) : null;
  const custom = !sub.pro && !!sub.features?.length;
  const [mode, setMode] = useState<'pro' | 'custom'>(custom ? 'custom' : 'pro');
  const [plan, setPlan] = useState<PriceId>(sub.plan ?? 'year'), [step, setStep] = useState<'choose' | 'paying' | 'done'>('choose');
  const [pick, setPick] = useState<PackKey[]>(() => custom ? [...sub.features!] : focusKey ? [focusKey] : []);
  const [result, setResult] = useState<{ sub: Subscription; price: number } | null>(null);
  const paid = sub.source === 'web' && (sub.pro || custom), lifetime = sub.source === 'free';
  const q = useMemo(() => customPrice(pick, plan), [pick, plan]);
  const call = async (path: string, body?: unknown) => {
    try { const r = await api<{ subscription: Subscription; price?: number }>(path, { method: 'POST', body }); onChange(r.subscription); return r; }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); return null; }
  };
  const buy = async () => {
    if (mode === 'custom' && !pick.length) { toast('Выбери хотя бы один раздел', { err: true }); return; }
    setStep('paying'); buzz(10);
    // имитация окна оплаты: короткая пауза, как у настоящей платёжки
    await new Promise(r => setTimeout(r, 1300));
    const r = await call('/api/billing/purchase', { plan, features: mode === 'custom' ? pick : undefined });
    if (r) { setResult({ sub: r.subscription, price: r.price ?? 0 }); setStep('done'); buzz([10, 40, 10, 40, 20]); } else setStep('choose');
  };
  const toggle = (k: PackKey) => { setPick(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]); buzz(6); };

  if (step === 'done' && result) { const s = result.sub; return <div className="pw-done">
    <div className="pw-check"><Icon name="check" /></div>
    <h3>{s.pro ? 'Pro активен' : 'Свой набор активен'}</h3>
    {!s.pro && s.features && <div className="pw-picked">{s.features.map(k => <span key={k}>{packName(k)}</span>)}</div>}
    <p>{usd(result.price)} {plan === 'year' ? 'в год' : 'в месяц'}{s.expiresAt ? ` · до ${dateRu(s.expiresAt)}, продлится автоматически.` : '.'}</p>
    <button className="primary" onClick={onClose}>Готово</button>
    <p className="pw-small">Это демонстрация: деньги не списывались.</p>
  </div>; }

  const priceOf = (id: PriceId) => mode === 'pro' ? PRICES[id].price : customPrice(pick, id).price;
  const cta = mode === 'pro' ? `Оформить Pro за ${usd(PRICES[plan].price)} ${PRICES[plan].per}` : pick.length ? `Оформить ${pick.length} ${word(pick.length)} за ${usd(q.price)} ${PRICES[plan].per}` : 'Выбери разделы';
  const changed = (mode === 'custom') !== custom || (custom && [...pick].sort().join() !== [...sub.features!].sort().join());
  return <div className="pw">
    <div className="pw-hero">
      <span className="pw-badge">{mode === 'pro' ? 'PRO' : 'СВОЙ НАБОР'}</span>
      <h3>{mode === 'pro' ? 'Весь Бортжурнал' : 'Только то, что нужно'}</h3>
      <p>{mode === 'pro' ? (focus ? `«${focus}» — часть Pro. Или возьми только его в своём наборе — так дешевле.` : 'Фото и описание еды с ИИ, зал, учёба, бюджет, книги, цели и повторы.') : 'Плати только за нужное. Два раздела — скидка 15%, три и больше — 25%.'} {sub.source === 'trial' ? `Пробный период: ещё ${sub.daysLeft} дн.` : ''}</p>
    </div>

    <div className="seg2 pw-mode" role="tablist">
      <button role="tab" aria-selected={mode === 'pro'} className={mode === 'pro' ? 'on' : ''} onClick={() => { setMode('pro'); buzz(6); }}>Pro — всё</button>
      <button role="tab" aria-selected={mode === 'custom'} className={mode === 'custom' ? 'on' : ''} onClick={() => { setMode('custom'); buzz(6); }}>Свой набор</button>
    </div>

    {lifetime ? <div className="pw-manage"><SubStatus sub={sub} /><p>Pro открыт навсегда — как у владельца журнала. Тарифы ниже — чтобы посмотреть, как их увидят пользователи.</p></div> : null}
    {paid ? <div className="pw-manage">
      <SubStatus sub={sub} />
      {custom && <div className="pw-picked">{sub.features!.map(k => <span key={k}>{packName(k)}</span>)}</div>}
      <p>{sub.autoRenew ? `Продлится ${dateRu(sub.expiresAt!)}.` : `Автопродление выключено — доступ до ${dateRu(sub.expiresAt!)}.`}</p>
      {sub.autoRenew ? <button className="ghost" onClick={async () => { if (await call('/api/billing/cancel')) toast('Автопродление выключено'); }}>Отменить автопродление</button>
        : <button className="ghost" onClick={async () => { if (await call('/api/billing/resume')) toast('Автопродление снова включено'); }}>Возобновить</button>}
    </div> : null}

    {mode === 'pro' ? <ul className="pw-feats">{PACKS.map(p => <li key={p.key} className={focusKey === p.key ? 'hl' : ''}>
      <span className="chip-ic" style={{ ['--c' as string]: 'var(--orange)' }}><Icon name={p.icon} /></span><span className="mid"><b>{p.name}</b><small>{p.hint}</small></span></li>)}</ul>
      : <div className="pw-packs">{PACKS.map(p => { const on = pick.includes(p.key); return <button key={p.key} role="checkbox" aria-checked={on} className={`pw-pack ${on ? 'on' : ''} ${focusKey === p.key ? 'hl' : ''}`} onClick={() => toggle(p.key)}>
        <span className="pw-box">{on && <Icon name="check" />}</span>
        <span className="chip-ic" style={{ ['--c' as string]: on ? 'var(--orange)' : 'var(--text-3)' }}><Icon name={p.icon} /></span>
        <span className="mid"><b>{p.name}</b><small>{p.hint}</small></span>
        <em>{usd(packPrice(p.month, plan))}<small>{plan === 'month' ? '/мес' : '/год'}</small></em>
      </button>; })}</div>}

    {mode === 'custom' && pick.length > 0 && (() => { const qm = customPrice(pick, 'month'), qy = customPrice(pick, 'year'), next = BUNDLE_DISCOUNT(pick.length + 1); return <div className={`pw-sum ${q.all ? 'all' : ''}`}>
      <div><span>{pick.length} {word(pick.length)}{q.discount ? ` · скидка ${Math.round(q.discount * 100)}%` : ''}</span>{q.list > q.price && <s>{usd(q.list)}</s>}<b>{usd(q.price)}<small> {PRICES[plan].per}</small></b></div>
      {q.all ? <p>Все разделы — это и есть Pro.</p> : <p className="pw-save">Экономия против Pro: <b>{usd(qm.save)}</b> в месяц · <b>{usd(qy.save)}</b> в год</p>}
      {!q.all && next > q.discount && <p>Ещё один раздел — и скидка станет {Math.round(next * 100)}%.</p>}
      {!q.all && q.save <= 1 && <button className="btn-accent" onClick={() => { setMode('pro'); buzz(6); }}>Весь Pro — всего на {usd(q.save)} больше</button>}
    </div>; })()}

    {!paid || !sub.autoRenew || changed ? <>
      <div className="pw-plans" role="radiogroup" aria-label="Период">
        {(Object.keys(PRICES) as PriceId[]).reverse().map(id => { const p = PRICES[id], pr = priceOf(id); return <button key={id} role="radio" aria-checked={plan === id} className={`pw-plan ${plan === id ? 'on' : ''}`} onClick={() => { setPlan(id); buzz(6); }}>
          {id === 'year' && <em>−33%</em>}
          <b>{p.title}</b><strong>{mode === 'custom' && !pick.length ? '—' : usd(pr)}</strong><small>{id === 'year' ? (pr ? `${usd(Math.round(pr / 12 * 100) / 100)} в месяц` : 'в год') : p.per}</small>
        </button>; })}
      </div>
      <button className="primary pw-cta" disabled={step === 'paying' || (mode === 'custom' && !pick.length)} onClick={buy}>
        {step === 'paying' ? <span className="spin" aria-label="Оформляю" /> : cta}
      </button>
    </> : null}

    <div className="pw-free"><b>Бесплатно навсегда</b>{FEATURES.base.map(([k, n]) => <span key={k}><Icon name="check" className="ic" />{n}</span>)}</div>
    <p className="pw-small">Демонстрация: деньги не списываются, оплата подключится позже. Отменить или поменять набор можно в любой момент.</p>
    <button className="link" onClick={async () => { const r = await call('/api/billing/resume'); if (r) toast(r.subscription.pro || r.subscription.features?.length ? 'Покупки восстановлены' : 'Покупок не найдено'); }}>Восстановить покупки</button>
  </div>;
}
