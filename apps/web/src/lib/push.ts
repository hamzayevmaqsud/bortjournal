/** Web Push на этом устройстве: умеет ли браузер, разрешение и подписка (общее для «Напоминаний» и анкеты) */
import { api } from './api';

export const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
export const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const keyBytes = (b64: string) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };

/** спросить разрешение и подписать устройство; false — человек не разрешил */
export async function subscribeHere<T>(key: string): Promise<{ sub: PushSubscription; view: T } | false> {
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  return { sub, view: await api<T>('/api/push/subscribe', { method: 'POST', body: sub.toJSON() }) };
}
