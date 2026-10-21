/**
 * Админка беты: сколько людей и насколько активны, кто что записывает, расход ИИ, регистрации, отзывы.
 * Видна только логинам из ADMIN_USERS на сервере.
 */
import { useCallback, useEffect, useState } from 'react';
import { addDays } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { fmt, plural } from '../lib/format';
import { Bars, human } from '../components/Charts';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';

const ago = (iso: string | null) => { if (!iso) return 'не заходил'; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 2 ? 'сейчас' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн. назад`; };
const SECT: Record<string, string> = { food: 'еда', water: 'вода', steps: 'шаги', tasks: 'задачи', gym: 'зал', study: 'учёба', budget: 'бюджет', books: 'книги' };

export function Admin({ wide, onBack }: { wide: boolean; onBack: () => void }) {
  const toast = useToast(), [d, setD] = useState<any>(null), [all, setAll] = useState(false);
  const load = useCallback(async () => { try { setD(await api<any>('/api/admin/overview')); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось загрузить', { err: true }); } }, [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="day"><div className="skel" style={{ height: 400 }} /></div>;
  const today = new Date().toISOString().slice(0, 10), days = Array.from({ length: 14 }, (_, k) => addDays(today, k - 13));
  const series = (rows: Array<{ day: string; n: number }>) => days.map(day => { const n = rows.filter(r => r.day === day).reduce((a, r) => a + r.n, 0); return { label: String(+day.slice(8)), v: n, hint: `${human(day)}: ${n}` }; });
  const toggle = async (id: string) => { await api(`/api/admin/feedback/${id}/done`, { method: 'POST' }).catch(() => {}); load(); };
  const people = all ? d.people : d.people.slice(0, 30);
  return <div className="day admin-page">
    <header className="dayhead">
      {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
      <div className="daytitle"><span>бета · только для тебя</span><b>Админка</b></div>
      <button className="nav" onClick={load} aria-label="Обновить"><Icon name="repeat" /></button>
    </header>
    <div className="kpis">
      <div className="kpi"><span>Людей</span><b>{d.totals.users}</b><small>анкету прошли {d.totals.onboarded}</small></div>
      <div className="kpi"><span>Заходили</span><b>{d.totals.active1}</b><small>за сутки · за неделю {d.totals.active7}</small></div>
      <div className="kpi"><span>ИИ за 7 дней</span><b>{fmt(d.totals.ai7)}</b><small>обращений</small></div>
      <div className="kpi"><span>Отзывы</span><b>{d.totals.feedbackNew}</b><small>не разобрано</small></div>
    </div>
    <section className="panel"><div className="panel-h"><h2>Активные по дням</h2><small>сделали хоть одну запись</small></div><Bars rows={series(d.active)} color="var(--good)" every={2} /></section>
    <section className="panel"><div className="panel-h"><h2>Регистрации</h2></div><Bars rows={series(d.signups)} color="var(--orange)" every={2} /></section>
    <section className="panel"><div className="panel-h"><h2>ИИ по дням</h2><small>еда, вопросы, голос, шпаргалки</small></div><Bars rows={series(d.ai)} color="var(--quiz)" every={2} /></section>

    <section className="panel"><div className="panel-h"><h2>Отзывы</h2><small>{d.feedback.length}</small></div>
      {d.feedback.length ? <div className="fb-list">{d.feedback.map((f: any) => <article key={f.id} className={`fb ${f.done ? 'done' : ''}`}>
        <div className="fb-head"><b>@{f.username ?? 'удалён'}</b><span>{human(String(f.createdAt).slice(0, 10))} · {f.context?.screen || '—'}{f.context?.size ? ` · ${f.context.size}` : ''}</span></div>
        <p>{f.text}</p>
        <div className="fb-foot"><small>{(f.context?.device ?? '').replace(/^Mozilla\/5\.0 /, '').slice(0, 80)}</small><button className="btn-accent" onClick={() => toggle(f.id)}>{f.done ? 'Вернуть' : 'Разобрано'}</button></div>
      </article>)}</div> : <p className="hint" style={{ textAlign: 'left', margin: 2 }}>Отзывов пока нет.</p>}
    </section>

    <section className="panel"><div className="panel-h"><h2>Люди</h2><small>по последнему входу</small></div>
      <div className="ad-people">{people.map((p: any) => <div key={p.id} className="ad-p">
        <div className="ad-p-head"><b>@{p.username}</b><span>{ago(p.lastSeenAt)}</span></div>
        <small>с {human(String(p.createdAt).slice(0, 10))}{p.onboarded ? '' : ' · анкета не пройдена'}{Array.isArray(p.sections) ? ` · ${p.sections.map((x: string) => SECT[x] ?? x).join(', ')}` : ''}</small>
        <div className="ad-nums">{([['еда', p.meals], ['напитки', p.drinks], ['задачи', p.tasks], ['трен.', p.workouts], ['конспекты', p.materials], ['траты', p.spends], ['дней из 7', p.days7], ['ИИ 7д', p.ai7]] as Array<[string, number]>).map(([n, v]) => <span key={n} className={v ? '' : 'zero'}><b>{fmt(v)}</b>{n}</span>)}</div>
      </div>)}</div>
      {!all && d.people.length > 30 && <button className="link-btn" onClick={() => setAll(true)}>Показать всех · {d.people.length} {plural(d.people.length, 'человек', 'человека', 'человек')}</button>}
    </section>
  </div>;
}
