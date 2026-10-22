/**
 * Еда Pro: поиск по справочнику и своим блюдам; распознавание по фото или описанию (ИИ).
 * Результат ИИ — черновик: веса правятся, калории и БЖУ пересчитываются пропорционально, на уточнения можно ответить.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, draftPending, type FoodDraft } from '../lib/api';
import { fmt, fmt1 } from '../lib/format';
import { buzz } from '../lib/motion';
import { Icon } from './Icon';
import { useToast } from './Toasts';

const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const num = (s: string) => Number(String(s).replace(',', '.')) || 0;
const r1 = (n: number) => Math.round(n * 10) / 10;

/* ---------------- поиск ---------------- */
interface CatalogFood { id: string; name: string; kcal: number; protein: number; fat: number; carbs: number; grams: number; unit: string }
interface MineFood { name: string; kcal: number; protein: number; fat: number; carbs: number; uses: number }
type Pick = { kind: 'db'; f: CatalogFood } | { kind: 'mine'; f: MineFood };

export function FoodSearch({ day, time, onDone }: { day: string; time?: string; onDone: () => void }) {
  const toast = useToast(), [q, setQ] = useState(''), [res, setRes] = useState<{ mine: MineFood[]; catalog: CatalogFood[] } | null>(null);
  const [pick, setPick] = useState<Pick | null>(null), [g, setG] = useState(''), [x, setX] = useState(1), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const id = setTimeout(() => api<{ mine: MineFood[]; catalog: CatalogFood[] }>(`/api/food/search?q=${encodeURIComponent(q.trim())}`).then(setRes, e => toast(e instanceof ApiError ? e.message : 'Поиск не удался', { err: true })), 180);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (p: Pick) => { setPick(p); buzz(6); if (p.kind === 'db') setG(String(p.f.grams)); else setX(1); };
  // итог выбранного: справочник — на 100 г × граммы; своё блюдо — порция × множитель
  const k = pick ? (pick.kind === 'db' ? num(g) / 100 : x) : 0;
  const tot = pick ? { kcal: Math.round(pick.f.kcal * k), protein: r1(pick.f.protein * k), fat: r1(pick.f.fat * k), carbs: r1(pick.f.carbs * k) } : null;
  const save = async () => {
    if (!pick || !tot || !tot.kcal && !num(g)) return;
    const name = pick.kind === 'db' ? `${pick.f.name}, ${fmt(num(g))} г` : x === 1 ? pick.f.name : `${pick.f.name} ×${fmt1(x)}`;
    setBusy(true);
    try { await api('/api/food/meals', { method: 'POST', body: { day, time: time ?? nowHm(), name, ...tot, source: 'db' } }); buzz([8, 30, 8]); toast(`${name} — ${fmt(tot.kcal)} ккал`); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось записать', { err: true }); } finally { setBusy(false); }
  };

  if (pick && tot) return <div className="form">
    <button type="button" className="fp-back" onClick={() => setPick(null)}><Icon name="chevL" />к поиску</button>
    <div className="fp-head"><b>{pick.f.name}</b><small>{pick.kind === 'db' ? `${fmt(pick.f.kcal)} ккал на 100 г · Б ${fmt1(pick.f.protein)} · Ж ${fmt1(pick.f.fat)} · У ${fmt1(pick.f.carbs)}` : 'твоё блюдо — как ел в прошлый раз'}</small></div>
    {pick.kind === 'db' ? <>
      <label className="fld"><span>Сколько, г</span><input className="in big" inputMode="decimal" value={g} onChange={e => setG(e.target.value)} autoFocus /></label>
      <div className="chips">{[...new Set([pick.f.grams, 100, 150, 200, 300])].map(v => <button type="button" key={v} className={`chip ${num(g) === v ? 'on' : ''}`} onClick={() => setG(String(v))}>{v === pick.f.grams && pick.f.unit ? `${pick.f.unit} · ${v} г` : `${v} г`}</button>)}</div>
    </> : <div className="chips">{[0.5, 1, 1.5, 2].map(v => <button type="button" key={v} className={`chip ${x === v ? 'on' : ''}`} onClick={() => setX(v)}>{v === 1 ? 'порция' : `×${fmt1(v)}`}</button>)}</div>}
    <div className="fp-total"><b>{fmt(tot.kcal)} ккал</b><span>Б {fmt1(tot.protein)} · Ж {fmt1(tot.fat)} · У {fmt1(tot.carbs)}</span></div>
    <button className="primary" disabled={busy || !tot.kcal} onClick={save}>Записать</button>
  </div>;

  return <div className="form">
    <div className="fp-search"><Icon name="search" /><input className="in" value={q} onChange={e => setQ(e.target.value)} placeholder="Гречка, курица, творог, плов…" autoFocus aria-label="Что ищем" /></div>
    {!res ? <p className="hint" style={{ textAlign: 'left' }}>Ищет в справочнике — около двухсот продуктов и блюд с КБЖУ на 100 г — и среди того, что ты уже записывал.</p> : <>
      {res.mine.length > 0 && <div className="fp-group"><h3>Моё</h3>{res.mine.map(f => <button key={f.name} className="meal" onClick={() => choose({ kind: 'mine', f })}>
        <span className="chip-ic" style={{ ['--c' as string]: 'var(--orange)' }}><Icon name="food" /></span><span className="mid"><b>{f.name}</b><small>Б {fmt1(f.protein)} · Ж {fmt1(f.fat)} · У {fmt1(f.carbs)} · ел {f.uses} раз</small></span><span className="v">{fmt(f.kcal)}</span></button>)}</div>}
      {res.catalog.length > 0 && <div className="fp-group"><h3>Справочник <small>ккал на 100 г</small></h3>{res.catalog.map(f => <button key={f.id} className="meal" onClick={() => choose({ kind: 'db', f })}>
        <span className="chip-ic" style={{ ['--c' as string]: 'var(--food)' }}><Icon name="search" /></span><span className="mid"><b>{f.name}</b><small>обычно {f.unit ? `${f.unit}, ` : ''}{fmt(f.grams)} г · Б {fmt1(f.protein)} · Ж {fmt1(f.fat)} · У {fmt1(f.carbs)}</small></span><span className="v">{fmt(f.kcal)}</span></button>)}</div>}
      {!res.mine.length && !res.catalog.length && <p className="hint" style={{ textAlign: 'left' }}>Ничего не нашлось. Попробуй короче — «курица», «рис» — или опиши блюдо ИИ.</p>}
    </>}
  </div>;
}

/* ---------------- фото и описание ---------------- */
interface AiItem { name: string; grams: number; kcal: number; protein: number; fat: number; carbs: number; fiber: number; sugar: number; salt: number; confidence: string; source: string }
interface Row { name: string; grams: string; base: AiItem }
const SCALES: Array<[string, string]> = [['', 'Ничего'], ['card', 'Карта'], ['fork', 'Вилка'], ['spoon', 'Ложка'], ['phone', 'Телефон'], ['hand', 'Ладонь']];
const CONF: Record<string, string> = { high: 'точно', medium: 'примерно', low: 'догадка' };

/** фото уменьшаем на телефоне: до 1280 px по длинной стороне, JPEG — быстрее и дешевле */
async function shrink(file: File): Promise<{ b64: string; mime: string; url: string }> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  const s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', 0.82);
  return { b64: data.slice(data.indexOf(',') + 1), mime: 'image/jpeg', url };
}

