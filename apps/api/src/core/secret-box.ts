/**
 * Шифрование секретов интеграций (токены Google и т. п.) перед записью в базу: AES-256-GCM.
 * Ключ — INTEGRATIONS_KEY (32 байта в base64) или файл data/integrations.key, который создаётся при первом обращении.
 * Ключ лежит вне базы: утёкшая копия базы без него токенов не раскрывает.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const keyFile = () => process.env.INTEGRATIONS_KEY_FILE || fileURLToPath(new URL('../../../../data/integrations.key', import.meta.url));

export function secretKey(): Buffer {
  const fromEnv = process.env.INTEGRATIONS_KEY?.trim();
  if (fromEnv) {
    const k = Buffer.from(fromEnv, 'base64');
    if (k.length !== 32) throw new Error('INTEGRATIONS_KEY — 32 байта в base64');
    return k;
  }
  const file = keyFile();
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  const k = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, k.toString('base64'), { mode: 0o600 });
  return k;
}

/** объект → строка «v1.iv.tag.шифротекст» */
export function seal(value: unknown): string {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function unseal<T>(sealed: string): T {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('секрет повреждён');
  const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')) as T;
}

/** подпись коротких значений (state для OAuth) тем же ключом */
export const sign = (s: string) => crypto.createHmac('sha256', secretKey()).update(s).digest('base64url');
