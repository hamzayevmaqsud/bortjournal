/**
 * «Написать разработчику»: текст + автоматически экран, версия, тема и размер — без расспросов «а где это было».
 */
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { buzz } from '../lib/motion';
import { APP_VERSION } from '@bortjournal/core';
import { useToast } from './Toasts';

export const VERSION = APP_VERSION;
export const lastScreen = () => { try { return sessionStorage.getItem('bj-tab') ?? ''; } catch { return ''; } };

export function FeedbackForm({ onDone }: { onDone: () => void }) {
  const toast = useToast(), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  return <form className="form" onSubmit={async e => {
    e.preventDefault(); setBusy(true);
    try {
      await api('/api/feedback', { method: 'POST', body: { text, screen: lastScreen(), version: VERSION, theme: document.documentElement.dataset.theme ?? 'system', size: `${innerWidth}×${innerHeight}` } });
      buzz([10, 30, 10]); toast('Спасибо! Отзыв отправлен разработчику'); onDone();
    } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось отправить', { err: true }); } finally { setBusy(false); }
  }}>
    <p className="card-note">Что понравилось, что мешает, где ошибка — пиши как есть. Экран, версия и тип устройства приложатся сами.</p>
    <textarea className="in" rows={6} required minLength={3} maxLength={4000} autoFocus placeholder="Например: на экране «Еда» после фото не сохраняется приём…" value={text} onChange={e => setText(e.target.value)} />
    <button className="primary" disabled={busy || text.trim().length < 3}>Отправить</button>
  </form>;
}
