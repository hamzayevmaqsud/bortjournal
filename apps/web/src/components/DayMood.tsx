/**
 * «Как прошёл день?» на экране «Сегодня»: пять лиц от «плохо» до «отлично» и короткая заметка по желанию.
 * Вечером (с 17:00) и на прошлых днях — карточкой; утром — одной строкой «Вечером отметь, как прошёл день».
 * Отметка сохраняется сразу (без сети — в очередь), при ошибке откатывается. Отмеченное настроение — запись для серии.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fromCache } from '../lib/api';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import '../styles/mood.css';

interface Entry { day: string; mood: number | null; note: string | null; queued?: boolean }
const EVENING = 17 * 60, NOTE_MAX = 2000;
export const MOODS = ['Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично'] as const;
// рот и глаза для каждого лица; круг — общий
const MOUTH = ['M8.5 16.8q3.5-3.2 7 0', 'M9 16.2q3-1.5 6 0', 'M9 15.5h6', 'M8.8 14.6q3.2 2.4 6.4 0', 'M8 13.8q4 4.6 8 0z'];
const err = (e: unknown) => e instanceof Error ? e.message : 'Не получилось';

export function Face({ n }: { n: number }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9.3" />
    {n === 5 ? <path d="M8 10.2q1.2-1.4 2.4 0M13.6 10.2q1.2-1.4 2.4 0" /> : <><circle className="eye" cx="9.2" cy="10" r="1" /><circle className="eye" cx="14.8" cy="10" r="1" /></>}
    {n === 1 && <path d="M7.6 7.6l2.4 1M16.4 7.6l-2.4 1" />}
    <path d={MOUTH[n - 1]} />
  </svg>;
}

export function DayMood({ day, today, minutes, index = 9, onSaved }: { day: string; today: string; minutes: number; index?: number; onSaved?: () => void }) {
  const toast = useToast();
  const [e, setE] = useState<Entry | null>(null), [open, setOpen] = useState(false), [draft, setDraft] = useState(''), [later, setLater] = useState(true), [said, setSaid] = useState('');
  const want = useRef(day), cur = useRef<Entry | null>(null);
  cur.current = e;

  const load = useCallback(async (d: string) => {
    want.current = d;
    try {
      const r = await api<Entry>(`/api/journal?day=${d}`);
      if (want.current !== d || (fromCache(r) && cur.current?.day === d)) return;
      setE({ day: d, mood: r.mood, note: r.note });
    } catch { if (want.current === d) setE(x => x ?? { day: d, mood: null, note: null }); }
  }, []);
  useEffect(() => { setE(null); setOpen(false); setLater(true); setSaid(''); void load(day); }, [day, load]);
  useEffect(() => { const on = () => void load(want.current); addEventListener('bj-synced', on); return () => removeEventListener('bj-synced', on); }, [load]);

  /** сохранить сразу на экране; ошибка — вернуть как было */
  const save = async (patch: Partial<Pick<Entry, 'mood' | 'note'>>) => {
    const was = cur.current; if (!was) return;
    const next = { ...was, ...patch };
    setE(next); setSaid('');
    try {
      const r = await api<Entry>('/api/journal', { method: 'PUT', body: { day, ...patch } });
      if (want.current !== day) return;
      if (r.queued) { setSaid('Сохранится, когда появится связь'); return; }
      setE({ day, mood: r.mood, note: r.note }); setSaid('Сохранено');
      if ('mood' in patch) dispatchEvent(new Event('lumi-mood'));
      // настроение появилось или пропало — у серии мог поменяться счёт
      if ('mood' in patch && (was.mood === null) !== (r.mood === null)) onSaved?.();
    } catch (x) {
      if (want.current === day) setE(was);
      toast(err(x), { err: true });
    }
  };
  const pick = (n: number) => { if (future) return; buzz(e?.mood === n ? 8 : [10, 30, 10]); void save({ mood: e?.mood === n ? null : n }); };
  const startNote = () => { setDraft(e?.note ?? ''); setOpen(true); };
  const saveNote = () => { const v = draft.trim(); setOpen(false); if (v !== (e?.note ?? '')) void save({ note: v || null }); };

  const future = day > today, isToday = day === today;
  if (future) return null;
  const morning = isToday && minutes < EVENING && !e?.mood && !e?.note;
  if (morning && later) return <section className="wc span7 c-mood mood-later" style={{ ['--i' as string]: index }}>
    <button type="button" onClick={() => setLater(false)} aria-expanded={false}><Icon name="moon" /><span>Вечером отметь, как прошёл день</span><Icon name="chev" className="ic chev" /></button>
  </section>;

  return <section id="day-mood" className="wc span7 c-mood" style={{ ['--i' as string]: index }} aria-labelledby="mood-h">
    <div className="card-head"><h2 id="mood-h">{isToday ? 'Как прошёл день?' : 'Как прошёл этот день?'}</h2></div>
    {e === null ? <div className="hb-skel" aria-hidden="true"><i /></div> : <>
      <div className={`mood-row ${e.mood ? 'picked' : ''}`} role="group" aria-label="Настроение дня">
        {MOODS.map((name, k) => <button key={name} type="button" className="mood-b" style={{ ['--mc' as string]: `var(--m${k + 1})` }}
          aria-pressed={e.mood === k + 1} aria-label={name} title={e.mood === k + 1 ? `${name} — нажми ещё раз, чтобы снять` : name} onClick={() => pick(k + 1)}>
          <span className="face"><Face n={k + 1} /></span><small aria-hidden="true">{name}</small>
        </button>)}
      </div>
      {open ? <div className="mood-note">
        <textarea className="in" autoFocus value={draft} maxLength={NOTE_MAX} rows={3} aria-label="Заметка о дне" placeholder="Что запомнилось? Пара слов — по желанию"
          onChange={x => setDraft(x.target.value)}
          onKeyDown={x => { if (x.key === 'Escape') { x.preventDefault(); setOpen(false); } if (x.key === 'Enter' && (x.ctrlKey || x.metaKey)) { x.preventDefault(); saveNote(); } }} />
        <div className="mood-note-acts">
          {draft.length > NOTE_MAX - 200 && <span className="count">{draft.length} / {NOTE_MAX}</span>}
          <button type="button" className="link-btn" onClick={() => setOpen(false)}>Отмена</button>
          <button type="button" className="primary" onClick={saveNote}>Сохранить</button>
        </div>
      </div>
        : <button type="button" className={`mood-note-line ${e.note ? 'has' : ''}`} onClick={startNote} aria-label={e.note ? `Заметка: ${e.note}. Изменить` : 'Добавить заметку о дне'}>
          <Icon name="edit" /><span>{e.note ?? 'Пара слов о дне — по желанию'}</span>
        </button>}
      <p className="mood-saved" role="status" aria-live="polite">{said}</p>
    </>}
  </section>;
}
