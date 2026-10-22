/**
 * Плагин Lumi для Obsidian: тонкая обёртка над Sync — подписка на события хранилища, настройки, строка состояния.
 * Сеть — через requestUrl Obsidian (работает и на телефоне, без ограничений CORS).
 */
import { Notice, Plugin, PluginSettingTab, requestUrl, Setting, TAbstractFile, TFile } from 'obsidian';
import { httpTransport, Sync, type SyncState } from './sync';

interface Settings { url: string; key: string; folder: string }
const DEFAULTS: Settings = { url: '', key: '', folder: 'Учёба' };

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'только что' : s < 3600 ? `${Math.round(s / 60)} мин назад` : new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

export default class LumiPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  sync: Sync | null = null;
  private bar: HTMLElement | null = null;
  private last: SyncState | null = null;

  async onload() {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings> | null) };
    this.bar = this.addStatusBarItem();
    this.rebuild();
    this.addSettingTab(new LumiSettings(this));
    this.addCommand({ id: 'send-all', name: 'Отправить всё сейчас', callback: () => this.sendAll() });

    const md = (f: TAbstractFile): f is TFile => f instanceof TFile && f.extension === 'md';
    this.registerEvent(this.app.vault.on('modify', f => { if (md(f)) this.sync?.changed(f.path); }));
    this.registerEvent(this.app.vault.on('delete', f => { if (md(f)) this.sync?.deleted(f.path); }));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { if (md(f)) this.sync?.renamed(old, f.path); }));
    // при запуске Obsidian шлёт create на каждый файл — слушаем только после загрузки
    this.app.workspace.onLayoutReady(() => this.registerEvent(this.app.vault.on('create', f => { if (md(f)) this.sync?.changed(f.path); })));
    this.registerInterval(window.setInterval(() => this.paint(), 30000));
  }

  onunload() { this.sync?.dispose(); }

  /** настроили адрес или ключ — пересобрать синхронизацию */
  rebuild() {
    this.sync?.dispose();
    const { url, key, folder } = this.settings;
    this.sync = url && key ? new Sync({
      folder,
      read: async path => { const f = this.app.vault.getAbstractFileByPath(path); if (!(f instanceof TFile)) throw new Error('нет файла'); return this.app.vault.cachedRead(f); },
      transport: httpTransport(url, key, async (u, init) => {
        const r = await requestUrl({ url: u, method: init.method, headers: init.headers, body: init.body, throw: false });
        let json: any; try { json = r.json; } catch { json = undefined; }
        return { status: r.status, json };
      }),
      onState: s => { this.last = s; this.paint(); }
    }) : null;
    this.paint();
  }

  sendAll() {
    if (!this.sync) { new Notice('Lumi: впиши адрес и ключ в настройках плагина.'); return; }
    const paths = this.app.vault.getMarkdownFiles().map(f => f.path).filter(p => this.sync!.inScope(p));
    this.sync.sendAll(paths);
    new Notice(`Lumi: отправляю ${paths.length} заметок`);
  }

  private paint() {
    if (!this.bar) return;
    const s = this.last;
    this.bar.setText(!this.sync ? 'Lumi: не настроен'
      : s?.error ? `Lumi: ⚠ ${s.error}`
      : s?.pending ? `Lumi: отправка… ${s.pending}`
      : s?.lastSync ? `Lumi: ✓ ${ago(s.lastSync)}` : 'Lumi: готов');
    this.bar.setAttr('title', s?.error ?? 'Конспекты отправляются в Lumi после правки');
  }

  private again: number | null = null;
  /** сохранить настройки; пересобрать синхронизацию, когда человек перестал печатать (иначе каждая буква сбрасывала бы очередь) */
  async save() {
    await this.saveData(this.settings);
    if (this.again !== null) window.clearTimeout(this.again);
    this.again = window.setTimeout(() => { this.again = null; this.rebuild(); }, 1500);
  }
}

class LumiSettings extends PluginSettingTab {
  constructor(private p: LumiPlugin) { super(p.app, p); }
  display() {
    const { containerEl: el } = this;
    el.empty();
    el.createEl('p', { text: 'Ключ и адрес — в Lumi: Профиль → Obsidian. Заметки из папки уходят в «Учёбу» через пару секунд после правки.' });
    new Setting(el).setName('Адрес Lumi').setDesc('Например, https://lumi.example.com')
      .addText(t => t.setPlaceholder('https://…').setValue(this.p.settings.url).onChange(async v => { this.p.settings.url = v.trim(); await this.p.save(); }));
    new Setting(el).setName('Ключ').setDesc('Начинается с bjo_')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(this.p.settings.key).onChange(async v => { this.p.settings.key = v.trim(); await this.p.save(); }); });
    new Setting(el).setName('Папка с конспектами').setDesc('Отправляются только заметки из неё. Пусто — всё хранилище.')
      .addText(t => t.setPlaceholder('Учёба').setValue(this.p.settings.folder).onChange(async v => { this.p.settings.folder = v.trim(); await this.p.save(); }));
    new Setting(el).setName('Отправить всё сейчас').setDesc('Загрузить разом все заметки папки — например, после установки.')
      .addButton(b => b.setButtonText('Отправить').setCta().onClick(() => this.p.sendAll()));
  }
}
