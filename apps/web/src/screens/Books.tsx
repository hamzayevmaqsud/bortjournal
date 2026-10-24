/**
 * «Книги» (раздел Pro): «Читаю» — цель года, серия, темп, страницы по дням, текущие книги с записью страниц;
 * «Полка» — фильтры, сортировка, прочитанное по годам; «Цитаты». Карточка книги — статус, оценка, мысли,
 * цитаты, история чтения. Добавление — поиском в Open Library (обложка, автор, страницы) или вручную, своё фото обложки.
 */
import { useQuick } from '../lib/quick';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { fmt, fmt1, plural } from '../lib/format';
import { buzz } from '../lib/motion';
import { Bars, human, humanLong } from '../components/Charts';
import { Icon } from '../components/Icon';
import { HelpButton } from '../components/HelpButton';
import { Arc } from '../components/Ring';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toasts';

const STATUS: Record<string, string> = { reading: 'Читаю', want: 'Хочу прочитать', done: 'Прочитано', drop: 'Брошено' };
const FORMAT: Record<string, string> = { paper: 'Бумажная', ebook: 'Электронная', audio: 'Аудио' };
const COLORS = ['#2F3B4F', '#D9622B', '#3C5B38', '#B5891E', '#8E2F22', '#4D7B78', '#5A4A6E', '#2E6B57'];
const GENRES = ['Роман', 'Нон-фикшн', 'Бизнес', 'Психология', 'Фантастика', 'Классика', 'История', 'Саморазвитие', 'Технологии', 'Биография'];
const colorOf = (t: string) => COLORS[[...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
const coverSrc = (b: any) => b.cover?.mine ? `/api/books/books/${b.id}/cover?v=${b.cover.v}` : b.cover && (b.cover.ol || b.cover.isbn?.length) ? `/api/books/cover?${b.cover.ol ? `ol=${b.cover.ol}&` : ''}isbn=${encodeURIComponent((b.cover.isbn ?? []).join(','))}` : '';
const bkN = (v: number) => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? `${r} ${plural(r, 'книгу', 'книги', 'книг')}` : `${fmt1(r)} книги`; };

function Cover({ b, size = 'm' }: { b: any; size?: 's' | 'm' | 'l' | 'xl' }) {
  const [bad, setBad] = useState(false), src = coverSrc(b);
  return <div className={`bk-cover bk-${size}`} style={{ ['--bc' as string]: colorOf(b.title ?? '') }}>
    <div className="bk-gen"><b>{b.title}</b>{b.author && <span>{b.author}</span>}</div>
    {src && !bad && <img src={src} alt={`Обложка: ${b.title}`} loading="lazy" onError={() => setBad(true)} />}
  </div>;
}
const Stars = ({ n, onRate }: { n: number; onRate?: (v: number) => void }) => <span className="bk-stars" role={onRate ? 'radiogroup' : 'img'} aria-label={`Оценка ${n || 0} из 5`}>
  {[1, 2, 3, 4, 5].map(k => onRate ? <button key={k} type="button" className={k <= n ? 'on' : ''} onClick={() => onRate(k)} aria-label={String(k)}>★</button> : <i key={k} className={k <= n ? 'on' : ''}>★</i>)}</span>;
function Tile({ b, onOpen }: { b: any; onOpen: (id: string) => void }) {
  return <button type="button" className="bk-tile" onClick={() => onOpen(b.id)}>
    <Cover b={b} />{b.status === 'reading' && <span className="bk-prog"><i style={{ width: `${b.pct}%` }} /></span>}
    <b className="bk-t">{b.title}</b><span className="bk-a">{b.author ?? ''}</span>
    {b.rating ? <Stars n={b.rating} /> : b.status !== 'done' && <span className={`bk-st bk-st-${b.status}`}>{STATUS[b.status]}</span>}
  </button>;
}

/* ---------------- добавить / изменить ---------------- */
async function shrink(file: File) {
  const url = URL.createObjectURL(file), img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  const k = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1]!;
}
function BookForm({ b, onDone }: { b?: any; onDone: (id: string) => void }) {
  const toast = useToast(), [q, setQ] = useState(''), [hits, setHits] = useState<any[] | null>(null), [err, setErr] = useState(''), [photo, setPhoto] = useState<File | null>(null), [busy, setBusy] = useState(false);
  const [v, setV] = useState({ title: b?.title ?? '', author: b?.author ?? '', pages: b?.pages ? String(b.pages) : '', status: b?.status ?? 'reading', format: b?.format ?? 'paper', genre: b?.genre ?? '', owned: !!b?.owned, cover: b?.cover && !b.cover.mine ? { ol: b.cover.ol, isbn: b.cover.isbn } : null as null | { ol: number | null; isbn: string[] } });
  useEffect(() => {
    if (b || q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => api<{ items: any[] }>(`/api/books/search?q=${encodeURIComponent(q.trim())}`).then(r => { setHits(r.items); setErr(''); }, e => setErr(e instanceof ApiError ? e.message : 'Поиск не сработал')), 350);
    return () => clearTimeout(t);
  }, [q, b]);
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...v, pages: v.pages || null, cover: v.cover ?? undefined };
      const r = await api<any>(b ? `/api/books/books/${b.id}` : '/api/books/books', { method: b ? 'PATCH' : 'POST', body });
      if (photo) await api(`/api/books/books/${r.id}/cover`, { method: 'POST', body: { image: await shrink(photo) } });
      buzz([8, 30, 8]); toast(b ? 'Сохранено' : `«${r.title}» на полке`); onDone(r.id);
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); } finally { setBusy(false); }
  };
  return <form className="form" onSubmit={e => { e.preventDefault(); save(); }}>
    {!b && <div className="bk-search">
      <div className="fp-search"><Icon name="search" /><input className="in" value={q} onChange={e => setQ(e.target.value)} placeholder="Найти по названию или автору" autoComplete="off" aria-label="Поиск книги" /></div>
      {err ? <p className="card-note">{err}</p> : hits === null ? <p className="card-note">Найдём обложку, автора и число страниц. Или заполни вручную ниже.</p> : hits.length ? <div className="bk-hits">{hits.map((x, k) => <button type="button" key={k} className={`bk-hit ${v.title === x.title && v.cover?.ol === x.cover ? 'on' : ''}`} onClick={() => { setV({ ...v, title: x.title, author: x.author, pages: x.pages ? String(x.pages) : v.pages, genre: v.genre || (/[а-яё]/i.test(x.genre ?? '') ? x.genre : '') || '', cover: x.cover || x.isbn.length ? { ol: x.cover, isbn: x.isbn } : null }); buzz(6); }}>
        <Cover b={{ title: x.title, author: x.author, cover: { ol: x.cover, isbn: x.isbn } }} size="s" /><span><b>{x.title}</b><small>{x.author}{x.year ? ` · ${x.year}` : ''}{x.pages ? ` · ${x.pages} стр.` : ''}</small></span></button>)}</div> : <p className="card-note">Ничего не нашлось — заполни вручную.</p>}
    </div>}
    <label className="fld"><span>Название</span><input className="in" required maxLength={200} value={v.title} onChange={e => setV({ ...v, title: e.target.value })} /></label>
    <div className="grid2"><label className="fld"><span>Автор</span><input className="in" maxLength={160} value={v.author} onChange={e => setV({ ...v, author: e.target.value })} /></label>
      <label className="fld"><span>Страниц</span><input className="in" inputMode="numeric" value={v.pages} onChange={e => setV({ ...v, pages: e.target.value })} /></label></div>
    <div className="fld"><span>Статус</span><div className="chips">{Object.entries(STATUS).map(([k, n]) => <button type="button" key={k} className={`chip ${v.status === k ? 'on' : ''}`} onClick={() => setV({ ...v, status: k })}>{n}</button>)}</div></div>
    <div className="fld"><span>Формат</span><div className="chips">{Object.entries(FORMAT).map(([k, n]) => <button type="button" key={k} className={`chip ${v.format === k ? 'on' : ''}`} onClick={() => setV({ ...v, format: k })}>{n}</button>)}</div></div>
    <div className="fld"><span>Жанр</span><div className="chips">{GENRES.map(g => <button type="button" key={g} className={`chip ${v.genre === g ? 'on' : ''}`} onClick={() => setV({ ...v, genre: v.genre === g ? '' : g })}>{g}</button>)}</div></div>
    <label className="check-row"><input type="checkbox" checked={v.owned} onChange={e => setV({ ...v, owned: e.target.checked })} /><span>Есть в моей коллекции (книга у меня)</span></label>
    <label className="fld"><span>Своя обложка — фото книги</span><input className="in" type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></label>
    {v.cover && !photo && <p className="card-note">Обложка из каталога выбрана.</p>}
    <button className="primary" disabled={busy}>{b ? 'Сохранить' : 'Добавить'}</button>
  </form>;
}

