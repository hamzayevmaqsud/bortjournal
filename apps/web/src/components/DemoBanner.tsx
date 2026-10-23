/**
 * Полоса демо без регистрации: напоминает, что записи временные, и предлагает сохранить их как аккаунт
 * (логин или почта, пароль дважды, почта обязательна — /api/auth/claim). «Выйти» просто выходит: демо удалится само.
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api, ApiError, renameOwner } from '../lib/api';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';
import { PasswordInput } from './PasswordInput';
import { Sheet } from './Sheet';
import '../styles/demo.css';

export function DemoBanner({ onClaimed, onLogout }: { onClaimed: () => Promise<void> | void; onLogout: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [v, setV] = useState({ username: '', password: '', password2: '', email: '' }), [show, setShow] = useState(false);
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement>) => { setV(x => ({ ...x, [k]: e.target.value })); if (err) setErr(''); };

  const byMail = v.username.includes('@');
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return;
    if (v.password !== v.password2) { setErr('Пароли не совпадают.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api<{ username: string }>('/api/auth/claim', { method: 'POST', body: { username: v.username.trim(), password: v.password, password2: v.password2, email: byMail ? '' : v.email.trim() } });
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
        <label className="fld"><span>Логин или почта</span><input className="in" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={v.username} onChange={set('username')} placeholder="латиница, цифры, . _ - или почта" pattern={byMail ? undefined : '[A-Za-z0-9._-]{3,32}'} required /></label>
        {!byMail && <label className="fld"><span>Почта — чтобы восстановить пароль</span><input className="in" name="email" type="email" autoComplete="email" autoCapitalize="none" value={v.email} onChange={set('email')} placeholder="you@mail.com" required /></label>}
        <label className="fld"><span>Пароль</span>
          <PasswordInput className="in" show={show} onToggle={() => setShow(x => !x)} name="password" autoComplete="new-password" value={v.password} onChange={set('password')} placeholder="не короче 8 символов" minLength={8} required /></label>
        <label className="fld"><span>Повтори пароль</span>
          <PasswordInput className="in" show={show} onToggle={() => setShow(x => !x)} name="password2" autoComplete="new-password" value={v.password2} onChange={set('password2')} placeholder="ещё раз" required /></label>
        {v.password2 && v.password2 !== v.password && <small className="field-hint bad">Пароли не совпадают</small>}
        {err && <p className="form-err" role="alert">{err}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </form>
    </Sheet>
  </>;
}
