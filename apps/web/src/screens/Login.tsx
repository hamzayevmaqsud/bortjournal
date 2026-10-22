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
// какие постеры на стене (номера файлов): одна гамма с логотипом — тёплые пейзажи и закаты
const PICK = [1, 3, 5, 6, 7, 9, 13, 14, 15, 17, 19, 20, 22, 23];
const PER = 11;                         // секунд на постер — у всех лент одна скорость
const LETTERS = 4;                      // L, U, M, I — карточки логотипа (public/lumi/logo)
const PHONE_Q = '(max-width: 899px)';
const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia(PHONE_Q).matches;
const posterSet = (k: number) => `/lumi/posters/${k}-240.webp 240w, /lumi/posters/${k}-400.webp 400w, /lumi/posters/${k}-560.webp 560w`;
// ?v= — после замены картинок логотипа браузер не покажет старые из кэша
const LOGO_V = 'main';
const letterSet = (k: number) => `/lumi/logo/${k}-240.webp?v=${LOGO_V} 240w, /lumi/logo/${k}-400.webp?v=${LOGO_V} 400w, /lumi/logo/${k}.webp?v=${LOGO_V} 612w`;
/** форма справа: ширина — как в стилях (.lw-scene .login); поле — отступ справа и зазор до стены, они равны */
/** на высоких экранах форма крупнее целиком (zoom), чтобы не теряться рядом с большими карточками */
const formZoom = () => (innerWidth >= 1800 ? Math.min(1.3, Math.max(1, innerHeight / 1080)) : 1);
const formW = () => Math.min(600, Math.max(460, innerWidth * 0.34)) * formZoom(), margin = () => Math.min(120, Math.max(32, innerWidth * 0.045));
/** место слева от формы, где может стоять стена */
const wallFree = () => innerWidth - formW() - 2 * margin();
/** ширина постера: четыре ленты занимают свободное место (с зазорами), не уже 150; на больших экранах растёт с высотой, но не шире 440 */
const cardW = () => Math.round(Math.min(440, innerHeight * 0.3, Math.max(150, (wallFree() - 3 * 18) / 4 * 0.9)));
/** сколько стена занимает на деле (карточки упёрлись в предел — меньше свободного места) и где тогда форма: посередине оставшегося */
const wallUsed = (w: number) => Math.min(wallFree(), (4 * w + 3 * 18) / 0.9);
const formRight = (w: number) => Math.max(margin(), (innerWidth - wallUsed(w) - formW()) / 2);
const laneCount = (phone: boolean) => phone ? 1 : LETTERS;
// буквы стоят не по линейке: M выше, U и I ниже — слово читается, но выглядит положенным рукой (доли высоты карточки)
const LETTER_DY = [0.1, -0.12, 0.14, -0.12], LETTER_ROT = [-1.2, 0.8, -0.5, 1];
const GAP = [0, 6, 2, 8, 4];           // зазор между постерами немного разный у соседних лент

type Item = { letter: number } | { poster: number };
/** постеры по лентам: соседние по цвету — в разных лентах; лента длиннее экрана с запасом на наклон */
const lanesOf = (n: number, phone: boolean): Item[][] => {
  const min = phone ? 10 : Math.ceil(innerHeight * 1.5 / (cardW() * 1308 / 736)) + 2;
  return Array.from({ length: n }, (_, c) => {
    const own: Item[] = PICK.filter((_, k) => k % n === c).map(poster => ({ poster }));
    let lane = own; while (lane.length < min) lane = [...lane, ...own];
    return lane;
  });
};

/**
 * Стена: наклонные ленты постеров на весь экран, и в ней с первого кадра стоит слово LUMI — четыре карточки логотипа
 * в соседних лентах, посередине свободного места слева от формы. Потом ленты едут (соседние — навстречу), буквы расходятся.
 * Движение — своим циклом (requestAnimationFrame). Колёсико (и тачпад, и горизонтальное) плавно разгоняет ленту:
 * вниз — вперёд, вверх — назад; разгон гаснет. Анимация не останавливается, при изменении окна лента не сбрасывается.
 */
