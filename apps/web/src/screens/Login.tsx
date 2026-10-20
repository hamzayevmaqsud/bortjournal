import { useState } from 'react';
import { api, ApiError } from '../lib/api';

export function Login({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState(''), [p, setP] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  return <main className="login">
    <div className="brand"><i>✦</i>Бортжурнал</div>
    <h1>С возвращением</h1>
    <p>Новая версия журнала. Логин и пароль — те же, что в старой.</p>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setErr('');
      try { await api('/api/auth/login', { method: 'POST', body: { username: u, password: p } }); onDone(); }
      catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось войти.'); }
      finally { setBusy(false); }
    }}>
      <input id="login-user" autoComplete="username" placeholder="Логин" value={u} onChange={e => setU(e.target.value)} required autoCapitalize="none" />
      <input id="login-pass" type="password" autoComplete="current-password" placeholder="Пароль" value={p} onChange={e => setP(e.target.value)} required />
      <div className="err" role="alert">{err}</div>
      <button type="submit" disabled={busy}>{busy ? 'Вхожу…' : 'Войти'}</button>
    </form>
  </main>;
}
