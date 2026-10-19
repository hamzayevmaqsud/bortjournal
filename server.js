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

// .env в папке проекта: KEY=value построчно (не попадает в git)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (e) { if (e.code !== 'ENOENT') throw e; }

const PORT = +process.env.PORT || 3333;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_DIR = path.join(DATA, 'state');
const USERS_FILE = path.join(DATA, 'users.json');
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const SESSION_DAYS = 90;
const MAX_BODY = 10 * 1024 * 1024;
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/plan.js': 'plan.js' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

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
  return next;
}

let users = readJson(USERS_FILE, {});
let sessions = readJson(SESSIONS_FILE, {});
const stateFile = u => path.join(STATE_DIR, `${u}.json`);

/* ---------- пароли и сессии ---------- */
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function checkPassword(pw, rec) {
  const { hash } = hashPassword(pw, rec.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(rec.hash, 'hex'));
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function newSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[sha(token)] = { u: username, exp: Date.now() + SESSION_DAYS * 864e5 };
  writeJson(SESSIONS_FILE, sessions);
  return token;
}
function sessionUser(req) {
  const m = /(?:^|;\s*)bj_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = sessions[sha(m[1])];
  if (!s || s.exp < Date.now() || !users[s.u]) return null;
  return s.u;
}
function sessionCookie(token, maxAge) {
  return `bj_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
// чистка просроченных сессий раз в час
setInterval(() => {
  const now = Date.now(); let changed = false;
  for (const k of Object.keys(sessions)) if (sessions[k].exp < now) { delete sessions[k]; changed = true; }
  if (changed) writeJson(SESSIONS_FILE, sessions);
}, 36e5).unref();

/* ---------- защита от перебора ---------- */
const attempts = new Map();
function tooMany(ip) {
  const a = attempts.get(ip);
  return a && a.n >= 10 && Date.now() - a.t < 15 * 60e3;
}
function failed(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.t > 15 * 60e3) attempts.set(ip, { n: 1, t: Date.now() });
  else a.n++;
}


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
const FOOD_PROMPT = `Ты нутрициолог. По фото оцени, что съедено, и посчитай калории и БЖУ.
Правила:
- Разбей на отдельные позиции: каждый продукт, соус, масло, напиток — отдельной строкой. Названия по-русски, коротко.
- Для каждой позиции: вес порции в граммах и калории, белки, жиры, углеводы на ВСЮ порцию (не на 100 г). Округляй: граммы до 5, ккал до целых, БЖУ до 0,5.
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
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      source: { type: 'STRING', enum: ['estimate', 'label', 'user'] }
    }, required: ['name', 'grams', 'kcal', 'protein', 'fat', 'carbs', 'confidence', 'source'] } },
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
  const day = new Date().toISOString().slice(0, 10), k = `${user}:${day}`;
  const n = (photoUse.get(k) || 0) + 1; photoUse.set(k, n);
  return n <= (+process.env.PHOTO_DAILY_LIMIT || 60);
}
const numClamp = (v, max) => Math.max(0, Math.min(max, Math.round((+v || 0) * 2) / 2));

