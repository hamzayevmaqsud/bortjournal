/**
 * «Внешний вид»: темы и мелочи интерфейса, которые открываются с уровнем (уровень — из достижений).
 * Закрытое видно с замком и уровнем; тему можно примерить (предпросмотр на время, пока открыт лист), поставить — когда откроется.
 * LevelUp — поздравление «Новый уровень!»: что открылось и кнопка «Попробовать».
 */
import { useEffect, useState } from 'react';
import type { Look } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { applyLook, savedLook } from '../lib/look';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';
import { useToast } from './Toasts';

interface Theme { id: string; name: string; level: number; hint: string; swatch: [string, string, string]; open: boolean }
interface Extra { key: keyof Look; name: string; hint: string; level: number; options: Array<{ id: string; name: string }>; open: boolean }
export interface LookState { level: number; seen: number; look: Look; fresh: Array<{ kind: 'theme' | 'extra'; id: string; name: string; level: number }>; themes: Theme[]; extras: Extra[] }

const STREAK_IC: Record<string, string> = { flame: 'flame', star: 'star', drop: 'drop', snow: 'snow' };

export function Looks({ onSaved }: { onSaved?: (look: Look) => void }) {
  const toast = useToast(), [s, setS] = useState<LookState | null>(null), [err, setErr] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { api<LookState>('/api/look').then(setS, e => setErr(e instanceof ApiError ? e.message : 'Не получилось загрузить')); }, []);
  // примерка закрытой темы — только пока лист открыт: при закрытии возвращаем выбранную
  useEffect(() => () => { if (preview) applyLook(savedLook()); }, [preview]);
  if (err) return <p className="form-err">{err}</p>;
  if (!s) return <div className="skel" style={{ height: 260 }} />;

  const save = async (patch: Partial<Look>) => {
    try {
      const r = await api<{ look: Look }>('/api/look', { method: 'PUT', body: patch });
      setS(x => x && { ...x, look: r.look }); setPreview(null); applyLook(r.look); onSaved?.(r.look); buzz(8);
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); }
  };
  const tryOn = (t: Theme) => { setPreview(t.id); applyLook({ ...s.look, theme: t.id }); };
  const toNext = s.themes.concat().filter(t => !t.open).sort((a, b) => a.level - b.level)[0];

  return <div className="looks">
    <p className="lk-level"><b>Уровень {s.level}</b>{toNext ? <> · следующая тема — «{toNext.name}» на уровне {toNext.level}. Уровень растёт с достижениями: «Статистика → Достижения».</> : <> · открыто всё.</>}</p>
    <div className="lk-themes">{s.themes.map(t => {
      const on = (preview ?? s.look.theme) === t.id;
      return <button key={t.id} type="button" className={`lk-theme ${on ? 'on' : ''} ${t.open ? '' : 'locked'}`} aria-pressed={on}
        onClick={() => t.open ? save({ theme: t.id }) : tryOn(t)} title={t.open ? t.hint : `Откроется на уровне ${t.level} — нажми, чтобы примерить`}>
        <span className="lk-sw" style={{ background: t.swatch[0] }}><i style={{ background: t.swatch[1] }} /><i style={{ background: t.swatch[2] }} /></span>
        <b>{t.name}</b><small>{t.open ? t.hint : `уровень ${t.level}`}</small>
      </button>;
    })}</div>
    {preview && <div className="lk-preview"><span>Примерка: «{s.themes.find(t => t.id === preview)?.name}». Откроется на уровне {s.themes.find(t => t.id === preview)?.level}.</span>
      <button type="button" className="btn-accent" onClick={() => { setPreview(null); applyLook(s.look); }}>Вернуть мою</button></div>}
    {s.extras.map(x => <section key={x.key} className={`lk-extra ${x.open ? '' : 'locked'}`}>
      <div className="lk-x-h"><b>{x.name}</b><small>{x.open ? x.hint : `откроется на уровне ${x.level}`}</small></div>
      <div className="seg2 lk-opts" role="group" aria-label={x.name}>{x.options.map((o, i) => {
        const can = x.open || i === 0, on = s.look[x.key] === o.id;
        return <button key={o.id} type="button" className={on ? 'on' : ''} aria-pressed={on} disabled={!can} onClick={() => save({ [x.key]: o.id } as Partial<Look>)}>
          {x.key === 'streak' && <Icon name={STREAK_IC[o.id] ?? 'flame'} />}{o.name}</button>;
      })}</div>
    </section>)}
  </div>;
}

/** «Новый уровень!» — что открылось; «Попробовать» ставит первую открывшуюся тему */
export function LevelUp({ state, onDone }: { state: LookState; onDone: () => void }) {
  const toast = useToast(), theme = state.fresh.find(f => f.kind === 'theme');
  useEffect(() => { void api('/api/look/seen', { method: 'POST' }).catch(() => {}); buzz([10, 40, 10, 40, 20]); }, []);
  const tryTheme = async () => {
    if (!theme) { onDone(); return; }
    try { const r = await api<{ look: Look }>('/api/look', { method: 'PUT', body: { theme: theme.id } }); applyLook(r.look); toast(`Тема «${state.themes.find(t => t.id === theme.id)?.name}» включена`); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); }
    onDone();
  };
  return <div className="form levelup">
    <div className="lu-badge"><span>уровень</span><b>{state.level}</b></div>
    <p className="lu-lead">Открылось новое:</p>
    <ul className="lu-list">{state.fresh.map(f => <li key={`${f.kind}-${f.id}`}><Icon name={f.kind === 'theme' ? 'sun' : 'star'} />{f.name}<small>уровень {f.level}</small></li>)}</ul>
    <div className="ob-nav"><button type="button" className="ghost" onClick={onDone}>Позже</button>
      <button type="button" className="primary" onClick={tryTheme}>{theme ? 'Попробовать тему' : 'Отлично'}</button></div>
  </div>;
}
