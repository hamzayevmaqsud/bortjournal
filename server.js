/* ============================================================
   Бортжурнал — локальный сервер
   Аккаунты, сессии и данные пользователей в папке data/.
   Без зависимостей: node server.js
   ============================================================ */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { promisify } = require('node:util');
const scryptAsync = promisify(crypto.scrypt);

// .env в папке проекта: KEY=value построчно (не попадает в git)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (e) { if (e.code !== 'ENOENT') throw e; }

const PORT = +process.env.PORT || 3333;
// по умолчанию только этот компьютер; доступ с телефона — через Tailscale (https), см. README
const HOST = process.env.HOST || '127.0.0.1';
const ALLOW_REGISTER = /^(1|true|yes)$/i.test(process.env.ALLOW_REGISTER || '');
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const ROOT = __dirname;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_DIR = path.join(DATA, 'state');
const USERS_FILE = path.join(DATA, 'users.json');
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const SESSION_DAYS = 90;
const MAX_BODY = 10 * 1024 * 1024;
const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/plan.js': 'plan.js', '/foods.js': 'foods.js',
  '/sw.js': 'sw.js', '/manifest.webmanifest': 'manifest.webmanifest',
  '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png', '/apple-touch-icon.png': 'apple-touch-icon.png'
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png' };

fs.mkdirSync(STATE_DIR, { recursive: true });

/* ---------- файлы ---------- */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
// запись через временный файл, чтобы не оставить битый JSON при сбое
const queues = new Map();
function writeJson(file, data) {
  const prev = queues.get(file) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await fsp.rename(tmp, file);
  });
  queues.set(file, next);
  next.catch(e => console.error(`Не удалось записать ${path.basename(file)}: ${e.message}`));
  return next;
}
// последняя страховка: ошибка в фоне не должна останавливать сервер
process.on('unhandledRejection', e => console.error('Необработанная ошибка:', e?.message || e));

let users = Object.assign(Object.create(null), readJson(USERS_FILE, {}));
let sessions = Object.assign(Object.create(null), readJson(SESSIONS_FILE, {}));
// напоминания: подписки браузеров, часовой пояс и что уже отправлено — data/push.json
const PUSH_FILE = path.join(DATA, 'push.json');
const pushDb = Object.assign(Object.create(null), readJson(PUSH_FILE, {}));
const stateFile = u => path.join(STATE_DIR, `${u}.json`);
const userRec = u => Object.hasOwn(users, u) ? users[u] : null;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'admin', 'root']);

