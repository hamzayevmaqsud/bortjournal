/**
 * Напоминания (бесплатно): включить уведомления на этом устройстве, выбрать, о чём напоминать, проверить.
 * На iPhone уведомления работают только у приложения, добавленного на экран «Домой» (iOS 16.4+).
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Icon } from './Icon';
import { useToast } from './Toasts';

const KINDS: Array<[string, string, string]> = [
  ['water', 'Вода', 'если отстаёшь от нормы — не чаще раза в 2,5 часа, с 10 до 21'],
  ['food', 'Еда', 'в 13:30, если сегодня ещё ничего не записано'],
  ['tasks', 'Задачи', 'заранее, до времени задачи — выбери ниже'],
  ['gym', 'Тренировка', 'по плану тренировок, в его время'],
  ['quiz', 'Вопросы дня', 'в 10:00, если есть что повторить'],
  ['streak', 'Серия', 'в 21:00, если сегодня пусто, а серия идёт'],
  ['tip', 'Совет на вечер', 'в 20:40 — одна подсказка по сегодняшнему дню, если есть что сказать'],
  ['review', 'Итог недели', 'в воскресенье в 19:00 — оценка недели и серия']
];
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const keyBytes = (b64: string) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };

interface View { key: string; devices: number; off: boolean; lead: number; kinds: Record<string, boolean> }

export function Reminders({ onInstall }: { onInstall: () => void }) {
  const toast = useToast(), [v, setV] = useState<View | null>(null), [here, setHere] = useState<PushSubscription | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    api<View>('/api/push').then(setV, () => {});
    if (supported()) navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(setHere, () => {});
  }, []);
  const fail = (e: unknown, msg: string) => toast(e instanceof ApiError ? e.message : msg, { err: true });
  const enable = async () => {
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== 'granted') { toast('Уведомления запрещены. Разреши их в настройках браузера или телефона.', { err: true }); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(v!.key) });
      setV(await api<View>('/api/push/subscribe', { method: 'POST', body: sub.toJSON() })); setHere(sub);
      toast('Напоминания включены на этом устройстве');
    } catch (e) { fail(e, 'Не получилось включить уведомления'); } finally { setBusy(false); }
  };
  const disable = async () => {
    if (!here) return; setBusy(true);
    try { const endpoint = here.endpoint; await here.unsubscribe().catch(() => {}); setV(await api<View>('/api/push/unsubscribe', { method: 'POST', body: { endpoint } })); setHere(null); toast('На этом устройстве выключено'); }
    catch (e) { fail(e, 'Не получилось'); } finally { setBusy(false); }
  };
  const save = async (body: Record<string, unknown>) => { try { setV(await api<View>('/api/push/settings', { method: 'PUT', body })); } catch (e) { fail(e, 'Не сохранилось'); } };
  const test = async () => { try { await api('/api/push/test', { method: 'POST' }); toast('Отправлено — уведомление придёт через пару секунд'); } catch (e) { fail(e, 'Не получилось отправить'); } };

  if (!v) return <div className="skel" style={{ height: 240 }} />;
  const needInstall = ios() && !standalone();
  return <div className="form rem">
    <div className={`rem-status ${here ? 'on' : ''}`}>
      <span className="chip-ic" style={{ ['--c' as string]: here ? 'var(--good)' : 'var(--water)' }}><Icon name={here ? 'check' : 'drop'} /></span>
      <span className="mid"><b>{here ? 'Включены на этом устройстве' : 'На этом устройстве выключены'}</b>
        <small>{v.devices ? `Всего устройств с напоминаниями: ${v.devices}` : 'Пока ни одного устройства'}</small></span>
    </div>
    {needInstall ? <div className="rem-hint"><p>На iPhone уведомления приходят только приложению с экрана «Домой». Добавь Lumi на экран «Домой», открой его оттуда и включи напоминания здесь.</p>
      <button type="button" className="ghost" onClick={onInstall}>Как добавить на экран «Домой»</button></div>
      : !supported() ? <p className="rem-hint">Этот браузер не умеет присылать уведомления. Открой журнал в Safari на iPhone, в Chrome или в Edge.</p>
      : here ? <div className="row-flex"><button type="button" className="ghost" disabled={busy} onClick={test}>Проверить</button><button type="button" className="ghost danger" disabled={busy} onClick={disable}>Выключить здесь</button></div>
      : <button type="button" className="primary" disabled={busy} onClick={enable}>{busy ? <span className="spin" /> : 'Включить на этом устройстве'}</button>}
    <div className="rem-list">
      <label className="rem-row rem-all"><span className="mid"><b>Все напоминания</b><small>общий выключатель для всех устройств</small></span>
        <input type="checkbox" className="switch" checked={!v.off} onChange={e => save({ off: !e.target.checked })} /></label>
      {KINDS.map(([k, n, d]) => <label key={k} className={`rem-row ${v.off ? 'dim' : ''}`}><span className="mid"><b>{n}</b><small>{d}</small></span>
        <input type="checkbox" className="switch" disabled={v.off} checked={v.kinds[k] ?? true} onChange={e => save({ kinds: { [k]: e.target.checked } })} /></label>)}
    </div>
    <div className="fld"><span>О задаче со временем — напомнить за</span><div className="chips">{[0, 5, 10, 15, 30, 60].map(m => <button key={m} type="button" className={`chip ${v.lead === m ? 'on' : ''}`} onClick={() => save({ lead: m })}>{m ? `${m} мин` : 'в само время'}</button>)}</div></div>
    <p className="card-note">Напоминания приходят по твоему местному времени и не повторяются: каждое — не больше раза в день. Если есть что-то ко времени, вода подождёт.</p>
  </div>;
}