/* ---------------- карточка книги ---------------- */
function BookCard({ id, onChanged, onEdit, onClose }: { id: string; onChanged: () => void; onEdit: (b: any) => void; onClose: () => void }) {
  const toast = useToast(), [b, setB] = useState<any>(null), [quote, setQuote] = useState({ text: '', page: '' }), [notes, setNotes] = useState(''), noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const load = useCallback(async () => { const d = await api<any>(`/api/books/books/${id}`); setB(d); setNotes(d.notes ?? ''); }, [id]);
  useEffect(() => { load().catch(() => setB(false)); }, [load]);
  if (b === false) return <p className="card-note">Книга не найдена.</p>;
  if (!b) return <div className="skel" style={{ height: 300 }} />;
  const patch = async (body: any, msg?: string) => { try { await api(`/api/books/books/${id}`, { method: 'PATCH', body }); if (msg) toast(msg); await load(); onChanged(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); } };
  const days = b.started && b.finished ? Math.round((Date.parse(b.finished) - Date.parse(b.started)) / 864e5) + 1 : 0;
  return <div className="form">
    <div className="bk-detail"><Cover b={b} size="xl" />
      <div className="bk-detail-main">
        <h3>{b.title}</h3><div className="bk-now-a">{b.author || 'Автор не указан'}</div>
        <div className="chips">{[b.genre, b.pages && `${fmt(b.pages)} стр.`, FORMAT[b.format], b.owned && 'в коллекции'].filter(Boolean).map((x: string) => <span key={x} className="chip static">{x}</span>)}</div>
        <div className="seg-tabs bk-status">{Object.entries(STATUS).map(([k, n]) => <button key={k} className={b.status === k ? 'on' : ''} onClick={() => patch({ status: k }, k === 'done' ? 'Дочитано! Книга на полке «Прочитано»' : undefined)}>{n}</button>)}</div>
        <div className="bk-rate">Оценка <Stars n={b.rating ?? 0} onRate={v => patch({ rating: v })} /></div>
        {(b.status === 'reading' || (b.status === 'done' && b.pages)) && <><div className="bk-now-bar"><i style={{ width: `${b.pct}%` }} /></div><div className="bk-now-s">{b.pct}%{b.pages ? ` · стр. ${fmt(b.page)} из ${fmt(b.pages)}` : ''}</div></>}
        <p className="card-note">{[b.started && `Начал ${humanLong(b.started)}`, b.finished && `закончил ${humanLong(b.finished)}`, days && `за ${days} ${plural(days, 'день', 'дня', 'дней')}`, b.readDays && `читал ${b.readDays} ${plural(b.readDays, 'день', 'дня', 'дней')}`].filter(Boolean).join(' · ') || (b.added ? `Добавлена ${humanLong(b.added)}` : '')}</p>
      </div>
    </div>
    <label className="fld"><span>Мысли о книге</span><textarea className="in" rows={3} value={notes} placeholder="Что запомнилось, кому посоветовать…" onChange={e => { const t = e.target.value; setNotes(t); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => api(`/api/books/books/${id}`, { method: 'PATCH', body: { notes: t } }).catch(() => {}), 700); }} /></label>
    <h4 className="sub-h">Цитаты · {b.quotes.length}</h4>
    <form className="bk-q-form" onSubmit={async e => { e.preventDefault(); if (!quote.text.trim()) return; try { await api(`/api/books/books/${id}/quotes`, { method: 'POST', body: quote }); setQuote({ text: '', page: '' }); buzz([8, 30, 8]); toast('Цитата сохранена'); await load(); onChanged(); } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } }}>
      <textarea className="in" rows={2} maxLength={1200} placeholder="Фраза, которая зацепила" value={quote.text} onChange={e => setQuote({ ...quote, text: e.target.value })} />
      <div className="row-flex"><input className="in" maxLength={10} inputMode="numeric" placeholder="стр." style={{ maxWidth: 90 }} value={quote.page} onChange={e => setQuote({ ...quote, page: e.target.value })} /><button className="btn-accent"><Icon name="plus" />Добавить цитату</button></div>
    </form>
    {b.quotes.map((q: any) => <figure key={q.id} className="bk-quote sm" style={{ ['--bc' as string]: colorOf(b.title) }}><blockquote>{q.text}</blockquote>
      <figcaption>{q.page ? `стр. ${q.page} · ` : ''}{q.day ? human(q.day) : ''}<button className="ico del" onClick={async () => { await api(`/api/books/quotes/${q.id}`, { method: 'DELETE' }); await load(); onChanged(); }} aria-label="Удалить цитату">×</button></figcaption></figure>)}
    {b.log.length > 0 && <details className="more-block"><summary>История чтения · {b.log.length}</summary><ul className="ex-hist">{b.log.map((l: any) => <li key={l.day}><span>{human(l.day)}</span><b>+{l.pages} стр.</b></li>)}</ul></details>}
    <div className="ob-nav"><button className="ghost danger" onClick={async () => { await api(`/api/books/books/${id}`, { method: 'DELETE' }); toast(`«${b.title}» удалена`); onChanged(); onClose(); }}>Удалить</button><button className="ghost" onClick={() => onEdit(b)}><Icon name="edit" />Изменить</button></div>
  </div>;
}

