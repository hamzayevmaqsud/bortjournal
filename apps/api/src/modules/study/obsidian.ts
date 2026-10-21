/**
 * Obsidian для владельца журнала: конспекты из папки «Учёба» локального хранилища, вопросы по разделам (Gemini),
 * шпаргалки, поиск и чтение. Используется тот же модуль, что у старого журнала (obsidian.js в корне), но со своей
 * копией состояния (data/obsidian-next): два сервера не пишут в один файл. При первом запуске копия берётся
 * из состояния старого журнала — уже собранные вопросы не генерируются заново.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiEnabled, gemini } from '../../core/gemini.js';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export interface Obs {
  user: string; sync(): Promise<void>; publicState(): any; check(a: any): Promise<any>; cheatsheet(id: string): Promise<any>; readCheat(id: string): Promise<any>;
  regen(id: string, key: string | null): void; search(q: string): Promise<any[]>; listLibrary(): Promise<any[]>; readNote(rel: string): Promise<any>;
}
let inst: Obs | null | undefined;

export function obsidian(): Obs | null {
  if (inst !== undefined) return inst;
  const vault = process.env.OBSIDIAN_VAULT, user = (process.env.OBSIDIAN_USER ?? '').toLowerCase();
  if (!vault || !user || process.env.NODE_ENV === 'test') return (inst = null);
  const dataDir = path.join(ROOT, 'data', 'obsidian-next'), mine = path.join(dataDir, 'obsidian', `${user}.json`), old = path.join(ROOT, 'data', 'obsidian', `${user}.json`);
  try { if (!fs.existsSync(mine) && fs.existsSync(old)) { fs.mkdirSync(path.dirname(mine), { recursive: true }); fs.copyFileSync(old, mine); } } catch { /* начнём с нуля */ }
  const create = createRequire(import.meta.url)(path.join(ROOT, 'obsidian.js'));
  inst = create({ vault, user, folder: process.env.OBSIDIAN_FOLDER || 'Учёба', cheatsFolder: process.env.OBSIDIAN_CHEATS || 'Шпаргалки', dataDir,
    gemini: aiEnabled() ? async (parts: unknown[], schema: unknown, opts?: { timeout?: number }) => ({ out: await gemini(parts, schema, opts) }) : null,
    log: () => {}, autoQuestions: false }) as Obs;
  return inst;
}
/** Obsidian открыт только владельцу хранилища */
export const obsFor = (username: string) => { const o = obsidian(); return o && username.toLowerCase() === o.user ? o : null; };
