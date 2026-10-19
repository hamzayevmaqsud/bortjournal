/* ============================================================
   Бортжурнал — Web Push без зависимостей
   Шифрование сообщения — RFC 8291 (aes128gcm), подпись сервера — VAPID (RFC 8292).
   Ключи сервера создаются один раз и лежат в data/vapid.json.
   ============================================================ */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// куда можно слать: только известные сервисы push — сервер не ходит по произвольным адресам
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
function endpointOk(endpoint) {
  try {
    const u = new URL(endpoint);
    if (process.env.PUSH_ALLOW_ANY === '1') return /^https?:$/.test(u.protocol); // только для тестов
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname);
  } catch { return false; }
}

function loadVapid(dataDir) {
  const file = path.join(dataDir, 'vapid.json');
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (v.publicKey && v.privateKey) return v;
  } catch {}
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const v = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
  return v;
}
function vapidKeyObject(v) {
  const pub = unb64u(v.publicKey);
  return crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: v.privateKey } });
}
function vapidHeader(v, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: vapidKeyObject(v), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.publicKey}`;
}

/* RFC 8291: шифруем payload ключами подписки браузера */
function encrypt(payload, keys) {
  const uaPublic = unb64u(keys.p256dh), authSecret = unb64u(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  const as = crypto.createECDH('prime256v1'); as.generateKeys();
  const asPublic = as.getPublicKey(), shared = as.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const salt = crypto.randomBytes(16), prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/* отправка: { ok, gone } — gone, если подписка больше не действует и её надо удалить */
async function send(v, sub, message, subject) {
  if (!endpointOk(sub.endpoint)) return { ok: false, gone: true };
  const body = encrypt(JSON.stringify(message), sub.keys || {});
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: vapidHeader(v, sub.endpoint, subject), TTL: '3600', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Urgency: 'normal' },
    body, signal: AbortSignal.timeout(15000)
  });
  return { ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, status: r.status };
}

module.exports = { loadVapid, send, encrypt, endpointOk, vapidHeader };
