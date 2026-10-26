/**
 * Вход через Google и Apple: адрес начала входа, какие провайдеры включены на сервере,
 * и результат возврата (сервер кладёт его в адрес: #auth-error=… или #auth-ok=…).
 */
import { useEffect, useState } from 'react';
import { mobileOnly } from './wide';

export type ProviderId = 'google' | 'apple';
export const PROVIDER_NAMES: Record<ProviderId, string> = { google: 'Google', apple: 'Apple' };
/** внутри приложения для iPhone Google не пускает вход во встроенном браузере — эту кнопку там прячем */
export const nativeApp = () => !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
export const startUrl = (p: ProviderId, link = false) => `/api/auth/${p}/start?back=${mobileOnly() ? '/m' : '/'}${link ? '&link=1' : ''}`;

export function useProviders() {
  const [v, setV] = useState<Record<ProviderId | 'beta', boolean>>({ google: false, apple: false, beta: false });
  useEffect(() => { fetch('/api/auth/providers').then(r => r.json()).then(j => setV({ google: !!j.google && !nativeApp(), apple: !!j.apple, beta: !!j.beta }), () => {}); }, []);
  return v;
}
/** прочитать и убрать из адреса результат входа */
export function takeAuthResult(): { error?: string; ok?: string } | null {
  const m = /^#auth-(error|ok)=(.*)$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  const text = decodeURIComponent(m[2]!);
  return m[1] === 'error' ? { error: text } : { ok: text };
}

export const GoogleMark = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="pv-mark"><path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z" /><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1-3.8 1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.7 14c-.2-.7-.4-1.3-.4-2s.1-1.4.4-2V7.2H2.1a11 11 0 0 0 0 9.6z" /><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.1 7.2L5.7 10c.9-2.6 3.4-4.6 6.3-4.6z" /></svg>;
export const AppleMark = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="pv-mark"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9s-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6s1.8-.8 3.3-.8 2 .8 3.4.8 2.2-1.3 3.1-2.5a10 10 0 0 0 1.4-2.9 4.4 4.4 0 0 1-2.6-4.1zM13.9 5c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.2 1.2.1 2.3-.6 3-1.5z" /></svg>;
