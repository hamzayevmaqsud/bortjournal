/**
 * Текст конспекта из файла или ссылки → Markdown. PDF — по страницам (unpdf); скан без текстового слоя — через ИИ.
 * Word (.docx) — mammoth → HTML → Markdown. Ссылка — страница скачивается сервером, но только из интернета:
 * адреса локальной сети, Tailscale и самого компьютера закрыты (иначе через «ссылку» можно было бы читать внутренние сервисы).
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { aiEnabled, gemini } from '../../core/gemini.js';
import { bad } from '../../core/http.js';

export const MAX_FILE = 20 * 1024 * 1024, MAX_TEXT = 400_000;
export type Kind = 'pdf' | 'docx' | 'text' | 'link';
export interface Extracted { kind: Kind; title: string; text: string; ext: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', laquo: '«', raquo: '»', hellip: '…' };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m);
const tidy = (s: string) => s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const titleFrom = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 200) || 'Конспект';

/** HTML → Markdown: заголовки, списки, абзацы, код; навигация, скрипты и подвалы отбрасываются */
export function htmlToMd(html: string): { title: string; md: string } {
  const title = decode((/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, '')).trim();
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template|button)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(h)?.[2]; if (main && main.length > 500) h = main;
  h = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(h)?.[1] ?? h;
  h = h.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, c: string) => `\n\n\`\`\`\n${decode(c.replace(/<[^>]+>/g, ''))}\n\`\`\`\n\n`)
    .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${'#'.repeat(+n)} ${t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/(li|ul|ol)>/gi, '\n')
    .replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|section|tr|table|blockquote|h5|h6)>/gi, '\n\n').replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  return { title, md: tidy(decode(h).split('\n').map(l => l.replace(/[ \t]{2,}/g, ' ')).join('\n')) };
}

const MD_SCHEMA = { type: 'OBJECT', properties: { title: { type: 'STRING' }, markdown: { type: 'STRING' } }, required: ['title', 'markdown'] };
async function pdfText(buf: Buffer): Promise<{ text: string; title?: string }> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  let pages: string[] = [];
  try { const pdf = await getDocumentProxy(new Uint8Array(buf)); pages = (await extractText(pdf, { mergePages: false })).text as string[]; }
  catch { throw bad('Не получилось открыть PDF — файл повреждён или защищён паролем.'); }
  const total = pages.reduce((a, p) => a + p.trim().length, 0);
  // скан — это почти полное отсутствие текста (подписи, номера страниц), а не короткий документ
  if (total >= Math.max(40, pages.length * 15)) return { text: pages.map((p, i) => `## Стр. ${i + 1}\n\n${tidy(p)}`).filter(p => p.length > 12).join('\n\n') };
  // текстового слоя нет — это скан: просим ИИ переписать страницы в Markdown
  if (!aiEnabled()) throw bad('В PDF нет текста (похоже на скан), а распознавание без ИИ не работает.');
  if (buf.length > 15 * 1024 * 1024) throw bad('Скан больше 15 МБ — раздели его на части.');
  const out = await gemini([{ inline_data: { mime_type: 'application/pdf', data: buf.toString('base64') } }, { text: 'Это скан конспекта или учебного материала. Перепиши весь текст в Markdown: заголовки разделов — «## …», списки, формулы текстом. Ничего не добавляй от себя. title — короткое название материала.' }], MD_SCHEMA, { timeout: 180e3 });
  const md = tidy(String(out?.markdown ?? ''));
  if (md.length < 50) throw bad('Не получилось распознать текст в PDF.');
  return { text: md, title: String(out?.title ?? '').slice(0, 200) || undefined };
}

/** загруженный файл → текст */
export async function extractFile(name: string, buf: Buffer): Promise<Extracted> {
  if (!buf.length) throw bad('Файл пустой.');
  if (buf.length > MAX_FILE) throw bad('Файл больше 20 МБ.');
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? '').toLowerCase();
  const isPdf = ext === 'pdf' || buf.subarray(0, 5).toString() === '%PDF-';
  if (isPdf) { const r = await pdfText(buf); return { kind: 'pdf', title: r.title ?? titleFrom(name), text: r.text, ext: 'pdf' }; }
  if (ext === 'docx') {
    const mammoth = (await import('mammoth')).default;
    let html = '';
    try { html = (await mammoth.convertToHtml({ buffer: buf })).value; } catch { throw bad('Не получилось открыть документ Word.'); }
    return { kind: 'docx', title: titleFrom(name), text: htmlToMd(html).md, ext: 'docx' };
  }
  if (ext === 'doc') throw bad('Старый формат .doc не поддерживается — сохрани документ как .docx.');
  if (['txt', 'md', 'markdown', ''].includes(ext)) {
    const t = buf.toString('utf8');
    if (t.includes('\u0000')) throw bad('Это не текстовый файл. Подходят PDF, Word (.docx), .txt и .md.');
    const h1 = /^#\s+(.+)$/m.exec(t)?.[1];
    return { kind: 'text', title: (ext === 'md' || ext === 'markdown') && h1 ? h1.slice(0, 200) : titleFrom(name), text: tidy(t), ext: ext || 'txt' };
  }
  throw bad('Такой формат не подходит. Можно PDF, Word (.docx), .txt и .md.');
}

