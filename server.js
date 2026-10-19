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
  if (route === 'GET /api/me') return send(res, 200, { username: user });
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
});
