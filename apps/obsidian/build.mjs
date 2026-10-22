// Сборка плагина: dist/main.js + manifest.json; копия кладётся в веб (public/obsidian), чтобы скачать из профиля Lumi
import { build } from 'esbuild';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const out = new URL('dist/', here), web = new URL('../web/public/obsidian/', here);
await build({
  entryPoints: [fileURLToPath(new URL('src/main.ts', here))],
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2020',
  external: ['obsidian'], outfile: fileURLToPath(new URL('main.js', out)),
  minify: false, legalComments: 'none', logLevel: 'info'
});
fs.copyFileSync(new URL('manifest.json', here), new URL('manifest.json', out));
fs.mkdirSync(web, { recursive: true });
for (const f of ['main.js', 'manifest.json']) fs.copyFileSync(new URL(f, out), new URL(f, web));
console.log('плагин собран: dist/ и web/public/obsidian/');
