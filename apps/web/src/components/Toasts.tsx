/** Уведомления сверху: короткие, с «Вернуть» для удалений */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { buzz } from '../lib/motion';

interface ToastItem { id: number; text: string; undo?: () => void; err?: boolean }
const Ctx = createContext<(text: string, opts?: { undo?: () => void; err?: boolean }) => void>(() => {});
export const useToast = () => useContext(Ctx);

function Toast({ t, onGone }: { t: ToastItem; onGone: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const a = requestAnimationFrame(() => setShown(true));
    const b = setTimeout(() => setShown(false), t.undo ? 5000 : 2600), c = setTimeout(onGone, t.undo ? 5300 : 2900);
    return () => { cancelAnimationFrame(a); clearTimeout(b); clearTimeout(c); };
  }, [t, onGone]);
  return <div className={`toast ${shown ? 'in' : ''} ${t.err ? 'err' : ''}`} role="status">
    <span>{t.text}</span>
    {t.undo && <button onClick={() => { t.undo!(); buzz(8); setShown(false); setTimeout(onGone, 300); }}>Вернуть</button>}
  </div>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, opts: { undo?: () => void; err?: boolean } = {}) => setList(l => [...l.slice(-2), { id: Date.now() + Math.random(), text, ...opts }]), []);
  const remove = useCallback((id: number) => setList(l => l.filter(x => x.id !== id)), []);
  return <Ctx.Provider value={push}>{children}<div className="toasts" aria-live="polite">{list.map(t => <Toast key={t.id} t={t} onGone={() => remove(t.id)} />)}</div></Ctx.Provider>;
}
