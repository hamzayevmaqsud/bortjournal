/** Широкий экран (компьютер, планшет боком): раскладка как в веб-версии журнала — сетка карточек и плавающая панель */
import { useEffect, useState } from 'react';

const Q = '(min-width: 900px)';
export function useWide() {
  const [wide, setWide] = useState(() => matchMedia(Q).matches);
  useEffect(() => { const m = matchMedia(Q), on = () => setWide(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  return wide;
}
