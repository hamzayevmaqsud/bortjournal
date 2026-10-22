/**
 * Вход и регистрация Lumi. Слева (на телефоне — сверху) стена постеров, справа карточка формы с маяком.
 * Новичок попадает сразу на «Создать аккаунт» (кто уже входил с этого устройства — на «Войти»).
 * После регистрации — анкета; 7 дней Pro начинаются сразу.
 */
import { useEffect, useRef, useState } from 'react';
import { AppleMark, GoogleMark, startUrl, takeAuthResult, useProviders } from '../lib/oauth';
import { TRIAL_DAYS } from '@bortjournal/core';
import { api, ApiError } from '../lib/api';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';

// 23 постера по кругу оттенков (собираются из Documents/Lumi/login page): 240 и 400 px — показываем не крупнее
const N = 23;
const srcSet = (k: number) => `/lumi/posters/${k}-240.webp 240w, /lumi/posters/${k}-400.webp 400w`;
const SIZES = '(min-width: 900px) 200px, 80px';
const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 899px)').matches;
const PER = 11;                         // секунд на постер при обычной скорости — у всех полос одна скорость
const LETTERS = 4;                      // L, U, M, I — карточки логотипа (public/lumi/logo)
const letterSrc = (k: number) => ({ srcSet: `/lumi/logo/${k}-240.webp 240w, /lumi/logo/${k}.webp 306w`, src: `/lumi/logo/${k}.webp` });

/**
 * Полосы стены. Компьютер: 4 вертикальные полосы, у каждой первая карточка — буква логотипа, дальше свои постеры.
 * Телефон: одна горизонтальная лента — сначала L U M I, потом постеры. Короткая полоса повторяется, чтобы быть длиннее экрана.
 */
type Item = { letter: number } | { poster: number };
const lay = (): Item[][] => {
  if (PHONE) {
    const posters: Item[] = Array.from({ length: N }, (_, k) => ({ poster: k + 1 }));
    return [[...Array.from({ length: LETTERS }, (_, k) => ({ letter: k + 1 })), ...posters.slice(0, 10)]];
  }
  return Array.from({ length: LETTERS }, (_, c) => {
    const own: Item[] = Array.from({ length: N }, (_, k) => k + 1).filter(k => (k - 1) % LETTERS === c).map(poster => ({ poster }));
    let col = own; while (col.length < 7) col = [...col, ...own];
    return [{ letter: c + 1 }, ...col];
  });
};

/**
 * Стена постеров с заставкой: сначала четыре карточки собраны в логотип LUMI по центру, потом разъезжаются в полосы,
 * постеры проявляются, лента набирает ход. Движение — своим циклом (requestAnimationFrame), не CSS: колёсико мыши
 * разгоняет ленту без рывков (вниз — вперёд, вверх — назад, разгон гаснет). Анимация не останавливается.
 */
