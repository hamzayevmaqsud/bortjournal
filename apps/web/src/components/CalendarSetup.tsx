/**
 * Подключение Google Календаря: Lumi ведёт свой календарь «Lumi» с задачами и тренировками,
 * а встречи из основного календаря показывает в ленте дня. Подключение — через страницу Google.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { human } from './Charts';
import { Icon } from './Icon';
import { useToast } from './Toasts';

type St = { available: boolean; connected: boolean; error: string | null; lastSync: string | null };
const when = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : `${human(iso.slice(0, 10))}, ${new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`; };

const START = () => `/api/integrations/google-calendar/start${location.pathname.startsWith('/m') ? '?back=m' : ''}`;

export function CalendarSetup() {
  const toast = useToast(), [st, setSt] = useState<St | null>(null), [busy, setBusy] = useState(false);
  const load = () => api<{ googleCalendar: St }>('/api/integrations').then(r => setSt(r.googleCalendar), () => setSt({ available: false, connected: false, error: null, lastSync: null }));
  useEffect(() => { load(); }, []);
  if (!st) return <div className="skel" style={{ height: 200 }} />;
  const off = async () => { setBusy(true); try { await api('/api/integrations/google-calendar', { method: 'DELETE' }); toast('Календарь отключён, календарь «Lumi» удалён'); load(); } catch { toast('Не получилось отключить', { err: true }); } finally { setBusy(false); } };
  return <div className="form vs">
    <section className="vs-block">
      <h3><Icon name="plans" />Google Календарь</h3>
      <p className="card-note">Lumi создаст в твоём Google отдельный календарь «Lumi» и будет сам держать в нём задачи с датой и тренировки по плану: перенёс, выполнил или удалил задачу — через пару минут это видно в календаре. Встречи из основного календаря появятся в ленте дня отдельной дорожкой.</p>
      {!st.available ? <p className="vs-warn">На этом сервере календарь ещё не настроен: владельцу нужно добавить ключи Google.</p>
        : !st.connected ? <a className="primary vs-cal" href={START()}><Icon name="plans" />Подключить Google Календарь</a>
        : <>
          <div className="row-flex"><span className="vs-state">{st.error ? '' : st.lastSync ? `Подключён · синхронизирован ${when(st.lastSync)}` : 'Подключён · первая синхронизация через пару минут'}</span>
            <button className="btn-accent" disabled={busy} onClick={off}>Отключить</button></div>
          {st.error && <p className="form-err">{st.error}</p>}
          {st.error && /заново/.test(st.error) && <a className="primary vs-cal" href={START()}>Подключить заново</a>}
        </>}
      <p className="card-note">Lumi видит только события, а менять может только свой календарь «Lumi». Отключение удаляет календарь «Lumi» и забывает доступ.</p>
    </section>
  </div>;
}
