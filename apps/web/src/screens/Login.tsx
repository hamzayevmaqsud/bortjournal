/**
 * Вход и регистрация Lumi. Слева (на телефоне — сверху) стена постеров, справа карточка формы с маяком.
 * Новичок попадает сразу на «Создать аккаунт» (кто уже входил с этого устройства — на «Войти»).
 * После регистрации — анкета; 7 дней Pro начинаются сразу.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppleMark, GoogleMark, startUrl, takeAuthResult, useProviders } from '../lib/oauth';
import { TRIAL_DAYS } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';

// 23 постера по кругу оттенков (собираются из Documents/Lumi/login page): 240 и 400 px — показываем не крупнее
const N = 23;
const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 899px)').matches;
const PER = 11;                         // секунд на постер при обычной скорости — у всех лент одна скорость
const LETTERS = 4;                      // L, U, M, I — карточки логотипа (public/lumi/logo)
const posterSet = (k: number) => `/lumi/posters/${k}-240.webp 240w, /lumi/posters/${k}-400.webp 400w, /lumi/posters/${k}-560.webp 560w`;
const letterSet = (k: number) => `/lumi/logo/${k}-240.webp 240w, /lumi/logo/${k}.webp 306w`;
const SIZES = '(min-width: 900px) clamp(170px, 15vw, 280px), 88px';
/** ширина ленты (CSS px) — как в стилях .lw-track img */
const laneW = () => Math.min(280, Math.max(170, innerWidth * 0.15)) + 16;
/** лент столько, чтобы наклонная стена закрыла весь экран (на телефоне — одна лента) */
const laneCount = () => PHONE ? 1 : Math.max(6, Math.min(14, Math.ceil(innerWidth * 1.35 / laneW()) + 1));

type Item = { letter: number } | { poster: number };
/** постеры по лентам: соседние по цвету — в разных лентах; короткая лента повторяется, чтобы быть длиннее экрана */
const lanesOf = (n: number): Item[][] => Array.from({ length: n }, (_, c) => {
  const own: Item[] = Array.from({ length: N }, (_, k) => k + 1).filter(k => (k - 1) % n === c).map(poster => ({ poster }));
  let lane = own.length ? own : [{ poster: (c % N) + 1 }];
  while (lane.length < (PHONE ? 10 : 6)) lane = [...lane, ...own];
  return lane;
});

/**
 * Стена: наклонные ленты постеров на весь экран, и в ней с первого кадра стоит слово LUMI — четыре карточки логотипа
 * в одном ряду, левее формы. Потом ленты едут (соседние — навстречу), буквы расходятся и проезжают по кругу.
 * Движение — своим циклом (requestAnimationFrame): колёсико мыши разгоняет ленту (вниз — вперёд, вверх — назад),
 * разгон гаснет. Анимация не останавливается.
 */
