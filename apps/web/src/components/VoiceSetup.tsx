/**
 * Подключение iPhone: «Команды» (кнопка действия, виджет, Siri) записывают фразу в журнал по личному ключу,
 * а «Календарь» подписывается на задачи журнала. Ключ показывается один раз — его копируют в команду.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { human } from './Charts';
import { Icon } from './Icon';
import { useToast } from './Toasts';

type Info = Record<'capture' | 'calendar', { createdAt: string; lastUsedAt: string | null } | null>;
const copy = async (t: string, toast: ReturnType<typeof useToast>, what: string) => { try { await navigator.clipboard.writeText(t); toast(`${what} скопирован`); } catch { toast('Не получилось скопировать — выдели и скопируй вручную', { err: true }); } };

export function VoiceSetup() {
  const toast = useToast(), [info, setInfo] = useState<Info | null>(null), [cap, setCap] = useState<{ token: string; url: string } | null>(null), [cal, setCal] = useState<{ url: string; webcal: string } | null>(null);
  const load = () => api<Info>('/api/tokens').then(setInfo, () => {});
  useEffect(() => { load(); }, []);
  const make = async (kind: 'capture' | 'calendar') => {
    try { const r = await api<any>(`/api/tokens/${kind}`, { method: 'POST' }); if (kind === 'capture') setCap(r); else setCal(r); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); }
  };
  const off = async (kind: 'capture' | 'calendar') => { await api(`/api/tokens/${kind}`, { method: 'DELETE' }).catch(() => {}); if (kind === 'capture') setCap(null); else setCal(null); load(); toast(kind === 'capture' ? 'Ключ команды отключён' : 'Календарь отключён'); };
  if (!info) return <div className="skel" style={{ height: 200 }} />;
  return <div className="form vs">
    <section className="vs-block">
      <h3><Icon name="mic" />Запись голосом с iPhone</h3>
      <p className="card-note">Кнопка действия, виджет на экране «Домой» или «Привет, Siri, записать в журнал» — говоришь фразу, и она попадает в журнал задачей или заметкой.</p>
      {!cap ? <div className="row-flex">
          <span className="vs-state">{info.capture ? `Ключ создан ${human(info.capture.createdAt.slice(0, 10))}${info.capture.lastUsedAt ? `, последний раз — ${human(info.capture.lastUsedAt.slice(0, 10))}` : ', ещё не использовался'}` : 'Ключа ещё нет'}</span>
          <button className="btn-accent" onClick={() => make('capture')}>{info.capture ? 'Новый ключ' : 'Создать ключ'}</button>
          {info.capture && <button className="btn-accent" onClick={() => off('capture')}>Отключить</button>}
        </div>
        : <>
          <div className="vs-key"><code>{cap.token}</code><button className="btn-accent" onClick={() => copy(cap.token, toast, 'Ключ')}>Скопировать</button></div>
          <p className="vs-warn">Ключ показывается один раз — сразу вставь его в команду. Новый ключ отключает старый.</p>
          <ol className="steps vs-steps">
            <li>Открой приложение <b>«Команды»</b> → <b>«+»</b> → назови команду <b>«Записать в журнал»</b>.</li>
            <li>Добавь действие <b>«Диктовать текст»</b>: язык — русский, «Остановить прослушивание» — <b>после паузы</b>.</li>
            <li>Добавь <b>«Получить содержимое URL»</b>. Адрес: <span className="vs-url"><code>{cap.url}</code><button className="ico" onClick={() => copy(cap.url, toast, 'Адрес')} aria-label="Скопировать адрес"><Icon name="file" /></button></span></li>
            <li>В нём раскрой «Показать больше»: метод <b>POST</b>; заголовки — <b>Authorization</b> со значением <b>Bearer</b>, пробел и ключ; тело запроса <b>JSON</b> — поле <b>text</b>, значение «Диктованный текст».</li>
            <li>Добавь <b>«Получить значение из словаря»</b> → ключ <b>message</b>, затем <b>«Показать уведомление»</b> (или «Произнести текст») — журнал ответит, что записал.</li>
            <li>Настрой запуск: <b>Настройки → Кнопка действия → Команда → «Записать в журнал»</b>; виджет «Команды» на экран «Домой»; или просто скажи Siri название команды.</li>
          </ol>
          <p className="card-note">Пока сервер работает внутри Tailscale, команда срабатывает только когда Tailscale на телефоне включён.</p>
        </>}
    </section>

    <section className="vs-block">
      <h3><Icon name="plans" />Задачи в «Календаре» iPhone</h3>
      <p className="card-note">Задачи с датой появятся в «Календаре» и будут обновляться сами. Задачи со временем — с напоминанием заранее, как в «Напоминаниях» журнала.</p>
      {!cal ? <div className="row-flex">
          <span className="vs-state">{info.calendar ? `Подключён ${human(info.calendar.createdAt.slice(0, 10))}${info.calendar.lastUsedAt ? ` · обновлялся ${human(info.calendar.lastUsedAt.slice(0, 10))}` : ''}` : 'Не подключён'}</span>
          <button className="btn-accent" onClick={() => make('calendar')}>{info.calendar ? 'Новая ссылка' : 'Подключить календарь'}</button>
          {info.calendar && <button className="btn-accent" onClick={() => off('calendar')}>Отключить</button>}
        </div>
        : <>
          <a className="primary vs-cal" href={cal.webcal}><Icon name="plans" />Добавить в «Календарь»</a>
          <div className="vs-key"><code>{cal.url}</code><button className="btn-accent" onClick={() => copy(cal.url, toast, 'Адрес')}>Скопировать</button></div>
          <p className="card-note">Если кнопка не сработала: <b>Настройки → Приложения → Календарь → Учётные записи → Новая → Другое → Подписной календарь</b> и вставь адрес. Частоту обновления поставь «Каждые 15 минут».</p>
          <p className="vs-warn">Ссылку видит только тот, у кого она есть, — не публикуй её. Новая ссылка отключает старую.</p>
        </>}
    </section>
  </div>;
}
