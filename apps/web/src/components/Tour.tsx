/**
 * Обучение: затемняет экран, вырезает окошко вокруг нужного места и рядом карточка с подсказкой.
 * Цели — элементы с data-tour="…"; нет такого на экране (раздел выключен, нет данных) — шаг тихо пропускается.
 * На телефоне карточка прижата к низу над панелью разделов, на компьютере — рядом с целью, не вылезая за край.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reduceMotion } from '../lib/motion';
import { useWide } from '../lib/wide';
import '../styles/tour.css';

export type TourStep = { target?: string; tab?: string; title: string; text: string };

/** шаги для гостя демо и для своего журнала; stats — открыта ли статистика */
export function tourSteps({ demo, stats, wide }: { demo: boolean; stats: boolean; wide: boolean }): TourStep[] {
  const s: TourStep[] = [
    { tab: 'today', title: 'Привет! Это Lumi', text: demo ? 'Один дневник на весь день. Здесь 3 месяца жизни гостя — покажу главное за минуту.' : 'Один дневник на весь день. Покажу главное за минуту.' },
    { tab: 'today', target: 'date', title: 'Листай дни', text: wide ? 'Стрелками ‹ › переходи по дням: всё, что было, на месте.' : 'Стрелками или смахиванием переходи по дням: всё, что было, на месте.' },
    { tab: 'today', target: 'stats', title: 'План, вес и серия', text: 'Сколько калорий на сегодня, последний вес и сколько дней подряд ты ведёшь дневник.' },
    { tab: 'today', target: 'timeline', title: 'Лента дня', text: 'Еда, вода, учёба, зал и задачи по времени. Нажми на пустое место — запишешь на это время.' },
    { tab: 'today', target: 'photo', title: 'Еда по фото', text: 'Сфотографируй тарелку — Lumi сам посчитает калории.' },
    { tab: 'today', target: 'water', title: 'Вода в одно касание', text: '+250 или +500 мл — и стакан уже в ленте.' },
    { tab: 'today', target: 'habits', title: 'Привычки', text: 'Заведи свои привычки и отмечай каждый день — серия растёт сама.' },
    { tab: 'today', target: 'tip', title: 'Совет на вечер', text: 'Вечером Lumi смотрит на твой день и подсказывает, что ещё успеть.' },
  ];
  if (stats) s.push({ tab: 'stats', target: 'calendar', title: 'Календарь оценок', text: 'Нажми на любой день — увидишь, из чего сложилась оценка.' });
  if (demo) s.push({ target: 'demo-save', title: 'Понравилось?', text: 'Сохрани как аккаунт — все записи останутся, а Pro будет бесплатно 7 дней.' });
  return s;
}

type Box = { x: number; y: number; w: number; h: number; r: number };
type Pos = { top: number; left: number; dock: boolean };
const EMPTY: Box = { x: 0, y: 0, w: 0, h: 0, r: 0 };
const find = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)]
  .find(el => !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0) ?? null;
const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) < .5 && Math.abs(a.w - b.w) < .5 && Math.abs(a.h - b.h) < .5 && a.r === b.r;
// низ, занятый панелью разделов на компьютере (плавающая панель), и место под карточку на телефоне
const DOCK_WIDE = 100, GAP = 14;

