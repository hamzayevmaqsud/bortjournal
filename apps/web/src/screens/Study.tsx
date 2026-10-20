/**
 * «Учёба и вопросы» (раздел Pro). «Вопросы» — порция дня из тезисов занятий и конспектов Obsidian: показать ответ
 * или проверить свой ответ ИИ, оценить «помню / частично / не помню» — повторение разнесётся по дням.
 * «Учёба» — поиск и чтение конспектов Obsidian, шпаргалки, дневник занятий с минутами, график минут.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { fmt, plural } from '../lib/format';
import { headId, markTerms, mdToHtml, safeQuizHtml } from '../lib/md';
import { buzz } from '../lib/motion';
import { Bars, human } from '../components/Charts';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toasts';

const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const hours = (m: number) => (Math.round(m / 6) / 10).toLocaleString('ru-RU');
const fmtMin = (m: number) => m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`;
const noteShort = (t: string) => String(t).replace(/\s*[—–-]\s*конспект.*$/i, '').replace(/\s*\(.*\)\s*$/, '').trim() || t;
const plain = (h: string) => new DOMParser().parseFromString(String(h), 'text/html').body.textContent?.trim() ?? '';
const ago = (iso: string | null) => { if (!iso) return 'ещё не было'; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : human(iso.slice(0, 10)); };

/* ---------------- вопросы ---------------- */
function Quiz({ onChanged }: { onChanged: () => void }) {
  const toast = useToast(), [d, setD] = useState<any>(null), [shown, setShown] = useState<Record<number, boolean>>({}), [ans, setAns] = useState(''), [check, setCheck] = useState<any>(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setD(await api<any>('/api/study/quiz')); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось загрузить', { err: true }); } }, [toast]);
  useEffect(() => { load(); }, [load]);
  const graded = useRef(false);
  useEffect(() => { if (graded.current) { graded.current = false; setTimeout(() => document.querySelector('.q.current')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80); } }, [d]);
  if (!d) return <div className="skel" style={{ height: 300 }} />;
  const items = d.items as any[], cur = items.findIndex(i => !i.result), answered = items.filter(i => i.result).length, good = items.filter(i => i.result === 'good').length;
  const more = async (mode?: string) => { try { const r = await api<any>('/api/study/quiz/more', { method: 'POST', body: { mode } }); toast(`Ещё ${r.added} ${plural(r.added, 'вопрос', 'вопроса', 'вопросов')}`); setShown({}); await load(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); } };
  const rate = async (k: number, g: string) => {
    try { await api('/api/study/quiz/grade', { method: 'POST', body: { index: k, grade: g, answer: ans || undefined, check: check ?? undefined } }); buzz(g === 'good' ? [10, 30, 10] : 8); graded.current = true; setAns(''); setCheck(null); await load(); onChanged(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); }
  };
  const verify = async (it: any, k: number) => {
    if (!ans.trim()) { toast('Сначала напиши ответ — или нажми «Не знаю»', { err: true }); return; }
    setBusy(true);
    try { setCheck(await api<any>('/api/study/quiz/check', { method: 'POST', body: { question: plain(it.q), reference: plain(it.a), answer: ans, noteId: it.noteId, key: it.key } })); setShown(s => ({ ...s, [k]: true })); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось проверить', { err: true }); } finally { setBusy(false); }
  };
  const hist = d.history as any[], anyHist = hist.some(h => h.answered);
  const histCard = anyHist && <section className="wc span12"><div className="card-head"><h2>Точность за 14 дней</h2></div>
    <Bars rows={hist.map(h => ({ label: String(+h.day.slice(8, 10)), v: h.answered ? Math.round(h.good / h.answered * 100) : 0, hint: h.answered ? `${human(h.day)}: ${h.good}/${h.answered}` : `${human(h.day)}: нет ответов` }))} color="var(--quiz)" max={100} unit="%" every={2} /></section>;

  if (!items.length) return <div className="wgrid">
    <section className="wc span12 solid s-mustard quiz-empty"><div className="card-head"><h2>Вопросы дня</h2></div>
      <p className="quiz-msg">{!d.total ? 'Вопросы собираются из тезисов твоих занятий. Запиши первое занятие с парой тезисов — и завтра здесь появится первый вопрос.' : d.next ? <>На сегодня повторять нечего. Ближайшая карточка — <b>{d.next.topic}</b>, {human(d.next.due)}.</> : 'Все карточки повторены.'}</p>
      {d.total > 0 && d.next && <button className="btn-accent" onClick={() => more('early')}><Icon name="repeat" />Повторить досрочно</button>}
    </section>{histCard}</div>;
  return <div className="wgrid">
    <div className="quiz-head span12"><div className="quiz-progress">{items.map((it, k) => <i key={k} className={it.result || (k === cur ? 'cur' : '')} />)}</div><span className="muted">{answered} / {items.length}</span></div>
    {cur === -1 && <section className="wc span12 solid s-sage quiz-done"><div className="wbig"><b>{good}</b><small>/ {items.length} уверенно</small></div>
      <p className="card-note">{good === items.length ? 'Чисто. Завтра будет новая порция.' : 'Что не вспомнил — вернётся завтра.'}</p>
      {d.due > 0 && <button className="btn-accent" onClick={() => more()}><Icon name="plus" />Ещё {Math.min(6, d.due)} {plural(Math.min(6, d.due), 'карточка', 'карточки', 'карточек')} ждут</button>}</section>}
    <div className="qlist span12">{items.map((it, k) => { const state = it.result ? 'done' : k === cur ? 'current' : 'locked', open = shown[k] || !!it.result;
      return <article key={k} className={`q ${state}`} style={{ ['--i' as string]: k }}>
        <div className="q-meta"><span>{k + 1} · {it.kind}</span><span>{it.meta}</span></div>
        <p className="q-text" dangerouslySetInnerHTML={{ __html: safeQuizHtml(it.q) }} />
        {state === 'current' && !open && (d.ai ? <>
          <textarea className="in q-input" rows={3} placeholder="Ответь своими словами — ИИ сверит с конспектом" value={ans} onChange={e => setAns(e.target.value)} />
          <div className="q-actions"><button className="primary" disabled={busy} onClick={() => verify(it, k)}>{busy ? <span className="spin" /> : <><Icon name="check" />Проверить ответ</>}</button><button className="ghost" onClick={() => setShown(s => ({ ...s, [k]: true }))}>Не знаю — показать ответ</button></div></>
          : <div className="q-actions"><button className="primary" onClick={() => setShown(s => ({ ...s, [k]: true }))}>Показать ответ</button></div>)}
        {state === 'current' && check && <div className={`q-check q-check-${check.verdict}`}><div className="q-score"><b>{check.score}</b><small>из 100</small></div><div className="q-fb">{ans && <p className="q-yours"><span>Твой ответ:</span> {ans}</p>}<p>{check.feedback}</p>{check.missing?.length > 0 && <ul>{check.missing.map((x: string) => <li key={x}>{x}</li>)}</ul>}</div></div>}
        {state !== 'current' && it.check && <div className={`q-check q-check-${it.check.verdict}`}><div className="q-score"><b>{it.check.score}</b><small>из 100</small></div><div className="q-fb"><p>{it.check.feedback}</p></div></div>}
        {open && <div className="q-answer"><span className="q-ref">Эталон</span><div dangerouslySetInnerHTML={{ __html: safeQuizHtml(it.a) }} /></div>}
        {state === 'current' && open && <div className="q-actions">{check && <span className="q-suggest">Оценка ИИ подсвечена — можно выбрать другую:</span>}
          {(['again', 'hard', 'good'] as const).map(g => <button key={g} className={`btn-accent grade-${g} ${check?.verdict === g ? 'suggest' : ''}`} onClick={() => rate(k, g)}>{g === 'good' && <Icon name="check" />}{g === 'again' ? 'Не помню' : g === 'hard' ? 'Частично' : 'Помню'}</button>)}</div>}
        {it.result && <div className="q-actions"><span className={`q-result ${it.result}`}>{{ good: 'помню', hard: 'частично', again: 'не помню' }[it.result as string]}</span></div>}
      </article>; })}</div>
    {histCard}
  </div>;
}

/* ---------------- чтение конспекта ---------------- */
function Reader({ rel, h, q: q0, onQuiz, onCheat, onClose }: { rel: string; h?: string; q?: string; onQuiz: (noteId: string) => void; onCheat: (noteId: string) => void; onClose: () => void }) {
  const [n, setN] = useState<any>(null), [err, setErr] = useState(''), [q, setQ] = useState(q0 ?? ''), body = useRef<HTMLElement>(null);
  useEffect(() => { api<any>(`/api/study/obsidian/note?rel=${encodeURIComponent(rel)}`).then(setN, e => setErr(e instanceof ApiError ? e.message : 'Не открылось')); }, [rel]);
  useEffect(() => {
    const el = body.current; if (!el || !n) return;
    el.innerHTML = mdToHtml(n.markdown); markTerms(el, q);
    const target = h && !q ? el.querySelector('#' + headId(h)) : el.querySelector('mark.hit');
    if (target) setTimeout(() => target.scrollIntoView({ block: q ? 'center' : 'start' }), 60);
  }, [n, q, h]);
  if (err) return <p className="form-err">{err}</p>;
  if (!n) return <div className="skel" style={{ height: 300 }} />;
  return <div className="reader">
    <div className="reader-title"><small>{n.rel.replace(/\.md$/, '')}</small><h2>{n.title}</h2>{n.tags.length > 0 && <div className="chips">{n.tags.map((t: string) => <span key={t} className="chip static">#{t}</span>)}</div>}</div>
    <div className="reader-actions">
      {n.sections.length > 0 && <select className="in" defaultValue="" onChange={e => { const el = body.current?.querySelector('#' + headId(e.target.value)); el?.scrollIntoView({ block: 'start' }); }} aria-label="Перейти к разделу"><option value="">Разделы…</option>{n.sections.map((x: string) => <option key={x}>{x}</option>)}</select>}
      <div className="fp-search"><Icon name="search" /><input className="in" type="search" placeholder="Найти в конспекте" value={q} onChange={e => setQ(e.target.value)} /></div>
      {n.noteId && <button className="btn-accent" onClick={() => { onClose(); onQuiz(n.noteId); }}><Icon name="quiz" />Повторить</button>}
      {n.noteId && <button className="btn-accent" onClick={() => onCheat(n.noteId)}>Шпаргалка</button>}
      <a className="btn-accent" href={n.link}>Открыть в Obsidian</a>
    </div>
    <article className="rd-body md" ref={body} onClick={e => { const a = (e.target as HTMLElement).closest('a.wl') as HTMLElement | null; if (a) { e.preventDefault(); const h2 = a.dataset.h; if (h2) body.current?.querySelector('#' + headId(h2))?.scrollIntoView({ block: 'start' }); } }} />
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

/* ---------------- занятие ---------------- */
function SessionForm({ s, today, cats, onDone }: { s?: any; today: string; cats: string[]; onDone: () => void }) {
  const toast = useToast(), [v, setV] = useState({ topic: s?.title ?? '', category: s?.category ?? '', minutes: s?.minutes ? String(s.minutes) : '', time: s?.time ?? nowHm(), day: s?.day ?? today, theses: (s?.theses ?? []).join('\n'), qa: (s?.qa ?? []).map((q: any) => `${q.q} => ${q.a}`).join('\n') });
  return <form className="form" onSubmit={async e => {
    e.preventDefault();
    try { await api(s ? `/api/study/sessions/${s.id}` : '/api/study/sessions', { method: s ? 'PUT' : 'POST', body: v }); buzz([8, 30, 8]); toast(s ? 'Сохранено' : 'Занятие записано'); onDone(); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); }
  }}>
    <label className="fld"><span>Тема</span><input className="in" required autoComplete="off" placeholder="Делегаты и события в C#" value={v.topic} onChange={e => setV({ ...v, topic: e.target.value })} /></label>
    <div className="fld"><span>Направление</span><div className="chips">{cats.slice(0, 12).map(c => <button type="button" key={c} className={`chip ${v.category === c ? 'on' : ''}`} onClick={() => setV({ ...v, category: v.category === c ? '' : c })}>{c}</button>)}</div></div>
    <div className="grid4f"><label className="fld"><span>Минут</span><input className="in" inputMode="numeric" placeholder="45" value={v.minutes} onChange={e => setV({ ...v, minutes: e.target.value })} /></label>
      <label className="fld"><span>Время</span><input className="in" type="time" value={v.time ?? ''} onChange={e => setV({ ...v, time: e.target.value })} /></label>
      <label className="fld" style={{ gridColumn: 'span 2' }}><span>Дата</span><input className="in" type="date" value={v.day} onChange={e => setV({ ...v, day: e.target.value })} /></label></div>
    <label className="fld"><span>Тезисы — что понял</span><textarea className="in" rows={4} placeholder={'Каждая строка — отдельная мысль. Например:\nДелегат — это тип, описывающий сигнатуру метода\nevent запрещает вызывать делегат извне класса'} value={v.theses} onChange={e => setV({ ...v, theses: e.target.value })} /></label>
    <p className="card-note">Из тезисов соберутся вопросы на повторение: пропуски в тексте и «расскажи, что помнишь по теме». Повторы придут через 1, 2, 5… дней.</p>
    <label className="fld"><span>Вопрос → ответ (по желанию)</span><textarea className="in" rows={2} placeholder="Чем Action отличается от Func? => Func возвращает значение, Action — нет" value={v.qa} onChange={e => setV({ ...v, qa: e.target.value })} /></label>
    <button className="primary">{s ? 'Сохранить' : 'Записать'}</button>
    {s && <button type="button" className="ghost danger" onClick={async () => { await api(`/api/study/sessions/${s.id}`, { method: 'DELETE' }); toast('Занятие удалено'); onDone(); }}>Удалить</button>}
  </form>;
}

/* ---------------- учёба ---------------- */
function Overview({ o, onOpen, onQuizNote, onCheat, onSession, onReload }: { o: any; onOpen: (rel: string, h?: string, q?: string) => void; onQuizNote: (id: string) => void; onCheat: (id: string) => void; onSession: (s?: any) => void; onReload: () => void }) {
  const toast = useToast(), [q, setQ] = useState(''), [hits, setHits] = useState<any[] | null>(null), [lib, setLib] = useState<any[]>([]), [all, setAll] = useState(false), [min, setMin] = useState<Record<string, string>>({});
  useEffect(() => { if (o.obs.enabled) api<any>('/api/study/obsidian/library').then(r => setLib(r.notes), () => {}); }, [o.obs.enabled]);
  useEffect(() => { if (q.trim().length < 2) { setHits(null); return; } const t = setTimeout(() => api<any>(`/api/study/obsidian/search?q=${encodeURIComponent(q)}`).then(r => setHits(r.hits), () => setHits([])), 250); return () => clearTimeout(t); }, [q]);
  const saveMin = async (e: any) => { try { await api('/api/study/time', { method: 'PUT', body: { key: e.id, day: e.day, minutes: Number(min[e.id] ?? e.minutes ?? 0) } }); toast('Минуты записаны'); onReload(); } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } };
  const from = new Date(Date.parse(o.today) - 13 * 864e5).toISOString().slice(0, 10), diary = all ? o.diary : o.diary.filter((e: any) => e.day >= from);
  const days = [...new Set(diary.map((e: any) => e.day))] as string[];
  return <div className="wgrid">
    <div className="kpis span12">
      {o.obs.enabled ? <div className="kpi"><span>Конспектов</span><b>{o.kpi.notes}</b><small>{o.kpi.sections} {plural(o.kpi.sections, 'раздел', 'раздела', 'разделов')}</small></div>
        : <div className="kpi"><span>Занятий</span><b>{o.kpi.sessions}</b><small>записано вручную</small></div>}
      <div className="kpi"><span>Вопросов</span><b>{fmt(o.kpi.questions)}</b><small>по разделам и тезисам</small></div>
      <div className="kpi"><span>К повторению</span><b>{o.kpi.due}</b><small>{o.kpi.due ? 'порциями по 6 в день' : 'на сегодня всё'}</small></div>
      <div className="kpi"><span>За 7 дней</span><b>{hours(o.kpi.week)}<small>ч</small></b><small>всего {hours(o.kpi.all)} ч</small></div>
    </div>
    {o.obs.enabled && <section className="wc span12"><div className="card-head"><h2>Поиск и чтение</h2></div>
      <div className="fp-search"><Icon name="search" /><input className="in" type="search" placeholder="Поиск по всем заметкам Obsidian: etcd кворум, multipath, LACP…" value={q} onChange={e => setQ(e.target.value)} /></div>
      {hits === null ? lib.length > 0 && <div className="lib"><h3 className="sub-h">Заметки в хранилище · {lib.length}</h3>{lib.slice(0, 12).map((n: any) => <button key={n.rel} className="lib-i" onClick={() => onOpen(n.rel)}><b>{n.title}</b><span>{n.rel.split('/').slice(0, -1).join(' / ') || 'корень'}{n.sections ? ` · ${n.sections} ${plural(n.sections, 'раздел', 'раздела', 'разделов')}` : ''}</span></button>)}</div>
        : hits.length ? hits.map((x: any, i: number) => <button key={i} className="hit-i" onClick={() => onOpen(x.rel, x.h, q)}><span className="hit-path"><b>{noteShort(x.title)}</b>{x.h ? ` › ${x.h}` : ''}</span><span className="hit-snip">{x.snippet}</span></button>) : <p className="card-note">Ничего не нашлось. Попробуй другое слово.</p>}
    </section>}
    {o.obs.enabled && <section className="wc span12"><div className="card-head"><h2>Obsidian</h2><div className="card-actions"><button className="btn-accent" onClick={async () => { await api('/api/study/obsidian/sync', { method: 'POST' }).catch(() => {}); toast('Синхронизировано'); onReload(); }}><Icon name="repeat" />Синхронизировать</button></div></div>
      <p className="card-note">Хранилище <b>{o.obs.vault}</b> → папка <b>{o.obs.folder}</b> · синхронизировано {ago(o.obs.lastSync)}</p>
      {o.obs.error && <p className="form-err">{o.obs.error}</p>}
      {o.obs.queue?.total > 0 && o.obs.ai && <div className="obs-q"><span>{o.obs.queue.total - o.obs.queue.done ? `${o.obs.queue.pausedUntil ? 'Лимит ИИ — пауза, продолжу сам. ' : 'ИИ готовит вопросы: '}${o.obs.queue.done} из ${o.obs.queue.total} разделов` : `Вопросы готовы для всех ${o.obs.queue.total} разделов`}</span><span className="wbar"><i style={{ width: `${o.obs.queue.done / o.obs.queue.total * 100}%`, background: 'var(--quiz)' }} /></span></div>}
    </section>}
    {o.notes.length > 0 && <section className="wc span12"><div className="card-head"><h2>Конспекты</h2></div>
      {o.notes.map((n: any) => <div key={n.id} className="note">
        <div className="note-head"><div className="note-title"><b>{n.title}</b><span className="note-meta">{human(n.date)} · {n.sections.length} {plural(n.sections.length, 'раздел', 'раздела', 'разделов')} · {n.questions} {plural(n.questions, 'вопрос', 'вопроса', 'вопросов')}</span></div>
          <div className="note-actions"><button className="btn-accent solid-st" onClick={() => onOpen(n.rel)}><Icon name="study" />Читать</button><button className="btn-accent" disabled={!n.questions} onClick={() => onQuizNote(n.id)}><Icon name="quiz" />Повторить{n.due ? ` · ${n.due}` : ''}</button>
            {o.obs.ai && <button className="btn-accent" onClick={() => onCheat(n.id)}>{n.cheat ? 'Шпаргалка' : 'Сделать шпаргалку'}</button>}</div></div>
        {n.tags.length > 0 && <div className="chips">{n.tags.map((t: string) => <span key={t} className="chip static">#{t}</span>)}</div>}
        <details className="more-block"><summary>Разделы и вопросы</summary><div className="note-secs">{n.sections.map((s: any) => <div key={s.key} className="note-sec"><button className="link-btn" onClick={() => onOpen(n.rel, s.h)}>{s.h}</button>
          <span className="muted">{s.questions === null ? 'вопросы готовятся…' : s.error ? `ошибка: ${String(s.error).slice(0, 60)}` : `${s.questions} ${plural(s.questions, 'вопрос', 'вопроса', 'вопросов')}`}</span>
          <button className="ico" title="Пересобрать вопросы по разделу" onClick={async () => { await api('/api/study/obsidian/regen', { method: 'POST', body: { noteId: n.id, key: s.key } }); toast('Вопросы пересоберутся'); onReload(); }} aria-label="Пересобрать вопросы"><Icon name="repeat" /></button></div>)}</div></details>
        {n.tasks.length > 0 && <details className="more-block"><summary>Что проверить · {n.tasks.length}</summary><ul className="goal-lines">{n.tasks.map((t: string) => <li key={t}>{t}</li>)}</ul></details>}
      </div>)}
    </section>}
    <section className="wc span8"><div className="card-head"><h2>Дневник занятий</h2><div className="card-actions"><button className="btn-accent" onClick={() => onSession()}><Icon name="plus" />Занятие</button></div></div>
      {!days.length ? <p className="card-note">{o.obs.enabled ? 'Дневник заполнится сам: новый конспект или дописанный раздел в Obsidian — запись здесь.' : 'Записывай, что изучал, — журнал посчитает часы, а из тезисов соберёт вопросы на повторение.'}</p>
        : days.map(dd => { const arr = diary.filter((e: any) => e.day === dd), m = arr.reduce((a: number, e: any) => a + (e.minutes || 0), 0); return <div key={dd}>
          <div className="group-date"><span>{human(dd)}</span><span>{m ? fmtMin(m) : ''}</span></div>
          <div className="list">{arr.map((e: any) => e.src === 'manual' ? <button key={e.id} className="item st-item" onClick={() => onSession(e)}>
              <span className="item-time">{e.time ?? '—'}</span><span className="item-main"><b>{e.title}{e.category && <span className="chip static sm">{e.category}</span>}</b><small>{e.theses.length ? `${e.theses.length} ${plural(e.theses.length, 'тезис', 'тезиса', 'тезисов')}` : ''}{e.qa.length ? ` · ${e.qa.length} Q&A` : ''}</small></span><span className="item-k"><b>{e.minutes ? fmtMin(e.minutes) : ''}</b></span></button>
            : <div key={e.id} className="item diary-item"><span className="diary-ic"><Icon name={e.kind === 'new' ? 'plus' : 'edit'} /></span>
              <span className="item-main"><b>{noteShort(e.title)}</b><small>{e.kind === 'new' ? `новый конспект: ${e.added.length} ${plural(e.added.length, 'раздел', 'раздела', 'разделов')}` : [e.added.length ? `дописал: ${e.added.join(', ')}` : '', e.changed.length ? `изменил: ${e.changed.join(', ')}` : ''].filter(Boolean).join(' · ')}</small></span>
              <label className="diary-min" title="Сколько минут занимался"><input className="in" inputMode="numeric" placeholder="—" value={min[e.id] ?? (e.minutes ?? '')} onChange={x => setMin(s => ({ ...s, [e.id]: x.target.value }))} onBlur={() => min[e.id] !== undefined && saveMin(e)} /><span>мин</span></label></div>)}</div>
        </div>; })}
      {o.diary.length > diary.length && <button className="link-btn" onClick={() => setAll(true)}>Показать ещё {o.diary.length - diary.length}</button>}
      <p className="card-note">Время занятия можно вписать прямо в строку дневника — оно пойдёт в часы и график.</p>
    </section>
    <section className="wc span4"><div className="card-head"><h2>30 дней, минуты</h2></div><Bars rows={o.days.map((x: any) => ({ label: String(+x.day.slice(8, 10)), v: x.minutes, hint: `${human(x.day)}: ${fmtMin(x.minutes)}` }))} color="var(--study)" target={o.goal} unit="мин" every={7} /></section>
  </div>;
}

export function Study({ wide, version, tab: start, onBack, onChanged }: { wide: boolean; version: number; tab?: 'study' | 'quiz'; onBack: () => void; onChanged: () => void }) {
  const toast = useToast(), [tab, setTab] = useState<'study' | 'quiz'>(start ?? 'quiz'), [o, setO] = useState<any>(null), [v, setV] = useState(0);
  const [sheet, setSheet] = useState<null | { kind: 'read'; rel: string; h?: string; q?: string } | { kind: 'cheat'; id: string } | { kind: 'session'; s?: any }>(null);
  const load = useCallback(async () => { try { setO(await api<any>('/api/study/overview')); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось загрузить', { err: true }); } }, [toast]);
  useEffect(() => { load(); }, [load, version, v]);
  useEffect(() => { if (start) setTab(start); }, [start]);
  const changed = () => { setV(x => x + 1); onChanged(); };
  const quizNote = async (id: string) => { try { await api('/api/study/quiz/more', { method: 'POST', body: { mode: 'note', noteId: id } }); setTab('quiz'); setV(x => x + 1); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); } };
  return <div className="day study-page">
    <header className="dayhead">
      {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
      <div className="daytitle"><span>{tab === 'quiz' ? 'из твоих конспектов и тезисов' : o?.obs?.enabled ? `конспекты из Obsidian · ${o.obs.vault}` : 'дневник занятий и повторение'}</span><b>{tab === 'quiz' ? 'Вопросы дня' : 'Учёба'}</b></div>
      <button className="nav" onClick={() => setSheet({ kind: 'session' })} aria-label="Занятие вручную" title="Занятие вручную"><Icon name="plus" /></button>
    </header>
    <div className="st-bar"><div className="seg-tabs" role="tablist">{([['quiz', 'Вопросы'], ['study', 'Учёба']] as const).map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); buzz(6); }}>{n}{k === 'quiz' && o?.kpi?.due ? <span className="tab-badge">{Math.min(6, o.kpi.due)}</span> : null}</button>)}</div></div>
    {tab === 'quiz' ? <Quiz key={v} onChanged={changed} /> : !o ? <div className="skel" style={{ height: 300 }} /> : <Overview o={o} onOpen={(rel, h, q) => setSheet({ kind: 'read', rel, h, q })} onQuizNote={quizNote} onCheat={id => setSheet({ kind: 'cheat', id })} onSession={s => setSheet({ kind: 'session', s })} onReload={() => setV(x => x + 1)} />}
    <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.kind === 'session' ? (sheet.s ? 'Изменить занятие' : 'Занятие') : sheet?.kind === 'cheat' ? 'Шпаргалка' : ''} tall={sheet?.kind !== 'session'}>
      {sheet?.kind === 'read' && <Reader key={sheet.rel} rel={sheet.rel} h={sheet.h} q={sheet.q} onQuiz={quizNote} onCheat={id => setSheet({ kind: 'cheat', id })} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'cheat' && <Cheat id={sheet.id} />}
      {sheet?.kind === 'session' && o && <SessionForm s={sheet.s} today={o.today} cats={o.categories} onDone={() => { setSheet(null); changed(); }} />}
    </Sheet>
  </div>;
}