/* ---------------- вкладки ---------------- */
function Now({ o, onOpen, onAdd, onGoal, onChanged }: { o: any; onOpen: (id: string) => void; onAdd: () => void; onGoal: () => void; onChanged: () => void }) {
  const toast = useToast(), [page, setPage] = useState<Record<string, string>>({});
  const progress = async (id: string, body: any) => {
    try { const r = await api<any>(`/api/books/books/${id}/progress`, { method: 'POST', body }); buzz([8, 30, 8]); toast(r.delta > 0 ? `+${r.delta} стр. · ${r.book.pct}%` : 'Записано'); setPage(p => ({ ...p, [id]: '' })); onChanged(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось', { err: true }); }
  };
  const diff = o.behind;
  return <div className="wgrid">
    <div className="kpis span12" data-tour="books-kpis">
      <div className="kpi"><span>Серия чтения</span><b>{o.kpi.streak}<small>{plural(o.kpi.streak, 'день', 'дня', 'дней')}</small></b><small>{o.kpi.streak ? 'подряд с чтением' : 'почитай сегодня — начнётся'}</small></div>
      <div className="kpi"><span>Сегодня</span><b>{o.kpi.today}<small>стр.</small></b><small>за неделю {o.kpi.week} стр.</small></div>
      <div className="kpi"><span>Темп</span><b>{o.kpi.pace}<small>стр/день</small></b><small>в дни, когда читаешь</small></div>
      <div className="kpi"><span>За 30 дней</span><b>{fmt(o.kpi.pages30)}<small>стр.</small></b><small>{o.kpi.done30} {plural(o.kpi.done30, 'книга', 'книги', 'книг')} дочитано</small></div>
    </div>
    <section className="wc span8" data-tour="books-now"><div className="card-head"><h2>{o.reading.length > 1 ? `Читаю сейчас · ${o.reading.length}` : 'Читаю сейчас'}</h2></div>
      {o.reading.length ? o.reading.map((b: any) => <article key={b.id} className="bk-now">
        <button className="bk-now-cover" onClick={() => onOpen(b.id)} aria-label={`Открыть «${b.title}»`}><Cover b={b} size="l" /></button>
        <div className="bk-now-main">
          <div className="bk-now-k">{b.format !== 'paper' ? `${FORMAT[b.format]} · ` : ''}{b.started ? `читаю с ${human(b.started)}` : 'читаю'}</div>
          <h3>{b.title}</h3><div className="bk-now-a">{b.author ?? ''}</div>
          <div className="bk-now-bar"><i style={{ width: `${b.pct}%` }} /></div>
          <div className="bk-now-s"><b>{b.pct}%</b>{b.pages ? ` · стр. ${fmt(b.page)} из ${fmt(b.pages)}` : ''}{b.eta ? ` · ≈${b.eta} ${plural(b.eta, 'день', 'дня', 'дней')} до конца` : ''}{b.today ? <span className="bk-today"> · сегодня +{b.today}</span> : null}</div>
          <form className="bk-log" onSubmit={e => { e.preventDefault(); if (page[b.id]) progress(b.id, { page: page[b.id] }); }}>
            <label className="bk-log-in"><span>Дочитал до стр.</span><input className="in" inputMode="numeric" placeholder={b.page ? String(b.page) : ''} value={page[b.id] ?? ''} onChange={e => setPage(p => ({ ...p, [b.id]: e.target.value }))} /></label>
            <button className="btn-accent solid-b"><Icon name="check" />Записать</button>
            <button type="button" className="btn-accent" onClick={() => progress(b.id, { add: 10 })}>+10</button>
            <button type="button" className="btn-accent" onClick={() => progress(b.id, { add: 25 })}>+25</button>
            <button type="button" className="btn-accent" onClick={async () => { await api(`/api/books/books/${b.id}`, { method: 'PATCH', body: { status: 'done' } }); buzz([10, 40, 10, 40, 20]); toast(`Дочитано: «${b.title}»`); onChanged(); }}>Дочитал</button>
          </form>
        </div>
      </article>) : <div className="bk-empty"><p className="card-note">{o.total ? 'Сейчас ничего не читаешь. Выбери следующую книгу из «Хочу прочитать».' : 'Добавь книгу, которую читаешь, — журнал будет считать страницы, темп и серию.'}</p><button className="primary" onClick={onAdd}><Icon name="plus" />Добавить книгу</button></div>}
    </section>
    <section className="wc span4 bk-goal-card" data-tour="books-goal"><div className="card-head"><h2>Цель на {o.year}</h2></div>
      <div className="bk-goal"><span className="meter" style={{ width: 130, height: 130 }}><Arc size={130} sw={12} color="var(--books)" p={o.goal ? o.done / o.goal : 0} /><em>{o.done}<small>из {o.goal}</small></em></span>
        <div><p className="bk-goal-t">{o.done >= o.goal ? 'Цель года выполнена — всё, что дальше, сверху.' : diff >= 0.5 ? `Опережаешь график на ${bkN(diff)}.` : diff <= -0.5 ? `Отстаёшь от графика на ${bkN(-diff)} — догонишь.` : 'Идёшь точно по графику.'}</p>
          {o.need > 0 && <p className="card-note">Осталось {o.need} {plural(o.need, 'книга', 'книги', 'книг')} — примерно по одной в {fmt1(o.weeksLeft / o.need)} нед.</p>}
          <button className="btn-accent" onClick={onGoal}>Изменить цель</button></div></div>
    </section>
    <section className="wc span12"><div className="card-head"><h2>Страниц в день · 30 дней</h2></div>
      {o.kpi.pages30 ? <Bars rows={o.days.map((d: any) => ({ label: String(+d.day.slice(8, 10)), v: d.pages, hint: `${human(d.day)}: ${d.pages} стр.` }))} color="var(--books)" unit="стр." every={5} /> : <p className="card-note">Записывай, до какой страницы дочитал, — появится график.</p>}
    </section>
    {o.want.length > 0 && <section className="wc span12"><div className="card-head"><h2>Следующие на очереди</h2></div><div className="bk-row">{o.want.map((b: any) => <Tile key={b.id} b={b} onOpen={onOpen} />)}</div></section>}
    {o.recent.length > 0 && <section className="wc span12"><div className="card-head"><h2>Недавно прочитано</h2></div><div className="bk-row">{o.recent.map((b: any) => <Tile key={b.id} b={b} onOpen={onOpen} />)}</div></section>}
  </div>;
}

function Shelf({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
  const [d, setD] = useState<any>(null), [f, setF] = useState('all'), [sort, setSort] = useState('added');
  useEffect(() => { api<any>('/api/books/shelf').then(setD, () => {}); }, [version]);
  if (!d) return <div className="skel" style={{ height: 300 }} />;
  const bs: any[] = d.books, cnt = (k: string) => k === 'all' ? bs.length : bs.filter(b => k === 'owned' ? b.owned : b.status === k).length;
  const by: Record<string, (a: any, b: any) => number> = { added: (a, b) => String(b.added ?? '').localeCompare(String(a.added ?? '')), title: (a, b) => a.title.localeCompare(b.title, 'ru'), author: (a, b) => String(a.author ?? '').localeCompare(String(b.author ?? ''), 'ru'), rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) };
  const list = bs.filter(b => f === 'all' || (f === 'owned' ? b.owned : b.status === f)).sort(by[sort]);
  const years = f === 'done' && sort === 'added' ? [...new Set(list.map(b => (b.finished ?? '').slice(0, 4) || 'Без даты'))].sort().reverse() : null;
  return <div className="wgrid">
    <div className="kpis span12">
      <div className="kpi"><span>На полке</span><b>{bs.length}</b><small>{cnt('owned')} в моей коллекции</small></div>
      <div className="kpi"><span>Прочитано</span><b>{cnt('done')}</b><small>{fmt(d.pagesRead)} стр. всего</small></div>
      <div className="kpi"><span>Хочу прочитать</span><b>{cnt('want')}</b><small>{cnt('want') ? 'список ждёт' : 'пусто'}</small></div>
      <div className="kpi"><span>Средняя оценка</span><b>{d.avgRating ? <>{fmt1(d.avgRating)}<small>из 5</small></> : '—'}</b></div>
    </div>
    <div className="bk-filters span12"><div className="chips">{[['all', 'Все'], ['reading', 'Читаю'], ['done', 'Прочитано'], ['want', 'Хочу'], ['owned', 'Моя коллекция'], ['drop', 'Брошено']].map(([k, n]) => <button key={k} className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k!)}>{n}<b>{cnt(k!)}</b></button>)}</div>
      <div className="seg-tabs sm">{[['added', 'недавние'], ['title', 'название'], ['author', 'автор'], ['rating', 'оценка']].map(([k, n]) => <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k!)}>{n}</button>)}</div></div>
    <section className="wc span12 bk-shelf">{!list.length ? <p className="card-note">{bs.length ? 'В этом разделе пока пусто.' : 'Полка пустая. Добавь книги, которые читал, читаешь или хочешь прочитать.'}</p>
      : years ? years.map(y => { const xs = list.filter(b => ((b.finished ?? '').slice(0, 4) || 'Без даты') === y); return <div key={y} className="bk-year"><h3>{y}<span>{xs.length} {plural(xs.length, 'книга', 'книги', 'книг')} · {fmt(xs.reduce((a: number, b: any) => a + (b.pages ?? 0), 0))} стр.</span></h3><div className="bk-grid">{xs.map(b => <Tile key={b.id} b={b} onOpen={onOpen} />)}</div></div>; })
      : <div className="bk-grid">{list.map(b => <Tile key={b.id} b={b} onOpen={onOpen} />)}</div>}</section>
  </div>;
}

