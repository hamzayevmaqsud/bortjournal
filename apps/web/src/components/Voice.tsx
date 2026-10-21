/**
 * Запись голосом в приложении: нажал — говоришь — ИИ решает, задача это (с датой и временем) или заметка.
 * Запись идёт через микрофон (MediaRecorder) и уходит на сервер; можно и просто написать фразу.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';
import { useToast } from './Toasts';

interface Result { kind: 'task' | 'note'; heard: string; message: string }
const MAX_SEC = 60;
const toB64 = (blob: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = no; r.readAsDataURL(blob); });

export function VoiceCapture({ onDone }: { onDone: () => void }) {
  const toast = useToast(), [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle'), [sec, setSec] = useState(0), [text, setText] = useState(''), [res, setRes] = useState<Result | null>(null);
  const rec = useRef<MediaRecorder | null>(null), chunks = useRef<Blob[]>([]), timer = useRef(0);
  const canRec = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia;
  useEffect(() => () => { clearInterval(timer.current); rec.current?.stream.getTracks().forEach(t => t.stop()); }, []);
  const send = async (body: Record<string, unknown>) => {
    setState('busy');
    try { const r = await api<Result>('/api/plans/capture', { method: 'POST', body }); setRes(r); setText(''); buzz([10, 30, 10]); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось записать', { err: true }); }
    finally { setState('idle'); }
  };
  const start = async () => {
    setRes(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach(t => t.stop()); clearInterval(timer.current);
        const blob = new Blob(chunks.current, { type: r.mimeType || type || 'audio/mp4' });
        if (blob.size < 2000) { setState('idle'); toast('Слишком коротко — скажи ещё раз', { err: true }); return; }
        await send({ audio: await toB64(blob), mime: blob.type });
      };
      r.start(); rec.current = r; setState('rec'); setSec(0); buzz(12);
      timer.current = window.setInterval(() => setSec(s => { if (s + 1 >= MAX_SEC) r.state === 'recording' && r.stop(); return s + 1; }), 1000);
    } catch { toast('Нет доступа к микрофону. Разреши его в настройках браузера или телефона.', { err: true }); }
  };
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };
  return <div className="form voice">
    <p className="card-note">Скажи, например: «Завтра в 3 позвонить Анару» — это станет задачей с напоминанием за 15 минут. «Идея: виджет для воды» — заметкой.</p>
    {canRec && <button type="button" className={`voice-btn ${state}`} disabled={state === 'busy'} onClick={state === 'rec' ? stop : start} aria-label={state === 'rec' ? 'Остановить запись' : 'Начать запись'}>
      {state === 'busy' ? <span className="spin" /> : <Icon name={state === 'rec' ? 'check' : 'mic'} />}
      <b>{state === 'rec' ? `Слушаю… ${sec} с` : state === 'busy' ? 'Разбираю…' : 'Нажми и говори'}</b>
      <small>{state === 'rec' ? 'нажми ещё раз, когда закончишь' : 'до минуты'}</small>
    </button>}
    <form className="voice-text" onSubmit={e => { e.preventDefault(); if (text.trim()) send({ text }); }}>
      <input className="in" value={text} onChange={e => setText(e.target.value)} placeholder={canRec ? 'или напиши фразу' : 'Напиши: «завтра в 10 стоматолог»'} enterKeyHint="send" />
      <button className="primary" disabled={!text.trim() || state === 'busy'} aria-label="Записать"><Icon name="check" /></button>
    </form>
    {res && <div className={`voice-res ${res.kind}`}><span className="chip-ic" style={{ ['--c' as string]: res.kind === 'task' ? 'var(--orange)' : 'var(--study)' }}><Icon name={res.kind === 'task' ? 'task' : 'edit'} /></span>
      <span className="mid"><b>{res.message}</b><small>Услышал: «{res.heard}»</small></span></div>}
  </div>;
}
