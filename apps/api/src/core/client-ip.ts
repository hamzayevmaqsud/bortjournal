/**
 * Адрес посетителя для лимитов. X-Forwarded-For слева пишет кто угодно — верим только своим прокси (TRUST_PROXY):
 * число — сколько прокси перед нами, иначе список адресов/подсетей или имена loopback, uniquelocal, linklocal.
 * Пусто — только 127.0.0.1. За туннелем Cloudflare берём CF-Connecting-IP: его ставит сам Cloudflare.
 */
import net from 'node:net';
import type { FastifyRequest } from 'fastify';

const NAMED: Record<string, string[]> = {
  loopback: ['127.0.0.0/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7']
};
const plain = (a: string) => a.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

export type Trust = (addr: string, hop: number) => boolean;

/** функция доверия для Fastify (trustProxy) и для clientIp — одна на оба места */
export function proxyTrust(v = process.env.TRUST_PROXY?.trim() ?? ''): Trust {
  if (v === 'true') return () => true;
  if (/^\d+$/.test(v)) { const n = Number(v); return (_a, hop) => hop < n; }
  const list = new net.BlockList();
  for (const part of (v || '127.0.0.1').split(',').map(x => x.trim()).filter(Boolean)) for (const item of NAMED[part] ?? [part]) {
    const [ip, bits] = item.split('/'), fam = net.isIP(ip ?? '');
    if (!fam) continue;
    const type = fam === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(ip!, type); else list.addSubnet(ip!, Number(bits), type);
  }
  return addr => { const a = plain(addr), fam = net.isIP(a); return !!fam && list.check(a, fam === 6 ? 'ipv6' : 'ipv4'); };
}

// buildApp кладёт сюда ту же функцию, что отдал Fastify: req.ip и clientIp верят одним и тем же прокси
declare module 'fastify' { interface FastifyInstance { proxyTrust?: Trust } }

/** адрес посетителя: пришёл через свой прокси и есть CF-Connecting-IP — он; иначе самый правый чужой адрес цепочки (req.ip) */
export function clientIp(req: FastifyRequest) {
  const peer = req.socket?.remoteAddress ?? '', cf = req.headers['cf-connecting-ip'], trust = req.server?.proxyTrust ?? proxyTrust();
  if (typeof cf === 'string' && net.isIP(cf.trim()) && trust(peer, 0)) return plain(cf.trim());
  return plain(req.ip || peer);
}

/** лимиты в памяти: раз в 10 минут выбрасываем истёкшие записи, иначе Map растёт бесконечно */
export function sweepEvery<V>(map: Map<string, V>, expired: (v: V, now: number) => boolean, ms = 10 * 60e3) {
  const t = setInterval(() => { const now = Date.now(); for (const [k, v] of map) if (expired(v, now)) map.delete(k); }, ms);
  t.unref();
  return () => clearInterval(t);
}