function PosterWall() {
  const box = useRef<HTMLDivElement>(null);
  const [phone, setPhone] = useState(isPhone), [n, setN] = useState(() => laneCount(isPhone()));
  const [letterAt, setLetterAt] = useState<number[] | null>(() => (isPhone() ? [0] : [0, 1, 2, 3]));
  const [w, setW] = useState(cardW), [vw, setVw] = useState(() => innerWidth);   // ширина окна: форма встаёт заново, даже когда карточки упёрлись в предел
  const saved = useRef<number[] | null>(null);       // где были ленты (доля цикла) — чтобы после изменения окна продолжить, а не начать заново
  useEffect(() => {
    const mq = matchMedia(PHONE_Q); let id = 0;
    const apply = () => { const ph = mq.matches; setPhone(ph); setN(laneCount(ph)); setW(cardW()); setVw(innerWidth); };
    const onResize = () => { clearTimeout(id); id = window.setTimeout(apply, 200); };
    const onMq = () => { setLetterAt(mq.matches ? [0] : [0, 1, 2, 3]); saved.current = null; apply(); };
    addEventListener('resize', onResize); mq.addEventListener('change', onMq);
    return () => { clearTimeout(id); removeEventListener('resize', onResize); mq.removeEventListener('change', onMq); };
  }, []);
  const lanes = lanesOf(n, phone).map((lane, c): Item[] => {
    if (phone) return [...Array.from({ length: LETTERS }, (_, k) => ({ letter: k + 1 })), ...lane];
    const at = letterAt?.indexOf(c) ?? -1;
    return at >= 0 ? [{ letter: at + 1 }, ...lane] : lane;
  });


  // расстановка — до первого кадра (без мигания): буквы в ряд посередине, остальные ленты вразнобой
  const tracksRef = useRef<Array<{ el: HTMLElement; len: number; pos: number; dir: number }>>([]);
  useLayoutEffect(() => {
    const root = box.current; if (!root || !letterAt) return;
    const prev = saved.current; saved.current = null;
    tracksRef.current = [...root.querySelectorAll<HTMLElement>('.lw-track')].map((el, c) => {
      const first = el.firstElementChild as HTMLElement, cs = getComputedStyle(first);
      // точная длина копии: размер карточки (дробный) × число + отступы — без скачка в полпикселя на стыке
      let len = 0; for (const img of [...el.children].slice(0, lanes[c]!.length) as HTMLElement[]) { const st = getComputedStyle(img); len += phone ? parseFloat(st.width) + parseFloat(st.marginRight) : parseFloat(st.height) + parseFloat(st.marginBottom); }
      void cs;
      const view = phone ? root.clientWidth : (el.parentElement as HTMLElement).clientHeight;
      let pos: number;
      const letter = el.querySelector<HTMLElement>('.letter');
      if (prev && prev[c] !== undefined) pos = prev[c]! * len;
      else if (phone && letter) { const ls = el.querySelectorAll<HTMLElement>('.letter'), last = ls[LETTERS - 1]!; pos = letter.offsetLeft - (view - (last.offsetLeft + last.offsetWidth - letter.offsetLeft)) / 2; }
      else if (letter) { const k = Number(letter.dataset.k); pos = letter.offsetTop + letter.offsetHeight / 2 - view / 2 + LETTER_DY[k]! * letter.offsetHeight; }
      else pos = len * ((c * 0.37) % 1);
      pos = ((pos % len) + len) % len;
      el.style.transform = phone ? `translate3d(${-pos}px,0,0)` : `translate3d(0,${-pos}px,0)`;
      return { el, len, pos, dir: c % 2 ? -1 : 1 };
    });
    root.dataset.resumed = prev ? '1' : '';
  }, [letterAt, n, phone, w]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = box.current; if (!root || !letterAt) return;
    const tracks = tracksRef.current, per = tracks.map((_, c) => lanes[c]!.length * PER);
    let boost = 0, target = 0, last = performance.now(), raf = 0;
    const born = root.dataset.resumed ? -1e9 : performance.now() + 1400;   // при первом показе LUMI читается, потом ленты трогаются
    // при первом показе по стене проходит луч маяка и по очереди зажигает L, U, M, I
    let beam = 0;
    if (!root.dataset.resumed && !matchMedia('(prefers-reduced-motion: reduce)').matches) { root.classList.add('beam'); beam = window.setTimeout(() => root.classList.remove('beam'), 2600); }
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      boost += (target - boost) * (1 - Math.pow(0.002, dt));   // разгон набирается плавно, без рывка
      target *= Math.pow(0.15, dt);
      const g = Math.max(0, Math.min(1, (now - born) / 3200)), ease = g * g * (3 - 2 * g);
      tracks.forEach((t, c) => {
        if (!t.len) return;
        t.pos = ((t.pos + t.len / per[c]! * (ease + boost) * t.dir * dt) % t.len + t.len) % t.len;
        t.el.style.transform = phone ? `translate3d(${-t.pos}px,0,0)` : `translate3d(0,${-t.pos}px,0)`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const scene = root.closest('.login-scene') ?? root;
    const wheel = (ev: Event) => {
      const e = ev as WheelEvent, raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const d = raw * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);   // строки (Firefox) и страницы — в пиксели
      target = Math.max(-14, Math.min(14, target + Math.sign(d) * Math.min(Math.abs(d), 160) / 40));
    };
    scene.addEventListener('wheel', wheel, { passive: true });
    return () => {
      cancelAnimationFrame(raf); clearTimeout(beam); root.classList.remove('beam'); scene.removeEventListener('wheel', wheel);
      saved.current = tracks.map(t => (t.len ? t.pos / t.len : 0));   // продолжить с того же места
    };
  }, [letterAt, n, phone, w]); // eslint-disable-line react-hooks/exhaustive-deps

  // где стоит форма — переменная на всей сцене: форма стене соседка, а не дочка
  useLayoutEffect(() => {
    const scene = box.current?.closest<HTMLElement>('.lw-scene'); if (!scene) return;
    if (phone) { scene.style.removeProperty('--fr'); scene.style.removeProperty('--fz'); return; }
    scene.style.setProperty('--fr', `${Math.round(formRight(w))}px`); scene.style.setProperty('--fz', formZoom().toFixed(3));
  }, [phone, w, vw]);

  const sizes = phone ? '88px' : `${w}px`;
  return <aside className="lw" aria-hidden="true" ref={box} style={phone ? undefined : { ['--w' as string]: `${w}px`, ['--free' as string]: `${Math.round(wallUsed(w))}px` }}>
    <div className="lw-wall">{lanes.map((lane, c) => <div key={`${phone}-${n}-${c}`} className="lw-col" style={{ ['--g' as string]: `${GAP[c % GAP.length]}px` }}>
      <div className="lw-track">
        {[...lane, ...lane].map((it, k) => 'letter' in it
          ? <img key={k} className="letter" data-k={it.letter - 1} style={{ ['--r' as string]: `${LETTER_ROT[it.letter - 1]}deg` }} srcSet={letterSet(it.letter)} sizes={sizes} src={`/lumi/logo/${it.letter}.webp?v=${LOGO_V}`} alt="" draggable={false} decoding="async" fetchPriority="high" />
          : <img key={k} srcSet={posterSet(it.poster)} sizes={sizes} src={`/lumi/posters/${it.poster}-400.webp`} alt="" draggable={false} decoding="async" />)}
      </div>
    </div>)}</div>
    <div className="lw-beam" />
  </aside>;
}

