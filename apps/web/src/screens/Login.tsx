/**
 * Вход и регистрация Lumi. Слева (на телефоне — сверху) колода постеров, справа форма.
 * После регистрации — анкета; 7 дней Pro начинаются сразу.
 */
import { useEffect, useState } from 'react';
import { AppleMark, GoogleMark, startUrl, takeAuthResult, useProviders } from '../lib/oauth';
import { TRIAL_DAYS } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { Icon } from '../components/Icon';

const POSTERS = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `/lumi/posters/${n}.webp`);
const STILL = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** колода постеров: текущий в центре, соседние веером по бокам; смена раз в 6 секунд. Размер не больше родного — без мыла */
function Posters() {
  const [i, setI] = useState(() => Math.floor(Math.random() * POSTERS.length));
  useEffect(() => {
    POSTERS.forEach(src => { const im = new Image(); im.src = src; });
    if (STILL) return;
    const t = setInterval(() => setI(x => (x + 1) % POSTERS.length), 6000);
    return () => clearInterval(t);
  }, []);
  const n = POSTERS.length, cls = (k: number) => k === i ? 'on' : k === (i + n - 1) % n ? 'prev' : k === (i + 1) % n ? 'next' : '';
  return <aside className="login-art" aria-hidden="true">
    <div className="deck">{POSTERS.map((src, k) => <img key={src} src={src} alt="" className={cls(k)} decoding="async" />)}</div>
    <div className="login-dots">{POSTERS.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
  </aside>;
}

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [show, setShow] = useState(false), [u, setU] = useState(''), [p, setP] = useState(''), [mail, setMail] = useState(''), [err, setErr] = useState(() => takeAuthResult()?.error ?? ''), [busy, setBusy] = useState(false);
  const pv = useProviders(), any = pv.google || pv.apple, [forgot, setForgot] = useState(false), [sent, setSent] = useState('');
  const brand = <div className="login-brand"><b>Lumi</b></div>;
  const legal = <p className="legal-links">Продолжая, ты принимаешь <a href="/terms.html" target="_blank" rel="noopener">условия</a> и <a href="/privacy.html" target="_blank" rel="noopener">политику конфиденциальности</a>.</p>;

  const card = forgot ? <>
    {brand}
    <h1>Новый пароль</h1>
    {sent ? <p>{sent}</p> : <p>Напиши логин или почту — пришлём ссылку, чтобы задать новый пароль.</p>}
    {!sent && <form onSubmit={async e => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await api<{ message: string }>('/api/auth/forgot', { method: 'POST', body: { login: u } }); setSent(r.message); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось.'); } finally { setBusy(false); } }}>
      <input id="forgot-login" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Логин или почта" value={u} onChange={e => setU(e.target.value)} required />
      <div className="err" role="alert">{err}</div>
      <button type="submit" disabled={busy}>{busy ? 'Отправляю…' : 'Прислать ссылку'}</button>
    </form>}
    <button type="button" className="forgot" style={{ alignSelf: 'center' }} onClick={() => { setForgot(false); setSent(''); setErr(''); }}>← Ко входу</button>
  </> : (() => { const up = mode === 'up'; return <>
    {brand}
    <h1>{up ? 'Зажжём твой первый день' : 'С возвращением'}</h1>
    <p>{up ? `Еда, вода, шаги, задачи, цель и статистика — бесплатно навсегда. Всё остальное — ${TRIAL_DAYS} дней бесплатно.` : 'Lumi сохранил твой день. Войди, чтобы продолжить.'}</p>
    {any && <div className="pv-btns">
      {pv.apple && <a className="pv-btn pv-apple" href={startUrl('apple')}><AppleMark />{up ? 'Создать через Apple' : 'Войти через Apple'}</a>}
      {pv.google && <a className="pv-btn pv-google" href={startUrl('google')}><GoogleMark />{up ? 'Создать через Google' : 'Войти через Google'}</a>}
      <div className="pv-or"><span>или по логину</span></div>
    </div>}
    <div className="seg2" role="tablist">
      <button role="tab" aria-selected={!up} className={!up ? 'on' : ''} onClick={() => { setMode('in'); setErr(''); }}>Войти</button>
      <button role="tab" aria-selected={up} className={up ? 'on' : ''} onClick={() => { setMode('up'); setErr(''); }}>Создать аккаунт</button>
    </div>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setErr('');
      try {
        if (up) await api('/api/auth/register', { method: 'POST', body: { username: u, password: p, email: mail, tz: -new Date().getTimezoneOffset() } });
        else await api('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
        onDone();
      } catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось.'); }
      finally { setBusy(false); }
    }}>
      <input id="login-user" autoComplete="username" placeholder="Логин" value={u} onChange={e => { setU(e.target.value); if (err) setErr(''); }} required autoCapitalize="none" spellCheck={false} />
      {up && <input id="login-mail" type="email" autoComplete="email" placeholder="Почта — чтобы восстановить пароль" value={mail} onChange={e => setMail(e.target.value)} />}
      <div className="pw-field"><input id="login-pass" type={show ? 'text' : 'password'} autoComplete={up ? 'new-password' : 'current-password'} placeholder={up ? 'Пароль — от 8 символов' : 'Пароль'} value={p} onChange={e => { setP(e.target.value); if (err) setErr(''); }} required minLength={up ? 8 : undefined} />
        <button type="button" className="pw-eye" onClick={() => setShow(x => !x)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={show}><Icon name={show ? 'eyeOff' : 'eye'} /></button></div>
      {!up && <button type="button" className="forgot" onClick={() => { setForgot(true); setErr(''); }}>Забыли пароль?</button>}
      <div className="err" role="alert">{err}</div>
      <button type="submit" disabled={busy}>{busy ? (up ? 'Создаю…' : 'Вхожу…') : up ? 'Создать аккаунт' : 'Войти'}</button>
    </form>
  </>; })();

  return <div className="login-scene">
    <Posters />
    <main className="login">{card}{legal}</main>
  </div>;
}