/* ---------- пароли и сессии ---------- */
async function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = (await scryptAsync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 })).toString('hex');
  return { salt, hash };
}
// для несуществующего логина считаем тот же хеш, чтобы по времени ответа нельзя было узнать, есть ли он
const DUMMY = { salt: crypto.randomBytes(16).toString('hex'), hash: '0'.repeat(128) };
async function checkPassword(pw, rec) {
  const r = rec && typeof rec.salt === 'string' && typeof rec.hash === 'string' ? rec : DUMMY;
  const { hash } = await hashPassword(pw, r.salt);
  return rec === r && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(r.hash, 'hex'));
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function newSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[sha(token)] = { u: username, exp: Date.now() + SESSION_DAYS * 864e5 };
  writeJson(SESSIONS_FILE, sessions).catch(() => {});
  return token;
}
function sessionUser(req) {
  const m = /(?:^|;\s*)bj_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = sessions[sha(m[1])];
  if (!s || s.exp < Date.now() || !userRec(s.u)) return null;
  return s.u;
}
// через Tailscale (https) кука помечается Secure
const isHttps = req => req.headers['x-forwarded-proto'] === 'https' || /\.ts\.net$/i.test(hostOf(req));
function sessionCookie(req, token, maxAge) {
  return `bj_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
// чистка просроченных сессий раз в час
setInterval(() => {
  const now = Date.now(); let changed = false;
  for (const k of Object.keys(sessions)) if (sessions[k].exp < now) { delete sessions[k]; changed = true; }
  if (changed) writeJson(SESSIONS_FILE, sessions).catch(() => {});
  // чистим счётчики попыток и лимитов
  for (const [k, a] of attempts) if (now - a.t > 15 * 60e3) attempts.delete(k);
  const today = localDay();
  for (const m of [photoUse, aiUse]) for (const k of m.keys()) if (!k.endsWith(today)) m.delete(k);
}, 36e5).unref();

/* ---------- защита от перебора ---------- */
const attempts = new Map();
const LIMIT = 10;
function tooMany(...keys) {
  return keys.some(k => { const a = attempts.get(k); return a && a.n >= LIMIT && Date.now() - a.t < 15 * 60e3; });
}
function failed(...keys) {
  for (const k of keys) {
    const a = attempts.get(k);
    if (!a || Date.now() - a.t > 15 * 60e3) attempts.set(k, { n: 1, t: Date.now() }); else a.n++;
  }
}
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;


/* ---------- распознавание еды по фото (Google Gemini) ---------- */
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
const GEMINI_MODELS = (process.env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-3.5-flash-lite').split(',').map(s => s.trim()).filter(Boolean);
const SCALES = {
  card: 'Рядом с едой лежит банковская или ID-карта: 85,6 × 54 мм. Используй её как эталон размера.',
  fork: 'Рядом с едой лежит обычная столовая вилка длиной около 19–20 см. Используй её как эталон размера.',
  spoon: 'Рядом с едой лежит столовая ложка длиной около 18–20 см. Используй её как эталон размера.',
  phone: 'Рядом с едой лежит смартфон около 15 × 7 см. Используй его как эталон размера.',
  hand: 'Рядом с едой ладонь взрослого человека: длина ладони без пальцев около 10 см. Используй её как эталон размера.'
};
const FOOD_PROMPT = `Ты нутрициолог. По фото и/или текстовому описанию оцени, что съедено, и посчитай калории и БЖУ.
Правила:
- Разбей на отдельные позиции: каждый продукт, соус, масло, напиток — отдельной строкой. Названия по-русски, коротко.
- Для каждой позиции: вес порции в граммах и калории, белки, жиры, углеводы на ВСЮ порцию (не на 100 г). Округляй: граммы до 5, ккал до целых, БЖУ до 0,5.
- Также на всю порцию: fiber — пищевые волокна (клетчатка), г; sugar — сахара всего, г; salt — соль, г (натрий × 2,5). Округляй до 0,5.
- Если фото нет, считай только по описанию. Если вес не указан, бери типичную порцию для этого блюда и confidence = "medium".
- Размер порции оценивай по эталону, если он указан, иначе по тарелке (обычно 24–27 см), приборам и упаковке.
- Если пользователь в подписи указал вес или состав, это главнее твоей оценки: бери его цифры, source = "user".
- Если на фото видна этикетка с пищевой ценностью, считай по ней, source = "label". Иначе source = "estimate".
- Учитывай скрытые калории: масло при жарке, заправки, соусы. Если они вероятны, но не видны, добавь их отдельной позицией с confidence = "low".
- confidence: "high" — продукт и вес очевидны, "medium" — продукт ясен, вес примерный, "low" — догадка.
- questions: до 3 уточнений, только если ответ меняет итог больше чем на 15% (например, «на чём жарили?», «майонез обычный или лёгкий?»). У каждого 2–4 коротких варианта ответа. Если всё ясно — пустой массив.
- Если на фото нет еды, is_food = false и пустой items.
- comment: одно короткое предложение по-русски — что учтено или в чём главная неопределённость.`;
const FOOD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_food: { type: 'BOOLEAN' },
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, grams: { type: 'NUMBER' }, kcal: { type: 'NUMBER' },
      protein: { type: 'NUMBER' }, fat: { type: 'NUMBER' }, carbs: { type: 'NUMBER' },
      fiber: { type: 'NUMBER' }, sugar: { type: 'NUMBER' }, salt: { type: 'NUMBER' },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      source: { type: 'STRING', enum: ['estimate', 'label', 'user'] }
    }, required: ['name', 'grams', 'kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'salt', 'confidence', 'source'] } },
    questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      text: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } }
    }, required: ['text', 'options'] } },
    comment: { type: 'STRING' }
  },
  required: ['is_food', 'items', 'questions', 'comment']
};
// мягкий лимит на пользователя, чтобы один не выел общую бесплатную квоту
const photoUse = new Map();
function photoQuota(user) {
  const day = localDay(), k = `${user}:${day}`;
  const n = (photoUse.get(k) || 0) + 1; photoUse.set(k, n);
  return n <= (+process.env.PHOTO_DAILY_LIMIT || 60) && aiQuota(user, 'photo');
}
const numClamp = (v, max) => Math.max(0, Math.min(max, Math.round((+v || 0) * 2) / 2));

/* Общий вызов Gemini: части запроса + JSON-схема ответа. Перебирает модели, если у первой лимит или сбой. */
async function gemini(parts, schema, { timeout = 60e3 } = {}) {
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } });
  let lastErr;
  for (const model of GEMINI_MODELS) {
    let r;
    try {
      r = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, body,
        signal: AbortSignal.timeout(timeout)
      });
    } catch (err) {
      lastErr = { status: 502, message: err.name === 'TimeoutError' ? 'Gemini не ответил вовремя.' : 'Нет связи с Gemini.' };
      continue;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      lastErr = { status: r.status, message: data.error?.message || `HTTP ${r.status}` };
      // лимит, модель недоступна или перегружена — пробуем следующую
      if ([404, 429, 500, 503].includes(r.status)) continue;
      break;
    }
    const part = data.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string' && !p.thought);
    try { return { out: JSON.parse(part?.text || ''), model }; }
    catch { lastErr = { status: 502, message: 'Модель вернула непонятный ответ.' }; }
  }
  const e = new Error(
    lastErr?.status === 429 ? 'Бесплатный лимит Gemini на сейчас исчерпан. Попробуй через минуту или завтра.' :
    lastErr?.status === 400 || lastErr?.status === 403 ? `Gemini отклонил запрос: ${lastErr.message}` :
    lastErr?.message || 'Gemini недоступен.');
  e.code = lastErr?.status === 429 ? 429 : 502;
  throw e;
}

async function recognizeFood({ image, mime, note, scale, answers }) {
  const text = [
    FOOD_PROMPT,
    SCALES[scale] || 'Эталона размера в кадре нет.',
    image ? '' : 'Фото нет — только текстовое описание.',
    note ? `${image ? 'Подпись пользователя' : 'Описание еды от пользователя'}: ${note}` : '',
    answers && answers.length ? `Ответы пользователя на уточнения:\n${answers.map(a => `- ${a}`).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
  const { out, model } = await gemini(image ? [{ inline_data: { mime_type: mime, data: image } }, { text }] : [{ text }], FOOD_SCHEMA);
  const items = (Array.isArray(out.items) ? out.items : []).slice(0, 20).map(it => ({
    name: String(it.name || 'Без названия').slice(0, 80),
    grams: numClamp(it.grams, 3000), kcal: Math.round(numClamp(it.kcal, 6000)),
    p: numClamp(it.protein, 500), f: numClamp(it.fat, 500), c: numClamp(it.carbs, 1000),
    fi: numClamp(it.fiber, 200), su: numClamp(it.sugar, 500), sa: numClamp(it.salt, 50),
    confidence: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'medium',
    source: ['estimate', 'label', 'user'].includes(it.source) ? it.source : 'estimate'
  }));
  const questions = (Array.isArray(out.questions) ? out.questions : []).slice(0, 3).map(q => ({
    text: String(q.text || '').slice(0, 160), options: (Array.isArray(q.options) ? q.options : []).slice(0, 4).map(o => String(o).slice(0, 60))
  })).filter(q => q.text && q.options.length);
  return { isFood: out.is_food !== false && items.length > 0, items, questions, comment: String(out.comment || '').slice(0, 300), model };
}

/* ---------- Obsidian ---------- */
const OBS_VAULT = process.env.OBSIDIAN_VAULT || '', OBS_USER = (process.env.OBSIDIAN_USER || '').toLowerCase();
const obsidian = OBS_VAULT && OBS_USER ? require('./obsidian.js')({
  vault: OBS_VAULT, user: OBS_USER, folder: process.env.OBSIDIAN_FOLDER || 'Учёба', cheatsFolder: process.env.OBSIDIAN_CHEATS || 'Шпаргалки',
  dataDir: DATA, gemini: GEMINI_KEY ? gemini : null
}) : null;
const aiUse = new Map();
function aiQuota(user, kind = 'ai') {
  const day = localDay(), k = `${user}:${kind}:${day}`, g = `*:${day}`;
  const limit = kind === 'regen' ? 30 : (+process.env.AI_DAILY_LIMIT || 200);
  const n = (aiUse.get(k) || 0) + 1, gn = (aiUse.get(g) || 0) + 1;
  // общий потолок на всех — бесплатная квота Gemini одна
  if (n > limit || gn > (+process.env.AI_GLOBAL_LIMIT || 400)) return false;
  aiUse.set(k, n); aiUse.set(g, gn); return true;
}

const bookSearches = new Map(); // поиски книг за день: отдельно от квоты ИИ
const noCover = new Set();        // обложки, которых нет ни в одном каталоге: не спрашиваем повторно
function isbn10(x) {
  x = String(x).replace(/[^\dX]/gi, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(x)) return x;
  if (!/^978\d{10}$/.test(x)) return null;
  const b = x.slice(3, 12); let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * +b[i];
  const c = (11 - sum % 11) % 11; return b + (c === 10 ? 'X' : c);
}

/* ---------- HTTP ---------- */
function send(res, code, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const type = isJson ? 'application/json; charset=utf-8' : headers['Content-Type'] || 'text/plain; charset=utf-8';
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CSP } : {}),
    ...headers
  });
  res.end(isJson ? JSON.stringify(body) : body);
}
const CSP = [
  "default-src 'self'", "script-src 'self' https://cdn.jsdelivr.net", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'", "obj" + "ect-src 'none'",
  "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "manifest-src 'self'", "worker-src 'self'"
].join('; ');
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('Ожидается JSON'), { code: 415 }));
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('Слишком большой запрос'), { code: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Битый JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}
const USER_RE = /^[a-z0-9_.-]{3,32}$/;
function hostOf(req) { return String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, ''); }
const MY_HOST = os.hostname().toLowerCase();
function hostOk(req) {
  const h = hostOf(req);
  if (!h) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(':')) return true; // IP-адрес
  return h === 'localhost' || h.endsWith('.ts.net') || h.endsWith('.local') || h === MY_HOST || h === MY_HOST.replace(/\.local$/, '') || ALLOWED_HOSTS.includes(h);
}
const canRegister = () => ALLOW_REGISTER || Object.keys(users).length === 0;

