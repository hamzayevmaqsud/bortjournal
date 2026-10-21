/**
 * Профиль и настройки: аккаунт (имя, почта, пароль, часовой пояс), тело и цель (сводка анкеты и пересчёт),
 * нормы на день, настройки разделов, оформление, напоминания, устройства, данные и удаление аккаунта.
 * Всё хранится на сервере — телефон и компьютер видят одно и то же.
 */
import { useCallback, useEffect, useState } from 'react';
import { GOALS, PACE } from '@bortjournal/core';
import { api, ApiError, forgetLocal, type Me } from '../lib/api';
import { fmt } from '../lib/format';
import { Icon } from '../components/Icon';
import { SubStatus } from '../components/Paywall';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toasts';
import { PasswordForm, ThemePick } from './More';
import { TRACK } from './Onboarding';
import { VoiceSetup } from '../components/VoiceSetup';
import { AppleMark, GoogleMark, PROVIDER_NAMES, startUrl, useProviders, type ProviderId } from '../lib/oauth';

interface Account { username: string; email: string | null; createdAt: string; tzOffset: number; hasPassword: boolean; identities: Array<{ provider: ProviderId; email: string | null; createdAt: string }> }
interface Device { id: string; current: boolean; userAgent: string | null; createdAt: string }
const tzText = (m: number) => `UTC${m >= 0 ? '+' : '−'}${Math.floor(Math.abs(m) / 60)}${Math.abs(m) % 60 ? `:${String(Math.abs(m) % 60).padStart(2, '0')}` : ''}`;
const since = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
function device(ua: string | null) {
  const u = ua ?? '';
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Macintosh|Mac OS/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'Устройство';
  const br = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox|FxiOS/.test(u) ? 'Firefox' : /Chrome|CriOS/.test(u) ? 'Chrome' : /Safari/.test(u) ? 'Safari' : '';
  return { name: br ? `${os} · ${br}` : os, icon: /iPhone|Android/.test(os) ? 'steps' : 'today' };
}

function NormsForm({ me, onSaved }: { me: Me; onSaved: (s: Record<string, unknown>) => void }) {
  const toast = useToast(), s = me.profile?.settings ?? {};
  const init = () => ({ kcal: String(s.kcal ?? 2000), protein: String(s.protein ?? ''), fat: String(s.fat ?? ''), carbs: String(s.carbs ?? ''), water: String(s.water ?? 2000), steps: String(s.steps ?? 8000), study: String(s.study ?? 60) });
  const [v, setV] = useState(init), [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(init());
  const f = (k: keyof typeof v, name: string, unit: string) => <label key={k} className="fld nf"><span>{name}</span><span className="nf-in"><input className="in" inputMode="numeric" value={v[k]} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} /><small>{unit}</small></span></label>;
  return <form className="form" onSubmit={async e => {
    e.preventDefault(); setBusy(true);
    try { const r = await api<{ settings: Record<string, unknown> }>('/api/profile/settings', { method: 'PUT', body: { ...v, protein: v.protein || 0, fat: v.fat || 0, carbs: v.carbs || 0 } }); toast('Нормы сохранены'); onSaved(r.settings); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } finally { setBusy(false); }
  }}>
    <div className="nf-grid">
      {f('kcal', 'Калории', 'ккал')}{f('protein', 'Белок', 'г')}{f('fat', 'Жиры', 'г')}{f('carbs', 'Углеводы', 'г')}
      {f('water', 'Вода', 'мл')}{f('steps', 'Шаги', 'шагов')}{f('study', 'Учёба', 'мин')}
    </div>
    <p className="card-note">Калории и БЖУ считаются по анкете. Поправишь руками — будет так, пока не пересчитаешь анкету заново.</p>
    {dirty && <button className="primary" disabled={busy}>Сохранить нормы</button>}
  </form>;
}

