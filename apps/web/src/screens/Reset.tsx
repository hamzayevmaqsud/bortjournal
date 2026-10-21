/** Новый пароль по ссылке из письма или от администратора: /#reset=… */
import { useState } from 'react';
import { api, ApiError } from '../lib/api';

export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [p, setP] = useState(''), [p2, setP2] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  return <main className="login">
    <div className="brand"><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.6 6.4L20 12l-6.4 1.6L12 21l-1.6-7.4L4 12l6.4-2.6z" fill="currentColor" /></svg></i>Бортжурнал</div>
    <h1>Новый пароль</h1><p>Придумай пароль от 8 символов. После этого журнал выйдет на всех других устройствах.</p>
    <form onSubmit={async e => {
      e.preventDefault(); setErr('');
      if (p !== p2) { setErr('Пароли не совпадают.'); return; }
      setBusy(true);
      try { await api('/api/auth/reset', { method: 'POST', body: { token, password: p } }); history.replaceState(null, '', location.pathname); onDone(); }
      catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось.'); } finally { setBusy(false); }
    }}>
      <input type="password" autoComplete="new-password" placeholder="Новый пароль" minLength={8} required value={p} onChange={e => setP(e.target.value)} />
      <input type="password" autoComplete="new-password" placeholder="Ещё раз" minLength={8} required value={p2} onChange={e => setP2(e.target.value)} />
      <div className="err" role="alert">{err}</div>
      <button type="submit" disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить и войти'}</button>
    </form>
    <button type="button" className="forgot" style={{ alignSelf: 'center' }} onClick={() => { history.replaceState(null, '', location.pathname); location.reload(); }}>← Ко входу</button>
  </main>;
}
