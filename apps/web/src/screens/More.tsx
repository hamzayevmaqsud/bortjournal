/** «Ещё»: профиль и нормы, подписка, разделы Pro, установка на телефон, выход */
import { useState } from 'react';
import { api, ApiError, type Me } from '../lib/api';
import { fmt, fmt1 } from '../lib/format';
import { Icon } from '../components/Icon';
import { SubStatus } from '../components/Paywall';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toasts';
import { applyTheme, savedTheme, type Theme } from '../lib/theme';
import { buzz } from '../lib/motion';
import { can } from '../lib/features';

// уже переехали в новую версию — открываются по-настоящему
const PRO_SECTIONS: Array<[string, string, string, string]> = [
  ['goal', 'Цель и прогноз', 'target', 'var(--steps)'], ['gym', 'Зал', 'gym', 'var(--gym)'], ['study', 'Учёба и вопросы', 'study', 'var(--study)'],
  ['budget', 'Бюджет', 'money', 'var(--money)'], ['books', 'Книги', 'books', 'var(--books)'], ['stats', 'Статистика и итог недели', 'stats', 'var(--orange)'],
  ['awards', 'Достижения', 'star', 'var(--quiz)'], ['reminders', 'Напоминания', 'drop', 'var(--water)']
];

const THEMES: Array<[Theme, string, string]> = [['system', 'Как в системе', 'auto'], ['light', 'Светлая', 'sun'], ['dark', 'Тёмная', 'moon']];

/** Оформление: применяется сразу, сохраняется в профиль — телефон и компьютер подхватят */
export function ThemePick({ me, onSaved }: { me: Me; onSaved: (s: Record<string, unknown>) => void }) {
  const toast = useToast(), [cur, setCur] = useState<Theme>((me.profile?.settings?.theme as Theme) ?? savedTheme());
  const pick = async (t: Theme) => {
    if (t === cur) return; const was = cur;
    setCur(t); applyTheme(t); buzz(6);
    try { const r = await api<{ settings: Record<string, unknown> }>('/api/profile/settings', { method: 'PUT', body: { theme: t } }); onSaved(r.settings); }
    catch { setCur(was); applyTheme(was); toast('Не получилось сохранить тему', { err: true }); }
  };
  return <section className="panel">
    <div className="panel-h"><h2>Оформление</h2><small>общее для всех устройств</small></div>
    <div className="seg3" role="radiogroup" aria-label="Тема">{THEMES.map(([k, n, ic]) => <button key={k} role="radio" aria-checked={cur === k} className={cur === k ? 'on' : ''} onClick={() => pick(k)}>
      <span className={`th-sw th-${ic}`} aria-hidden="true" />{n}</button>)}</div>
  </section>;
}

export function More({ me, onPaywall, onPro, onSettings, onInstall, onLogout, onSaved }: { me: Me; onPaywall: (focus?: string) => void; onPro: (what: string) => void; onSettings: () => void; onInstall: () => void; onLogout: () => void; onSaved: (s: Record<string, unknown>) => void }) {
  const s = me.profile?.settings ?? {}, sub = me.subscription, [pw, setPw] = useState(false);
  return <div className="day more-page">
    <header className="dayhead"><div className="daytitle"><span>ещё</span><b>{s.name || me.username}</b></div></header>
    <button className="profile-card" onClick={onSettings}>
      <span className="avatar">{(s.name || me.username).slice(0, 1).toUpperCase()}</span>
      <span className="mid"><b>{s.name || me.username}</b><small>{fmt(s.kcal ?? 2000)} ккал · белок {fmt(s.protein ?? 0)} г · {fmt1((s.water ?? 2000) / 1000)} л · {fmt(s.steps ?? 8000)} шагов</small></span>
      <Icon name="edit" className="ic chev" />
    </button>
    <button className="sub-card" onClick={() => onPaywall()}>
      <span className="mid"><b>Подписка</b><small>{sub.source === 'trial' ? `Пробный Pro закончится через ${sub.daysLeft} дн.` : sub.pro ? (sub.expiresAt ? `Pro до ${new Date(sub.expiresAt).toLocaleDateString('ru-RU')}` : 'Pro открыт навсегда') : sub.features?.length ? `Свой набор: ${sub.features.length} ${sub.features.length === 1 ? 'раздел' : sub.features.length < 5 ? 'раздела' : 'разделов'}${sub.expiresAt ? ` · до ${new Date(sub.expiresAt).toLocaleDateString('ru-RU')}` : ''}` : 'Еда, вода, шаги, задачи, цель и статистика — бесплатно'}</small></span>
      <SubStatus sub={sub} />
    </button>
    <ThemePick me={me} onSaved={onSaved} />
    <div className="rows">
      {PRO_SECTIONS.map(([k, n, ic, c]) => { const open = can(sub, k === 'awards' ? 'stats' : k); return <button key={k} className="row" onClick={() => onPro(n)}>
        <span className="chip-ic" style={{ ['--c' as string]: c }}><Icon name={ic} /></span>
        <span className="mid"><b>{n}</b><small>{open ? 'открыть' : 'в Pro или в своём наборе'}</small></span>
        {!open ? <span className="lock">PRO</span> : <Icon name="chev" className="ic chev" />}
      </button>; })}
    </div>
    <div className="rows">
      <button className="row" onClick={onInstall}><span className="chip-ic" style={{ ['--c' as string]: 'var(--water)' }}><Icon name="plus" /></span><span className="mid"><b>Установить на телефон</b><small>как приложение, с иконкой на экране</small></span><Icon name="chev" className="ic chev" /></button>
      <button className="row" onClick={() => setPw(true)}><span className="chip-ic" style={{ ['--c' as string]: 'var(--orange)' }}><Icon name="edit" /></span><span className="mid"><b>Сменить пароль</b><small>другие устройства выйдут из аккаунта</small></span><Icon name="chev" className="ic chev" /></button>
      <a className="row" href="/api/export" download><span className="chip-ic" style={{ ['--c' as string]: 'var(--steps)' }}><Icon name="stats" /></span><span className="mid"><b>Выгрузить мои данные</b><small>всё, что записано, — одним файлом JSON</small></span><Icon name="chev" className="ic chev" /></a>
      <button className="row" onClick={onLogout}><span className="chip-ic" style={{ ['--c' as string]: 'var(--bad)' }}><Icon name="chevL" /></span><span className="mid"><b>Выйти</b><small>{me.username}</small></span></button>
    </div>
    <p className="hint">Бортжурнал · новая версия</p>
    <Sheet open={pw} onClose={() => setPw(false)} title="Сменить пароль">{pw && <PasswordForm onDone={() => setPw(false)} />}</Sheet>
  </div>;
}