/** надёжность пароля: 0 — короче 8, 1 — слабый, 2 — нормальный, 3 — надёжный (длина и разные виды символов) */
const strength = (pw: string) => {
  if (pw.length < 8) return 0;
  const kinds = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\p{L}\d]/u].filter(r => r.test(pw)).length;
  const score = (pw.length >= 12 ? 2 : pw.length >= 10 ? 1 : 0) + (kinds >= 3 ? 2 : kinds === 2 ? 1 : 0);
  return score >= 3 ? 3 : score >= 1 ? 2 : 1;
};
const STRENGTH = ['', 'Слабый — добавь цифры или длины', 'Нормальный', 'Надёжный'];

const SEEN = 'lumi.seen';
const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* приватный режим */ } };

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>(() => (new URLSearchParams(location.search).get('mode') === 'signup' || !seen() ? 'up' : 'in'));
  const [show, setShow] = useState(false), [u, setU] = useState(''), [p, setP] = useState(''), [mail, setMail] = useState(''), [err, setErr] = useState(() => takeAuthResult()?.error ?? ''), [busy, setBusy] = useState(false);
  const pv = useProviders(), any = pv.google || pv.apple, [forgot, setForgot] = useState(false), [sent, setSent] = useState('');
  const [focus, setFocus] = useState(''), [withMail, setWithMail] = useState(false), [caps, setCaps] = useState(false);
  const pass = useRef<HTMLInputElement>(null), title = useRef<HTMLHeadingElement>(null), first = useRef(true);
  // смена экрана (вход ↔ новый пароль) — фокус на заголовок, а не в никуда
  useEffect(() => { if (first.current) { first.current = false; return; } title.current?.focus(); }, [forgot]);

  const brand = <div className="login-brand"><img className="login-mark" src="/favicon.svg" alt="" /><b>Lumi</b></div>;
  const legal = <p className="legal-links">Продолжая, ты принимаешь <a href="/terms.html" target="_blank" rel="noopener">условия</a> и <a href="/privacy.html" target="_blank" rel="noopener">политику конфиденциальности</a>.</p>;
  const errBox = err ? <div className="err" id="login-err" role="alert">{err}</div> : <div id="login-err" role="alert" className="sr-only" />;
  const bad = err ? { 'aria-invalid': true, 'aria-describedby': 'login-err' } : {};
  const on = (k: string) => ({ onFocus: () => setFocus(k), onBlur: () => setFocus(f => (f === k ? '' : f)) });

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
    {/* переключатель — над заголовком, который он меняет */}
    <div className="seg2 tabs2" role="group" aria-label="Вход или регистрация">
      <button type="button" aria-pressed={!up} className={!up ? 'on' : ''} onClick={() => { setMode('in'); setErr(''); }}>Войти</button>
      <button type="button" aria-pressed={up} className={up ? 'on' : ''} onClick={() => { setMode('up'); setErr(''); }}>Создать аккаунт</button>
    </div>
    <h1 ref={title} tabIndex={-1}>{up ? 'Один дневник на\u00a0весь день' : 'С\u00a0возвращением'}</h1>
    <p>{up ? 'Еда, вода, шаги, задачи и учёба — всё в одном месте.' : 'Маяк горит — твой день на месте.'}</p>
    {any && <div className="pv-btns">
      {pv.apple && <a className="pv-btn pv-apple" href={startUrl('apple')}><AppleMark />{up ? 'Создать через Apple' : 'Войти через Apple'}</a>}
      {pv.google && <a className="pv-btn pv-google" href={startUrl('google')}><GoogleMark />{up ? 'Создать через Google' : 'Войти через Google'}</a>}
      <div className="pv-or"><span>или по логину</span></div>
    </div>}
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setErr('');
      try {
        if (up) await api('/api/auth/register', { method: 'POST', body: { username: u, password: p, email: mail, tz: -new Date().getTimezoneOffset() } });
        else await api('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
        markSeen(); onDone();
      } catch (x) {
        setErr(x instanceof ApiError ? x.message : 'Не получилось.');
        setTimeout(() => pass.current?.focus());   // неверный пароль — сразу можно перепечатать
      }
      finally { setBusy(false); }
    }}>
      <label className="sr-only" htmlFor="login-user">Логин</label>
      <input id="login-user" name="username" autoComplete="username" placeholder="Логин" value={u} onChange={e => { setU(e.target.value); if (err) setErr(''); }} onKeyDown={e => { if (e.key === 'Enter' && !p) { e.preventDefault(); pass.current?.focus(); } }} required autoCapitalize="none" spellCheck={false} pattern={up ? '[A-Za-z0-9._-]{3,32}' : undefined} aria-describedby={up ? 'user-hint' : undefined} {...on('u')} {...bad} />
      {/* подсказки — только пока поле в фокусе, чтобы форма не казалась длинной */}
      {up && focus === 'u' && <small className="field-hint" id="user-hint">3–32 символа: латиница, цифры, . _ -</small>}
      <label className="sr-only" htmlFor="login-pass">Пароль</label>
      <div className="pw-field"><input ref={pass} id="login-pass" name="password" type={show ? 'text' : 'password'} autoComplete={up ? 'new-password' : 'current-password'} placeholder="Пароль" value={p} onChange={e => { setP(e.target.value); if (err) setErr(''); }} required minLength={up ? 8 : undefined} aria-describedby={err ? 'login-err' : up ? 'pw-hint' : undefined} aria-invalid={err ? true : undefined} {...on('p')}
          onKeyDown={e => setCaps(e.getModifierState('CapsLock'))} onKeyUp={e => setCaps(e.getModifierState('CapsLock'))} />
        <button type="button" className="pw-eye" onClick={() => setShow(x => !x)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={show}><Icon name={show ? 'eyeOff' : 'eye'} /></button></div>
      {caps && focus === 'p' && <small className="field-hint caps" role="status">Включён Caps Lock</small>}
      {up && (focus === 'p' || p.length > 0) && (() => { const st = strength(p); return <div className="pw-meter" data-s={st}>
        <i /><i /><i />
        <small className={`field-hint ${st === 3 ? 'ok' : ''}`} id="pw-hint">{st ? STRENGTH[st] : `Минимум 8 символов${p ? ` · ещё ${8 - p.length}` : ''}`}</small>
      </div>; })()}
      {up && (withMail
        ? <><label className="sr-only" htmlFor="login-mail">Почта, необязательно</label>
          <input id="login-mail" name="email" type="email" autoComplete="email" placeholder="Почта — для восстановления пароля" value={mail} onChange={e => setMail(e.target.value)} autoFocus /></>
        : <button type="button" className="forgot add-mail" onClick={() => setWithMail(true)}>+ Добавить почту для восстановления</button>)}
      {errBox}
      {!up && <button type="button" className="forgot" onClick={() => { setForgot(true); setErr(''); }}>Забыли пароль?</button>}
      <button type="submit" disabled={busy}>{busy ? (up ? 'Создаю…' : 'Вхожу…') : up ? 'Создать аккаунт' : 'Войти'}</button>
      {up && <p className="trust">Без карты · {TRIAL_DAYS} дней Pro бесплатно</p>}
    </form>
    {/* демо: временный аккаунт с примером дня, удаляется через сутки; можно сохранить как настоящий */}
    <button type="button" className="forgot demo-link" disabled={busy} onClick={async () => {
      setBusy(true); setErr('');
      try { await api('/api/auth/demo', { method: 'POST', body: { tz: -new Date().getTimezoneOffset() } }); onDone(); }
      catch (x) { setErr(x instanceof ApiError ? x.message : 'Не получилось открыть демо.'); }
      finally { setBusy(false); }
    }}>Посмотреть без регистрации →</button>
  </>; })();

  return <div className="login-scene lw-scene">
    <PosterWall />
    <ThemeToggle className="corner" />
    <main className="login">{card}{!forgot && mode === 'up' && legal}</main>
  </div>;
}