function Quotes({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api<any>('/api/books/quotes').then(setD, () => {}); }, [version]);
  if (!d) return <div className="skel" style={{ height: 200 }} />;
  if (!d.quotes.length) return <section className="wc"><p className="card-note">Сохраняй фразы, которые зацепили: открой книгу и нажми «Добавить цитату».</p></section>;
  return <div className="bk-quotes">{d.quotes.map((q: any) => <figure key={q.id} className="bk-quote" style={{ ['--bc' as string]: colorOf(q.book.title) }}><blockquote>{q.text}</blockquote>
    <figcaption><button onClick={() => onOpen(q.book.id)}>{q.book.title}</button>{q.book.author ? ` · ${q.book.author}` : ''}{q.page ? ` · стр. ${q.page}` : ''}</figcaption></figure>)}</div>;
}

export function Books({ wide, version: outer, onBack, onChanged, quick }: { wide: boolean; version: number; onBack: () => void; onChanged: () => void; quick?: number }) {
  const toast = useToast(), [tab, setTab] = useState<'now' | 'shelf' | 'quotes'>('now'), [o, setO] = useState<any>(null), [v, setV] = useState(0);
  const [sheet, setSheet] = useState<null | { kind: 'book'; id: string } | { kind: 'form'; b?: any } | { kind: 'goal' }>(null), [goal, setGoal] = useState('');
  const load = useCallback(async () => { try { setO(await api<any>('/api/books/overview')); } catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось загрузить', { err: true }); } }, [toast]);
  useEffect(() => { load(); }, [load, outer, v]);
  useQuick(quick, !!o, () => {
    if (!o?.reading?.length) { setSheet({ kind: 'form' }); return; }
    setTab('now');
    requestAnimationFrame(() => { const i = document.querySelector<HTMLInputElement>('.screen[data-pos="center"] .bk-log-in input'); i?.scrollIntoView({ block: 'center', behavior: 'smooth' }); i?.focus({ preventScroll: true }); });
  });
  const changed = () => { setV(x => x + 1); onChanged(); };
  const head = <header className="dayhead">
    {!wide && <button className="nav" onClick={onBack} aria-label="Назад"><Icon name="chevL" /></button>}
    <div className="daytitle"><span>{o?.total ? `${o.done} из ${o.goal} за ${o.year} год · ${o.total} ${plural(o.total, 'книга', 'книги', 'книг')} на полке` : 'чтение и коллекция'}</span><b>Книги</b></div>
    <button className="nav" data-tour="books-add" onClick={() => setSheet({ kind: 'form' })} aria-label="Добавить книгу" title="Добавить книгу"><Icon name="plus" /></button>
    <HelpButton tour="books" />
  </header>;
  if (!o) return <div className="day books-page">{head}<div className="skel" style={{ height: 300 }} /></div>;
  return <div className="day books-page">
    {head}
    {o.total > 0 && <div className="st-bar"><div className="seg-tabs" role="tablist" data-tour="books-tabs">{([['now', 'Читаю'], ['shelf', 'Полка'], ['quotes', 'Цитаты']] as const).map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); buzz(6); }}>{n}</button>)}</div></div>}
    {!o.total ? <section className="wc solid s-peach" data-tour="books-empty"><div className="card-head"><h2>Твоя книжная полка</h2></div><p className="card-note">Что читаешь, что прочитал и что хочешь прочитать — в одном месте, с обложками.</p>
      <ol className="steps"><li>Найди книгу по названию — обложка, автор и страницы подставятся сами.</li><li>Записывай, до какой страницы дочитал, — появятся темп и серия.</li><li>Сохраняй цитаты и ставь оценки — получится своя библиотека.</li></ol>
      <button className="primary" onClick={() => setSheet({ kind: 'form' })}><Icon name="plus" />Добавить первую книгу</button></section>
      : tab === 'now' ? <Now o={o} onOpen={id => setSheet({ kind: 'book', id })} onAdd={() => setSheet({ kind: 'form' })} onGoal={() => { setGoal(String(o.goal)); setSheet({ kind: 'goal' }); }} onChanged={changed} />
      : tab === 'shelf' ? <Shelf version={v} onOpen={id => setSheet({ kind: 'book', id })} /> : <Quotes version={v} onOpen={id => setSheet({ kind: 'book', id })} />}
    <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.kind === 'form' ? (sheet.b ? 'Изменить книгу' : 'Новая книга') : sheet?.kind === 'goal' ? 'Цель на год' : 'Книга'} tall={sheet?.kind !== 'goal'}>
      {sheet?.kind === 'book' && <BookCard key={sheet.id} id={sheet.id} onChanged={changed} onEdit={b => setSheet({ kind: 'form', b })} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'form' && <BookForm b={sheet.b} onDone={id => { changed(); setSheet({ kind: 'book', id }); }} />}
      {sheet?.kind === 'goal' && <form className="form" onSubmit={async e => { e.preventDefault(); try { await api('/api/books/goal', { method: 'PUT', body: { goal } }); toast('Цель сохранена'); setSheet(null); changed(); } catch (x) { toast(x instanceof ApiError ? x.message : 'Не получилось', { err: true }); } }}>
        <label className="fld"><span>Сколько книг за год</span><input className="in big" inputMode="numeric" value={goal} onChange={e => setGoal(e.target.value)} autoFocus /></label>
        <div className="chips">{[6, 12, 24, 52].map(n => <button type="button" key={n} className={`chip ${goal === String(n) ? 'on' : ''}`} onClick={() => setGoal(String(n))}>{n}</button>)}</div>
        <button className="primary">Сохранить</button></form>}
    </Sheet>
  </div>;
}
