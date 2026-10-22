/**
 * Подключение Obsidian: личный ключ для плагина Lumi, адрес сервера и как поставить плагин.
 * Ключ показывается один раз; новый ключ отключает старый. Плагин присылает заметки из выбранной папки сам.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { human } from './Charts';
import { Icon } from './Icon';
import { useToast } from './Toasts';

type Tok = { createdAt: string; lastUsedAt: string | null } | null;
const copy = async (t: string, toast: ReturnType<typeof useToast>, what: string) => { try { await navigator.clipboard.writeText(t); toast(`${what} скопирован`); } catch { toast('Не получилось скопировать — выдели и скопируй вручную', { err: true }); } };
const ago = (iso: string) => { const d = iso.slice(0, 10), t = new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); return `${human(d)}, ${t}`; };

export function ObsidianSetup() {
  const toast = useToast(), [tok, setTok] = useState<Tok | undefined>(undefined), [fresh, setFresh] = useState<{ token: string; url: string } | null>(null);
  const load = () => api<{ obsidian?: Tok }>('/api/tokens').then(r => setTok(r.obsidian ?? null), () => setTok(null));
  useEffect(() => { load(); }, []);
  const make = async () => {
    try { setFresh(await api<{ token: string; url: string }>('/api/tokens/obsidian', { method: 'POST' })); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); }
  };
  const off = async () => { await api('/api/tokens/obsidian', { method: 'DELETE' }).catch(() => {}); setFresh(null); load(); toast('Плагин отключён — заметки больше не придут'); };
  if (tok === undefined) return <div className="skel" style={{ height: 200 }} />;
  const base = fresh?.url ?? location.origin;
  return <div className="form vs">
    <section className="vs-block">
      <h3><Icon name="study" />Конспекты из Obsidian</h3>
      <p className="card-note">Плагин Lumi отправляет заметки из выбранной папки хранилища через пару секунд после правки. В «Учёбе» их можно читать, искать по ним и делать вопросы, а дописанные разделы попадают в дневник занятий. Удалённая заметка уходит в архив вместе с историей ответов.</p>
      {!fresh ? <div className="row-flex">
          <span className="vs-state">{tok ? `Ключ создан ${human(tok.createdAt.slice(0, 10))}${tok.lastUsedAt ? ` · последняя отправка — ${ago(tok.lastUsedAt)}` : ' · заметок ещё не было'}` : 'Ключа ещё нет'}</span>
          <button className="btn-accent" onClick={make}>{tok ? 'Новый ключ' : 'Создать ключ'}</button>
          {tok && <button className="btn-accent" onClick={off}>Отключить</button>}
        </div>
        : <>
          <div className="vs-key"><code>{fresh.token}</code><button className="btn-accent" onClick={() => copy(fresh.token, toast, 'Ключ')}>Скопировать</button></div>
          <p className="vs-warn">Ключ показывается один раз — сразу вставь его в настройки плагина. Новый ключ отключает старый.</p>
        </>}
    </section>

    <section className="vs-block">
      <h3><Icon name="file" />Как поставить плагин</h3>
      <ol className="steps vs-steps">
        <li>Скачай два файла: <a href="/obsidian/main.js" download>main.js</a> и <a href="/obsidian/manifest.json" download>manifest.json</a>.</li>
        <li>В хранилище создай папку <b>.obsidian/plugins/lumi</b> и положи их туда.</li>
        <li>В Obsidian: <b>Настройки → Сторонние плагины</b> → выключи безопасный режим → включи <b>Lumi</b>.</li>
        <li>В настройках плагина впиши адрес <span className="vs-url"><code>{base}</code><button className="ico" onClick={() => copy(base, toast, 'Адрес')} aria-label="Скопировать адрес"><Icon name="file" /></button></span>, ключ и папку с конспектами, например <b>Учёба</b>.</li>
        <li>Нажми <b>«Отправить всё сейчас»</b> — старые конспекты загрузятся разом. Дальше плагин всё делает сам, а в строке состояния Obsidian видно, когда была последняя отправка.</li>
      </ol>
      <p className="card-note">На телефоне плагин тоже работает: файлы нужно положить в ту же папку хранилища, например через синхронизацию Obsidian.</p>
    </section>
  </div>;
}