function PosterWall({ onReady }: { onReady: () => void }) {
  const box = useRef<HTMLDivElement>(null), [phase, setPhase] = useState<'logo' | 'opening' | 'open'>('logo');
  const lists = lay();
  useEffect(() => {
    const root = box.current; if (!root) return;
    const tracks = [...root.querySelectorAll<HTMLElement>('.wall-track')].map((el, c) => ({ el, col: el.parentElement as HTMLElement, n: lists[c]!.length, len: 0, pos: 0, dir: c % 2 ? -1 : 1 }));
    // старт: буквы (первая копия) стоят в одну линию посередине стены
    const place = () => tracks.forEach(t => {
      t.len = (PHONE ? t.el.scrollWidth : t.el.scrollHeight) / 2;
      const first = t.el.querySelector<HTMLElement>('.letter')!, view = PHONE ? root.clientWidth : root.clientHeight;
      if (PHONE) { const lastL = t.el.querySelectorAll<HTMLElement>('.letter')[LETTERS - 1]!; const span = lastL.offsetLeft + lastL.offsetWidth - first.offsetLeft; t.pos = first.offsetLeft - (view - span) / 2; }
      else t.pos = first.offsetTop - (view - first.offsetHeight) / 2;
      t.pos = ((t.pos % t.len) + t.len) % t.len;
      t.el.style.transform = PHONE ? `translate3d(${-t.pos}px,0,0)` : `translate3d(0,${-t.pos}px,0)`;
    });
    place();
    // заставка на компьютере: полосы сдвинуты к центру вплотную и увеличены — буквы складываются в слово
    if (!PHONE) {
      const centers = tracks.map(t => { const r = t.col.getBoundingClientRect(); return r.left + r.width / 2; });
      const w = tracks[0]!.col.getBoundingClientRect().width, h = w * 1308 / 736;
      const scale = Math.max(1, Math.min(1.6, root.clientHeight * 0.58 / h)), mid = innerWidth / 2;  // логотип — по центру всего экрана
      // увеличиваем вокруг строки букв (середина стены), а не вокруг центра длинной полосы
      const oy = root.clientHeight / 2 - (tracks[0]!.col.getBoundingClientRect().top - root.getBoundingClientRect().top);
      // начальное положение — сразу, без плавного перехода; переход включается только для раскрытия
      tracks.forEach((t, c) => { t.col.style.transition = 'none'; t.col.style.transformOrigin = `50% ${oy}px`; t.col.style.transform = `translateX(${mid + (c - (LETTERS - 1) / 2) * w * scale - centers[c]!}px) scale(${scale})`; });
      void root.offsetHeight;
      tracks.forEach(t => { t.col.style.transition = ''; });
    }
    let boost = 0, last = performance.now(), raf = 0, go = 0, started = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      boost *= Math.pow(0.15, dt);
      if (started) go = Math.min(1, (now - started) / 1800);   // после раскрытия лента плавно набирает ход
      const ease = go * go * (3 - 2 * go);
      for (const t of tracks) {
        if (!t.len) continue;
        const v = t.len / (t.n * PER) * (ease + boost) * t.dir;
        t.pos = ((t.pos + v * dt) % t.len + t.len) % t.len;
        t.el.style.transform = PHONE ? `translate3d(${-t.pos}px,0,0)` : `translate3d(0,${-t.pos}px,0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // через мгновение — раскрытие: полосы разъезжаются, постеры проявляются, появляется форма
    const open = setTimeout(() => {
      setPhase('opening'); onReady();
      setTimeout(() => setPhase('open'), 1250);  // пока полосы разъезжаются, стена не обрезает логотип
      tracks.forEach(t => { t.col.style.transform = ''; });
      started = performance.now() + 500;
    }, 1100);
    const scene = root.closest('.login-scene') ?? root;
    const wheel = (e: Event) => { const d = (e as WheelEvent).deltaY; boost = Math.max(-14, Math.min(14, boost + Math.sign(d) * Math.min(Math.abs(d), 160) / 40)); };
    scene.addEventListener('wheel', wheel, { passive: true });
    const resize = () => tracks.forEach(t => { t.len = (PHONE ? t.el.scrollWidth : t.el.scrollHeight) / 2; });
    addEventListener('resize', resize);
    return () => { clearTimeout(open); cancelAnimationFrame(raf); scene.removeEventListener('wheel', wheel); removeEventListener('resize', resize); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <aside className={`login-art wall4 ${phase}`} aria-hidden="true" ref={box}>
    <div className="wall">{lists.map((col, c) => <div key={c} className={`wall-col c${c}`}>
      <div className="wall-track">
        {[...col, ...col].map((it, k) => 'letter' in it
          ? <img key={k} className="letter" {...letterSrc(it.letter)} sizes={PHONE ? '80px' : '220px'} alt="" decoding="async" />
          : <img key={k} srcSet={srcSet(it.poster)} sizes={SIZES} src={`/lumi/posters/${it.poster}-400.webp`} alt="" decoding="async" />)}
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
  const pass = useRef<HTMLInputElement>(null), title = useRef<HTMLHeadingElement>(null), first = useRef(true), [shown, setShown] = useState(false);
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

  return <div className="login-scene">
    <PosterWall onReady={() => setShown(true)} />
    <main className={`login ${shown ? 'shown' : 'hidden'}`}><ThemeToggle className="in-card" />{card}{legal}</main>
  </div>;
}
