/**
 * «Учёба» (раздел Pro). Конспекты: файлы PDF и Word, текст, ссылки и заметки Obsidian — читать, искать, открыть оригинал.
 * Вопросы — только по просьбе: у конспекта «Сделать вопросы», ИИ составляет вопросы с 4 вариантами ответа.
 * «Вопросы» — то, что пора повторить сегодня: верно — вопрос вернётся позже, неверно — завтра.
 * Дневник занятий с минутами и график — как раньше.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { fmt, plural } from '../lib/format';
import { headId, markTerms, mdToHtml } from '../lib/md';
import { buzz } from '../lib/motion';
import { g } from '../lib/gender';
import { Bars, human } from '../components/Charts';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toasts';

const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const hours = (m: number) => (Math.round(m / 6) / 10).toLocaleString('ru-RU');
const fmtMin = (m: number) => m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`;
const noteShort = (t: string) => String(t).replace(/\s*[—–-]\s*конспект.*$/i, '').replace(/\s*\(.*\)\s*$/, '').trim() || t;
const ago = (iso: string | null) => { if (!iso) return 'ещё не было'; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : human(iso.slice(0, 10)); };
const size = (b: number | null) => !b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} КБ` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
const KIND: Record<string, [string, string]> = { pdf: ['PDF', 'file'], docx: ['Word', 'file'], text: ['Текст', 'edit'], link: ['Ссылка', 'link'], obsidian: ['Obsidian', 'study'] };
const fail = (toast: ReturnType<typeof useToast>, e: unknown, msg = 'Не получилось') => toast(e instanceof ApiError ? e.message : msg, { err: true });

export interface Material { id: string; kind: string; title: string; source: string | null; bytes: number | null; chars: number; hasFile: boolean; createdAt: string; quiz: boolean; quizStatus: 'none' | 'working' | 'ready' | 'error'; quizError: string | null; quizDone: number; quizTotal: number; questions: number; due: number }

/* ---------------- вопросы ---------------- */
function Quiz({ onChanged, onMaterials }: { onChanged: () => void; onMaterials: () => void }) {
  const toast = useToast(), [d, setD] = useState<any>(null), [extra, setExtra] = useState(0), [res, setRes] = useState<null | { choice: number; correct: boolean; correctIndex: number; explain: string | null }>(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setD(await api<any>(`/api/study/quiz?extra=${extra}`)); setRes(null); } catch (e) { fail(toast, e, 'Не получилось загрузить'); } }, [toast, extra]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="skel" style={{ height: 300 }} />;
  const pick = async (i: number) => {
    if (res || busy) return; setBusy(true);
    try { const r = await api<any>('/api/study/quiz/answer', { method: 'POST', body: { id: d.current.id, choice: i } }); setRes({ choice: i, ...r }); buzz(r.correct ? [10, 30, 10] : [30, 40, 30]); onChanged(); }
    catch (e) { fail(toast, e); } finally { setBusy(false); }
  };
  const hist = d.history as any[], total = d.answered + d.left;
  const histCard = hist.some(h => h.answered) && <section className="wc span12"><div className="card-head"><h2>Точность за 14 дней</h2></div>
    <Bars rows={hist.map(h => ({ label: String(+h.day.slice(8, 10)), v: h.answered ? Math.round(h.good / h.answered * 100) : 0, hint: h.answered ? `${human(h.day)}: ${h.good} из ${h.answered} верно` : `${human(h.day)}: нет ответов` }))} color="var(--quiz)" max={100} unit="%" every={2} /></section>;

  if (!d.materials) return <div className="wgrid"><section className="wc span12 quiz-empty"><div className="card-head"><h2>Вопросов пока нет</h2></div>
    <p className="quiz-msg">Вопросы появляются, только когда ты сам их попросишь. Открой конспект и нажми <b>«Сделать вопросы»</b> — ИИ составит вопросы с вариантами ответа, и они будут приходить сюда на повторение.</p>
    <button className="btn-accent" onClick={onMaterials}><Icon name="study" />К конспектам</button></section>{histCard}</div>;

  if (!d.current) return <div className="wgrid">
    <section className="wc span12 solid s-sage quiz-done"><div className="card-head"><h2>{d.answered ? 'На сегодня всё' : 'Повторять пока нечего'}</h2></div>
      {d.answered > 0 && <div className="wbig"><b>{d.good}</b><small>из {d.answered} верно</small></div>}
      <p className="card-note">{d.freshLeft ? `Новых вопросов ещё ${d.freshLeft}.` : d.next ? `Следующие вопросы вернутся ${human(d.next)}.` : d.total ? 'Все вопросы пройдены.' : 'ИИ ещё составляет вопросы — загляни через минуту.'} {g('Что ответил', 'Что ответила')} неверно — вернётся завтра.</p>
      {d.freshLeft > 0 && <button className="btn-accent" onClick={() => setExtra(x => x + 10)}><Icon name="plus" />Ещё {Math.min(10, d.freshLeft)} {plural(Math.min(10, d.freshLeft), 'новый', 'новых', 'новых')}</button>}
    </section>{histCard}</div>;

  const q = d.current;
  return <div className="wgrid">
    <div className="quiz-head span12"><span className="wbar"><i style={{ width: `${total ? d.answered / total * 100 : 0}%`, background: 'var(--quiz)' }} /></span><span className="muted">{d.answered} из {total}{d.answered ? ` · верно ${d.good}` : ''}</span></div>
    <section className="wc span12 mc">
      <div className="q-meta"><span>{q.material}</span><span>осталось {d.left}</span></div>
      <p className="mc-q">{q.q}</p>
      <div className="mc-opts">{q.options.map((o: { i: number; text: string }, k: number) => {
        const st = !res ? '' : o.i === res.correctIndex ? 'right' : o.i === res.choice ? 'wrong' : 'dim';
        return <button key={o.i} className={`mc-opt ${st}`} disabled={!!res || busy} onClick={() => pick(o.i)}><span className="mc-l">{'АБВГ'[k]}</span><span>{o.text}</span>{st === 'right' && <Icon name="check" />}</button>;
      })}</div>
      {res && <div className={`mc-res ${res.correct ? 'ok' : 'no'}`}><b>{res.correct ? 'Верно' : 'Неверно'}</b>{res.explain && <p>{res.explain}</p>}<small>{res.correct ? 'Вопрос вернётся через несколько дней.' : 'Вопрос вернётся завтра.'}</small></div>}
      {res && <button className="primary" onClick={load}>{d.left > 1 ? 'Дальше' : 'Готово'}</button>}
    </section>
    {histCard}
  </div>;
}