/** фото уходит в фон: черновик приёма разбирает сервер, а мы сообщим, когда готово. draftId — открыть черновик на проверку */
export function FoodAi({ day, time, mode: start, draftId, onDone }: { day: string; time?: string; mode: 'photo' | 'text'; draftId?: string; onDone: () => void }) {
  const toast = useToast(), file = useRef<HTMLInputElement>(null), cam = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState(start), [photo, setPhoto] = useState<{ b64: string; mime: string; url: string } | null>(null);
  const [note, setNote] = useState(''), [scale, setScale] = useState(''), [t, setT] = useState(time ?? nowHm());
  const [stage, setStage] = useState<'setup' | 'loading' | 'review'>('setup'), [err, setErr] = useState('');
  const [rows, setRows] = useState<Row[]>([]), [qs, setQs] = useState<Array<{ text: string; options: string[] }>>([]), [ans, setAns] = useState<Record<number, string>>({});
  const [comment, setComment] = useState(''), [busy, setBusy] = useState(false), [draft, setDraft] = useState<FoodDraft | null>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  // открыли черновик (из полосы сверху или из уведомления): готовый — сразу на проверку
  useEffect(() => {
    if (!draftId) return;
    setStage('loading');
    api<FoodDraft>(`/api/food/drafts/${draftId}`).then(d => {
      setDraft(d); setMode('photo'); setT(d.time ?? nowHm());
      if (d.state === 'ready') { setRows(d.items.map(it => ({ name: it.name, grams: String(it.grams), base: it }))); setQs(d.questions); setAns({}); setComment(d.comment); setStage('review'); }
      else setStage('setup');
    }, e => { setStage('setup'); setErr(e instanceof ApiError && e.status === 404 ? 'Этого фото уже нет: его подтвердили или удалили.' : 'Не получилось открыть фото.'); });
  }, [draftId]);

  const pickFile = async (f: File | undefined) => { if (!f) return; try { setPhoto(await shrink(f)); setErr(''); } catch { setErr('Не получилось открыть фото. Попробуй JPEG или PNG.'); } };
  // строка пересчитывается от исходной оценки ИИ пропорционально весу
  const calc = (r: Row) => { const k = r.base.grams ? num(r.grams) / r.base.grams : 1; return { kcal: Math.round(r.base.kcal * k), protein: r1(r.base.protein * k), fat: r1(r.base.fat * k), carbs: r1(r.base.carbs * k), fiber: r1(r.base.fiber * k), sugar: r1(r.base.sugar * k), salt: r1(r.base.salt * k) }; };
  const tot = rows.reduce((a, r) => { const c = calc(r); return { kcal: a.kcal + c.kcal, protein: a.protein + c.protein, fat: a.fat + c.fat, carbs: a.carbs + c.carbs, g: a.g + num(r.grams) }; }, { kcal: 0, protein: 0, fat: 0, carbs: 0, g: 0 });

  const go = async () => {
    // у черновика фото уже на сервере — проверять нечего
    if (!draft && mode === 'photo' && !photo) { setErr('Добавь фото.'); return; }
    if (!draft && mode === 'text' && note.trim().length < 2) { setErr('Напиши, что съел.'); return; }
    const answers = qs.map((q, i) => ans[i] ? `${q.text} — ${ans[i]}` : '').filter(Boolean);
    // ручные правки весов при пересчёте отдаём модели как факт
    if (stage === 'review') for (const r of rows) if (num(r.grams) !== r.base.grams) answers.push(`Вес исправлен: ${r.name} — ${fmt(num(r.grams))} г`);
    const prev = stage; setStage('loading'); setErr('');
    // черновик: ответы уходят в фон, сервер пересчитает и пришлёт уведомление
    if (draft) {
      try { await api(`/api/food/drafts/${draft.id}/answers`, { method: 'POST', body: { answers } }); toast('Пересчитываю с ответами — сообщу, когда будет готово'); dispatchEvent(new Event('bj-drafts')); onDone(); }
      catch (e) { setStage(prev); setErr(e instanceof ApiError ? e.message : 'Сервер недоступен.'); }
      return;
    }
    // фото: в фон — черновик приёма, можно сразу заниматься своими делами
    if (mode === 'photo') {
      try { await api('/api/food/drafts', { method: 'POST', body: { image: photo?.b64, mime: photo?.mime, note, scale, day, time: t } }); buzz([8, 30, 8]); toast('Фото разбирается — сообщу, когда будет готово'); dispatchEvent(new Event('bj-drafts')); onDone(); }
      catch (e) { setStage('setup'); setErr(e instanceof ApiError ? e.message : 'Сервер недоступен.'); }
      return;
    }
    try {
      const out = await api<{ isFood: boolean; items: AiItem[]; questions: typeof qs; comment: string }>('/api/food/recognize', { method: 'POST', body: { image: null, note, scale, answers } }); // фото ушло в фон выше — сюда доходит только описание текстом
      if (!out.isFood) { setStage('setup'); setErr(out.comment || (mode === 'text' ? 'Не понял, что за еда. Опиши подробнее.' : 'На фото не видно еды.')); return; }
      setRows(out.items.map(it => ({ name: it.name, grams: String(it.grams), base: it }))); setQs(answers.length ? [] : out.questions); setAns({}); setComment(out.comment); setStage('review'); buzz([8, 30, 8]);
    } catch (e) { setStage(prev === 'review' ? 'review' : 'setup'); setErr(e instanceof ApiError ? e.message : 'Сервер недоступен.'); }
  };
  const save = async () => {
    const items = rows.filter(r => r.name.trim()).map(r => ({ name: `${r.name.trim()}${num(r.grams) ? `, ${fmt(num(r.grams))} г` : ''}`, ...calc(r) }));
    if (!items.length) { setErr('Нечего записывать.'); return; }
    setBusy(true);
    try { await api('/api/food/meals/batch', { method: 'POST', body: { day, time: t, source: mode === 'photo' ? 'photo' : 'text', items, ...(draft ? { draftId: draft.id } : {}) } }); if (draft) dispatchEvent(new Event('bj-drafts')); buzz([8, 30, 8]); toast(`Записано: ${items.length} ${items.length === 1 ? 'позиция' : items.length < 5 ? 'позиции' : 'позиций'}, ${fmt(tot.kcal)} ккал`); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Не получилось записать', { err: true }); } finally { setBusy(false); }
  };
  const loading = stage === 'loading';
  const dropDraft = async () => { if (!draft) return; setBusy(true); try { await api(`/api/food/drafts/${draft.id}`, { method: 'DELETE' }); toast('Фото удалено'); dispatchEvent(new Event('bj-drafts')); onDone(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Не получилось удалить'); } finally { setBusy(false); } };
  const retryDraft = async () => { if (!draft) return; setBusy(true); try { await api(`/api/food/drafts/${draft.id}/retry`, { method: 'POST' }); toast('Пробую ещё раз — сообщу, когда будет готово'); dispatchEvent(new Event('bj-drafts')); onDone(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Не получилось'); } finally { setBusy(false); } };

  // черновик не готов: ещё разбирается или не удался
  if (draft && draft.state !== 'ready' && stage !== 'loading') return <div className="form">
    {draftPending(draft) ? <p className="ai-comment">Фото ещё разбирается. Можно закрыть — сообщу, когда будет готово.</p>
      : <p className="form-err">{draft.error || 'Разобрать фото не получилось.'}</p>}
    {err && <p className="form-err">{err}</p>}
    <div className="ob-nav"><button type="button" className="ghost" disabled={busy} onClick={dropDraft}>Удалить</button>
      {draft.state === 'failed' ? <button className="primary" disabled={busy} onClick={retryDraft}>Повторить</button> : <button className="primary" onClick={onDone}>Закрыть</button>}</div>
  </div>;

  if (stage === 'review') return <div className="form">
    <div className="ai-top">{photo && mode === 'photo' && <img className="ai-img sm" src={photo.url} alt="Фото еды" />}
      <div className="mid">{comment && <p className="ai-comment">{comment}</p>}<div className="fp-total"><b>{fmt(tot.kcal)} ккал</b><span>Б {fmt1(tot.protein)} · Ж {fmt1(tot.fat)} · У {fmt1(tot.carbs)} · {fmt(tot.g)} г</span></div></div></div>
    {qs.length > 0 && <div className="ai-qs">{qs.map((q, i) => <div key={i} className="ai-q"><b>{q.text}</b><div className="chips">{q.options.map(o => <button type="button" key={o} className={`chip ${ans[i] === o ? 'on' : ''}`} onClick={() => setAns(a => ({ ...a, [i]: o }))}>{o}</button>)}</div></div>)}
      <button type="button" className="ghost" disabled={!Object.keys(ans).length || loading} onClick={go}>Пересчитать с ответами</button></div>}
    <div className="ai-rows">{rows.map((r, i) => { const c = calc(r); return <div key={i} className="ai-row">
      <span className="mid"><input className="in" value={r.name} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="Название" />
        <small><em className={`conf ${r.base.source === 'estimate' ? r.base.confidence : 'high'}`}>{r.base.source === 'label' ? 'с этикетки' : r.base.source === 'user' ? 'с подписи' : CONF[r.base.confidence]}</em>Б {fmt1(c.protein)} · Ж {fmt1(c.fat)} · У {fmt1(c.carbs)}</small></span>
      <label className="ai-g"><input className="in" inputMode="decimal" value={r.grams} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, grams: e.target.value } : x))} aria-label="Граммы" /><span>г</span></label>
      <b className="ai-k">{fmt(c.kcal)}</b>
      <button type="button" className="ai-x" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label="Убрать">×</button>
    </div>; })}</div>
    <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Проверь вес порций: поменяешь граммы — калории и БЖУ пересчитаются.</p>
    {draft ? <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Время приёма — когда сделано фото: {draft.time ?? 'без времени'}.</p>
      : <label className="fld"><span>Время</span><input className="in" type="time" value={t} onChange={e => setT(e.target.value)} style={{ width: 'auto' }} /></label>}
    {err && <p className="form-err">{err}</p>}
    <div className="ob-nav">{draft ? <button type="button" className="ghost" disabled={busy} onClick={dropDraft}>Удалить</button> : <button type="button" className="ghost" onClick={() => setStage('setup')}>{mode === 'photo' ? 'Другое фото' : 'Изменить'}</button>}<button className="primary" disabled={busy || !rows.length} onClick={save}>Согласен, записать</button></div>
  </div>;

  return <div className="form">
    <div className="seg2 ai-mode" role="tablist"><button role="tab" aria-selected={mode === 'photo'} className={mode === 'photo' ? 'on' : ''} onClick={() => { setMode('photo'); setErr(''); }}>По фото</button><button role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'on' : ''} onClick={() => { setMode('text'); setErr(''); }}>По описанию</button></div>
    {mode === 'photo' ? <>
      {/* capture открывает сразу камеру и прячет галерею, поэтому два поля: камера и галерея */}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={file} type="file" accept="image/*" hidden onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
      {photo ? <div className="ai-pick has"><img className="ai-img" src={photo.url} alt="Фото еды" /></div>
        : <div className="ai-pick"><Icon name="camera" /><b>Фото тарелки</b><small>целиком, сверху или под углом</small></div>}
      <div className="ai-src"><button type="button" className="ghost" onClick={() => cam.current?.click()} disabled={loading}><Icon name="camera" />{photo ? 'Переснять' : 'Камера'}</button>
        <button type="button" className="ghost" onClick={() => file.current?.click()} disabled={loading}><Icon name="image" />{photo ? 'Другое из галереи' : 'Из галереи'}</button></div>
      <label className="fld"><span>Подпись (по желанию)</span><textarea className="in" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Например: гречка 200 г, куриная грудка, соус сметанный" disabled={loading} /></label>
      <div className="fld"><span>Что лежит рядом для масштаба</span><div className="chips">{SCALES.map(([k, n]) => <button type="button" key={k} className={`chip ${scale === k ? 'on' : ''}`} onClick={() => setScale(k)} disabled={loading}>{n}</button>)}</div></div>
    </> : <>
      <label className="fld"><span>Что съел</span><textarea className="in" rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="Например: гречка 200 г, куриная грудка 150 г, огурец, чай с сахаром" autoFocus disabled={loading} /></label>
      <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Пиши как удобно, через запятую. Укажешь граммы — посчитает точнее, не укажешь — возьмёт обычную порцию.</p>
    </>}
    {err && <p className="form-err">{err}</p>}
    <button className="primary" disabled={loading} onClick={go}>{loading ? <span className="spin" aria-label="Считаю" /> : mode === 'photo' ? 'Отправить на разбор' : 'Посчитать'}</button>
    {mode === 'photo' && <p className="hint" style={{ margin: 0 }}>Фото разберётся в фоне: можно сразу записывать воду или закрыть журнал. Пришлю уведомление.</p>}
  </div>;
}
