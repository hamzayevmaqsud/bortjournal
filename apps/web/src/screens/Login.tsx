/** Вход и регистрация. После регистрации — анкета; 7 дней Pro начинаются сразу */
import { useState } from 'react';
import { TRIAL_DAYS } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [u, setU] = useState(''), [p, setP] = useState(''), [mail, setMail] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const up = mode === 'up';
  return <main className="login">
    <div className="brand"><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.6 6.4L20 12l-6.4 1.6L12 21l-1.6-7.4L4 12l6.4-2.6z" fill="currentColor" /></svg></i>Бортжурнал</div>
    <h1>{up ? 'Новый журнал' : 'С возвращением'}</h1>
    <p>{up ? `Еда, вода, шаги, задачи, цель и статистика — бесплатно навсегда. Всё остальное — ${TRIAL_DAYS} дней бесплатно.` : 'Войди, чтобы продолжить свой день.'}</p>
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
      <input id="login-user" autoComplete="username" placeholder="Логин" value={u} onChange={e => setU(e.target.value)} required autoCapitalize="none" spellCheck={false} />
      {up && <input id="login-mail" type="email" autoComplete="email" placeholder="Почта (по желанию)" value={mail} onChange={e => setMail(e.target.value)} />}
      <input id="login-pass" type="password" autoComplete={up ? 'new-password' : 'current-password'} placeholder={up ? 'Пароль — от 8 символов' : 'Пароль'} value={p} onChange={e => setP(e.target.value)} required minLength={up ? 8 : undefined} />
      <div className="err" role="alert">{err}</div>
      <button type="submit" disabled={busy}>{busy ? (up ? 'Создаю…' : 'Вхожу…') : up ? 'Создать аккаунт' : 'Войти'}</button>
    </form>
  </main>;
}
