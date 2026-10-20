/**
 * Ключи из .env в корне репозитория (тот же файл, что у старого журнала). Уже заданные переменные не трогаем.
 * Загружается только при запуске сервера, не в тестах — чтобы тесты никогда не ходили к настоящему Gemini.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadEnv(file = fileURLToPath(new URL('../../../../.env', import.meta.url))) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
}
