/** Вход и регистрация. После регистрации — анкета; 7 дней Pro начинаются сразу */
import { useState } from 'react';
import { TRIAL_DAYS } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [u, setU] = useState(''), [p, setP] = useState(''), [mail, setMail] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const up = mode === 'up';
  return <main className="login">
    <div className="brand"><i>✦</i>Бортжурнал</div>
    <h1>{up ? 'Новый журнал' : 'С возвращением'}</h1>
    <p>{up ? `Еда, вода, шаги и задачи — бесплатно навсегда. Всё остальное — ${TRIAL_DAYS} дней бесплатно.` : 'Войди, чтобы продолжить свой день.'}</p>
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