const stateCache = new Map();
function loadState(user) {
  if (!stateCache.has(user)) stateCache.set(user, readJson(stateFile(user), { rev: 0, state: null }));
  return stateCache.get(user);
}

async function api(req, res, url) {
  const ip = req.socket.remoteAddress;
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/config') return send(res, 200, { register: canRegister(), firstRun: Object.keys(users).length === 0 });
  if (route === 'POST /api/register' || route === 'POST /api/login') {
    const body = await readBody(req, 16e3);
    const username = String(body.username || '').trim().toLowerCase().slice(0, 64);
    const password = String(body.password || '').slice(0, 512);
    if (tooMany(ip, 'u:' + username)) return send(res, 429, { error: 'Слишком много попыток. Подожди 15 минут.' });
    if (route === 'POST /api/register') {
      if (!canRegister()) { failed(ip); return send(res, 403, { error: 'Регистрация закрыта.' }); }
      failed('reg:' + ip);
      if (tooMany('reg:' + ip)) return send(res, 429, { error: 'Слишком много попыток. Подожди 15 минут.' });
      if (!USER_RE.test(username) || RESERVED.has(username)) return send(res, 400, { error: 'Логин: 3–32 символа, латиница, цифры, точка, дефис или подчёркивание.' });
      if (password.length < 6) return send(res, 400, { error: 'Пароль должен быть не короче 6 символов.' });
      if (userRec(username)) return send(res, 409, { error: 'Такой логин уже занят.' });
      users[username] = { ...(await hashPassword(password)), created: new Date().toISOString() };
      await writeJson(USERS_FILE, users);
    } else {
      if (!(await checkPassword(password, userRec(username)))) { failed(ip, 'u:' + username); return send(res, 401, { error: 'Неверный логин или пароль.' }); }
      attempts.delete(ip); attempts.delete('u:' + username);
    }
    const token = newSession(username);
    return send(res, 200, { username }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  }

  const user = sessionUser(req);
  if (!user) return send(res, 401, { error: 'Нужно войти.' });

  if (route === 'POST /api/logout') {
    const m = /(?:^|;\s*)bj_session=([^;]+)/.exec(req.headers.cookie || '');
    if (m) { delete sessions[sha(m[1])]; await writeJson(SESSIONS_FILE, sessions); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (route === 'GET /api/me') return send(res, 200, { username: user, photo: !!GEMINI_KEY });
  if (route === 'GET /api/obsidian') return send(res, 200, obsidian && user === OBS_USER ? obsidian.publicState() : { enabled: false });
  if (route === 'POST /api/obsidian/sync') {
    if (!obsidian || user !== OBS_USER) return send(res, 404, { error: 'Obsidian не подключён.' });
    await obsidian.sync(); return send(res, 200, obsidian.publicState());
  }
  if (route === 'GET /api/obsidian/search') {
    if (!obsidian || user !== OBS_USER) return send(res, 404, { error: 'Obsidian не подключён.' });
    return send(res, 200, { hits: await obsidian.search(String(url.searchParams.get('q') || '').slice(0, 200)) });
  }
  if (route === 'GET /api/obsidian/library') {
    if (!obsidian || user !== OBS_USER) return send(res, 404, { error: 'Obsidian не подключён.' });
    return send(res, 200, { notes: await obsidian.listLibrary() });
  }
  if (route === 'GET /api/obsidian/note') {
    if (!obsidian || user !== OBS_USER) return send(res, 404, { error: 'Obsidian не подключён.' });
    return send(res, 200, await obsidian.readNote(url.searchParams.get('rel') || ''));
  }
  if (route === 'POST /api/obsidian/regen') {
    if (!obsidian || user !== OBS_USER) return send(res, 404, { error: 'Obsidian не подключён.' });
    if (!aiQuota(user, 'regen')) return send(res, 429, { error: 'Пересобирать вопросы можно до 30 раз в день.' });
    const body = await readBody(req); obsidian.regen(String(body.noteId || ''), body.key ? String(body.key) : null);
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/study/cheatsheet') {
    if (!obsidian || user !== OBS_USER) return send(res, 404, { error: 'Obsidian не подключён.' });
    if (!GEMINI_KEY) return send(res, 503, { error: 'Нет ключа Gemini.' });
    if (!aiQuota(user)) return send(res, 429, { error: 'На сегодня лимит запросов к ИИ исчерпан.' });
    const body = await readBody(req); return send(res, 200, await obsidian.cheatsheet(String(body.noteId || '')));
  }
  if (route === 'GET /api/study/cheatsheet') {
    if (!obsidian || user !== OBS_USER) return send(res, 404, { error: 'Obsidian не подключён.' });
    return send(res, 200, await obsidian.readCheat(url.searchParams.get('id') || ''));
  }
  if (route === 'POST /api/study/check') {
    if (!GEMINI_KEY) return send(res, 503, { error: 'Нет ключа Gemini.' });
    if (!aiQuota(user)) return send(res, 429, { error: 'На сегодня лимит запросов к ИИ исчерпан.' });
    const body = await readBody(req);
    const answer = String(body.answer || '').trim();
    if (!answer) return send(res, 400, { error: 'Напиши ответ.' });
    const check = obsidian ? obsidian.check : null;
    if (!check) return send(res, 503, { error: 'Проверка недоступна.' });
    return send(res, 200, await check({ question: String(body.question || '').slice(0, 600), reference: String(body.reference || '').slice(0, 1500), answer: answer.slice(0, 3000),
      noteId: user === OBS_USER ? body.noteId : null, key: body.key, context: String(body.context || '').slice(0, 6000) }));
  }
  if (route === 'POST /api/food/photo') {
    if (!GEMINI_KEY) return send(res, 503, { error: 'Распознавание не настроено: на сервере нет GEMINI_API_KEY.' });
    if (!photoQuota(user)) return send(res, 429, { error: 'На сегодня лимит фото исчерпан.' });
    const body = await readBody(req);
    const mime = String(body.mime || ''), hasImage = typeof body.image === 'string' && body.image.length > 0;
    if (hasImage) {
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return send(res, 400, { error: 'Нужна картинка JPEG, PNG или WebP.' });
      if (body.image.length < 100 || body.image.length > 8e6) return send(res, 400, { error: 'Фото пустое или слишком большое.' });
    } else if (String(body.note || '').trim().length < 2) return send(res, 400, { error: 'Опиши, что съел, или добавь фото.' });
    const out = await recognizeFood({
      image: hasImage ? body.image : null, mime,
      note: String(body.note || '').slice(0, 300),
      scale: String(body.scale || ''),
      answers: (Array.isArray(body.answers) ? body.answers : []).slice(0, 5).map(a => String(a).slice(0, 200))
    });
    return send(res, 200, out);
  }
  // Книги: поиск в Open Library и обложки. Сервер ходит только на адреса Open Library, собранные им самим
  if (route === 'GET /api/books/search') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
    if (q.length < 2) return send(res, 200, { items: [] });
    { const k = `${user}:${localDay()}`, n = (bookSearches.get(k) || 0) + 1; if (n > 300) return send(res, 429, { error: 'Слишком много поисков за сегодня.' }); bookSearches.set(k, n); }
    try {
      const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=16&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,subject,isbn`,
        { headers: { 'User-Agent': 'Bortjournal/1.0 (personal tracker)' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      const items = (d.docs || []).map(x => ({
        title: String(x.title || '').slice(0, 200), author: (x.author_name || []).slice(0, 2).join(', ').slice(0, 160),
        year: x.first_publish_year || null, pages: x.number_of_pages_median || null, cover: Number.isInteger(x.cover_i) && x.cover_i > 0 ? x.cover_i : null,
        genre: (x.subject || []).find(t => t.length < 30) || '',
        isbn: [...new Set((x.isbn || []).map(isbn10).filter(Boolean))].slice(0, 4)
      })).filter(x => x.title).sort((a, b) => (b.cover || b.isbn.length ? 1 : 0) - (a.cover || a.isbn.length ? 1 : 0)).slice(0, 12);
      return send(res, 200, { items });
    } catch { return send(res, 502, { error: 'Каталог книг не ответил. Можно добавить книгу вручную.' }); }
  }
  if (route === 'GET /api/books/cover') {
    const ol = url.searchParams.get('ol'), mine = url.searchParams.get('mine');
    const isbns = String(url.searchParams.get('isbn') || '').split(',').filter(x => /^\d{9}[\dX]$/.test(x)).slice(0, 4);
    let file;
    if ((ol && /^\d{1,12}$/.test(ol)) || isbns.length) {
      const key = ol && /^\d{1,12}$/.test(ol) ? 'ol' + ol : 'isbn' + isbns[0];
      file = path.join(DATA, 'covers', 'cat', key + '.jpg');
      if (!(await fsp.access(file).then(() => true, () => false))) {
        if (noCover.has(key)) return send(res, 404, 'No cover');
        // сначала Amazon по ISBN (быстро), потом Open Library — её картинки лежат на archive.org, который доступен не везде
        const urls = [...isbns.map(i => `https://images-na.ssl-images-amazon.com/images/P/${i}.01.LZZZZZZZ.jpg`), ...(key.startsWith('ol') ? [`https://covers.openlibrary.org/b/id/${ol}-M.jpg?default=false`] : [])];
        let buf = null;
        for (const u of urls) {
          try {
            const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
            const host = new URL(r.url).hostname;
            if (!r.ok || !/(^|\.)(openlibrary\.org|archive\.org|amazon\.com|media-amazon\.com|ssl-images-amazon\.com)$/.test(host) || !/^image\/jpe?g/.test(r.headers.get('content-type') || '')) continue;
            const b = Buffer.from(await r.arrayBuffer());
            if (b.length > 2000 && b.length < 3e6) { buf = b; break; } // у Amazon «нет обложки» — картинка 1×1
          } catch {}
        }
        if (!buf) { noCover.add(key); return send(res, 404, 'No cover'); }
        await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, buf);
      }
    } else if (mine && /^[a-z0-9]{4,24}$/.test(mine)) file = path.join(DATA, 'covers', 'u', sha(user).slice(0, 16), mine + '.jpg');
    else return send(res, 400, 'Bad request');
    try { return send(res, 200, await fsp.readFile(file), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=2592000' }); }
    catch { return send(res, 404, 'No cover'); }
  }
  if (route === 'POST /api/books/cover') {
    const body = await readBody(req, 2e6);
    const id = String(body.id || ''), img = String(body.image || '');
    if (!/^[a-z0-9]{4,24}$/.test(id) || img.length < 100 || img.length > 1.5e6) return send(res, 400, { error: 'Фото не подошло.' });
    const buf = Buffer.from(img, 'base64');
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return send(res, 400, { error: 'Нужен JPEG.' });
    const dir = path.join(DATA, 'covers', 'u', sha(user).slice(0, 16));
    await fsp.mkdir(dir, { recursive: true }); await fsp.writeFile(path.join(dir, id + '.jpg'), buf);
    return send(res, 200, { ok: true });
  }
  if (route === 'GET /api/push/key') return send(res, 200, { key: vapid.publicKey, subs: (pushDb[user]?.subs || []).length });
  if (route === 'POST /api/push/subscribe') {
    const body = await readBody(req, 8e3), sub = body.sub || {};
    if (!push.endpointOk(sub.endpoint) || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') return send(res, 400, { error: 'Этот браузер не поддерживает напоминания.' });
    const rec = pushDb[user] = pushDb[user] || { subs: [], sent: {} };
    rec.tz = Math.max(-840, Math.min(840, Math.round(+body.tz || 0)));
    rec.subs = [...rec.subs.filter(x => x.endpoint !== sub.endpoint), { endpoint: String(sub.endpoint).slice(0, 1000), keys: { p256dh: sub.keys.p256dh.slice(0, 200), auth: sub.keys.auth.slice(0, 100) }, at: new Date().toISOString() }].slice(-5);
    await writeJson(PUSH_FILE, pushDb); return send(res, 200, { ok: true, subs: rec.subs.length });
  }
  if (route === 'POST /api/push/unsubscribe') {
    const body = await readBody(req, 4e3), rec = pushDb[user];
    if (rec) { rec.subs = rec.subs.filter(x => x.endpoint !== body.endpoint); await writeJson(PUSH_FILE, pushDb); }
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/push/test') {
    const rec = pushDb[user]; if (!rec?.subs.length) return send(res, 400, { error: 'На этом аккаунте нет устройств с напоминаниями.' });
    const n = await pushTo(user, { title: 'Напоминания работают', body: 'Так будут выглядеть подсказки Бортжурнала.', url: '/#today' });
    return send(res, n ? 200 : 502, n ? { ok: true, sent: n } : { error: 'Сервис уведомлений не принял сообщение. Попробуй выключить и включить напоминания.' });
  }
  if (route === 'GET /api/state') return send(res, 200, loadState(user));
  if (route === 'PUT /api/state') {
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) return send(res, 400, { error: 'Нет данных.' });
    const cur = loadState(user);
    // защита от перезаписи: сохраняем, только если клиент видел последнюю версию.
    // Проверка и новая версия — синхронно, до записи на диск, поэтому два запроса с одной версией не пройдут оба
    if (body.rev !== cur.rev) return send(res, 409, cur);
    const rec = { rev: cur.rev + 1, savedAt: new Date().toISOString(), state: body.state };
    stateCache.set(user, rec);
    await writeJson(stateFile(user), rec);
    return send(res, 200, { rev: rec.rev, savedAt: rec.savedAt });
  }
  if (route === 'POST /api/password') {
    const body = await readBody(req);
    if (!(await checkPassword(String(body.current || ''), userRec(user)))) return send(res, 401, { error: 'Текущий пароль неверный.' });
    if (String(body.next || '').length < 6) return send(res, 400, { error: 'Новый пароль должен быть не короче 6 символов.' });
    users[user] = { ...users[user], ...(await hashPassword(String(body.next).slice(0, 512))) };
    await writeJson(USERS_FILE, users);
    // выходим на всех остальных устройствах
    const mine = sha(/(?:^|;\s*)bj_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '');
    for (const k of Object.keys(sessions)) if (sessions[k].u === user && k !== mine) delete sessions[k];
    await writeJson(SESSIONS_FILE, sessions);
    return send(res, 200, { ok: true, others: 'closed' });
  }
  return send(res, 404, { error: 'Нет такого метода.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!hostOk(req)) return send(res, 421, 'Unknown host');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = STATIC[url.pathname];
    if (req.method !== 'GET' || !file) return send(res, 404, 'Not found');
    const buf = await fsp.readFile(path.join(ROOT, file));
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] });
  } catch (e) {
    if (!e.code || typeof e.code !== 'number') console.error(e);
    send(res, typeof e.code === 'number' ? e.code : 500, { error: typeof e.code === 'number' ? e.message : 'Ошибка сервера.' });
  }
});