/* ---------- ссылки ---------- */
const v4Private = (ip: string) => {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
};
export function privateIp(ip: string) {
  if (net.isIPv4(ip)) return v4Private(ip);
  const x = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x)?.[1]; if (mapped) return v4Private(mapped);
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
}
async function publicHost(u: URL) {
  if (!/^https?:$/.test(u.protocol)) throw bad('Подходят только ссылки http и https.');
  if (u.username || u.password) throw bad('Ссылка с логином и паролем не подходит.');
  if (process.env.STUDY_ALLOW_PRIVATE === '1') return; // только для тестов
  if (u.port && !['80', '443'].includes(u.port)) throw bad('Ссылка с нестандартным портом не подходит.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw bad('Такой сайт не найден.'); })).map(a => a.address);
  if (!ips.length || ips.some(privateIp)) throw bad('Эта ссылка ведёт во внутреннюю сеть — такие адреса открывать нельзя.');
}
/** страница по ссылке → текст. Переходы проверяются на каждом шаге */
export async function extractLink(raw: string): Promise<Extracted & { url: string; buf?: Buffer }> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw bad('Это не похоже на ссылку.'); }
  for (let hop = 0; hop < 5; hop++) {
    await publicHost(u);
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (Bortjournal; +study notes)', Accept: 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5' } }).catch(() => { throw bad('Сайт не ответил.'); });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location')!, u); continue; }
    if (!r.ok) throw bad(`Сайт ответил ошибкой ${r.status}.`);
    const len = Number(r.headers.get('content-length') ?? 0); if (len > MAX_FILE) throw bad('Страница больше 20 МБ.');
    const reader = r.body!.getReader(), parts: Uint8Array[] = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > MAX_FILE) { await reader.cancel(); throw bad('Страница больше 20 МБ.'); } parts.push(value); }
    const buf = Buffer.concat(parts), type = (r.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('pdf') || buf.subarray(0, 5).toString() === '%PDF-') { const p = await pdfText(buf); return { kind: 'link', title: p.title ?? titleFrom(decodeURIComponent(u.pathname.split('/').pop() || u.hostname)), text: p.text, ext: 'pdf', url: u.toString(), buf }; }
    if (type.includes('html') || /<html|<body/i.test(buf.subarray(0, 2000).toString())) {
      const { title, md } = htmlToMd(buf.toString('utf8'));
      if (md.length < 100) throw bad('На странице почти нет текста — возможно, она собирается скриптами. Попробуй сохранить её как PDF.');
      return { kind: 'link', title: title || u.hostname, text: md, ext: 'html', url: u.toString() };
    }
    if (type.startsWith('text/')) return { kind: 'link', title: titleFrom(u.pathname.split('/').pop() || u.hostname), text: tidy(buf.toString('utf8')), ext: 'txt', url: u.toString() };
    throw bad('По ссылке не страница и не PDF.');
  }
  throw bad('Слишком много переадресаций.');
}

/** куски для вопросов: по заголовкам, мелкие склеиваются, крупные режутся по абзацам; не больше 25 кусков */
export function chunksOf(md: string, size = 6000, max = 25): string[] {
  const parts = md.split(/\n(?=#{1,3}\s)/).map(s => s.trim()).filter(s => s.length > 40), out: string[] = [];
  for (const p of parts) {
    if (p.length <= size) { const last = out[out.length - 1]; if (last && last.length + p.length < size * 0.6) out[out.length - 1] = `${last}\n\n${p}`; else out.push(p); continue; }
    let cur = '';
    for (const para of p.split(/\n{2,}/)) { if (cur && cur.length + para.length > size) { out.push(cur); cur = ''; } cur = cur ? `${cur}\n\n${para}` : para.slice(0, size * 2); }
    if (cur) out.push(cur);
  }
  if (out.length <= max) return out;
  // длинный материал: берём куски равномерно по всему тексту
  return Array.from({ length: max }, (_, i) => out[Math.floor(i * out.length / max)]!);
}
