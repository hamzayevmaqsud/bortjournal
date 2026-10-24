/**
 * «Что нового»: версии Lumi сверху вниз, текущая — первой. Текст — в @bortjournal/core (RELEASES) и в CHANGELOG.md.
 */
import { APP_VERSION, RELEASES } from '@bortjournal/core';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const day = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m! - 1]} ${y}`; };

/** показать «Что нового» один раз после обновления — кто уже пользовался Lumi; новичку и демо — нет */
export function shouldShowWhatsNew(regular: boolean) {
  try {
    const was = localStorage.getItem('lumi.version');
    localStorage.setItem('lumi.version', APP_VERSION);
    return regular && was !== APP_VERSION;
  } catch { return false; }
}

export function WhatsNew() {
  return <div className="whatsnew">
    {RELEASES.map((r, k) => <section key={r.version} className={`wn-rel ${k === 0 ? 'now' : ''}`}>
      <header className="wn-h"><b>{r.title}</b><span>{r.version} · {day(r.date)}</span></header>
      <ul>{r.items.map(t => <li key={t}>{t}</li>)}</ul>
    </section>)}
  </div>;
}