/* ---------- напоминания: раз в минуту проверяем, что пора отправить ---------- */
const push = require('./push.js');
const reminders = require('./reminders.js');
const vapid = push.loadVapid(DATA);
const PUSH_SUBJECT = process.env.PUSH_SUBJECT || 'mailto:bortjournal@localhost';
async function pushTo(user, msg) {
  const rec = pushDb[user]; if (!rec) return 0;
  let ok = 0, changed = false;
  for (const sub of [...rec.subs]) {
    try {
      const r = await push.send(vapid, sub, msg, PUSH_SUBJECT);
      if (r.ok) ok++;
      else if (r.gone) { rec.subs = rec.subs.filter(x => x !== sub); changed = true; }
    } catch (e) { console.error('push:', e.message); }
  }
  if (changed) await writeJson(PUSH_FILE, pushDb);
  return ok;
}
async function remindTick() {
  for (const user of Object.keys(pushDb)) {
    const rec = pushDb[user];
    if (!rec.subs?.length || !userRec(user)) continue;
    const st = loadState(user).state; if (!st) continue;
    const list = reminders.due(st, rec.tz, rec.sent || {});
    if (!list.length) continue;
    rec.sent = rec.sent || {};
    const today = reminders.localNow(rec.tz).ymd;
    for (const m of list.slice(0, 2)) {
      if (await pushTo(user, { title: m.title, body: m.body, url: m.url, tag: m.key })) {
        rec.sent[m.key] = `${today}T${new Date().toISOString().slice(11, 16)}`;
        if (m.key === 'water') rec.sent.waterAt = Date.now();
      }
    }
    // старые отметки не копим
    for (const k of Object.keys(rec.sent)) if (k !== 'waterAt' && !String(rec.sent[k]).startsWith(today)) delete rec.sent[k];
    await writeJson(PUSH_FILE, pushDb);
  }
}
setInterval(() => remindTick().catch(e => console.error('remind:', e.message)), 60 * 1000).unref();

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Порт ${PORT} занят другой программой. Запусти на другом: PORT=4000 npm start`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Бортжурнал запущен: http://localhost:${PORT}`);
  if (HOST === '127.0.0.1' || HOST === 'localhost') console.log('  только на этом компьютере; с телефона — через Tailscale (см. README)');
  if (!canRegister()) console.log('  регистрация закрыта (ALLOW_REGISTER=1 в .env, чтобы открыть)');
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces()))
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  в локальной сети: http://${a.address}:${PORT}`);
  }
  console.log(`Данные: ${DATA}`);
  console.log(`Напоминания: ${Object.values(pushDb).reduce((a, r) => a + (r.subs?.length || 0), 0)} устройств`);
  if (obsidian) console.log(`Obsidian: ${OBS_VAULT} → папка «${process.env.OBSIDIAN_FOLDER || 'Учёба'}», пользователь ${OBS_USER}`);
  console.log(GEMINI_KEY ? `Фото еды: Gemini (${GEMINI_MODELS.join(' → ')})` : 'Фото еды выключено: добавь GEMINI_API_KEY в файл .env');
});
