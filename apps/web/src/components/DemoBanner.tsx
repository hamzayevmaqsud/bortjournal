/**
 * Полоса демо без регистрации: напоминает, что записи временные, и предлагает сохранить их как аккаунт
 * (логин, пароль, почта по желанию — /api/auth/claim). «Выйти» просто выходит: демо удалится само.
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api, ApiError, renameOwner } from '../lib/api';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import '../styles/demo.css';

export function DemoBanner({ onClaimed, onLogout }: { onClaimed: () => Promise<void> | void; onLogout: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [v, setV] = useState({ username: '', password: '', email: '' }), [show, setShow] = useState(false);
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement>) => { setV(x => ({ ...x, [k]: e.target.value })); if (err) setErr(''); };

  const save = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ username: string }>('/api/auth/claim', { method: 'POST', body: { username: v.username.trim(), password: v.password, email: v.email.trim() } });
      renameOwner(r.username); buzz([10, 40, 10]);
      setOpen(false); await onClaimed();
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось. Попробуй ещё раз.'); }
    finally { setBusy(false); }
  };

  return <>
    <div className="demo-bar" role="status">
      <span className="demo-dot" aria-hidden="true" />
      <span className="demo-text">Это демо — данные удалятся через сутки.</span>
      <button type="button" className="btn-accent demo-save" onClick={() => setOpen(true)}>Сохранить как аккаунт</button>
      <button type="button" className="demo-out" onClick={onLogout} aria-label="Выйти из демо"><Icon name="logout" /><span>Выйти</span></button>
    </div>
    <Sheet open={open} onClose={() => setOpen(false)} title="Сохранить как аккаунт">
      <form className="form demo-form" onSubmit={save}>
        <p className="demo-lead">Записи из демо останутся, а Pro будет бесплатно ещё 7 дней.</p>
        <label className="fld"><span>Логин</span><input className="in" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={v.username} onChange={set('username')} placeholder="латиница, цифры, . _ -" pattern="[A-Za-z0-9._-]{3,32}" required /></label>
        <label className="fld"><span>Пароль</span>
          <div className="pw-field"><input className="in" name="password" type={show ? 'text' : 'password'} autoComplete="new-password" value={v.password} onChange={set('password')} placeholder="не короче 8 символов" minLength={8} required />
            <button type="button" className="pw-eye" onClick={() => setShow(x => !x)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={show}><Icon name={show ? 'eyeOff' : 'eye'} /></button></div></label>
        <label className="fld"><span>Почта — по желанию</span><input className="in" name="email" type="email" autoComplete="email" value={v.email} onChange={set('email')} placeholder="для восстановления пароля" /></label>
        {err && <p className="form-err" role="alert">{err}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </form>
    </Sheet>
  </>;
}