function SectionsForm({ me, onSaved }: { me: Me; onSaved: (s: Record<string, unknown>) => void }) {
  const toast = useToast(), s = me.profile?.settings ?? {};
  const save = async (body: Record<string, unknown>) => { try { const r = await api<{ settings: Record<string, unknown> }>('/api/profile/settings', { method: 'PUT', body }); onSaved(r.settings); toast('Сохранено'); } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } };
  const rest = Number(s.rest) || 90, books = Number(s.booksGoal) || 12;
  const chosen = (s.sections as string[] | undefined) ?? TRACK.map(t => t[0]);
  const toggle = (k: string) => { const next = chosen.includes(k) ? chosen.filter(x => x !== k) : [...chosen, k]; if (!next.length) { toast('Оставь хотя бы один раздел', { err: true }); return; } save({ sections: next }); };
  return <div className="pf-list">
    <div className="pf-row pf-track"><span className="mid"><b>Что веду</b><small>главный экран и нижняя панель показывают только выбранное</small></span>
      <div className="chips">{TRACK.map(([k, n]) => <button key={k} type="button" className={`chip ${chosen.includes(k) ? 'on' : ''}`} aria-pressed={chosen.includes(k)} onClick={() => toggle(k)}>{n}</button>)}</div></div>
    <div className="pf-row"><span className="mid"><b>Отдых между подходами</b><small>таймер в зале после каждого подхода</small></span>
      <div className="chips">{[60, 90, 120, 180].map(x => <button key={x} type="button" className={`chip ${rest === x ? 'on' : ''}`} onClick={() => save({ rest: x })}>{x < 120 ? `${x} с` : `${x / 60} мин`}</button>)}</div></div>
    <div className="pf-row"><span className="mid"><b>Книг за год</b><small>цель года в «Книгах»</small></span>
      <span className="stepper"><button type="button" onClick={() => books > 1 && save({ booksGoal: books - 1 })} aria-label="Меньше">−</button><b>{books}</b><button type="button" onClick={() => save({ booksGoal: books + 1 })} aria-label="Больше">+</button></span></div>
    <p className="card-note">Бюджет на месяц и валюта — в разделе «Бюджет» → «Настроить».</p>
  </div>;
}