export function Tour({ steps, tab, onTab, onClose }: { steps: TourStep[]; tab: string; onTab: (tab: string) => boolean; onClose: () => void }) {
  const wide = useWide();
  // шаги, чьих целей нет на «Сегодня», убираем сразу — чтобы счёт «3 из 7» не прыгал
  const [list, setList] = useState(() => steps.filter(s => !s.target || (s.tab && s.tab !== 'today') || !!find(s.target)));
  const [i, setI] = useState(0), [hole, setHole] = useState<Box>(EMPTY), [pos, setPos] = useState<Pos | null>(null), [out, setOut] = useState(false);
  const card = useRef<HTMLDivElement>(null), el = useRef<HTMLElement | null>(null), dir = useRef(1), tabRef = useRef(tab), ret = useRef<Element | null>(null);
  tabRef.current = tab;
  const step = list[Math.min(i, list.length - 1)];
  const last = i >= list.length - 1;

  const finish = useCallback(() => {
    if (out) return;
    setOut(true);
    if (tabRef.current !== 'today') onTab('today');
    setTimeout(onClose, reduceMotion() ? 0 : 220);
  }, [out, onTab, onClose]);
  const next = useCallback(() => { if (last) { finish(); return; } dir.current = 1; setI(x => x + 1); }, [last, finish]);
  const back = useCallback(() => { if (i === 0) return; dir.current = -1; setI(x => x - 1); }, [i]);

  // откуда пришли — туда и вернуть фокус
  useEffect(() => {
    ret.current = document.activeElement;
    return () => { const r = ret.current as HTMLElement | null; if (r?.isConnected && !r.closest('[aria-hidden="true"]')) r.focus?.({ preventScroll: true }); };
  }, []);

  // новый шаг: переключить раздел, дождаться цели, прокрутить к ней; не нашлась — пропустить
  useEffect(() => {
    if (!step) { finish(); return; }
    el.current = null;
    if (step.tab && step.tab !== tabRef.current && !onTab(step.tab)) { drop(); return; }
    if (!step.target) { card.current?.focus({ preventScroll: true }); return; }
    let alive = true, tries = 0;
    const look = () => {
      if (!alive) return;
      const t = find(step.target!);
      if (!t) { if (++tries > 30) drop(); else setTimeout(look, 100); return; }
      el.current = t; scrollTo(t);
      card.current?.focus({ preventScroll: true });
    };
    look();
    return () => { alive = false; };
    function drop() {
      // вперёд — индекс тот же, на нём уже следующий шаг; назад — на шаг раньше; убрали последний — конец
      const at = list.indexOf(step!), rest = list.filter(x => x !== step);
      if (!rest.length || (dir.current > 0 && at >= rest.length)) { finish(); return; }
      setList(rest);
      if (dir.current < 0) setI(Math.max(0, at - 1));
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollTo = (t: HTMLElement) => {
    const sc = t.closest<HTMLElement>('.screen'); if (!sc) return;
    const r = t.getBoundingClientRect(), s = sc.getBoundingClientRect(), ch = card.current?.offsetHeight ?? 180;
    const top = s.top + 12, bottom = wide ? innerHeight - DOCK_WIDE : innerHeight - ch - 96;
    const room = bottom - top;
    // компьютер: цель вместе с карточкой под ней — посередине; телефон: цель посередине над карточкой
    const need = wide ? r.height + GAP + ch : r.height;
    const want = need <= room ? top + (room - need) / 2 : top;
    const dy = r.top - want;
    if (Math.abs(dy) < 4) return;
    sc.scrollTo({ top: sc.scrollTop + dy, behavior: reduceMotion() ? 'auto' : 'smooth' });
  };

  // каждый кадр сверяем положение цели: прокрутка, смена размера, переезд экрана — окошко и карточка едут следом
  useLayoutEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = card.current; if (!c) return;
      const vw = innerWidth, vh = innerHeight, cw = c.offsetWidth, ch = c.offsetHeight, t = el.current;
      const dock = !wide;
      const cardTop = dock ? (c.getBoundingClientRect().top || vh - ch - 80) : vh;
      let b: Box;
      if (!t || !t.isConnected) b = { x: vw / 2, y: vh / 2, w: 0, h: 0, r: 0 };
      else {
        const r = t.getBoundingClientRect(), pad = wide ? 8 : 6;
        const rad = Math.min(28, (parseFloat(getComputedStyle(t).borderTopLeftRadius) || 10) + pad);
        const x0 = Math.max(4, r.left - pad), x1 = Math.min(vw - 4, r.right + pad);
        const y0 = Math.max(4, r.top - pad), y1 = Math.min(dock ? cardTop - 10 : vh - 4, r.bottom + pad);
        b = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), r: rad };
      }
      setHole(h => same(h, b) ? h : b);
      let p: Pos;
      // телефон: над панелью разделов; уехала вниз при прокрутке — к самому низу (top тут — отступ снизу, -1 — панели нет)
      if (dock) { const tb = document.querySelector('.app > .tabs')?.getBoundingClientRect(); p = { top: tb && tb.top < vh - 2 ? Math.round(vh - tb.top + 10) : -1, left: 0, dock: true }; }
      else if (!t || b.w === 0) p = { top: Math.round((vh - ch) / 2), left: Math.round((vw - cw) / 2), dock: false };
      else {
        const m = 16, clampX = (x: number) => Math.max(m, Math.min(vw - cw - m, x)), clampY = (y: number) => Math.max(m, Math.min(vh - DOCK_WIDE + 10 - ch, y));
        const cx = clampX(b.x + b.w / 2 - cw / 2), cy = clampY(b.y + b.h / 2 - ch / 2);
        if (b.y + b.h + GAP + ch <= vh - DOCK_WIDE + 10) p = { top: b.y + b.h + GAP, left: cx, dock: false };
        else if (b.y - GAP - ch >= m) p = { top: b.y - GAP - ch, left: cx, dock: false };
        else if (b.x + b.w + GAP + cw <= vw - m) p = { top: cy, left: b.x + b.w + GAP, dock: false };
        else if (b.x - GAP - cw >= m) p = { top: cy, left: b.x - GAP - cw, dock: false };
        else p = { top: vh - DOCK_WIDE + 10 - ch, left: cx, dock: false };
        p.top = Math.round(p.top); p.left = Math.round(p.left);
      }
      setPos(o => o && o.top === p.top && o.left === p.left && o.dock === p.dock ? o : p);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [wide]);

  // клавиши: ←/→ и Enter листают, Esc — пропустить; Tab ходит только внутри карточки; горячие клавиши экрана не срабатывают
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      e.stopPropagation();
      const c = card.current; if (!c) return;
      if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); back(); return; }
      if (e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('button')) { e.preventDefault(); next(); return; }
      if (e.key === 'Tab') {
        const f = [...c.querySelectorAll<HTMLElement>('button:not([disabled])')]; if (!f.length) return;
        const a = document.activeElement, k = f.indexOf(a as HTMLElement);
        e.preventDefault();
        f[e.shiftKey ? (k <= 0 ? f.length - 1 : k - 1) : (k < 0 || k === f.length - 1 ? 0 : k + 1)]!.focus();
      }
    };
    addEventListener('keydown', on, true);
    return () => removeEventListener('keydown', on, true);
  }, [next, back, finish]);

  if (!step) return null;
  const n = list.length, k = Math.min(i, n - 1);
  return <div className={`tour ${out ? 'out' : ''} ${wide ? '' : 'phone'}`}>
    <div className="tour-hole" aria-hidden="true" style={{ transform: `translate(${hole.x}px,${hole.y}px)`, width: hole.w, height: hole.h, borderRadius: hole.r }} />
    <div ref={card} className={`tour-card ${pos?.dock ? 'dock' : ''} ${step.target ? '' : 'center'}`} role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-d" tabIndex={-1}
      style={!pos ? { opacity: 0 } : !pos.dock ? { top: pos.top, left: pos.left } : pos.top >= 0 ? { bottom: pos.top } : undefined}>
      <div className="tour-top">
        <span className="tour-dots" aria-hidden="true">{list.map((_, j) => <i key={j} className={j === k ? 'on' : j < k ? 'past' : ''} />)}</span>
        <span className="tour-n">{k + 1} из {n}</span>
        <button type="button" className="tour-skip" onClick={finish}>Пропустить</button>
      </div>
      <div className="tour-body" key={k}>
        <h2 id="tour-t">{step.title}</h2>
        <p id="tour-d">{step.text}</p>
      </div>
      <div className="tour-act">
        {k > 0 && <button type="button" className="tour-back" onClick={back}>Назад</button>}
        <button type="button" className="tour-next" onClick={next}>{last ? 'Готово' : 'Дальше'}</button>
      </div>
    </div>
  </div>;
}
