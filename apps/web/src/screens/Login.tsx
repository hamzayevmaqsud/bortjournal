/**
 * Вход и регистрация Lumi. Слева (на телефоне — сверху) стена постеров, справа карточка формы с маяком.
 * Новичок попадает сразу на «Создать аккаунт» (кто уже входил с этого устройства — на «Войти»).
 * После регистрации — анкета; 7 дней Pro начинаются сразу.
 */
import { useEffect, useRef, useState } from 'react';
import { AppleMark, GoogleMark, startUrl, takeAuthResult, useProviders } from '../lib/oauth';
import { TRIAL_DAYS } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';

// 23 постера по кругу оттенков (собираются из Documents/Lumi/login page): 240 и 400 px — показываем не крупнее
const N = 23;
const srcSet = (k: number) => `/lumi/posters/${k}-240.webp 240w, /lumi/posters/${k}-400.webp 400w`;
const SIZES = '(min-width: 900px) 200px, 80px';
const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 899px)').matches;
// у каждой колонки свои постеры: соседние по цвету — в разных колонках; на телефоне — одна лента
const COLS = (PHONE ? [0] : [0, 1, 2]).map(c => Array.from({ length: N }, (_, k) => k + 1).filter(k => (k - 1) % 3 === c));
// скорость у всех колонок одна (секунд на постер); старт с разных точек цикла — колонки сразу заполнены
const PER = 11, START = [0.3, 0.55, 0.12];

/** стена постеров: колонки медленно едут навстречу друг другу; при «меньше движения» стоит, при фокусе в форме — замирает */
function PosterWall() {
  return <aside className="login-art" aria-hidden="true">
    <div className="wall">{COLS.map((col, c) => <div key={c} className={`wall-col c${c}`}>
      <div className="wall-track" style={{ animationDuration: `${col.length * PER}s`, animationDelay: `${-col.length * PER * START[c]!}s` }}>
        {[...col, ...col].map((n, k) => <img key={k} srcSet={srcSet(n)} sizes={SIZES} src={`/lumi/posters/${n}-400.webp`} alt="" decoding="async" fetchPriority={k < 4 ? 'auto' : 'low'} />)}
      </div>
    </div>)}</div>
  </aside>;
}

