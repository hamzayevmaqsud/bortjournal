/**
 * Синхронизация заметок с Lumi без зависимостей от Obsidian (тестируется отдельно).
 * Правка → отправка через delayMs после последнего изменения; переименование, удаление — сразу.
 * Операции выполняются строго по очереди; при сбое сети или 5xx очередь ждёт retryMs и повторяет с того же места.
 * Ошибка ключа, тарифа или размера (4xx) — показывается, операция отбрасывается.
 */
export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json?: any }>;

export interface Transport {
  put(note: { path: string; title: string; markdown: string }): Promise<number>;
  rename(from: string, to: string): Promise<number>;
  remove(path: string): Promise<number>;
}

class Retry extends Error {}
class Fatal extends Error {}

/** HTTP к API Lumi; 404 возвращается кодом, остальные ошибки — исключениями Retry / Fatal */
export function httpTransport(base: string, key: string, fetcher: Fetcher): Transport {
  const root = `${base.trim().replace(/\/+$/, '')}/api/study/obsidian`;
  const call = async (method: string, path: string, body?: unknown) => {
    let r: { status: number; json?: any };
    try {
      r = await fetcher(root + path, { method, headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new Retry('Нет связи с Lumi — повторю через полминуты'); }
    if (r.status < 300 || r.status === 404) return r.status;
    if (r.status === 429 || r.status >= 500) throw new Retry(`Lumi сейчас не отвечает (${r.status}) — повторю позже`);
    throw new Fatal(typeof r.json?.error === 'string' ? r.json.error : `Lumi не принял заметку (${r.status})`);
  };
  return {
    put: note => call('PUT', '/notes', note),
    rename: (from, to) => call('POST', '/rename', { from, to }),
    remove: path => call('DELETE', `/notes?path=${encodeURIComponent(path)}`)
  };
}

type Op = { t: 'put'; path: string } | { t: 'rename'; from: string; to: string } | { t: 'remove'; path: string };
export interface SyncState { pending: number; error: string | null; lastSync: number | null }
export interface SyncOptions {
  folder: string;
  delayMs?: number;
  retryMs?: number;
  read(path: string): Promise<string>;
  transport: Transport;
  onState?(s: SyncState): void;
}

export class Sync {
  state: SyncState = { pending: 0, error: null, lastSync: null };
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private queue: Op[] = [];
  private running = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private delay: number;
  private retryMs: number;

  constructor(private o: SyncOptions) { this.delay = o.delayMs ?? 3000; this.retryMs = o.retryMs ?? 30000; }

  /** заметка Markdown внутри выбранной папки (пустая папка — всё хранилище) */
  inScope(path: string) {
    if (!/\.md$/i.test(path)) return false;
    const f = this.o.folder.trim().replace(/^\/+|\/+$/g, '');
    return !f || path.startsWith(`${f}/`);
  }

  changed(path: string) {
    if (!this.inScope(path)) return;
    this.cancel(path);
    this.timers.set(path, setTimeout(() => { this.timers.delete(path); this.push({ t: 'put', path }); }, this.delay));
    this.emit();
  }

  renamed(from: string, to: string) {
    const was = this.inScope(from), now = this.inScope(to), waiting = this.cancel(from);
    if (was && now) { this.push({ t: 'rename', from, to }); if (waiting) this.changed(to); }
    else if (was) this.push({ t: 'remove', path: from });
    else if (now) this.push({ t: 'put', path: to });
  }

  deleted(path: string) {
    if (!this.inScope(path)) return;
    this.cancel(path);
    this.queue = this.queue.filter((op, i) => i === 0 && this.running ? true : !(op.t === 'put' && op.path === path));
    this.push({ t: 'remove', path });
  }

  /** «Отправить всё сейчас»: все заметки папки, без задержки */
  sendAll(paths: string[]) {
    for (const p of paths) if (this.inScope(p)) { this.cancel(p); this.enqueue({ t: 'put', path: p }); }
    void this.flush();
  }

  private cancel(path: string) {
    const h = this.timers.get(path);
    if (h === undefined) return false;
    clearTimeout(h); this.timers.delete(path);
    return true;
  }
  private enqueue(op: Op) {
    // одна и та же заметка дважды подряд в очереди не нужна — текст читается в момент отправки
    if (op.t === 'put' && this.queue.some((x, i) => x.t === 'put' && x.path === op.path && !(i === 0 && this.running))) return;
    this.queue.push(op);
  }
  private push(op: Op) { this.enqueue(op); void this.flush(); }

  private emit() {
    this.state = { ...this.state, pending: this.queue.length + this.timers.size };
    this.o.onState?.(this.state);
  }

  private async putNote(path: string) {
    let markdown: string;
    try { markdown = await this.o.read(path); } catch { return; } // файла уже нет — отправлять нечего
    await this.o.transport.put({ path, title: path.split('/').pop()!.replace(/\.md$/i, ''), markdown });
  }
  private async run(op: Op) {
    if (op.t === 'put') return this.putNote(op.path);
    if (op.t === 'remove') { await this.o.transport.remove(op.path); return; }
    // в Lumi такой заметки ещё нет — присылаем целиком под новым путём
    if ((await this.o.transport.rename(op.from, op.to)) === 404) await this.putNote(op.to);
  }

  async flush() {
    if (this.running || this.retry) { this.emit(); return; }
    this.running = true; this.emit();
    try {
      while (this.queue.length) {
        try {
          await this.run(this.queue[0]!);
          this.queue.shift();
          this.state = { ...this.state, error: null, lastSync: Date.now() };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.state = { ...this.state, error: msg };
          if (e instanceof Fatal) { this.queue.shift(); continue; }
          this.retry = setTimeout(() => { this.retry = null; void this.flush(); }, this.retryMs);
          break;
        }
        this.emit();
      }
    } finally { this.running = false; this.emit(); }
  }

  dispose() {
    for (const h of this.timers.values()) clearTimeout(h);
    if (this.retry) clearTimeout(this.retry);
    this.timers.clear(); this.queue = []; this.retry = null;
  }
}
