/**
 * Широкий экран (компьютер, планшет боком): раскладка как в веб-версии журнала — сетка карточек и плавающая панель.
 * Адрес /m — всегда телефонная раскладка, даже на большом экране.
 */
import { useEffect, useState } from 'react';

const Q = '(min-width: 900px)';
export const mobileOnly = () => location.pathname === '/m' || location.pathname.startsWith('/m/');
export function useWide() {
  const [wide, setWide] = useState(() => !mobileOnly() && matchMedia(Q).matches);
  useEffect(() => { const m = matchMedia(Q), on = () => setWide(!mobileOnly() && m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  return wide;
}