const SEEN = 'lumi.seen';
const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* приватный режим */ } };

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>(() => (new URLSearchParams(location.search).get('mode') === 'signup' || !seen() ? 'up' : 'in'));
  const [show, setShow] = useState(false), [u, setU] = useState(''), [p, setP] = useState(''), [mail, setMail] = useState(''), [err, setErr] = useState(() => takeAuthResult()?.error ?? ''), [busy, setBusy] = useState(false);
  const pv = useProviders(), any = pv.google || pv.apple, [forgot, setForgot] = useState(false), [sent, setSent] = useState('');
  const pass = useRef<HTMLInputElement>(null), title = useRef<HTMLHeadingElement>(null), first = useRef(true);
  // смена экрана (вход ↔ новый пароль) — фокус на заголовок, а не в никуда
  useEffect(() => { if (first.current) { first.current = false; return; } title.current?.focus(); }, [forgot]);

  const brand = <div className="login-brand"><img className="login-mark" src="/favicon.svg" alt="" /><div><b>Lumi</b><span>дневник, который ведёт тебя</span></div></div>;
  const legal = <p className="legal-links">Продолжая, ты принимаешь <a href="/terms.html" target="_blank" rel="noopener">условия</a> и <a href="/privacy.html" target="_blank" rel="noopener">политику конфиденциальности</a>.</p>;
  const errBox = <div className="err" id="login-err" role="alert">{err}</div>;
  const bad = err ? { 'aria-invalid': true, 'aria-describedby': 'login-err' } : {};

  const card = forgot ? <>
    {brand}
    <h1 ref={title} tabIndex={-1}>Новый пароль</h1>
    {sent ? <p>{sent}</p> : <p>Напиши логин или почту — пришлём ссылку, чтобы задать новый пароль.</p>}
    {!sent && <form onSubmit={async e => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await api<{ message: string }>('/api/auth/forgot', { method: 'POST', body: { login: u } }); setSent(r.message); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось.'); } finally { setBusy(false); } }}>
      <label className="sr-only" htmlFor="forgot-login">Логин или почта</label>
      <input id="forgot-login" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Логин или почта" value={u} onChange={e => setU(e.target.value)} required {...bad} />
      {errBox}
      <button type="submit" disabled={busy}>{busy ? 'Отправляю…' : 'Прислать ссылку'}</button>
    </form>}
    <button type="button" className="forgot" style={{ alignSelf: 'center' }} onClick={() => { setForgot(false); setSent(''); setErr(''); }}>← Ко входу</button>
  </> : (() => { const up = mode === 'up'; return <>
    {brand}
    <h1 ref={title} tabIndex={-1}>{up ? 'Зажжём твой первый день' : 'С возвращением'}</h1>
    <p>{up ? `Еда, вода, задачи и статистика — бесплатно навсегда. Остальное — ${TRIAL_DAYS} дней Pro.` : 'Маяк горит — твой день на месте.'}</p>
    {any && <div className="pv-btns">
      {pv.apple && <a className="pv-btn pv-apple" href={startUrl('apple')}><AppleMark />{up ? 'Создать через Apple' : 'Войти через Apple'}</a>}
      {pv.google && <a className="pv-btn pv-google" href={startUrl('google')}><GoogleMark />{up ? 'Создать через Google' : 'Войти через Google'}</a>}
      <div className="pv-or"><span>или по логину</span></div>
    </div>}
    <div className="seg2" role="group" aria-label="Вход или регистрация">
      <button type="button" aria-pressed={!up} className={!up ? 'on' : ''} onClick={() => { setMode('in'); setErr(''); }}>Войти</button>
      <button type="button" aria-pressed={up} className={up ? 'on' : ''} onClick={() => { setMode('up'); setErr(''); }}>Создать аккаунт</button>
    </div>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setErr('');
      try {
        if (up) await api('/api/auth/register', { method: 'POST', body: { username: u, password: p, email: mail, tz: -new Date().getTimezoneOffset() } });
        else await api('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
        markSeen(); onDone();
      } catch (x) {
        setErr(x instanceof ApiError ? x.message : 'Не получилось.');
        // неверный пароль — сразу можно перепечатать
        setTimeout(() => { pass.current?.focus(); pass.current?.select(); });
      }
      finally { setBusy(false); }
    }}>
      <label className="sr-only" htmlFor="login-user">Логин</label>
      <input id="login-user" name="username" autoComplete="username" placeholder="Логин" value={u} onChange={e => { setU(e.target.value); if (err) setErr(''); }} required autoCapitalize="none" spellCheck={false} pattern={up ? "[A-Za-z0-9._-]{3,32}" : undefined} aria-describedby={up ? "user-hint" : undefined} {...(err ? bad : {})} />
      {up && <small className="field-hint" id="user-hint">3–32 символа: латиница, цифры, точка, дефис или подчёркивание</small>}
      {up && <><label className="sr-only" htmlFor="login-mail">Почта, необязательно</label>
        <input id="login-mail" name="email" type="email" autoComplete="email" placeholder="Почта — по желанию" value={mail} onChange={e => setMail(e.target.value)} /></>}
      <label className="sr-only" htmlFor="login-pass">Пароль</label>
      <div className="pw-field"><input ref={pass} id="login-pass" name="password" type={show ? 'text' : 'password'} autoComplete={up ? 'new-password' : 'current-password'} placeholder="Пароль" value={p} onChange={e => { setP(e.target.value); if (err) setErr(''); }} required minLength={up ? 8 : undefined} aria-describedby={up ? 'pw-hint' : err ? 'login-err' : undefined} aria-invalid={err ? true : undefined} />
        <button type="button" className="pw-eye" onClick={() => setShow(x => !x)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={show}><Icon name={show ? 'eyeOff' : 'eye'} /></button></div>
      {up && <small className={`field-hint ${p.length >= 8 ? 'ok' : ''}`} id="pw-hint">{p.length >= 8 ? '✓ 8 символов или больше' : `Минимум 8 символов${p ? ` · ещё ${8 - p.length}` : ''}`}</small>}
      {!up && <button type="button" className="forgot" onClick={() => { setForgot(true); setErr(''); }}>Забыли пароль?</button>}
      {errBox}
      <button type="submit" disabled={busy}>{busy ? (up ? 'Создаю…' : 'Вхожу…') : up ? 'Создать аккаунт' : 'Войти'}</button>
    </form>
  </>; })();

  return <div className="login-scene">
    <PosterWall />
    <main className="login"><ThemeToggle className="in-card" />{card}{legal}</main>
  </div>;
}
