/**
 * Экран Pro: что даёт подписка, выбор тарифа, «покупка» (сейчас имитация — деньги не списываются),
 * управление подпиской. Оплату потом заменит настоящая платёжка, экран останется тем же.
 */
import { useState } from 'react';
import { FEATURES, PRICES, type PriceId } from '@bortjournal/core';
import { api, ApiError, type Subscription } from '../lib/api';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';
import { useToast } from './Toasts';

const IC: Record<string, string> = { 'food.ai': 'camera', 'food.search': 'search', goal: 'today', gym: 'gym', study: 'study', budget: 'money', books: 'books', plans: 'plans', stats: 'flame', awards: 'check', reminders: 'drop' };
// «20 октября 2027» — без «г.», чтобы точка в конце фразы не удваивалась
const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
const usd = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} $`;

export function SubStatus({ sub }: { sub: Subscription }) {
  if (!sub.pro) return <span className="sub-pill off">Бесплатный тариф</span>;
  if (sub.source === 'trial') return <span className="sub-pill trial">Пробный Pro · ещё {sub.daysLeft} дн.</span>;
  if (sub.source === 'free') return <span className="sub-pill pro">Pro навсегда</span>;
  return <span className="sub-pill pro">Pro · {sub.plan === 'year' ? 'год' : 'месяц'}</span>;
}

export function Paywall({ sub, focus, onChange, onClose }: { sub: Subscription; focus?: string; onChange: (s: Subscription) => void; onClose: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState<PriceId>('year'), [step, setStep] = useState<'choose' | 'paying' | 'done'>('choose');
  const paid = sub.pro && sub.source === 'web', lifetime = sub.source === 'free';
  const call = async (path: string, body?: unknown) => {
    try { const r = await api<{ subscription: Subscription }>(path, { method: 'POST', body }); onChange(r.subscription); return r.subscription; }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); return null; }
  };
  const buy = async () => {
    setStep('paying'); buzz(10);
    // имитация окна оплаты: короткая пауза, как у настоящей платёжки
    await new Promise(r => setTimeout(r, 1300));
    const s = await call('/api/billing/purchase', { plan });
    if (s) { setStep('done'); buzz([10, 40, 10, 40, 20]); } else setStep('choose');
  };

  if (step === 'done') return <div className="pw-done">
    <div className="pw-check"><Icon name="check" /></div>
    <h3>Pro активен</h3>
    <p>{sub.expiresAt ? `До ${dateRu(sub.expiresAt)}, продлится автоматически.` : 'Все функции открыты.'}</p>
    <button className="primary" onClick={onClose}>Готово</button>
    <p className="pw-small">Это демонстрация: деньги не списывались.</p>
  </div>;

  return <div className="pw">
    <div className="pw-hero">
      <span className="pw-badge">PRO</span>
      <h3>Весь Бортжурнал</h3>
      <p>{focus ? `«${focus}» — часть Pro.` : 'Фото еды, зал, учёба, бюджет, книги, статистика и напоминания.'} {sub.source === 'trial' ? `Пробный период: ещё ${sub.daysLeft} дн.` : ''}</p>
    </div>

    {lifetime ? <div className="pw-manage"><SubStatus sub={sub} /><p>Pro открыт навсегда — как у владельца журнала. Экран тарифов ниже — чтобы посмотреть, как его увидят пользователи.</p></div> : null}
    {paid && !lifetime ? <div className="pw-manage">
      <SubStatus sub={sub} />
      <p>{sub.autoRenew ? `Продлится ${dateRu(sub.expiresAt!)}.` : `Автопродление выключено — Pro работает до ${dateRu(sub.expiresAt!)}.`}</p>
      {sub.autoRenew ? <button className="ghost" onClick={async () => { if (await call('/api/billing/cancel')) toast('Автопродление выключено'); }}>Отменить автопродление</button>
        : <button className="ghost" onClick={async () => { if (await call('/api/billing/resume')) toast('Автопродление снова включено'); }}>Возобновить</button>}
    </div> : null}

    <ul className="pw-feats">{FEATURES.pro.map(([k, n, d]) => <li key={k} className={focus && n.toLowerCase().includes(focus.toLowerCase().split(' ')[0]!) ? 'hl' : ''}>
      <span className="chip-ic" style={{ ['--c' as string]: 'var(--orange)' }}><Icon name={IC[k] ?? 'check'} /></span><span className="mid"><b>{n}</b><small>{d}</small></span></li>)}</ul>

    {!paid || !sub.autoRenew ? <>
      <div className="pw-plans" role="radiogroup" aria-label="Тариф">
        {(Object.keys(PRICES) as PriceId[]).reverse().map(id => { const p = PRICES[id]; return <button key={id} role="radio" aria-checked={plan === id} className={`pw-plan ${plan === id ? 'on' : ''}`} onClick={() => { setPlan(id); buzz(6); }}>
          {id === 'year' && <em>−33%</em>}
          <b>{p.title}</b><strong>{usd(p.price)}</strong><small>{'note' in p ? p.note : p.per}</small>
        </button>; })}
      </div>
      <button className="primary pw-cta" disabled={step === 'paying'} onClick={buy}>
        {step === 'paying' ? <span className="spin" aria-label="Оформляю" /> : `Оформить за ${usd(PRICES[plan].price)} ${PRICES[plan].per}`}
      </button>
    </> : null}

    <div className="pw-free"><b>Бесплатно навсегда</b>{FEATURES.base.map(([k, n]) => <span key={k}><Icon name="check" className="ic" />{n}</span>)}</div>
    <p className="pw-small">Демонстрация: деньги не списываются, оплата подключится позже. Отменить можно в любой момент.</p>
    <button className="link" onClick={async () => { const s = await call('/api/billing/resume'); if (s) toast(s.pro ? 'Покупки восстановлены' : 'Покупок не найдено'); }}>Восстановить покупки</button>
  </div>;
}
