/**
 * Web Push без зависимостей (перенесено из старого журнала): шифрование сообщения — RFC 8291 (aes128gcm),
 * подпись сервера — VAPID (RFC 8292). Ключи сервера создаются один раз и лежат в файле (VAPID_FILE,
 * по умолчанию data/vapid.json — тот же, что у старой версии, чтобы подписки телефонов остались рабочими).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { Tx } from '../db/index.js';
import { pushSubscriptions } from './schema.js';

const b64u = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString('base64url');
const unb64u = (s: string) => Buffer.from(String(s), 'base64url');
const hmac = (key: Buffer, data: Buffer) => crypto.createHmac('sha256', key).update(data).digest();

// куда можно слать: только известные сервисы push — сервер не ходит по произвольным адресам
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
export function endpointOk(endpoint: string) {
  try {
    const u = new URL(endpoint);
    if (process.env.PUSH_ALLOW_ANY === '1') return /^https?:$/.test(u.protocol); // только для тестов
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname);
  } catch { return false; }
}

export interface Vapid { publicKey: string; privateKey: string }
let cached: Vapid | null = null;
const defaultFile = () => process.env.VAPID_FILE ?? fileURLToPath(new URL('../../../../data/vapid.json', import.meta.url));
export function vapid(file = defaultFile()): Vapid {
  if (cached) return cached;
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); if (v.publicKey && v.privateKey) return (cached = v); } catch { /* создадим */ }
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const v = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
  return (cached = v);
}

function vapidHeader(v: Vapid, endpoint: string, subject: string) {
  const pub = unb64u(v.publicKey);
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: v.privateKey } });
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.publicKey}`;
}

/** RFC 8291: шифруем сообщение ключами подписки браузера */
export function encrypt(payload: string, keys: { p256dh: string; auth: string }) {
  const uaPublic = unb64u(keys.p256dh), authSecret = unb64u(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  const as = crypto.createECDH('prime256v1'); as.generateKeys();
  const asPublic = as.getPublicKey(), shared = as.computeSecret(uaPublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const salt = crypto.randomBytes(16), prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export interface PushMessage { title: string; body: string; url: string; tag?: string }
/** отправка: gone — подписка больше не действует, её надо удалить */
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, msg: PushMessage): Promise<{ ok: boolean; gone: boolean; status?: number }> {
  if (!endpointOk(sub.endpoint)) return { ok: false, gone: true };
  const v = vapid(), body = encrypt(JSON.stringify(msg), { p256dh: sub.p256dh, auth: sub.auth });
  const r = await fetch(sub.endpoint, {
    method: 'POST', body, signal: AbortSignal.timeout(15000),
    headers: { Authorization: vapidHeader(v, sub.endpoint, process.env.PUSH_SUBJECT || 'mailto:bortjournal@localhost'), TTL: '3600', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Urgency: 'normal' }
  });
  return { ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, status: r.status };
}

/** отправить на все устройства человека; отписавшиеся устройства удаляются. Возвращает, на сколько ушло */
export async function pushToUser(db: Tx, userId: string, msg: PushMessage) {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  let sent = 0;
  for (const s of subs) {
    try {
      const r = await sendPush(s, msg);
      if (r.ok) sent++;
      if (r.gone) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    } catch { /* устройство недоступно — попробуем в следующий раз */ }
  }
  return sent;
}