function PosterWall() {
  const box = useRef<HTMLDivElement>(null), [n, setN] = useState(laneCount);
  // в каких лентах буквы: четыре соседние ленты, центр ряда — посередине свободного места слева от формы
  const [letterAt, setLetterAt] = useState<number[] | null>(PHONE ? [0] : null);
  useEffect(() => { const f = () => { setN(laneCount()); if (!PHONE) setLetterAt(null); }; addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);
  const lanes = lanesOf(n).map((lane, c): Item[] => {
    if (PHONE) return [...Array.from({ length: LETTERS }, (_, k) => ({ letter: k + 1 })), ...lane];
    const at = letterAt?.indexOf(c) ?? -1;
    return at >= 0 ? [{ letter: at + 1 }, ...lane] : lane;
  });
  useLayoutEffect(() => {
    if (PHONE || letterAt) return;
    const root = box.current; if (!root) return;
    const card = document.querySelector('.lw-scene .login')?.getBoundingClientRect();
    const free = card ? card.left : innerWidth * 0.62, target = free / 2, y = innerHeight / 2;
    // центр каждой ленты на высоте середины экрана (стена наклонена — берём точку ленты на этой высоте)
    const xs = [...root.querySelectorAll<HTMLElement>('.lw-col')].map(col => { const r = col.getBoundingClientRect(); return r.left + r.width / 2 + Math.tan(6 * Math.PI / 180) * (y - (r.top + r.height / 2)); });
    let best = 0, bestD = Infinity;
    for (let c = 0; c + LETTERS <= xs.length; c++) { const mid = (xs[c]! + xs[c + LETTERS - 1]!) / 2, d = Math.abs(mid - target); if (d < bestD) { bestD = d; best = c; } }
    setLetterAt(Array.from({ length: LETTERS }, (_, k) => best + k));
  }, [n, letterAt]);
  useEffect(() => {
    const root = box.current; if (!root || !letterAt) return;
    const tracks = [...root.querySelectorAll<HTMLElement>('.lw-track')].map((el, c) => ({ el, n: lanes[c]!.length, len: 0, pos: 0, dir: c % 2 ? -1 : 1 }));
    const view = PHONE ? root.clientWidth : root.clientHeight;
    tracks.forEach((t, c) => {
      t.len = (PHONE ? t.el.scrollWidth : t.el.scrollHeight) / 2;
      const letter = t.el.querySelector<HTMLElement>('.letter');
      if (PHONE && letter) {        // телефон: L U M I по центру ленты
        const ls = t.el.querySelectorAll<HTMLElement>('.letter'), lastL = ls[LETTERS - 1]!;
        t.pos = letter.offsetLeft - (view - (lastL.offsetLeft + lastL.offsetWidth - letter.offsetLeft)) / 2;
      } else if (letter) t.pos = letter.offsetTop - (view - letter.offsetHeight) / 2;   // буквы — в одном ряду посередине
      else t.pos = t.len * ((c * 0.37) % 1);                                              // остальные ленты — вразнобой
      t.pos = ((t.pos % t.len) + t.len) % t.len;
      t.el.style.transform = PHONE ? `translate3d(${-t.pos}px,0,0)` : `translate3d(0,${-t.pos}px,0)`;
    });
    let boost = 0, last = performance.now(), raf = 0;
    const born = performance.now() + 900;   // первые мгновения LUMI читается целиком, потом ленты плавно трогаются
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      boost *= Math.pow(0.15, dt);
      const g = Math.max(0, Math.min(1, (now - born) / 2200)), ease = g * g * (3 - 2 * g);
      for (const t of tracks) {
        if (!t.len) continue;
        const v = t.len / (t.n * PER) * (ease + boost) * t.dir;
        t.pos = ((t.pos + v * dt) % t.len + t.len) % t.len;
        t.el.style.transform = PHONE ? `translate3d(${-t.pos}px,0,0)` : `translate3d(0,${-t.pos}px,0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const scene = root.closest('.login-scene') ?? root;
    const wheel = (e: Event) => { const d = (e as WheelEvent).deltaY; boost = Math.max(-14, Math.min(14, boost + Math.sign(d) * Math.min(Math.abs(d), 160) / 40)); };
    scene.addEventListener('wheel', wheel, { passive: true });
    return () => { cancelAnimationFrame(raf); scene.removeEventListener('wheel', wheel); };
  }, [letterAt, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return <aside className="lw" aria-hidden="true" ref={box}>
    <div className="lw-wall">{lanes.map((lane, c) => <div key={`${n}-${c}`} className="lw-col">
      <div className="lw-track">
        {[...lane, ...lane].map((it, k) => 'letter' in it
          ? <img key={k} className="letter" srcSet={letterSet(it.letter)} sizes={SIZES} src={`/lumi/logo/${it.letter}.webp`} alt="" decoding="async" />
          : <img key={k} srcSet={posterSet(it.poster)} sizes={SIZES} src={`/lumi/posters/${it.poster}-400.webp`} alt="" decoding="async" />)}
      </div>
    </div>)}</div>
  </aside>;
}

const SEEN = 'lumi.seen';
const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* приватный режим */ } };

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>(() => (new URLSearchParams(location.search).get('mode') === 'signup' || !seen() ? 'up' : 'in'));
  const [show, setShow] = useState(false), [u, setU] = useState(''), [p, setP] = useState(''), [mail, setMail] = useState(''), [err, setErr] = useState(() => takeAuthResult()?.error ?? ''), [busy, setBusy] = useState(false);
  const pv = useProviders(), any = pv.google || pv.apple, [forgot, setForgot] = useState(false), [sent, setSent] = useState('');
  const pass = useRef<HTMLInputElement>(null), title = useRef<HTMLHeadingElement>(null), first = useRef(true);
  // смена экрана (вход ↔ новый пароль) — фокус на заголовок, а не в никуда
  useEffect(() => { if (first.current) { first.current = false; return; } title.current?.focus(); }, [forgot]);

  const brand = <div className="login-brand"><img className="login-mark" src="/favicon.svg" alt="" /><div><b>Lumi</b><span>дневник, который ведёт тебя</span></div></div>;
  const legal = <p className="legal-links">Продолжая, ты принимаешь <a href="/terms.html" target="_blank" rel="noopener">условия</a> и <a href="/privacy.html" target="_blank" rel="noopener">политику конфиденциальности</a>.</p>;
  const errBox = <div className="err" id="login-err" role="alert">{err}</div>;
  const bad = err ? { 'aria-invalid': true, 'aria-describedby': 'login-err' } : {};

  const card = forgot ? <>
    {brand}
    <h1 ref={title} tabIndex={-1}>Новый пароль</h1>
    {sent ? <p>{sent}</p> : <p>Напиши логин или почту — пришлём ссылку, чтобы задать новый пароль.</p>}
    {!sent && <form onSubmit={async e => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await api<{ message: string }>('/api/auth/forgot', { method: 'POST', body: { login: u } }); setSent(r.message); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось.'); } finally { setBusy(false); } }}>
      <label className="sr-only" htmlFor="forgot-login">Логин или почта</label>
      <input id="forgot-login" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Логин или почта" value={u} onChange={e => setU(e.target.value)} required {...bad} />
      {errBox}
      <button type="submit" disabled={busy}>{busy ? 'Отправляю…' : 'Прислать ссылку'}</button>
    </form>}
    <button type="button" className="forgot" style={{ alignSelf: 'center' }} onClick={() => { setForgot(false); setSent(''); setErr(''); }}>← Ко входу</button>
  </> : (() => { const up = mode === 'up'; return <>
    {brand}
    <h1 ref={title} tabIndex={-1}>{up ? 'Зажжём твой первый день' : 'С возвращением'}</h1>
    <p>{up ? `Еда, вода, задачи и статистика — бесплатно навсегда. Остальное — ${TRIAL_DAYS} дней Pro.` : 'Маяк горит — твой день на месте.'}</p>
    {any && <div className="pv-btns">
      {pv.apple && <a className="pv-btn pv-apple" href={startUrl('apple')}><AppleMark />{up ? 'Создать через Apple' : 'Войти через Apple'}</a>}
      {pv.google && <a className="pv-btn pv-google" href={startUrl('google')}><GoogleMark />{up ? 'Создать через Google' : 'Войти через Google'}</a>}
      <div className="pv-or"><span>или по логину</span></div>
    </div>}
    <div className="seg2" role="group" aria-label="Вход или регистрация">
      <button type="button" aria-pressed={!up} className={!up ? 'on' : ''} onClick={() => { setMode('in'); setErr(''); }}>Войти</button>
      <button type="button" aria-pressed={up} className={up ? 'on' : ''} onClick={() => { setMode('up'); setErr(''); }}>Создать аккаунт</button>
    </div>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setErr('');
      try {
        if (up) await api('/api/auth/register', { method: 'POST', body: { username: u, password: p, email: mail, tz: -new Date().getTimezoneOffset() } });
        else await api('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
        markSeen(); onDone();
      } catch (x) {
        setErr(x instanceof ApiError ? x.message : 'Не получилось.');
        // неверный пароль — сразу можно перепечатать
        setTimeout(() => { pass.current?.focus(); pass.current?.select(); });
      }
      finally { setBusy(false); }
    }}>
      <label className="sr-only" htmlFor="login-user">Логин</label>
      <input id="login-user" name="username" autoComplete="username" placeholder="Логин" value={u} onChange={e => { setU(e.target.value); if (err) setErr(''); }} required autoCapitalize="none" spellCheck={false} pattern={up ? "[A-Za-z0-9._-]{3,32}" : undefined} aria-describedby={up ? "user-hint" : undefined} {...(err ? bad : {})} />
      {up && <small className="field-hint" id="user-hint">3–32 символа: латиница, цифры, точка, дефис или подчёркивание</small>}
      {up && <><label className="sr-only" htmlFor="login-mail">Почта, необязательно</label>
        <input id="login-mail" name="email" type="email" autoComplete="email" placeholder="Почта — по желанию" value={mail} onChange={e => setMail(e.target.value)} /></>}
      <label className="sr-only" htmlFor="login-pass">Пароль</label>
      <div className="pw-field"><input ref={pass} id="login-pass" name="password" type={show ? 'text' : 'password'} autoComplete={up ? 'new-password' : 'current-password'} placeholder="Пароль" value={p} onChange={e => { setP(e.target.value); if (err) setErr(''); }} required minLength={up ? 8 : undefined} aria-describedby={up ? 'pw-hint' : err ? 'login-err' : undefined} aria-invalid={err ? true : undefined} />
        <button type="button" className="pw-eye" onClick={() => setShow(x => !x)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={show}><Icon name={show ? 'eyeOff' : 'eye'} /></button></div>
      {up && <small className={`field-hint ${p.length >= 8 ? 'ok' : ''}`} id="pw-hint">{p.length >= 8 ? '✓ 8 символов или больше' : `Минимум 8 символов${p ? ` · ещё ${8 - p.length}` : ''}`}</small>}
      {!up && <button type="button" className="forgot" onClick={() => { setForgot(true); setErr(''); }}>Забыли пароль?</button>}
      {errBox}
      <button type="submit" disabled={busy}>{busy ? (up ? 'Создаю…' : 'Вхожу…') : up ? 'Создать аккаунт' : 'Войти'}</button>
    </form>
  </>; })();

  return <div className="login-scene lw-scene">
    <PosterWall />
    <main className="login"><ThemeToggle className="in-card" />{card}{legal}</main>
  </div>;
}
