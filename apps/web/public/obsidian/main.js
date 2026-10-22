"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LumiPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/sync.ts
var Retry = class extends Error {
};
var Fatal = class extends Error {
};
function httpTransport(base, key, fetcher) {
  const root = `${base.trim().replace(/\/+$/, "")}/api/study/obsidian`;
  const call = async (method, path, body) => {
    let r;
    try {
      r = await fetcher(root + path, { method, headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" }, body: body === void 0 ? void 0 : JSON.stringify(body) });
    } catch {
      throw new Retry("\u041D\u0435\u0442 \u0441\u0432\u044F\u0437\u0438 \u0441 Lumi \u2014 \u043F\u043E\u0432\u0442\u043E\u0440\u044E \u0447\u0435\u0440\u0435\u0437 \u043F\u043E\u043B\u043C\u0438\u043D\u0443\u0442\u044B");
    }
    if (r.status < 300 || r.status === 404) return r.status;
    if (r.status === 429 || r.status >= 500) throw new Retry(`Lumi \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435 \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442 (${r.status}) \u2014 \u043F\u043E\u0432\u0442\u043E\u0440\u044E \u043F\u043E\u0437\u0436\u0435`);
    throw new Fatal(typeof r.json?.error === "string" ? r.json.error : `Lumi \u043D\u0435 \u043F\u0440\u0438\u043D\u044F\u043B \u0437\u0430\u043C\u0435\u0442\u043A\u0443 (${r.status})`);
  };
  return {
    put: (note) => call("PUT", "/notes", note),
    rename: (from, to) => call("POST", "/rename", { from, to }),
    remove: (path) => call("DELETE", `/notes?path=${encodeURIComponent(path)}`)
  };
}
var Sync = class {
  constructor(o) {
    this.o = o;
    this.state = { pending: 0, error: null, lastSync: null };
    this.timers = /* @__PURE__ */ new Map();
    this.queue = [];
    this.running = false;
    this.retry = null;
    this.delay = o.delayMs ?? 3e3;
    this.retryMs = o.retryMs ?? 3e4;
  }
  /** заметка Markdown внутри выбранной папки (пустая папка — всё хранилище) */
  inScope(path) {
    if (!/\.md$/i.test(path)) return false;
    const f = this.o.folder.trim().replace(/^\/+|\/+$/g, "");
    return !f || path.startsWith(`${f}/`);
  }
  changed(path) {
    if (!this.inScope(path)) return;
    this.cancel(path);
    this.timers.set(path, setTimeout(() => {
      this.timers.delete(path);
      this.push({ t: "put", path });
    }, this.delay));
    this.emit();
  }
  renamed(from, to) {
    const was = this.inScope(from), now = this.inScope(to), waiting = this.cancel(from);
    if (was && now) {
      this.push({ t: "rename", from, to });
      if (waiting) this.changed(to);
    } else if (was) this.push({ t: "remove", path: from });
    else if (now) this.push({ t: "put", path: to });
  }
  deleted(path) {
    if (!this.inScope(path)) return;
    this.cancel(path);
    this.queue = this.queue.filter((op, i) => i === 0 && this.running ? true : !(op.t === "put" && op.path === path));
    this.push({ t: "remove", path });
  }
  /** «Отправить всё сейчас»: все заметки папки, без задержки */
  sendAll(paths) {
    for (const p of paths) if (this.inScope(p)) {
      this.cancel(p);
      this.enqueue({ t: "put", path: p });
    }
    void this.flush();
  }
  cancel(path) {
    const h = this.timers.get(path);
    if (h === void 0) return false;
    clearTimeout(h);
    this.timers.delete(path);
    return true;
  }
  enqueue(op) {
    if (op.t === "put" && this.queue.some((x, i) => x.t === "put" && x.path === op.path && !(i === 0 && this.running))) return;
    this.queue.push(op);
  }
  push(op) {
    this.enqueue(op);
    void this.flush();
  }
  emit() {
    this.state = { ...this.state, pending: this.queue.length + this.timers.size };
    this.o.onState?.(this.state);
  }
  async putNote(path) {
    let markdown;
    try {
      markdown = await this.o.read(path);
    } catch {
      return;
    }
    await this.o.transport.put({ path, title: path.split("/").pop().replace(/\.md$/i, ""), markdown });
  }
  async run(op) {
    if (op.t === "put") return this.putNote(op.path);
    if (op.t === "remove") {
      await this.o.transport.remove(op.path);
      return;
    }
    if (await this.o.transport.rename(op.from, op.to) === 404) await this.putNote(op.to);
  }
  async flush() {
    if (this.running || this.retry) {
      this.emit();
      return;
    }
    this.running = true;
    this.emit();
    try {
      while (this.queue.length) {
        try {
          await this.run(this.queue[0]);
          this.queue.shift();
          this.state = { ...this.state, error: null, lastSync: Date.now() };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.state = { ...this.state, error: msg };
          if (e instanceof Fatal) {
            this.queue.shift();
            continue;
          }
          this.retry = setTimeout(() => {
            this.retry = null;
            void this.flush();
          }, this.retryMs);
          break;
        }
        this.emit();
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }
  dispose() {
    for (const h of this.timers.values()) clearTimeout(h);
    if (this.retry) clearTimeout(this.retry);
    this.timers.clear();
    this.queue = [];
    this.retry = null;
  }
};

// src/main.ts
var DEFAULTS = { url: "", key: "", folder: "\u0423\u0447\u0451\u0431\u0430" };
var ago = (t) => {
  const s = Math.round((Date.now() - t) / 1e3);
  return s < 60 ? "\u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E" : s < 3600 ? `${Math.round(s / 60)} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434` : new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};
var LumiPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULTS };
    this.sync = null;
    this.bar = null;
    this.last = null;
    this.again = null;
  }
  async onload() {
    this.settings = { ...DEFAULTS, ...await this.loadData() };
    this.bar = this.addStatusBarItem();
    this.rebuild();
    this.addSettingTab(new LumiSettings(this));
    this.addCommand({ id: "send-all", name: "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0432\u0441\u0451 \u0441\u0435\u0439\u0447\u0430\u0441", callback: () => this.sendAll() });
    const md = (f) => f instanceof import_obsidian.TFile && f.extension === "md";
    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (md(f)) this.sync?.changed(f.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (f) => {
      if (md(f)) this.sync?.deleted(f.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (f, old) => {
      if (md(f)) this.sync?.renamed(old, f.path);
    }));
    this.app.workspace.onLayoutReady(() => this.registerEvent(this.app.vault.on("create", (f) => {
      if (md(f)) this.sync?.changed(f.path);
    })));
    this.registerInterval(window.setInterval(() => this.paint(), 3e4));
  }
  onunload() {
    this.sync?.dispose();
  }
  /** настроили адрес или ключ — пересобрать синхронизацию */
  rebuild() {
    this.sync?.dispose();
    const { url, key, folder } = this.settings;
    this.sync = url && key ? new Sync({
      folder,
      read: async (path) => {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof import_obsidian.TFile)) throw new Error("\u043D\u0435\u0442 \u0444\u0430\u0439\u043B\u0430");
        return this.app.vault.cachedRead(f);
      },
      transport: httpTransport(url, key, async (u, init) => {
        const r = await (0, import_obsidian.requestUrl)({ url: u, method: init.method, headers: init.headers, body: init.body, throw: false });
        let json;
        try {
          json = r.json;
        } catch {
          json = void 0;
        }
        return { status: r.status, json };
      }),
      onState: (s) => {
        this.last = s;
        this.paint();
      }
    }) : null;
    this.paint();
  }
  sendAll() {
    if (!this.sync) {
      new import_obsidian.Notice("Lumi: \u0432\u043F\u0438\u0448\u0438 \u0430\u0434\u0440\u0435\u0441 \u0438 \u043A\u043B\u044E\u0447 \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445 \u043F\u043B\u0430\u0433\u0438\u043D\u0430.");
      return;
    }
    const paths = this.app.vault.getMarkdownFiles().map((f) => f.path).filter((p) => this.sync.inScope(p));
    this.sync.sendAll(paths);
    new import_obsidian.Notice(`Lumi: \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E ${paths.length} \u0437\u0430\u043C\u0435\u0442\u043E\u043A`);
  }
  paint() {
    if (!this.bar) return;
    const s = this.last;
    this.bar.setText(!this.sync ? "Lumi: \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D" : s?.error ? `Lumi: \u26A0 ${s.error}` : s?.pending ? `Lumi: \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0430\u2026 ${s.pending}` : s?.lastSync ? `Lumi: \u2713 ${ago(s.lastSync)}` : "Lumi: \u0433\u043E\u0442\u043E\u0432");
    this.bar.setAttr("title", s?.error ?? "\u041A\u043E\u043D\u0441\u043F\u0435\u043A\u0442\u044B \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0432 Lumi \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u0430\u0432\u043A\u0438");
  }
  /** сохранить настройки; пересобрать синхронизацию, когда человек перестал печатать (иначе каждая буква сбрасывала бы очередь) */
  async save() {
    await this.saveData(this.settings);
    if (this.again !== null) window.clearTimeout(this.again);
    this.again = window.setTimeout(() => {
      this.again = null;
      this.rebuild();
    }, 1500);
  }
};
var LumiSettings = class extends import_obsidian.PluginSettingTab {
  constructor(p) {
    super(p.app, p);
    this.p = p;
  }
  display() {
    const { containerEl: el } = this;
    el.empty();
    el.createEl("p", { text: "\u041A\u043B\u044E\u0447 \u0438 \u0430\u0434\u0440\u0435\u0441 \u2014 \u0432 Lumi: \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u2192 Obsidian. \u0417\u0430\u043C\u0435\u0442\u043A\u0438 \u0438\u0437 \u043F\u0430\u043F\u043A\u0438 \u0443\u0445\u043E\u0434\u044F\u0442 \u0432 \xAB\u0423\u0447\u0451\u0431\u0443\xBB \u0447\u0435\u0440\u0435\u0437 \u043F\u0430\u0440\u0443 \u0441\u0435\u043A\u0443\u043D\u0434 \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u0430\u0432\u043A\u0438." });
    new import_obsidian.Setting(el).setName("\u0410\u0434\u0440\u0435\u0441 Lumi").setDesc("\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, https://lumi.example.com").addText((t) => t.setPlaceholder("https://\u2026").setValue(this.p.settings.url).onChange(async (v) => {
      this.p.settings.url = v.trim();
      await this.p.save();
    }));
    new import_obsidian.Setting(el).setName("\u041A\u043B\u044E\u0447").setDesc("\u041D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u0441 bjo_").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(this.p.settings.key).onChange(async (v) => {
        this.p.settings.key = v.trim();
        await this.p.save();
      });
    });
    new import_obsidian.Setting(el).setName("\u041F\u0430\u043F\u043A\u0430 \u0441 \u043A\u043E\u043D\u0441\u043F\u0435\u043A\u0442\u0430\u043C\u0438").setDesc("\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0438\u0437 \u043D\u0435\u0451. \u041F\u0443\u0441\u0442\u043E \u2014 \u0432\u0441\u0451 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435.").addText((t) => t.setPlaceholder("\u0423\u0447\u0451\u0431\u0430").setValue(this.p.settings.folder).onChange(async (v) => {
      this.p.settings.folder = v.trim();
      await this.p.save();
    }));
    new import_obsidian.Setting(el).setName("\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0432\u0441\u0451 \u0441\u0435\u0439\u0447\u0430\u0441").setDesc("\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0440\u0430\u0437\u043E\u043C \u0432\u0441\u0435 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u043F\u0430\u043F\u043A\u0438 \u2014 \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \u043F\u043E\u0441\u043B\u0435 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0438.").addButton((b) => b.setButtonText("\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C").setCta().onClick(() => this.p.sendAll()));
  }
};
