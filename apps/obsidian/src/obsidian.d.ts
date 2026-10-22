/**
 * Нужная плагину часть API Obsidian. Сам модуль obsidian подставляет приложение (в сборке он external),
 * поэтому пакет с типами не ставим — описываем только то, чем пользуемся.
 */
declare module 'obsidian' {
  export class TAbstractFile { path: string; name: string }
  export class TFile extends TAbstractFile { basename: string; extension: string }
  export interface EventRef {}
  export interface Vault {
    on(name: 'modify' | 'delete' | 'create', cb: (f: TAbstractFile) => unknown): EventRef;
    on(name: 'rename', cb: (f: TAbstractFile, oldPath: string) => unknown): EventRef;
    getAbstractFileByPath(path: string): TAbstractFile | null;
    getMarkdownFiles(): TFile[];
    cachedRead(f: TFile): Promise<string>;
  }
  export interface Workspace { onLayoutReady(cb: () => void): void }
  export interface App { vault: Vault; workspace: Workspace }
  export interface Command { id: string; name: string; callback?: () => unknown }
  export class Component {
    registerEvent(ref: EventRef): void;
    registerInterval(id: number): number;
  }
  export class Plugin extends Component {
    app: App;
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
    addStatusBarItem(): HTMLElement;
    addSettingTab(tab: PluginSettingTab): void;
    addCommand(c: Command): Command;
    onload(): void | Promise<void>;
    onunload(): void;
  }
  export class PluginSettingTab {
    constructor(app: App, plugin: Plugin);
    app: App;
    containerEl: HTMLElement;
    display(): void;
  }
  export class TextComponent {
    inputEl: HTMLInputElement;
    setValue(v: string): this;
    setPlaceholder(v: string): this;
    onChange(cb: (v: string) => unknown): this;
  }
  export class ButtonComponent {
    setButtonText(t: string): this;
    setCta(): this;
    onClick(cb: () => unknown): this;
  }
  export class Setting {
    constructor(el: HTMLElement);
    setName(n: string): this;
    setDesc(d: string): this;
    addText(cb: (t: TextComponent) => unknown): this;
    addButton(cb: (b: ButtonComponent) => unknown): this;
  }
  export class Notice { constructor(message: string, timeout?: number) }
  export interface RequestUrlParam { url: string; method?: string; headers?: Record<string, string>; body?: string; throw?: boolean }
  export interface RequestUrlResponse { status: number; json: any; text: string }
  export function requestUrl(p: RequestUrlParam): Promise<RequestUrlResponse>;
}

/** Obsidian добавляет эти методы всем элементам */
interface HTMLElement {
  setText(t: string): void;
  setAttr(name: string, value: string): void;
  empty(): void;
  createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: { text?: string; cls?: string }): HTMLElementTagNameMap[K];
}
