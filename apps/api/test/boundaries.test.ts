/**
 * Границы модулей: модуль импортирует только ядро (core, db) и публичный index.ts других модулей.
 * Залезть во внутренности соседа (его schema, legacy, service) нельзя — тест падает.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const modulesDir = fileURLToPath(new URL('../src/modules', import.meta.url));
const modules = fs.readdirSync(modulesDir).filter(n => fs.statSync(path.join(modulesDir, n)).isDirectory());

describe('границы модулей', () => {
  for (const mod of modules) {
    it(`${mod} не импортирует внутренности других модулей`, () => {
      const dir = path.join(modulesDir, mod), bad: string[] = [];
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.ts'))) {
        const src = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const [, spec] of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          if (!spec!.startsWith('.')) continue;
          const target = path.resolve(dir, spec!), rel = path.relative(modulesDir, target);
          if (rel.startsWith('..')) continue; // ядро и db — можно
          const [other, ...rest] = rel.split(path.sep);
          if (other !== mod && rest.join('/') !== 'index.js') bad.push(`${file} → ${spec}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
  it('каждый модуль экспортирует свой index.ts и зарегистрирован в реестре', () => {
    const registry = fs.readFileSync(path.join(modulesDir, 'index.ts'), 'utf8');
    for (const mod of modules) {
      expect(fs.existsSync(path.join(modulesDir, mod, 'index.ts'))).toBe(true);
      expect(registry).toContain(`./${mod}/index.js`);
    }
  });
});
