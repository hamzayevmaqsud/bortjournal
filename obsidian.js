/* ============================================================
   Бортжурнал — связка с Obsidian
   Читает папку с конспектами в хранилище Obsidian, строит дневник
   по изменениям, в фоне генерирует вопросы по разделам (Gemini),
   проверяет ответы и пишет шпаргалки в папку «Шпаргалки».
   Свои заметки пользователя только читает.
   ============================================================ */
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const sha = (s, n = 10) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, n);
const z = n => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
// разделы без вопросов: оглавление, планы, списки «что проверить»
const NO_QUESTIONS = /(оглавлени|содержани|table of contents|открытые вопросы|что проверить|план обучения|^todo|^план\b)/i;

/* ---------- разбор заметки ---------- */
function parseFrontmatter(src) {
  const out = {}; let key = null;
  for (const line of src.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) { (Array.isArray(out[key]) ? out[key] : (out[key] = [])).push(item[1].trim().replace(/^['"]|['"]$/g, '')); continue; }
    const kv = /^([\w\-а-яё]+)\s*:\s*(.*)$/i.exec(line);
    if (!kv) continue;
    key = kv[1].toLowerCase(); let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    else v = v.replace(/^['"]|['"]$/g, '');
    out[key] = v === '' ? [] : v;
  }
  return out;
}
function parseNote(raw, rel, stat) {
  let fm = {}, body = raw;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (m) { fm = parseFrontmatter(m[1]); body = raw.slice(m[0].length); }
  const lines = body.split(/\r?\n/);
  const h1 = lines.find(l => /^#\s+/.test(l));
  const base = path.basename(rel, '.md');
  const title = String(fm.title || fm.topic || (h1 ? h1.replace(/^#\s+/, '') : base)).trim();
  const tags = [...new Set((Array.isArray(fm.tags) ? fm.tags : fm.tags ? String(fm.tags).split(/[,\s]+/) : []).map(t => String(t).replace(/^#/, '').trim()).filter(Boolean))];
  const fmDate = String(fm.date || fm.created || '').slice(0, 10);
  const nameDate = /(\d{4}-\d{2}-\d{2})/.exec(base)?.[1];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fmDate) ? fmDate : nameDate || ymd(stat.birthtime || stat.mtime);
  const minutes = Math.max(0, parseInt(fm.minutes || fm.time || fm.duration || 0, 10) || 0);
  // разделы второго уровня; заголовки внутри блоков кода не считаем
  const sections = []; let cur = null, fence = false;
  const tasks = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence) {
      const t = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/.exec(line);
      if (t) tasks.push({ done: t[1] !== ' ', text: t[2].trim() });
      const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
      if (h) { cur = { h: h[1].trim(), lines: [] }; sections.push(cur); continue; }
    }
    if (cur) cur.lines.push(line);
  }
  const out = sections.map(s => {
    const text = s.lines.join('\n').replace(/^\s*---\s*$/gm, '').trim();
    return { key: sha(s.h), h: s.h, text, hash: sha(text, 12), skip: NO_QUESTIONS.test(s.h) || text.length < 60 };
  });
  return { title, tags, date, minutes, sections: out, tasks };
}

module.exports = function createObsidian({ vault, user, folder = 'Учёба', cheatsFolder = 'Шпаргалки', dataDir, gemini, log = console.log }) {
  const vaultName = path.basename(vault);
  const root = path.join(vault, folder);
  const storeFile = path.join(dataDir, 'obsidian', `${user}.json`);
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  let store;
  try { store = JSON.parse(fs.readFileSync(storeFile, 'utf8')); } catch { store = {}; }
  store = { notes: {}, diary: [], lastSync: null, error: null, pausedUntil: 0, ...store };
  let saving = Promise.resolve();
  const persist = () => {
    saving = saving.catch(() => {}).then(async () => {
      const tmp = `${storeFile}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(store), { mode: 0o600 });
      await fsp.rename(tmp, storeFile);
    });
    return saving;
  };
  const link = rel => `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(rel.replace(/\.md$/, ''))}`;

  async function walk(dir) {
    const out = [];
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)) || []);
      else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
  }

  // одна запись дневника на заметку в день: правки за день сливаются
  function diaryAdd(note, date, kind, added, changed) {
    const id = sha(`${note.id}|${date}`);
    let e = store.diary.find(x => x.id === id);
    if (!e) { e = { id, noteId: note.id, title: note.title, rel: note.rel, date, kind, added: [], changed: [], at: new Date().toISOString() }; store.diary.push(e); }
    for (const h of added) if (!e.added.includes(h)) e.added.push(h);
    for (const h of changed) if (!e.changed.includes(h) && !e.added.includes(h)) e.changed.push(h);
    e.at = new Date().toISOString();
  }

  let syncing = null;
  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const files = await walk(root);
        if (!files) { store.error = `В хранилище «${vaultName}» нет папки «${folder}». Создай её в Obsidian и положи туда конспекты.`; return; }
        const seen = new Set(), today = ymd();
        for (const file of files) {
          const rel = path.relative(vault, file);
          seen.add(rel);
          let stat; try { stat = await fsp.stat(file); } catch { continue; }
          const prev = store.notes[rel];
          if (prev && prev.mtimeMs === stat.mtimeMs) continue;
          let raw;
          try { raw = await fsp.readFile(file, 'utf8'); } catch (e) { log(`obsidian: не прочитать ${rel}: ${e.code || e.message}`); continue; }
          const n = parseNote(raw, rel, stat);
          const note = { id: 'obs:' + sha(rel), rel, title: n.title, tags: n.tags, date: n.date, minutes: n.minutes, mtimeMs: stat.mtimeMs, tasks: n.tasks, cheat: prev?.cheat || null, sections: [] };
          const added = [], changed = [];
          for (const s of n.sections) {
            const p = prev?.sections.find(x => x.key === s.key);
            if (!p) added.push(s.h); else if (p.hash !== s.hash) changed.push(s.h);
            const same = p && p.hash === s.hash;
            note.sections.push({ ...s, first: p?.first || (prev ? today : n.date), updated: same ? p.updated : (prev ? today : n.date), questions: same ? p.questions : null, qError: same ? p.qError : null });
          }
          if (!prev) diaryAdd(note, n.date, 'new', n.sections.filter(s => !s.skip).map(s => s.h), []);
          else if (added.length || changed.length) diaryAdd(note, today, 'edit', added, changed);
          store.notes[rel] = note;
        }
        for (const rel of Object.keys(store.notes)) if (!seen.has(rel)) delete store.notes[rel];
        store.error = null;
      } catch (e) {
        store.error = `Не получилось прочитать хранилище: ${e.message}`;
        log('obsidian sync:', e);
      } finally {
        store.lastSync = new Date().toISOString();
        await persist();
        syncing = null;
        pump();
      }
    })();
    return syncing;
  }

  /* ---------- фоновая генерация вопросов ---------- */
  const Q_SCHEMA = {
    type: 'OBJECT',
    properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      q: { type: 'STRING' }, a: { type: 'STRING' }, kind: { type: 'STRING', enum: ['fact', 'why', 'compare', 'practice'] }
    }, required: ['q', 'a', 'kind'] } } },
    required: ['questions']
  };
  function nextTask() {
    for (const note of Object.values(store.notes)) for (const s of note.sections) if (!s.skip && s.questions === null) return { note, s };
    return null;
  }
  let pumping = false;
  async function pump() {
    if (pumping || !gemini) return;
    pumping = true;
    try {
      for (let t = nextTask(); t; t = nextTask()) {
        if (Date.now() < store.pausedUntil) break;
        const { note, s } = t;
        const prompt = `Ты преподаватель. По разделу конспекта составь от 3 до 6 вопросов для интервального повторения, на русском.
- Вопросы на понимание и применение, а не на дословные формулировки. Типы: fact — ключевой факт или число; why — почему так устроено; compare — сравнение; practice — что сделать, какой командой проверить, как диагностировать.
- a — эталонный ответ, 1–3 предложения, строго по тексту раздела.
- Не задавай вопросов по пунктам с пометкой 🔍 — это непроверенные гипотезы.
- Вопрос не должен содержать ответ. Без повторов.
Конспект: ${note.title}
Раздел: ${s.h}
Текст раздела:
${s.text.slice(0, 12000)}`;
        try {
          const { out } = await gemini([{ text: prompt }], Q_SCHEMA, { timeout: 90e3 });
          s.questions = (out.questions || []).slice(0, 6).map(x => ({ id: sha(x.q, 8), q: String(x.q).slice(0, 400), a: String(x.a).slice(0, 800), kind: x.kind }));
          s.qError = null;
        } catch (e) {
          if (e.code === 429) { store.pausedUntil = Date.now() + 10 * 60e3; log('obsidian: лимит Gemini, пауза 10 минут'); await persist(); break; }
          s.questions = []; s.qError = e.message;
        }
        await persist();
        await new Promise(r => setTimeout(r, 4000));
      }
    } finally { pumping = false; }
  }

  /* ---------- проверка ответа ---------- */
  const CHECK_SCHEMA = {
    type: 'OBJECT',
    properties: { score: { type: 'NUMBER' }, verdict: { type: 'STRING', enum: ['good', 'hard', 'again'] }, feedback: { type: 'STRING' }, missing: { type: 'ARRAY', items: { type: 'STRING' } } },
    required: ['score', 'verdict', 'feedback', 'missing']
  };
  async function check({ question, reference, answer, noteId, key, context }) {
    let ctx = String(context || '');
    if (noteId) { const n = Object.values(store.notes).find(x => x.id === noteId); const s = n?.sections.find(x => x.key === key); if (s) ctx = s.text; }
    const prompt = `Проверь ответ ученика на вопрос для повторения. Пиши по-русски, на «ты», дружелюбно и конкретно.
Оценка score от 0 до 100: суть верна — 75 и выше (verdict "good"), частично — 40–74 ("hard"), неверно или пусто — ниже 40 ("again"). Формулировки не важны, важна суть. «Не знаю» и пустой ответ — again.
feedback — 1–2 предложения: что верно и что главное поправить. missing — до 3 коротких пунктов, чего не хватило (пусто, если всё есть).
Вопрос: ${question}
Эталон: ${reference}
Материал (контекст): ${ctx.slice(0, 6000)}
Ответ ученика: ${answer}`;
    const { out } = await gemini([{ text: prompt }], CHECK_SCHEMA, { timeout: 45e3 });
    const score = Math.max(0, Math.min(100, Math.round(+out.score || 0)));
    return { score, verdict: ['good', 'hard', 'again'].includes(out.verdict) ? out.verdict : score >= 75 ? 'good' : score >= 40 ? 'hard' : 'again', feedback: String(out.feedback || '').slice(0, 500), missing: (out.missing || []).slice(0, 3).map(x => String(x).slice(0, 200)) };
  }

  /* ---------- шпаргалки ---------- */
  const CHEAT_SCHEMA = { type: 'OBJECT', properties: { markdown: { type: 'STRING' } }, required: ['markdown'] };
  const shortTitle = t => String(t).replace(/\s*[—–-]\s*конспект.*$/i, '').replace(/\s*\(.*\)\s*$/, '').trim() || String(t);
  const safeName = s => String(s).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  async function cheatsheet(noteId) {
    const note = Object.values(store.notes).find(x => x.id === noteId);
    if (!note) throw Object.assign(new Error('Заметка не найдена — синхронизируй хранилище.'), { code: 404 });
    const raw = await fsp.readFile(path.join(vault, note.rel), 'utf8');
    const prompt = `Сделай шпаргалку по конспекту для Obsidian — markdown на 1–2 экрана, по-русски, без вступлений.
Структура (пропускай разделы, для которых в конспекте нет материала):
## Суть — 4–6 строк, главное.
## Ключевые числа и правила — список или короткая таблица.
## Команды — блоки кода bash с комментариями, только из конспекта.
## Ловушки — частые ошибки и «так нельзя».
## Сравнение — короткая таблица, если в конспекте есть сравнения.
## Проверить — пункты с пометкой 🔍, по одной строке.
Правила: только факты из конспекта, ничего от себя; коротко; можно **жирный**, таблицы, \`код\`; без mermaid и без callout-блоков.
Конспект «${note.title}»:
${raw.slice(0, 60000)}`;
    const { out } = await gemini([{ text: prompt }], CHEAT_SCHEMA, { timeout: 120e3 });
    const md = String(out.markdown || '').trim();
    if (!md) throw Object.assign(new Error('Gemini вернул пустую шпаргалку.'), { code: 502 });
    const dir = path.join(vault, cheatsFolder);
    await fsp.mkdir(dir, { recursive: true });
    let rel = path.join(cheatsFolder, `${safeName(shortTitle(note.title))} — шпаргалка.md`);
    // чужой файл с таким именем не перезаписываем
    try { const cur = await fsp.readFile(path.join(vault, rel), 'utf8'); if (!/^source:\s*bortjournal/m.test(cur)) rel = path.join(cheatsFolder, `${safeName(shortTitle(note.title))} — шпаргалка (журнал).md`); } catch {}
    const content = `---\nsource: bortjournal\nnote: "[[${note.rel.replace(/\.md$/, '')}]]"\nupdated: ${ymd()}\ntags: [шпаргалка${note.tags.length ? ', ' + note.tags.join(', ') : ''}]\n---\n\n# ${shortTitle(note.title)} — шпаргалка\n\n${md}\n`;
    await fsp.writeFile(path.join(vault, rel), content);
    note.cheat = { rel, updated: ymd() };
    await persist();
    return { markdown: md, rel, link: link(rel) };
  }
  async function readCheat(noteId) {
    const note = Object.values(store.notes).find(x => x.id === noteId);
    if (!note?.cheat) throw Object.assign(new Error('Шпаргалки ещё нет.'), { code: 404 });
    const raw = await fsp.readFile(path.join(vault, note.cheat.rel), 'utf8');
    return { markdown: raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^#\s+.+\n+/, ''), rel: note.cheat.rel, link: link(note.cheat.rel) };
  }

  function regen(noteId, key) {
    const note = Object.values(store.notes).find(x => x.id === noteId);
    for (const s of note?.sections || []) if (!key || s.key === key) { if (!s.skip) { s.questions = null; s.qError = null; } }
    store.pausedUntil = 0;
    persist().then(pump);
  }

  function publicState() {
    const notes = Object.values(store.notes).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const secs = notes.flatMap(n => n.sections.filter(s => !s.skip));
    return {
      enabled: true, vaultName, folder, cheatsFolder, lastSync: store.lastSync, error: store.error,
      queue: { total: secs.length, done: secs.filter(s => s.questions !== null).length, pausedUntil: store.pausedUntil > Date.now() ? store.pausedUntil : 0 },
      notes: notes.map(n => ({ id: n.id, rel: n.rel, title: n.title, tags: n.tags, date: n.date, minutes: n.minutes, link: link(n.rel), tasks: n.tasks, cheat: n.cheat ? { ...n.cheat, link: link(n.cheat.rel) } : null,
        sections: n.sections.map(s => ({ key: s.key, h: s.h, first: s.first, updated: s.updated, skip: s.skip, size: s.text.length, questions: s.questions, qError: s.qError })) })),
      diary: store.diary.slice(-300)
    };
  }

  setInterval(sync, 60e3).unref();
  setTimeout(sync, 1000);
  return { sync, publicState, check, cheatsheet, readCheat, regen, user };
};
module.exports.parseNote = parseNote;
