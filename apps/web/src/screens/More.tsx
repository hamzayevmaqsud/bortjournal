/** «Ещё»: профиль и нормы, подписка, разделы Pro, установка на телефон, выход */
import { useState } from 'react';
import { api, ApiError, type Me } from '../lib/api';
import { fmt, fmt1 } from '../lib/format';
import { Icon } from '../components/Icon';
import { SubStatus } from '../components/Paywall';
import { useToast } from '../components/Toasts';

const PRO_SECTIONS: Array<[string, string, string, string]> = [
  ['goal', 'Цель и прогноз', 'today', 'var(--steps)'], ['gym', 'Зал', 'gym', 'var(--gym)'], ['study', 'Учёба и вопросы', 'study', 'var(--study)'],
  ['budget', 'Бюджет', 'money', 'var(--money)'], ['books', 'Книги', 'books', 'var(--books)'], ['stats', 'Статистика и итог недели', 'flame', 'var(--orange)'],
  ['awards', 'Достижения', 'check', 'var(--quiz)'], ['reminders', 'Напоминания', 'drop', 'var(--water)']
];

export function More({ me, onPaywall, onSettings, onInstall, onLogout }: { me: Me; onPaywall: (focus?: string) => void; onSettings: () => void; onInstall: () => void; onLogout: () => void }) {
  const s = me.profile?.settings ?? {}, sub = me.subscription;
  return <div className="day more-page">
    <header className="dayhead"><div className="daytitle"><span>ещё</span><b>{s.name || me.username}</b></div></header>
    <button className="profile-card" onClick={onSettings}>
      <span className="avatar">{(s.name || me.username).slice(0, 1).toUpperCase()}</span>
      <span className="mid"><b>{s.name || me.username}</b><small>{fmt(s.kcal ?? 2000)} ккал · белок {fmt(s.protein ?? 0)} г · {fmt1((s.water ?? 2000) / 1000)} л · {fmt(s.steps ?? 8000)} шагов</small></span>
      <Icon name="edit" className="ic chev" />
    </button>
    <button className="sub-card" onClick={() => onPaywall()}>
      <span className="mid"><b>Подписка</b><small>{sub.source === 'trial' ? `Пробный Pro закончится через ${sub.daysLeft} дн.` : sub.pro ? (sub.expiresAt ? `Pro до ${new Date(sub.expiresAt).toLocaleDateString('ru-RU')}` : 'Pro открыт навсегда') : 'Еда, вода, шаги и задачи — бесплатно'}</small></span>
      <SubStatus sub={sub} />
    </button>
    <div className="rows">
      {PRO_SECTIONS.map(([k, n, ic, c]) => <button key={k} className="row" onClick={() => onPaywall(n)}>
        <span className="chip-ic" style={{ ['--c' as string]: c }}><Icon name={ic} /></span>
        <span className="mid"><b>{n}</b><small>{sub.pro ? (sub.source === 'free' ? 'переезжает в новую версию — пока в старой' : 'скоро — в ближайшем обновлении') : 'часть Pro'}</small></span>
        {!sub.pro ? <span className="lock">PRO</span> : <Icon name="chev" className="ic chev" />}
      </button>)}
    </div>
    <div className="rows">
      <button className="row" onClick={onInstall}><span className="chip-ic" style={{ ['--c' as string]: 'var(--navy)' }}><Icon name="plus" /></span><span className="mid"><b>Установить на телефон</b><small>как приложение, с иконкой на экране</small></span><Icon name="chev" className="ic chev" /></button>
      <button className="row" onClick={onLogout}><span className="chip-ic" style={{ ['--c' as string]: 'var(--bad)' }}><Icon name="chevL" /></span><span className="mid"><b>Выйти</b><small>{me.username}</small></span></button>
    </div>
    <p className="hint">Бортжурнал · новая версия</p>
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
    {ios ? <ol className="steps"><li>Открой эту страницу в <b>Safari</b>.</li><li>Нажми <b>«Поделиться»</b> внизу экрана.</li><li>Выбери <b>«На экран „Домой“»</b> → «Добавить».</li><li>Открывай журнал с новой иконки.</li></ol>
      : <ol className="steps"><li>Открой меню браузера (⋮).</li><li>Выбери <b>«Установить приложение»</b> или «Добавить на главный экран».</li></ol>}
    <p className="hint" style={{ textAlign: 'left' }}>Компьютер и телефон смотрят в одну базу: записал на одном — видно на другом.</p>
  </div>;
}
