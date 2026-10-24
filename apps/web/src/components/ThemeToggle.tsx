/**
 * Быстрый переключатель темы (солнце ↔ луна): на входе и на широком экране — в правом верхнем углу, на телефоне — в «Ещё».
 * Переключает видимую тему на противоположную. У вошедшего сохраняется в профиле (общая для устройств), как и в «Настройках».
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { applyTheme, savedTheme, type Theme } from '../lib/theme';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';

const darkNow = (t: Theme) => t === 'dark' || (t === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);

export function ThemeToggle({ className = '', onSaved }: { className?: string; onSaved?: (s: Record<string, unknown>) => void }) {
  const [t, setT] = useState<Theme>(savedTheme());
  // тему могли сменить в «Настройках» или в другом переключателе
  useEffect(() => { const f = () => setT(savedTheme()); addEventListener('lumi-theme', f); return () => removeEventListener('lumi-theme', f); }, []);
  const dark = darkNow(t);
  const flip = async () => {
    const next: Theme = dark ? 'light' : 'dark';
    setT(next); applyTheme(next); buzz(6); dispatchEvent(new Event('lumi-theme'));
    if (onSaved) { try { const r = await api<{ settings: Record<string, unknown> }>('/api/profile/settings', { method: 'PUT', body: { theme: next } }); onSaved(r.settings); } catch { /* тема уже применена на этом устройстве */ } }
  };
  return <button type="button" className={`theme-toggle ${className}`} onClick={flip} aria-label={dark ? 'Светлая тема' : 'Тёмная тема'} title={dark ? 'Светлая тема' : 'Тёмная тема'}>
    <Icon name={dark ? 'sun' : 'moon'} />
  </button>;
}

/**
 * Маяк — он же переключатель темы на входе: нажми — день ↔ ночь. В тёмной теме у маяка горит фонарь.
 * После луча по LUMI в маяк прилетает огонёк (Login) — видно, что на него можно нажать.
 */
export function LighthouseToggle() {
  const [t, setT] = useState<Theme>(savedTheme());
  useEffect(() => { const f = () => setT(savedTheme()); addEventListener('lumi-theme', f); return () => removeEventListener('lumi-theme', f); }, []);
  const dark = darkNow(t);
  const flip = () => { const next: Theme = dark ? 'light' : 'dark'; setT(next); applyTheme(next); buzz(6); dispatchEvent(new Event('lumi-theme')); };
  return <button type="button" className={`login-mark-btn ${dark ? 'night' : ''}`} onClick={flip} data-hint="Нажми — сменит тему"
    aria-label={dark ? 'Маяк: включить светлую тему' : 'Маяк: включить тёмную тему'} title={dark ? 'Светлая тема' : 'Тёмная тема'}>
    <img className="login-mark" src="/favicon.svg" alt="" />
  </button>;
}