export function SettingsForm({ me, onDone, onRedo }: { me: Me; onDone: (s: Record<string, unknown>) => void; onRedo: () => void }) {
  const toast = useToast(), s = me.profile?.settings ?? {};
  const [v, setV] = useState({ name: s.name ?? '', kcal: String(s.kcal ?? 2000), protein: String(s.protein ?? ''), water: String(s.water ?? 2000), steps: String(s.steps ?? 8000) });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }));
  return <form className="form" onSubmit={async e => {
    e.preventDefault(); setBusy(true);
    try { const r = await api<{ settings: Record<string, unknown> }>('/api/profile/settings', { method: 'PUT', body: { ...v, protein: v.protein || 0 } }); toast('Нормы сохранены'); onDone(r.settings); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } finally { setBusy(false); }
  }}>
    <label className="fld"><span>Имя</span><input className="in" value={v.name} onChange={set('name')} placeholder={me.username} /></label>
    <div className="grid2">
      <label className="fld"><span>Ккал в день</span><input className="in" inputMode="numeric" value={v.kcal} onChange={set('kcal')} /></label>
      <label className="fld"><span>Белок, г</span><input className="in" inputMode="numeric" value={v.protein} onChange={set('protein')} /></label>
      <label className="fld"><span>Вода, мл</span><input className="in" inputMode="numeric" value={v.water} onChange={set('water')} /></label>
      <label className="fld"><span>Шагов</span><input className="in" inputMode="numeric" value={v.steps} onChange={set('steps')} /></label>
    </div>
    <button className="primary" disabled={busy}>Сохранить</button>
    <button type="button" className="ghost" onClick={onRedo}>Пересчитать по анкете</button>
  </form>;
}

export function InstallHelp() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return <div className="form">
    <p style={{ margin: 0 }}>Бортжурнал ставится на экран «Домой» и открывается как приложение — без браузерных панелей.</p>
    {ios ? <ol className="steps"><li>Открой ссылку для телефона в <b>Safari</b>.</li><li>Нажми <b>«Поделиться»</b> внизу экрана.</li><li>Выбери <b>«На экран „Домой“»</b> → «Добавить».</li><li>Открывай журнал с новой иконки.</li></ol>
      : <ol className="steps"><li>Открой меню браузера (⋮).</li><li>Выбери <b>«Установить приложение»</b> или «Добавить на главный экран».</li></ol>}
    <div className="links">
      <div><b>Для компьютера</b><code>{location.origin}/</code></div>
      <div><b>Для телефона</b><code>{location.origin}/m</code></div>
    </div>
    <p className="hint" style={{ textAlign: 'left' }}>Обе ссылки открывают один журнал и одну базу: записал на телефоне — через несколько секунд видно на компьютере, и наоборот.</p>
  </div>;
}

export function PasswordForm({ onDone }: { onDone: () => void }) {
  const toast = useToast(), [v, setV] = useState({ current: '', next: '', again: '' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  return <form className="form" onSubmit={async e => {
    e.preventDefault(); setErr('');
    if (v.next !== v.again) { setErr('Новые пароли не совпадают.'); return; }
    setBusy(true);
    try { const r = await api<{ signedOut: number }>('/api/auth/password', { method: 'POST', body: { current: v.current, next: v.next } }); toast(r.signedOut ? `Пароль изменён. Вышли с других устройств: ${r.signedOut}` : 'Пароль изменён'); onDone(); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось'); } finally { setBusy(false); }
  }}>
    <label className="fld"><span>Текущий пароль</span><input className="in" type="password" autoComplete="current-password" required value={v.current} onChange={e => setV({ ...v, current: e.target.value })} /></label>
    <label className="fld"><span>Новый пароль</span><input className="in" type="password" autoComplete="new-password" required minLength={8} value={v.next} onChange={e => setV({ ...v, next: e.target.value })} /></label>
    <label className="fld"><span>Ещё раз</span><input className="in" type="password" autoComplete="new-password" required minLength={8} value={v.again} onChange={e => setV({ ...v, again: e.target.value })} /></label>
    {err && <p className="form-err">{err}</p>}
    <button className="primary" disabled={busy}>Сменить пароль</button>
  </form>;
}
