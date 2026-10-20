/**
 * Markdown → HTML для конспектов Obsidian и шпаргалок (перенесено из старого журнала): заголовки, списки с задачами,
 * таблицы, цитаты и callout, код, [[ссылки]], ==выделение==. Весь текст сначала экранируется — из заметки не выполнится
 * чужой код. Схемы mermaid показываются текстом (сторонние скрипты не подключаем).
 */
const CALLOUT: Record<string, string> = { info: 'Инфо', note: 'Заметка', tip: 'Совет', warning: 'Внимание', important: 'Важно', example: 'Пример', bug: 'Гипотеза', todo: 'Сделать', danger: 'Опасно', quote: 'Цитата', abstract: 'Кратко', question: 'Вопрос', success: 'Готово', failure: 'Ошибка' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export const headId = (t: string) => 'h-' + hash(String(t).trim().toLowerCase()).toString(36);

function inline(t: string) {
  return esc(t)
    .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\[\[([^\]|#]*)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, note, sec, label) => { const h = sec ? sec.slice(1) : ''; return `<a class="wl" href="#" data-note="${note}" data-h="${h}">${label || (note ? note + (h ? ' › ' + h : '') : h)}</a>`; })
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function mdToHtml(md: string): string {
  const lines = String(md).replace(/\r/g, '').split('\n'), out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const fence = /^\s*(```|~~~)\s*([\w-]*)/.exec(l);
    if (fence) {
      const buf: string[] = [];
      while (++i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) buf.push(lines[i]!);
      out.push(`<pre${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const buf: string[] = []; i--;
      while (++i < lines.length && /^\s*>/.test(lines[i]!)) buf.push(lines[i]!.replace(/^\s*>\s?/, ''));
      i--;
      const c = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(buf[0] ?? '');
      if (c) { const type = c[1]!.toLowerCase(); out.push(`<div class="callout callout-${esc(type)}"><div class="callout-title">${inline(c[2] || CALLOUT[type] || type)}</div>${mdToHtml(buf.slice(1).join('\n'))}</div>`); }
      else out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[] = []; i--;
      while (++i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(lines[i]!);
      i--;
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push(`<div class="md-table"><table>${body.map((r, k) => `<tr>${cells(r).map(x => k ? `<td>${inline(x)}</td>` : `<th>${inline(x)}</th>`).join('')}</tr>`).join('')}</table></div>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(l);
    if (h) { const lvl = Math.min(4, h[1]!.length + 1); out.push(`<h${lvl} id="${headId(h[2]!)}">${inline(h[2]!)}</h${lvl}>`); continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { out.push('<hr>'); continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const items: Array<{ ind: number; ord: boolean; text: string }> = []; i--;
      while (++i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!) || (/^\s{2,}\S/.test(lines[i]!) && items.length))) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!);
        if (m) items.push({ ind: m[1]!.replace(/\t/g, '  ').length, ord: /\d/.test(m[2]!), text: m[3]! });
        else items[items.length - 1]!.text += ' ' + lines[i]!.trim();
      }
      i--;
      const render = (arr: typeof items, from: number, ind: number): [string, number] => {
        let html = '', k = from; const ord = arr[from]!.ord;
        while (k < arr.length && arr[k]!.ind >= ind) {
          if (arr[k]!.ind > ind) { const [sub, next] = render(arr, k, arr[k]!.ind); html = html.replace(/<\/li>$/, sub + '</li>'); k = next; continue; }
          const t = /^\[( |x|X)\]\s+(.*)$/.exec(arr[k]!.text);
          html += t ? `<li class="task${t[1] !== ' ' ? ' done' : ''}"><span class="cb">${t[1] !== ' ' ? '✓' : ''}</span>${inline(t[2]!)}</li>` : `<li>${inline(arr[k]!.text)}</li>`;
          k++;
        }
        return [`<${ord ? 'ol' : 'ul'}>${html}</${ord ? 'ol' : 'ul'}>`, k];
      };
      let k = 0; while (k < items.length) { const [html, next] = render(items, k, items[k]!.ind); out.push(html); k = next; }
      continue;
    }
    if (l.trim()) {
      const buf = [l];
      while (i + 1 < lines.length && lines[i + 1]!.trim() && !/^\s*([-*+]|\d+[.)])\s+|^\s*>|^#{1,6}\s|^\s*\||^\s*(```|~~~)|^\s*---\s*$/.test(lines[i + 1]!)) buf.push(lines[++i]!);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('');
}

/** вопросы и ответы дня: оставляем только выделение и списки, остальное — текстом */
export function safeQuizHtml(h: string) {
  return String(h ?? '').replace(/<(\/?)([a-z]+)([^>]*)>/gi, (m, slash, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!['mark', 'ul', 'li', 'b', 'i', 'br'].includes(t)) return esc(m);
    const cls = t === 'mark' && !slash ? (/class="(blank|hl)"/.exec(attrs)?.[1] ?? '') : '';
    return `<${slash}${t}${cls ? ` class="${cls}"` : ''}>`;
  });
}
/** подсветить найденные слова в уже готовом HTML (только в текстовых узлах) */
export function markTerms(root: HTMLElement, q: string) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(w => w.length >= 2); if (!words.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  for (const n of nodes) {
    if (!re.test(n.data)) continue; re.lastIndex = 0;
    const f = document.createDocumentFragment(); let last = 0;
    n.data.replace(re, (m, _g, off: number) => { f.append(n.data.slice(last, off)); const mk = document.createElement('mark'); mk.className = 'hit'; mk.textContent = m; f.append(mk); last = off + m.length; return m; });
    f.append(n.data.slice(last)); n.replaceWith(f);
  }
}
