/**
 * «Итог недели» карточкой: оценка, дни недели, серия, цифры по разделам, вывод и фокус на следующую неделю.
 * «Поделиться» рисует ту же карточку в PNG на обычном <canvas> (Playfair Display — заголовки, Rubik — цифры)
 * и отдаёт системному «Поделиться»; где его нет — картинка скачивается.
 */
import { useEffect, useRef, useState } from 'react';
import { addDays, parseDay } from '@bortjournal/core';
import { api } from '../lib/api';
import { MONG, plural } from '../lib/format';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import '../styles/insights.css';
import '../styles/mood.css';

export interface WeekStat { key: string; label: string; value: string; unit: string; note: string; ok: boolean | null }
export interface Week {
  mon: string; sun: string; isThis: boolean; today: string; score: number; prevScore: number | null; scores: Array<number | null>;
  days: number; of: number; perfect: number; streak: number; best: { day: string; score: number; parts: string[] } | null;
  stats: WeekStat[]; verdict: string; focus: string; wins: string[];
  /** настроение недели и дни, которые закрыла заморозка серии */
  mood?: { avg: number; days: number; best: string | null } | null; frozen?: string[];
}
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WDL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const range = (a: string, b: string) => { const x = parseDay(a), y = parseDay(b); return x.getUTCMonth() === y.getUTCMonth() ? `${x.getUTCDate()}–${y.getUTCDate()} ${MONG[y.getUTCMonth()]}` : `${x.getUTCDate()} ${MONG[x.getUTCMonth()]} – ${y.getUTCDate()} ${MONG[y.getUTCMonth()]}`; };
const dayName = (d: string) => { const x = parseDay(d); return `${WDL[x.getUTCDay()]}, ${x.getUTCDate()} ${MONG[x.getUTCMonth()]}`; };

export function WeekRecap({ end }: { end?: string }) {
  const toast = useToast(), [w, setW] = useState<Week | null>(null), [at, setAt] = useState(end), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    setErr('');
    api<Week>(`/api/insights/week${at ? `?end=${at}` : ''}`).then(x => { if (live.current) setW(x); }, e => { if (live.current) setErr(e instanceof Error ? e.message : 'Не получилось загрузить итог'); });
  }, [at]);

  const share = async () => {
    if (!w || busy) return; setBusy(true);
    try {
      const blob = await drawWeek(w), name = `lumi-week-${w.mon}.png`, file = new File([blob], name, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], title: 'Итог недели в Lumi' }); } catch (e) { if ((e as Error).name !== 'AbortError') throw e; }
      } else {
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('Картинка сохранена');
      }
    } catch { toast('Не получилось сделать картинку', { err: true }); } finally { setBusy(false); }
  };

  if (err) return <p className="card-note">{err}</p>;
  if (!w) return <div className="skel" style={{ height: 420 }} />;
  const max = Math.max(1, ...w.scores.map(s => s ?? 0));
  return <div className="wr">
    <div className="wr-nav">
      <button type="button" className="wr-step" onClick={() => setAt(addDays(w.mon, -1))} aria-label="Прошлая неделя"><Icon name="chevL" /></button>
      <span>{w.isThis ? 'эта неделя' : range(w.mon, w.sun)}</span>
      <button type="button" className="wr-step" disabled={w.isThis} onClick={() => setAt(addDays(w.sun, 7))} aria-label="Следующая неделя"><Icon name="chev" /></button>
    </div>
    <article className="wr-card" aria-label={`Итог недели: ${w.score}%`}>
      <header className="wr-head"><small>Итог недели</small><h3>{range(w.mon, w.sun)}</h3></header>
      <div className="wr-score"><b>{w.score}<i>%</i></b><span>{w.prevScore !== null ? `неделей раньше ${w.prevScore}%` : 'оценка недели'}</span></div>
      <div className="wr-bars" role="img" aria-label={w.scores.map((s, k) => `${WD[k]} ${s ?? '—'}${s === null ? '' : '%'}`).join(', ')}>
        {w.scores.map((s, k) => <span key={k} className={`wr-bar ${s === null ? 'future' : ''} ${s !== null && s >= 95 ? 'perfect' : ''}`}><span className="wr-track"><i style={{ height: `${s ? Math.max(6, s / max * 100) : 0}%` }} /></span><em>{WD[k]}</em></span>)}
      </div>
      <div className="wr-chips">
        <span><b>{w.days}<small>/{w.of}</small></b>{plural(w.of, 'день', 'дня', 'дней')} с записями</span>
        <span><b>{w.perfect}</b>{plural(w.perfect, 'идеальный', 'идеальных', 'идеальных')}</span>
        <span><b>{w.streak}</b>серия, {plural(w.streak, 'день', 'дня', 'дней')}</span>
      </div>
      {!!w.frozen?.length && <p className="wr-ice"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /></svg>
        <span>{w.frozen.length === 1 ? 'Заморожен' : 'Заморожены'}: {w.frozen.map(dayName).join('; ')} — серия не прервалась</span></p>}
      {w.stats.length > 0 && <dl className="wr-stats">{w.stats.map(s => <div key={s.key} className={s.ok === true ? 'ok' : s.ok === false ? 'off' : ''}>
        <dt>{s.label}</dt><dd><b>{s.value}</b>{s.unit && <small>{s.unit}</small>}<small className="wr-note">{s.note}</small></dd></div>)}</dl>}
      {w.best && <p className="wr-best"><Icon name="star" /><span>Лучший день — {dayName(w.best.day)}, {w.best.score}%{w.best.parts.length ? ` · ${w.best.parts.join(', ')}` : ''}</span></p>}
      <p className="wr-verdict">{w.verdict}</p>
      <p className="wr-focus"><small>Фокус на следующую неделю</small>{w.focus}</p>
    </article>
    <button type="button" className="primary wr-share" disabled={busy} onClick={share}>{busy ? <span className="spin" /> : <><Icon name="upload" />Поделиться</>}</button>
  </div>;
}