function DeleteForm({ username, hasPassword, onDeleted }: { username: string; hasPassword: boolean; onDeleted: () => void }) {
  const [v, setV] = useState({ name: '', password: '' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  return <form className="form" onSubmit={async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api('/api/account/delete', { method: 'POST', body: hasPassword ? { password: v.password } : { confirm: v.name } }); forgetLocal(); onDeleted(); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось'); } finally { setBusy(false); }
  }}>
    <p className="del-warn">Аккаунт и <b>все записи</b> — еда, тренировки, учёба, бюджет, книги, планы — удалятся навсегда, вернуть их будет нельзя. Если данные могут пригодиться, сначала выгрузи их.</p>
    <label className="fld"><span>Напиши логин «{username}», чтобы подтвердить</span><input className="in" autoComplete="off" autoCapitalize="none" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></label>
    {hasPassword && <label className="fld"><span>Пароль</span><input className="in" type="password" autoComplete="current-password" value={v.password} onChange={e => setV({ ...v, password: e.target.value })} /></label>}
    {err && <p className="form-err">{err}</p>}
    <button className="primary danger-bg" disabled={busy || v.name.trim().toLowerCase() !== username.toLowerCase() || (hasPassword && !v.password)}>Удалить аккаунт навсегда</button>
  </form>;
}

export function Profile({ me, wide, onBack, onSaved, onRedo, onReminders, onPaywall, onLogout, onDeleted }: {
  me: Me; wide: boolean; onBack: () => void; onSaved: (s: Record<string, unknown>) => void; onRedo: () => void;
  onReminders: () => void; onPaywall: () => void; onLogout: () => void; onDeleted: () => void;
}) {
  const toast = useToast(), s = me.profile?.settings ?? {}, p = me.profile, sub = me.subscription;
  const [acc, setAcc] = useState<Account | null>(null), [devs, setDevs] = useState<Device[]>([]), [allDevs, setAllDevs] = useState(false), [sheet, setSheet] = useState<null | 'password' | 'delete' | 'voice'>(null);
  const [name, setName] = useState(String(s.name ?? '')), [email, setEmail] = useState('');
  const load = useCallback(async () => {
    try { const a = await api<Account>('/api/account'); setAcc(a); setEmail(a.email ?? ''); } catch { /* без сети — покажем то, что есть */ }
    api<{ items: Device[] }>('/api/account/sessions').then(r => setDevs(r.items), () => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const saveName = async () => { if (name.trim() === String(s.name ?? '')) return; try { const r = await api<{ settings: Record<string, unknown> }>('/api/profile/settings', { method: 'PUT', body: { name } }); onSaved(r.settings); toast('Имя сохранено'); } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } };
  const saveEmail = async () => { if (!acc || email.trim().toLowerCase() === (acc.email ?? '')) return; try { const r = await api<{ email: string | null }>('/api/account', { method: 'PUT', body: { email } }); setAcc({ ...acc, email: r.email }); setEmail(r.email ?? ''); toast(r.email ? 'Почта сохранена' : 'Почта убрана'); } catch (x) { setEmail(acc.email ?? ''); toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } };
  const outOne = async (id: string) => { try { await api(`/api/account/sessions/${id}`, { method: 'DELETE' }); setDevs(d => d.filter(x => x.id !== id)); toast('Устройство вышло из аккаунта'); } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } };
  const outAll = async () => { try { const r = await api<{ signedOut: number }>('/api/account/sessions/others', { method: 'POST' }); setDevs(d => d.filter(x => x.current)); toast(`Вышли с других устройств: ${r.signedOut}`); } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } };
  const display = String(s.name || me.username), goal = p?.goal as keyof typeof GOALS | null, pace = p?.pace as 'soft' | 'mid' | 'hard' | null;
  const others = devs.filter(d => !d.current).length, pv = useProviders();
  const unlink = async (p: ProviderId) => { try { await api(`/api/auth/identities/${p}`, { method: 'DELETE' }); toast(`${PROVIDER_NAMES[p]} отвязан`); load(); } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } };

  return <div className="day profile-page">
    <header className="dayhead">
      {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
      <div className="daytitle"><span>профиль и настройки</span><b>{display}</b></div>
    </header>

    <section className="panel pf-hero">
      <span className="avatar big">{display.slice(0, 1).toUpperCase()}</span>
      <div className="mid"><b>{display}</b><small>@{me.username}{acc ? ` · с нами с ${since(acc.createdAt)}` : ''}</small></div>
      <button className="sub-mini" onClick={onPaywall}><SubStatus sub={sub} /></button>
    </section>

    <section className="panel"><div className="panel-h"><h2>Аккаунт</h2></div>
      <div className="pf-list">
        <label className="pf-row pf-edit"><span className="mid"><b>Как к тебе обращаться</b></span><input className="in" value={name} placeholder={me.username} maxLength={40} onChange={e => setName(e.target.value)} onBlur={saveName} onKeyDown={e => e.key === 'Enter' && saveName()} />{name.trim() !== String(s.name ?? '') && <button type="button" className="btn-accent" onClick={saveName}>Сохранить</button>}</label>
        <label className="pf-row pf-edit"><span className="mid"><b>Почта</b><small>для входа и восстановления — по желанию</small></span><input className="in" type="email" inputMode="email" autoCapitalize="none" value={email} placeholder="name@mail.az" onChange={e => setEmail(e.target.value)} onBlur={saveEmail} onKeyDown={e => e.key === 'Enter' && saveEmail()} />{acc && email.trim().toLowerCase() !== (acc.email ?? '') && <button type="button" className="btn-accent" onClick={saveEmail}>Сохранить</button>}</label>
        <div className="pf-row"><span className="mid"><b>Логин</b><small>для входа, не меняется</small></span><span className="pf-val">{me.username}</span></div>
        <div className="pf-row"><span className="mid"><b>Часовой пояс</b><small>берётся с устройства — по нему «сегодня» и напоминания</small></span><span className="pf-val">{tzText(acc?.tzOffset ?? me.tzOffset)}</span></div>
        <button className="pf-row" onClick={() => setSheet('password')}><span className="mid"><b>{acc && !acc.hasPassword ? 'Задать пароль' : 'Сменить пароль'}</b><small>{acc && !acc.hasPassword ? 'чтобы входить и по логину' : 'другие устройства выйдут из аккаунта'}</small></span><Icon name="chev" className="ic chev" /></button>
      </div>
    </section>

    {(pv.google || pv.apple || (acc?.identities.length ?? 0) > 0) && <section className="panel"><div className="panel-h"><h2>Способы входа</h2></div>
      <div className="pf-list">
        <div className="pf-row"><span className="mid"><b>Логин и пароль</b><small>{acc?.hasPassword ? `@${me.username}` : 'пароль не задан'}</small></span>{acc && !acc.hasPassword && <button className="btn-accent" onClick={() => setSheet('password')}>Задать</button>}</div>
        {(['apple', 'google'] as const).filter(p => pv[p] || acc?.identities.some(i => i.provider === p)).map(p => { const id = acc?.identities.find(i => i.provider === p); return <div key={p} className="pf-row">
          <span className="pv-ic">{p === 'google' ? <GoogleMark /> : <AppleMark />}</span>
          <span className="mid"><b>{PROVIDER_NAMES[p]}</b><small>{id ? (id.email ? `привязан · ${id.email}` : 'привязан') : 'не привязан'}</small></span>
          {id ? <button className="btn-accent" onClick={() => unlink(p)}>Отвязать</button> : pv[p] && <a className="btn-accent" href={startUrl(p, true)}>Привязать</a>}</div>; })}
      </div>
      <p className="card-note">Привязанным аккаунтом можно входить вместо логина и пароля. Последний способ входа отвязать нельзя.</p>
    </section>}

    <section className="panel"><div className="panel-h"><h2>Тело и цель</h2><small>по анкете</small></div>
      {p?.heightCm ? <div className="pf-facts">
        <div><small>Пол</small><b>{p.sex === 'f' ? 'женский' : 'мужской'}</b></div>
        <div><small>Возраст</small><b>{p.age ?? '—'}</b></div>
        <div><small>Рост</small><b>{p.heightCm} см</b></div>
        <div><small>Цель</small><b>{goal && GOALS[goal] ? GOALS[goal].name : '—'}</b></div>
        {goal && goal !== 'maintain' && <div><small>Темп</small><b>{pace && goal in PACE ? PACE[goal as 'lose' | 'gain'][pace].name : '—'}</b></div>}
        {p.targetKg && <div><small>Желаемый вес</small><b>{fmt(p.targetKg)} кг</b></div>}
      </div> : <p className="hint" style={{ textAlign: 'left', margin: 2 }}>Анкета не заполнена.</p>}
      <button className="add-row" onClick={onRedo}><Icon name="repeat" />Изменить анкету и пересчитать план</button>
    </section>

    <section className="panel"><div className="panel-h"><h2>Нормы на день</h2></div><NormsForm key={JSON.stringify(s)} me={me} onSaved={onSaved} /></section>
    <section className="panel"><div className="panel-h"><h2>Разделы</h2></div><SectionsForm me={me} onSaved={onSaved} /></section>
    <ThemePick me={me} onSaved={onSaved} />

    <section className="panel"><div className="panel-h"><h2>Уведомления и iPhone</h2></div>
      <div className="pf-list"><button className="pf-row" onClick={() => setSheet('voice')}><span className="mid"><b>Голос и календарь</b><small>кнопка действия, Siri, виджет; задачи в «Календаре»</small></span><Icon name="chev" className="ic chev" /></button>
        <button className="pf-row" onClick={onReminders}><span className="mid"><b>Напоминания</b><small>{s.remind?.off ? 'выключены' : 'вода, еда, задачи, тренировки, вопросы дня'}</small></span><Icon name="chev" className="ic chev" /></button></div>
    </section>

    <section className="panel"><div className="panel-h"><h2>Устройства</h2><small>где выполнен вход</small></div>
      <div className="pf-list">{(allDevs ? devs : devs.slice(0, 5)).map(d => { const x = device(d.userAgent); return <div key={d.id} className="pf-row">
        <span className="chip-ic" style={{ ['--c' as string]: d.current ? 'var(--good)' : 'var(--water)' }}><Icon name={x.icon} /></span>
        <span className="mid"><b>{x.name}</b><small>{d.current ? 'это устройство' : `вход ${since(d.createdAt)}`}</small></span>
        {!d.current && <button className="btn-accent" onClick={() => outOne(d.id)}>Выйти</button>}</div>; })}</div>
      {!allDevs && devs.length > 5 && <button className="link-btn" style={{ marginTop: 10 }} onClick={() => setAllDevs(true)}>Показать все · {devs.length}</button>}
      {others > 0 && <button className="add-row" onClick={outAll}>Выйти на всех других устройствах · {others}</button>}
    </section>

    <section className="panel"><div className="panel-h"><h2>Данные</h2></div>
      <div className="pf-list">
        <a className="pf-row" href="/api/export" download><span className="mid"><b>Выгрузить мои данные</b><small>всё, что записано, — одним файлом JSON</small></span><Icon name="chev" className="ic chev" /></a>
        <button className="pf-row" onClick={onLogout}><span className="mid"><b>Выйти</b><small>на этом устройстве</small></span><Icon name="chev" className="ic chev" /></button>
        <button className="pf-row pf-danger" onClick={() => setSheet('delete')}><span className="mid"><b>Удалить аккаунт</b><small>вместе со всеми записями, без возврата</small></span><Icon name="chev" className="ic chev" /></button>
      </div>
    </section>

    <Sheet open={!!sheet} onClose={() => setSheet(null)} tall={sheet === 'voice'} title={sheet === 'voice' ? 'Голос и календарь' : sheet === 'delete' ? 'Удалить аккаунт' : acc && !acc.hasPassword ? 'Задать пароль' : 'Сменить пароль'}>
      {sheet === 'password' && <PasswordForm first={acc ? !acc.hasPassword : false} onDone={() => { setSheet(null); load(); }} />}
      {sheet === 'voice' && <VoiceSetup />}
      {sheet === 'delete' && <DeleteForm username={me.username} hasPassword={acc?.hasPassword ?? true} onDeleted={onDeleted} />}
    </Sheet>
  </div>;
}