/* ---------------- чтение ---------------- */
function Body({ md, q, h }: { md: string; q: string; h?: string }) {
  const body = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = body.current; if (!el) return;
    el.innerHTML = mdToHtml(md); markTerms(el, q);
    const target = h && !q ? el.querySelector('#' + headId(h)) : el.querySelector('mark.hit');
    if (target) setTimeout(() => target.scrollIntoView({ block: q ? 'center' : 'start' }), 60);
  }, [md, q, h]);
  return <article className="rd-body md" ref={body} onClick={e => { const a = (e.target as HTMLElement).closest('a.wl') as HTMLElement | null; if (a) { e.preventDefault(); const h2 = a.dataset.h; if (h2) body.current?.querySelector('#' + headId(h2))?.scrollIntoView({ block: 'start' }); } }} />;
}
const headsOf = (md: string) => [...md.matchAll(/^#{1,3}\s+(.+?)\s*#*$/gm)].map(m => m[1]!).slice(0, 80);
function Jump({ md }: { md: string }) {
  const hs = headsOf(md); if (hs.length < 2) return null;
  return <select className="in" defaultValue="" onChange={e => document.querySelector('.rd-body #' + headId(e.target.value))?.scrollIntoView({ block: 'start' })} aria-label="Перейти к разделу"><option value="">Разделы…</option>{hs.map((x, i) => <option key={i}>{x}</option>)}</select>;
}
function MaterialReader({ id, onQuiz }: { id: string; onQuiz: (m: Material, on: boolean) => void }) {
  const [m, setM] = useState<(Material & { text: string }) | null>(null), [err, setErr] = useState(''), [q, setQ] = useState('');
  useEffect(() => { api<any>(`/api/study/materials/${id}`).then(setM, e => setErr(e instanceof ApiError ? e.message : 'Не открылось')); }, [id]);
  if (err) return <p className="form-err">{err}</p>;
  if (!m) return <div className="skel" style={{ height: 300 }} />;
  return <div className="reader">
    <div className="reader-title"><small>{KIND[m.kind]?.[0]}{m.source && m.kind !== 'text' ? ` · ${m.source}` : ''}</small><h2>{m.title}</h2></div>
    <div className="reader-actions">
      <Jump md={m.text} />
      <div className="fp-search"><Icon name="search" /><input className="in" type="search" placeholder="Найти в конспекте" value={q} onChange={e => setQ(e.target.value)} /></div>
      {!m.quiz && <button className="btn-accent" onClick={() => onQuiz(m, true)}><Icon name="quiz" />Сделать вопросы</button>}
      {m.hasFile && <a className="btn-accent" href={`/api/study/materials/${m.id}/file`} target="_blank" rel="noopener">Оригинал</a>}
      {m.kind === 'link' && m.source && <a className="btn-accent" href={m.source} target="_blank" rel="noopener noreferrer">Открыть страницу</a>}
    </div>
    <Body md={m.text} q={q} />
  </div>;
}
function ObsReader({ rel, h, q: q0, onQuiz, onCheat }: { rel: string; h?: string; q?: string; onQuiz: (rel: string) => void; onCheat: (noteId: string) => void }) {
  const [n, setN] = useState<any>(null), [err, setErr] = useState(''), [q, setQ] = useState(q0 ?? '');
  useEffect(() => { api<any>(`/api/study/obsidian/note?rel=${encodeURIComponent(rel)}`).then(setN, e => setErr(e instanceof ApiError ? e.message : 'Не открылось')); }, [rel]);
  if (err) return <p className="form-err">{err}</p>;
  if (!n) return <div className="skel" style={{ height: 300 }} />;
  return <div className="reader">
    <div className="reader-title"><small>{n.rel.replace(/\.md$/, '')}</small><h2>{n.title}</h2>{n.tags.length > 0 && <div className="chips">{n.tags.map((t: string) => <span key={t} className="chip static">#{t}</span>)}</div>}</div>
    <div className="reader-actions">
      <Jump md={n.markdown} />
      <div className="fp-search"><Icon name="search" /><input className="in" type="search" placeholder="Найти в конспекте" value={q} onChange={e => setQ(e.target.value)} /></div>
      <button className="btn-accent" onClick={() => onQuiz(n.rel)}><Icon name="quiz" />Сделать вопросы</button>
      {n.noteId && <button className="btn-accent" onClick={() => onCheat(n.noteId)}>Шпаргалка</button>}
      <a className="btn-accent" href={n.link}>Открыть в Obsidian</a>
    </div>
    <Body md={n.markdown} q={q} h={h} />
  </div>;
}
function Cheat({ id }: { id: string }) {
  const [d, setD] = useState<any>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), box = useRef<HTMLDivElement>(null);
  const load = useCallback(async (regen = false) => {
    setBusy(true); setErr('');
    try { setD(regen ? await api<any>('/api/study/obsidian/cheatsheet', { method: 'POST', body: { noteId: id } }) : await api<any>(`/api/study/obsidian/cheatsheet?id=${encodeURIComponent(id)}`).catch(() => api<any>('/api/study/obsidian/cheatsheet', { method: 'POST', body: { noteId: id } }))); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Не получилось'); } finally { setBusy(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (box.current && d) box.current.innerHTML = mdToHtml(d.markdown); }, [d]);
  return <div className="form">
    {busy && <p className="card-note"><span className="spin dark" /> Собираю шпаргалку из конспекта… обычно 20–40 секунд</p>}
    {err && <p className="form-err">{err}</p>}
    <div className="md cheat-body" ref={box} />
    {d && <div className="row-flex"><span className="card-note" style={{ flex: 1 }}>Сохранено в Obsidian: {d.rel}</span><a className="btn-accent" href={d.link}>Открыть в Obsidian</a><button className="btn-accent" disabled={busy} onClick={() => load(true)}><Icon name="repeat" />Собрать заново</button></div>}
  </div>;
}

/* ---------------- добавить конспект ---------------- */
function LinkForm({ onDone }: { onDone: (m: Material) => void }) {
  const [url, setUrl] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  return <form className="form" onSubmit={async e => { e.preventDefault(); setErr(''); setBusy(true); try { onDone(await api<Material>('/api/study/materials/link', { method: 'POST', body: { url } })); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось'); } finally { setBusy(false); } }}>
    <label className="fld"><span>Ссылка на статью, документацию или PDF</span><input className="in" type="url" inputMode="url" required autoCapitalize="none" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} /></label>
    <p className="card-note">Журнал скачает страницу и сохранит её текст. Страницы, которые показываются только после входа или собираются скриптами, лучше сохранить как PDF и загрузить файлом.</p>
    {err && <p className="form-err">{err}</p>}
    <button className="primary" disabled={busy}>{busy ? <span className="spin" /> : 'Добавить'}</button>
  </form>;
}
function TextForm({ onDone }: { onDone: (m: Material) => void }) {
  const [v, setV] = useState({ title: '', text: '' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  return <form className="form" onSubmit={async e => { e.preventDefault(); setErr(''); setBusy(true); try { onDone(await api<Material>('/api/study/materials/text', { method: 'POST', body: v })); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось'); } finally { setBusy(false); } }}>
    <label className="fld"><span>Название</span><input className="in" placeholder="Например: Kubernetes — сети" value={v.title} onChange={e => setV({ ...v, title: e.target.value })} /></label>
    <label className="fld"><span>Текст конспекта</span><textarea className="in" rows={10} required placeholder={'Вставь текст. Заголовки можно отметить «# » в начале строки — так конспект разобьётся на разделы.'} value={v.text} onChange={e => setV({ ...v, text: e.target.value })} /></label>
    {err && <p className="form-err">{err}</p>}
    <button className="primary" disabled={busy}>Добавить</button>
  </form>;
}
async function uploadFile(f: File): Promise<Material> {
  const r = await fetch('/api/study/materials/upload', { method: 'POST', body: f, credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) } }).catch(() => { throw new ApiError(0, 'Нет связи с сервером.'); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Ошибка ${r.status}`);
  return j as Material;
}
function MaterialMenu({ m, onRename, onRegen, onDelete }: { m: Material; onRename: (t: string) => void; onRegen: () => void; onDelete: () => void }) {
  const [t, setT] = useState(m.title), [sure, setSure] = useState(false);
  return <div className="form">
    <label className="fld"><span>Название</span><input className="in" value={t} onChange={e => setT(e.target.value)} /></label>
    {t.trim() && t !== m.title && <button className="primary" onClick={() => onRename(t.trim())}>Сохранить название</button>}
    {m.questions > 0 && <button className="ghost" onClick={onRegen}><Icon name="repeat" />Составить вопросы заново</button>}
    {!sure ? <button className="ghost danger" onClick={() => setSure(true)}><Icon name="trash" />Удалить конспект</button>
      : <div className="del-warn">Конспект{m.questions ? `, его ${m.questions} ${plural(m.questions, 'вопрос', 'вопроса', 'вопросов')} и история повторения` : ''} удалятся без возврата. <div className="row-flex" style={{ marginTop: 10 }}><button className="ghost" onClick={() => setSure(false)}>Отмена</button><button className="primary danger-bg" onClick={onDelete}>Удалить</button></div></div>}
  </div>;
}

/* ---------------- конспект в списке ---------------- */
function QuizState({ m, ai, onQuiz }: { m: Material; ai: boolean; onQuiz: (on: boolean) => void }) {
  if (m.quizStatus === 'working') return <div className="mt-q working"><span>ИИ составляет вопросы{m.quizTotal ? `: ${m.quizDone} из ${m.quizTotal} частей` : '…'}</span><span className="wbar"><i style={{ width: `${m.quizTotal ? Math.max(4, m.quizDone / m.quizTotal * 100) : 4}%`, background: 'var(--quiz)' }} /></span></div>;
  if (m.quizStatus === 'error' && m.quiz) return <div className="mt-q err"><span>{m.quizError ?? 'Не получилось составить вопросы.'}</span><button className="btn-accent" onClick={() => onQuiz(true)}><Icon name="repeat" />Ещё раз</button></div>;
  if (!m.quiz) return <div className="mt-q"><span className="muted">{m.questions ? `Вопросы выключены · ${m.questions}` : 'Вопросов нет'}</span>{ai && <button className="btn-accent" onClick={() => onQuiz(true)}><Icon name="quiz" />{m.questions ? 'Включить вопросы' : 'Сделать вопросы'}</button>}</div>;
  return <div className="mt-q on"><span><b>{m.questions}</b> {plural(m.questions, 'вопрос', 'вопроса', 'вопросов')}{m.due ? ` · сегодня ${m.due}` : ''}</span><button className="btn-accent" onClick={() => onQuiz(false)}>Выключить</button></div>;
}
function MaterialCard({ m, ai, onRead, onQuiz, onMenu }: { m: Material; ai: boolean; onRead: () => void; onQuiz: (on: boolean) => void; onMenu: () => void }) {
  const [kind, ic] = KIND[m.kind] ?? ['Конспект', 'file'];
  return <article className="mt">
    <div className="mt-head">
      <span className={`mt-ic k-${m.kind}`}><Icon name={ic} /></span>
      <button className="mt-main" onClick={onRead}><b>{m.title}</b><small>{[kind, size(m.bytes), m.chars < 1000 ? `${m.chars} ${plural(m.chars, "знак", "знака", "знаков")}` : `${fmt(Math.round(m.chars / 1000))} тыс. знаков`, human(m.createdAt.slice(0, 10))].filter(Boolean).join(' · ')}</small></button>
      <button className="ico" onClick={onMenu} aria-label="Ещё"><Icon name="more" /></button>
    </div>
    <QuizState m={m} ai={ai} onQuiz={onQuiz} />
  </article>;
}

/* ---------------- занятие ---------------- */
function SessionForm({ s, today, cats, onDone }: { s?: any; today: string; cats: string[]; onDone: () => void }) {
  const toast = useToast(), [v, setV] = useState({ topic: s?.title ?? '', category: s?.category ?? '', minutes: s?.minutes ? String(s.minutes) : '', time: s?.time ?? nowHm(), day: s?.day ?? today, theses: (s?.theses ?? []).join('\n'), qa: (s?.qa ?? []).map((q: any) => `${q.q} => ${q.a}`).join('\n') });
  return <form className="form" onSubmit={async e => {
    e.preventDefault();
    try { await api(s ? `/api/study/sessions/${s.id}` : '/api/study/sessions', { method: s ? 'PUT' : 'POST', body: v }); buzz([8, 30, 8]); toast(s ? 'Сохранено' : 'Занятие записано'); onDone(); }
    catch (x) { fail(toast, x); }
  }}>
    <label className="fld"><span>Тема</span><input className="in" required autoComplete="off" placeholder="Делегаты и события в C#" value={v.topic} onChange={e => setV({ ...v, topic: e.target.value })} /></label>
    <div className="fld"><span>Направление</span><div className="chips">{cats.slice(0, 12).map(c => <button type="button" key={c} className={`chip ${v.category === c ? 'on' : ''}`} onClick={() => setV({ ...v, category: v.category === c ? '' : c })}>{c}</button>)}</div></div>
    <div className="grid4f"><label className="fld"><span>Минут</span><input className="in" inputMode="numeric" placeholder="45" value={v.minutes} onChange={e => setV({ ...v, minutes: e.target.value })} /></label>
      <label className="fld"><span>Время</span><input className="in" type="time" value={v.time ?? ''} onChange={e => setV({ ...v, time: e.target.value })} /></label>
      <label className="fld" style={{ gridColumn: 'span 2' }}><span>Дата</span><input className="in" type="date" value={v.day} onChange={e => setV({ ...v, day: e.target.value })} /></label></div>
    <label className="fld"><span>Заметки — что понял</span><textarea className="in" rows={4} placeholder={'Каждая строка — отдельная мысль'} value={v.theses} onChange={e => setV({ ...v, theses: e.target.value })} /></label>
    <button className="primary">{s ? 'Сохранить' : 'Записать'}</button>
    {s && <button type="button" className="ghost danger" onClick={async () => { await api(`/api/study/sessions/${s.id}`, { method: 'DELETE' }); toast('Занятие удалено'); onDone(); }}>Удалить</button>}
  </form>;
}

/* ---------------- конспекты и дневник ---------------- */
type SheetState = null | { kind: 'read'; id: string } | { kind: 'obs'; rel: string; h?: string; q?: string } | { kind: 'cheat'; id: string } | { kind: 'session'; s?: any } | { kind: 'link' } | { kind: 'text' } | { kind: 'menu'; m: Material };
function Overview({ o, open, onQuiz, onObsQuiz, onReload }: { o: any; open: (s: SheetState) => void; onQuiz: (m: Material, on: boolean) => void; onObsQuiz: (rel: string, on: boolean) => void; onReload: () => void }) {
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const toast = useToast(), file = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(''), [q, setQ] = useState(''), [hits, setHits] = useState<any[] | null>(null), [lib, setLib] = useState<any[]>([]), [all, setAll] = useState(false), [min, setMin] = useState<Record<string, string>>({});
  useEffect(() => { if (o.obs.enabled) api<any>('/api/study/obsidian/library').then(r => setLib(r.notes), () => {}); }, [o.obs.enabled]);
  useEffect(() => { if (q.trim().length < 2) { setHits(null); return; } const t = setTimeout(() => api<any>(`/api/study/obsidian/search?q=${encodeURIComponent(q)}`).then(r => setHits(r.hits), () => setHits([])), 250); return () => clearTimeout(t); }, [q]);
  const saveMin = async (e: any) => { try { await api('/api/study/time', { method: 'PUT', body: { key: e.id, day: e.day, minutes: Number(min[e.id] ?? e.minutes ?? 0) } }); toast('Минуты записаны'); onReload(); } catch (x) { fail(toast, x); } };
  const pickFile = async (f?: File) => {
    if (!f) return; setBusy(f.name);
    try { const m = await uploadFile(f); toast(`Конспект «${m.title}» добавлен`); buzz([8, 30, 8]); onReload(); }
    catch (e) { fail(toast, e, 'Не получилось загрузить'); } finally { setBusy(''); if (file.current) file.current.value = ''; }
  };
  const from = new Date(Date.parse(o.today) - 13 * 864e5).toISOString().slice(0, 10), diary = all ? o.diary : o.diary.filter((e: any) => e.day >= from);
  const days = [...new Set(diary.map((e: any) => e.day))] as string[];
  const mats = o.materials as Material[];
  return <div className="wgrid">
    <div className="kpis span12">
      <div className="kpi"><span>Конспектов</span><b>{o.kpi.materials}</b><small>файлы, ссылки, заметки</small></div>
      <div className="kpi"><span>Вопросов</span><b>{fmt(o.kpi.questions)}</b><small>{o.kpi.questions ? 'по выбранным конспектам' : 'только по просьбе'}</small></div>
      <div className="kpi"><span>Сегодня</span><b>{o.kpi.due}</b><small>{o.kpi.due ? plural(o.kpi.due, 'вопрос', 'вопроса', 'вопросов') + ' к повторению' : 'повторять нечего'}</small></div>
      <div className="kpi"><span>За 7 дней</span><b>{hours(o.kpi.week)}<small>ч</small></b><small>всего {hours(o.kpi.all)} ч</small></div>
    </div>

    <section className="wc span12"><div className="card-head"><h2>Конспекты</h2></div>
      <input ref={file} type="file" hidden accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={e => pickFile(e.target.files?.[0])} />
      <div className="add3">
        <button className="add3-b" disabled={!!busy} onClick={() => file.current?.click()}>{busy ? <span className="spin dark" /> : <Icon name="upload" />}<b>{busy ? 'Читаю файл…' : 'Файл'}</b><small>{busy ? busy : 'PDF, Word, .txt, .md'}</small></button>
        <button className="add3-b" onClick={() => open({ kind: 'link' })}><Icon name="link" /><b>Ссылка</b><small>статья или PDF</small></button>
        <button className="add3-b" onClick={() => open({ kind: 'text' })}><Icon name="edit" /><b>Текст</b><small>вставить конспект</small></button>
      </div>
      {mats.length ? <div className="mt-list">{mats.map(m => <MaterialCard key={m.id} m={m} ai={o.ai} onRead={() => open({ kind: 'read', id: m.id })} onQuiz={on => onQuiz(m, on)} onMenu={() => open({ kind: 'menu', m })} />)}</div>
        : <p className="card-note">Загрузи лекцию, методичку или статью — их можно читать и искать по ним. Когда захочешь проверить себя, нажми у конспекта «Сделать вопросы».</p>}
    </section>

    {o.obs.enabled && <section className="wc span12"><div className="card-head"><h2>Obsidian</h2><div className="card-actions"><button className="btn-accent" onClick={async () => { await api('/api/study/obsidian/sync', { method: 'POST' }).catch(() => {}); toast('Синхронизировано'); onReload(); }}><Icon name="repeat" />Синхронизировать</button></div></div>
      <p className="card-note">Хранилище <b>{o.obs.vault}</b> → папка <b>{o.obs.folder}</b> · синхронизировано {ago(o.obs.lastSync)}</p>
      {o.obs.error && <p className="form-err">{o.obs.error}</p>}
      <div className="fp-search"><Icon name="search" /><input className="in" type="search" placeholder="Поиск по всем заметкам: etcd кворум, multipath, LACP…" value={q} onChange={e => setQ(e.target.value)} /></div>
      {hits !== null ? (hits.length ? hits.map((x: any, i: number) => <button key={i} className="hit-i" onClick={() => open({ kind: 'obs', rel: x.rel, h: x.h, q })}><span className="hit-path"><b>{noteShort(x.title)}</b>{x.h ? ` › ${x.h}` : ''}</span><span className="hit-snip">{x.snippet}</span></button>) : <p className="card-note">Ничего не нашлось. Попробуй другое слово.</p>)
        : <>
          {o.notes.length > 0 && <div className="mt-list">{o.notes.map((n: any) => <article key={n.id} className="mt">
            <div className="mt-head"><span className="mt-ic k-obsidian"><Icon name="study" /></span>
              <button className="mt-main" onClick={() => open({ kind: 'obs', rel: n.rel })}><b>{n.title}</b><small>{human(n.date)} · {n.sections.length} {plural(n.sections.length, 'раздел', 'раздела', 'разделов')}</small></button>
              {o.ai && <button className="btn-accent" onClick={() => open({ kind: 'cheat', id: n.id })}>{n.cheat ? 'Шпаргалка' : 'Сделать шпаргалку'}</button>}</div>
            {n.material ? <QuizState m={n.material} ai={o.ai} onQuiz={on => onObsQuiz(n.rel, on)} /> : <div className="mt-q"><span className="muted">Вопросов нет</span>{o.ai && <button className="btn-accent" onClick={() => onObsQuiz(n.rel, true)}><Icon name="quiz" />Сделать вопросы</button>}</div>}
            {n.tasks.length > 0 && <details className="more-block"><summary>Что проверить · {n.tasks.length}</summary><ul className="goal-lines">{n.tasks.map((t: string) => <li key={t}>{t}</li>)}</ul></details>}
          </article>)}</div>}
          {lib.length > 0 && <details className="more-block"><summary>Все заметки хранилища · {lib.length}</summary><div className="lib">{lib.map((n: any) => <button key={n.rel} className="lib-i" onClick={() => open({ kind: 'obs', rel: n.rel })}><b>{n.title}</b><span>{n.rel.split('/').slice(0, -1).join(' / ') || 'корень'}{n.sections ? ` · ${n.sections} ${plural(n.sections, 'раздел', 'раздела', 'разделов')}` : ''}</span></button>)}</div></details>}
        </>}
    </section>}

    <section className="wc span8"><div className="card-head"><h2>Дневник занятий</h2><div className="card-actions"><button className="btn-accent" onClick={() => open({ kind: 'session' })}><Icon name="plus" />Занятие</button></div></div>
      {!days.length ? <p className="card-note">Записывай, что изучал, — журнал посчитает часы и покажет график.</p>
        : days.map(dd => { const arr = diary.filter((e: any) => e.day === dd), m = arr.reduce((a: number, e: any) => a + (e.minutes || 0), 0); return <div key={dd}>
          <div className="group-date"><span>{human(dd)}</span><span>{m ? fmtMin(m) : ''}</span></div>
          <div className="list">{(arr.length > 4 && !openDays[dd] ? arr.slice(0, 3) : arr).map((e: any) => e.src === 'manual' ? <button key={e.id} className="item st-item" onClick={() => open({ kind: 'session', s: e })}>
              <span className="item-time">{e.time ?? '—'}</span><span className="item-main"><b>{e.title}{e.category && <span className="chip static sm">{e.category}</span>}</b><small>{e.theses.length ? `${e.theses.length} ${plural(e.theses.length, 'заметка', 'заметки', 'заметок')}` : ''}</small></span><span className="item-k"><b>{e.minutes ? fmtMin(e.minutes) : ''}</b></span></button>
            : <div key={e.id} className="item diary-item"><span className="diary-ic"><Icon name={e.kind === 'new' ? 'plus' : 'edit'} /></span>
              <span className="item-main"><b>{noteShort(e.title)}</b><small>{e.kind === 'new' ? `новый конспект: ${e.added.length} ${plural(e.added.length, 'раздел', 'раздела', 'разделов')}` : [e.added.length ? `дописал: ${e.added.join(', ')}` : '', e.changed.length ? `изменил: ${e.changed.join(', ')}` : ''].filter(Boolean).join(' · ')}</small></span>
              <label className="diary-min" title={g('Сколько минут занимался', 'Сколько минут занималась')}><input className="in" inputMode="numeric" placeholder="—" value={min[e.id] ?? (e.minutes ?? '')} onChange={x => setMin(s => ({ ...s, [e.id]: x.target.value }))} onBlur={() => min[e.id] !== undefined && saveMin(e)} /><span>мин</span></label></div>)}</div>
          {arr.length > 4 && !openDays[dd] && <button className="link-btn day-more" onClick={() => setOpenDays(o => ({ ...o, [dd]: true }))}>Ещё {arr.length - 3} {plural(arr.length - 3, 'запись', 'записи', 'записей')} за этот день</button>}
        </div>; })}
      {o.diary.length > diary.length && <button className="link-btn" onClick={() => setAll(true)}>Показать ещё {o.diary.length - diary.length}</button>}
    </section>
    <section className="wc span4"><div className="card-head"><h2>30 дней, минуты</h2></div><Bars rows={o.days.map((x: any) => ({ label: String(+x.day.slice(8, 10)), v: x.minutes, hint: `${human(x.day)}: ${fmtMin(x.minutes)}` }))} color="var(--study)" target={o.goal} unit="мин" every={7} /></section>
  </div>;
}

export function Study({ wide, version, tab: start, onBack, onChanged }: { wide: boolean; version: number; tab?: 'study' | 'quiz'; onBack: () => void; onChanged: () => void }) {
  const toast = useToast(), [tab, setTab] = useState<'study' | 'quiz'>(start ?? 'study'), [o, setO] = useState<any>(null), [v, setV] = useState(0), [sheet, setSheet] = useState<SheetState>(null);
  const load = useCallback(async () => { try { setO(await api<any>('/api/study/overview')); } catch (e) { fail(toast, e, 'Не получилось загрузить'); } }, [toast]);
  useEffect(() => { load(); }, [load, version, v]);
  useEffect(() => { if (start) setTab(start); }, [start]);
  // пока ИИ составляет вопросы — обновляем прогресс
  const working = !!o && [...o.materials, ...o.notes.map((n: any) => n.material).filter(Boolean)].some((m: Material) => m.quizStatus === 'working');
  useEffect(() => { if (!working) return; const t = setInterval(() => setV(x => x + 1), 3000); return () => clearInterval(t); }, [working]);
  const changed = () => { setV(x => x + 1); onChanged(); };
  const onQuiz = async (m: Material, on: boolean) => {
    try { await api(`/api/study/materials/${m.id}/quiz`, { method: 'POST', body: { on } }); toast(on ? (m.questions ? 'Вопросы снова в повторении' : 'ИИ составляет вопросы — это займёт пару минут') : 'Вопросы выключены — в повторение не попадут'); setSheet(null); changed(); }
    catch (e) { fail(toast, e); }
  };
  const onObsQuiz = async (rel: string, on: boolean) => {
    try { await api('/api/study/obsidian/quiz', { method: 'POST', body: { rel, on } }); toast(on ? 'ИИ составляет вопросы по заметке' : 'Вопросы выключены'); setSheet(null); changed(); }
    catch (e) { fail(toast, e); }
  };
  const added = (m: Material) => { toast(`Конспект «${m.title}» добавлен`); setSheet(null); changed(); };
  const due = o?.kpi?.due ?? 0;
  const title = sheet?.kind === 'session' ? (sheet.s ? 'Изменить занятие' : 'Занятие') : sheet?.kind === 'cheat' ? 'Шпаргалка' : sheet?.kind === 'link' ? 'Конспект по ссылке' : sheet?.kind === 'text' ? 'Конспект текстом' : sheet?.kind === 'menu' ? 'Конспект' : '';
  return <div className="day study-page">
    <header className="dayhead">
      {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
      <div className="daytitle"><span>{tab === 'quiz' ? 'по выбранным конспектам' : 'конспекты, дневник и повторение'}</span><b>{tab === 'quiz' ? 'Вопросы' : 'Учёба'}</b></div>
      <button className="nav" onClick={() => setSheet({ kind: 'session' })} aria-label="Занятие вручную" title="Занятие вручную"><Icon name="plus" /></button>
    </header>
    <div className="st-bar"><div className="seg-tabs" role="tablist">{([['study', 'Конспекты'], ['quiz', 'Вопросы']] as const).map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); buzz(6); }}>{n}{k === 'quiz' && due ? <span className="tab-badge">{due}</span> : null}</button>)}</div></div>
    {tab === 'quiz' ? <Quiz key={v} onChanged={onChanged} onMaterials={() => setTab('study')} /> : !o ? <div className="skel" style={{ height: 300 }} /> : <Overview o={o} open={setSheet} onQuiz={onQuiz} onObsQuiz={onObsQuiz} onReload={() => setV(x => x + 1)} />}
    <Sheet open={!!sheet} onClose={() => setSheet(null)} title={title} tall={sheet?.kind === 'read' || sheet?.kind === 'obs' || sheet?.kind === 'cheat'}>
      {sheet?.kind === 'read' && <MaterialReader key={sheet.id} id={sheet.id} onQuiz={onQuiz} />}
      {sheet?.kind === 'obs' && <ObsReader key={sheet.rel} rel={sheet.rel} h={sheet.h} q={sheet.q} onQuiz={rel => onObsQuiz(rel, true)} onCheat={id => setSheet({ kind: 'cheat', id })} />}
      {sheet?.kind === 'cheat' && <Cheat id={sheet.id} />}
      {sheet?.kind === 'link' && <LinkForm onDone={added} />}
      {sheet?.kind === 'text' && <TextForm onDone={added} />}
      {sheet?.kind === 'menu' && <MaterialMenu m={sheet.m}
        onRename={async t => { try { await api(`/api/study/materials/${sheet.m.id}`, { method: 'PUT', body: { title: t } }); toast('Название сохранено'); setSheet(null); changed(); } catch (e) { fail(toast, e); } }}
        onRegen={async () => { try { await api(`/api/study/materials/${sheet.m.id}/quiz/regen`, { method: 'POST' }); toast('Вопросы составляются заново'); setSheet(null); changed(); } catch (e) { fail(toast, e); } }}
        onDelete={async () => { try { await api(`/api/study/materials/${sheet.m.id}`, { method: 'DELETE' }); toast('Конспект удалён'); setSheet(null); changed(); } catch (e) { fail(toast, e); } }} />}
      {sheet?.kind === 'session' && o && <SessionForm s={sheet.s} today={o.today} cats={o.categories} onDone={() => { setSheet(null); changed(); }} />}
    </Sheet>
  </div>;
}