/* ---------- картинка ---------- */
const W = 1080, H = 1350, PAD = 84;
function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lh: number, lines = 3) {
  const words = text.split(' '); let line = '', n = 0;
  for (const word of words) {
    const t = line ? `${line} ${word}` : word;
    if (c.measureText(t).width > width && line) { if (++n >= lines) { c.fillText(`${line}…`, x, y); return y; } c.fillText(line, x, y); y += lh; line = word; } else line = t;
  }
  if (line) c.fillText(line, x, y);
  return y;
}
/** карточка недели в PNG: цвета — из текущей темы, шрифты — после загрузки */
export async function drawWeek(w: Week): Promise<Blob> {
  const css = getComputedStyle(document.documentElement), v = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
  const bg = v('--card', '#FBF4E6'), text = v('--text', '#2B3445'), text2 = v('--text-2', '#665F50'), accent = v('--orange', '#B9501F'), good = v('--good', '#3C5B38'), track = v('--track', '#E6D8C0'), line = v('--line-2', 'rgba(46,58,78,.18)');
  const SERIF = '"Playfair Display", Georgia, serif', NUM = 'Rubik, system-ui, sans-serif';
  try { await Promise.all(['600 64px "Playfair Display"', '500 40px "Playfair Display"', '800 200px Rubik', '700 60px Rubik', '500 30px Rubik'].map(f => document.fonts.load(f))); } catch { /* без шрифтов — запасные */ }
  await document.fonts.ready;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  c.fillStyle = accent; c.fillRect(0, 0, W, 14);
  c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  // шапка
  c.fillStyle = text2; c.font = `500 30px ${NUM}`; c.fillText('ИТОГ НЕДЕЛИ', PAD, 130);
  c.fillStyle = text; c.font = `600 64px ${SERIF}`; c.fillText(range(w.mon, w.sun), PAD, 210);
  // оценка
  c.fillStyle = accent; c.font = `800 210px ${NUM}`; c.fillText(String(w.score), PAD - 8, 440);
  const sw = c.measureText(String(w.score)).width; c.font = `700 90px ${NUM}`; c.fillText('%', PAD + sw, 440);
  c.fillStyle = text2; c.font = `500 32px ${NUM}`; c.fillText(w.prevScore !== null ? `неделей раньше ${w.prevScore}%` : 'оценка недели', PAD, 500);
  // дни недели
  const bx = PAD, by = 560, bh = 170, gap = 18, bw = (W - PAD * 2 - gap * 6) / 7, max = Math.max(1, ...w.scores.map(s => s ?? 0));
  w.scores.forEach((s, k) => {
    const x = bx + k * (bw + gap);
    c.fillStyle = track; roundRect(c, x, by, bw, bh, 14); c.fill();
    if (s) { const h = Math.max(12, s / max * bh); c.fillStyle = s >= 95 ? accent : good; roundRect(c, x, by + bh - h, bw, h, 14); c.fill(); }
    c.fillStyle = text2; c.font = `500 28px ${NUM}`; c.textAlign = 'center'; c.fillText(WD[k]!, x + bw / 2, by + bh + 44); c.textAlign = 'left';
  });
  // три числа
  const chips: Array<[string, string]> = [[`${w.days}/${w.of}`, `${plural(w.of, 'день', 'дня', 'дней')} с записями`], [String(w.perfect), plural(w.perfect, 'идеальный', 'идеальных', 'идеальных')], [String(w.streak), `серия, ${plural(w.streak, 'день', 'дня', 'дней')}`]];
  const cw = (W - PAD * 2) / 3;
  chips.forEach(([n, l], k) => { const x = PAD + k * cw; c.fillStyle = text; c.font = `700 60px ${NUM}`; c.fillText(n, x, 860); c.fillStyle = text2; c.font = `500 26px ${NUM}`; c.fillText(l, x, 900); });
  c.strokeStyle = line; c.lineWidth = 2; c.beginPath(); c.moveTo(PAD, 940); c.lineTo(W - PAD, 940); c.stroke();
  // цифры разделов: до четырёх, по две в ряд
  const st = w.stats.slice(0, 4), colW = (W - PAD * 2) / 2;
  st.forEach((s, k) => {
    const x = PAD + (k % 2) * colW, y = 1000 + Math.floor(k / 2) * 100;
    c.fillStyle = text2; c.font = `500 26px ${NUM}`; c.fillText(s.label, x, y);
    c.fillStyle = text; c.font = `700 44px ${NUM}`; c.fillText(`${s.value}${s.unit ? ` ${s.unit}` : ''}`, x, y + 48);
  });
  // вывод
  const vy = st.length > 2 ? 1215 : st.length ? 1115 : 1010;
  c.fillStyle = text; c.font = `italic 500 40px ${SERIF}`; wrap(c, w.verdict, PAD, vy, W - PAD * 2 - 140, 52, H - vy > 120 ? 2 : 1);
  c.fillStyle = accent; c.font = `600 38px ${SERIF}`; c.textAlign = 'right'; c.fillText('Lumi', W - PAD, H - 56); c.textAlign = 'left';
  return new Promise((ok, fail) => cv.toBlob(b => b ? ok(b) : fail(new Error('canvas')), 'image/png'));
}
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