async function recognizeFood({ image, mime, note, scale, answers }) {
  const text = [
    FOOD_PROMPT,
    SCALES[scale] || 'Эталона размера в кадре нет.',
    note ? `Подпись пользователя: ${note}` : '',
    answers && answers.length ? `Ответы пользователя на уточнения:\n${answers.map(a => `- ${a}`).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: image } }, { text }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: FOOD_SCHEMA }
  });
  let lastErr;
  for (const model of GEMINI_MODELS) {
    let r;
    try {
      r = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, body,
        signal: AbortSignal.timeout(60e3)
      });
    } catch (err) {
      lastErr = { status: 502, message: err.name === 'TimeoutError' ? 'Gemini не ответил за минуту.' : 'Нет связи с Gemini.' };
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
    let out;
    try { out = JSON.parse(part?.text || ''); } catch { lastErr = { status: 502, message: 'Модель вернула непонятный ответ.' }; continue; }
    const items = (Array.isArray(out.items) ? out.items : []).slice(0, 20).map(it => ({
      name: String(it.name || 'Без названия').slice(0, 80),
      grams: numClamp(it.grams, 3000), kcal: Math.round(numClamp(it.kcal, 6000)),
      p: numClamp(it.protein, 500), f: numClamp(it.fat, 500), c: numClamp(it.carbs, 1000),
      confidence: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'medium',
      source: ['estimate', 'label', 'user'].includes(it.source) ? it.source : 'estimate'
    }));
    const questions = (Array.isArray(out.questions) ? out.questions : []).slice(0, 3).map(q => ({
      text: String(q.text || '').slice(0, 160), options: (Array.isArray(q.options) ? q.options : []).slice(0, 4).map(o => String(o).slice(0, 60))
    })).filter(q => q.text && q.options.length);
    return { isFood: out.is_food !== false && items.length > 0, items, questions, comment: String(out.comment || '').slice(0, 300), model };
  }
  const e = new Error(
    lastErr?.status === 429 ? 'Бесплатный лимит Gemini на сейчас исчерпан. Попробуй через минуту или завтра.' :
    lastErr?.status === 400 || lastErr?.status === 403 ? `Gemini отклонил запрос: ${lastErr.message}` :
    lastErr?.message || 'Gemini недоступен.');
  e.code = lastErr?.status === 429 ? 429 : 502;
  throw e;
}

/* ---------- HTTP ---------- */
function send(res, code, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(code, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : headers['Content-Type'] || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(isJson ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('Ожидается JSON'), { code: 415 }));
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Слишком большой запрос'), { code: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Битый JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}
const USER_RE = /^[a-z0-9_.-]{3,32}$/;

async function api(req, res, url) {
  const ip = req.socket.remoteAddress;
  const route = `${req.method} ${url.pathname}`;

  if (route === 'POST /api/register' || route === 'POST /api/login') {
    if (tooMany(ip)) return send(res, 429, { error: 'Слишком много попыток. Подожди 15 минут.' });
    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (route === 'POST /api/register') {
      if (!USER_RE.test(username)) return send(res, 400, { error: 'Логин: 3–32 символа, латиница, цифры, точка, дефис или подчёркивание.' });
      if (password.length < 6) return send(res, 400, { error: 'Пароль должен быть не короче 6 символов.' });
      if (users[username]) return send(res, 409, { error: 'Такой логин уже занят.' });
      users[username] = { ...hashPassword(password), created: new Date().toISOString() };
      await writeJson(USERS_FILE, users);
    } else {
      const rec = users[username];
      if (!rec || !checkPassword(password, rec)) { failed(ip); return send(res, 401, { error: 'Неверный логин или пароль.' }); }
    }
    attempts.delete(ip);
    const token = newSession(username);
    return send(res, 200, { username }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
  }

  const user = sessionUser(req);
  if (!user) return send(res, 401, { error: 'Нужно войти.' });

  if (route === 'POST /api/logout') {
    const m = /(?:^|;\s*)bj_session=([^;]+)/.exec(req.headers.cookie || '');
    if (m) { delete sessions[sha(m[1])]; await writeJson(SESSIONS_FILE, sessions); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (route === 'GET /api/me') return send(res, 200, { username: user, photo: !!GEMINI_KEY });
  if (route === 'POST /api/food/photo') {
    if (!GEMINI_KEY) return send(res, 503, { error: 'Распознавание не настроено: на сервере нет GEMINI_API_KEY.' });
    if (!photoQuota(user)) return send(res, 429, { error: 'На сегодня лимит фото исчерпан.' });
    const body = await readBody(req);
    const mime = String(body.mime || '');
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return send(res, 400, { error: 'Нужна картинка JPEG, PNG или WebP.' });
    if (typeof body.image !== 'string' || body.image.length < 100 || body.image.length > 8e6) return send(res, 400, { error: 'Фото пустое или слишком большое.' });
    const out = await recognizeFood({
      image: body.image, mime,
      note: String(body.note || '').slice(0, 300),
      scale: String(body.scale || ''),
      answers: (Array.isArray(body.answers) ? body.answers : []).slice(0, 5).map(a => String(a).slice(0, 200))
    });
    return send(res, 200, out);
  }
  if (route === 'GET /api/state') {
    const rec = readJson(stateFile(user), { rev: 0, state: null });
    return send(res, 200, rec);
  }
  if (route === 'PUT /api/state') {
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return send(res, 400, { error: 'Нет данных.' });
    const cur = readJson(stateFile(user), { rev: 0, state: null });
    // защита от перезаписи: сохраняем, только если клиент видел последнюю версию
    if (body.rev !== cur.rev) return send(res, 409, cur);
    const rec = { rev: cur.rev + 1, savedAt: new Date().toISOString(), state: body.state };
    await writeJson(stateFile(user), rec);
    return send(res, 200, { rev: rec.rev, savedAt: rec.savedAt });
  }
  if (route === 'POST /api/password') {
    const body = await readBody(req);
    if (!checkPassword(String(body.current || ''), users[user])) return send(res, 401, { error: 'Текущий пароль неверный.' });
    if (String(body.next || '').length < 6) return send(res, 400, { error: 'Новый пароль должен быть не короче 6 символов.' });
    users[user] = { ...users[user], ...hashPassword(String(body.next)) };
    await writeJson(USERS_FILE, users);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Нет такого метода.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
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

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Порт ${PORT} занят другой программой. Запусти на другом: PORT=4000 npm start`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Бортжурнал запущен: http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces()))
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  в локальной сети: http://${a.address}:${PORT}`);
  }
  console.log(`Данные: ${DATA}`);
  console.log(GEMINI_KEY ? `Фото еды: Gemini (${GEMINI_MODELS.join(' → ')})` : 'Фото еды выключено: добавь GEMINI_API_KEY в файл .env');
});
