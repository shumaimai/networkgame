// IPv4 アドレス計算
export interface Cidr { ip: number; prefix: number }

export function parseIp(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some(n => n > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
export const ipStr = (n: number): string => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
export const maskOf = (prefix: number): number => (prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
export const netOf = (ip: number, prefix: number): number => (ip & maskOf(prefix)) >>> 0;
export const inNet = (ip: number, net: number, prefix: number): boolean => netOf(ip, prefix) === netOf(net, prefix);
export const inCidr = (ip: number, c: Cidr): boolean => inNet(ip, c.ip, c.prefix);

export function parseCidr(s: unknown): Cidr | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (/^(any|all|すべて|모두|\*)$/i.test(t)) return { ip: 0, prefix: 0 };
  const m = t.match(/^([\d.]+)(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const ip = parseIp(m[1]);
  const prefix = m[2] === undefined ? 32 : Number(m[2]);
  if (ip == null || prefix > 32) return null;
  return { ip, prefix };
}
export const parseCidrList = (s: unknown): Cidr[] =>
  String(s ?? '').split(/[\s,、]+/).filter(Boolean).map(parseCidr).filter((c): c is Cidr => !!c);

const PRIVATE: Cidr[] = [{ ip: 0x0a000000, prefix: 8 }, { ip: 0xac100000, prefix: 12 }, { ip: 0xc0a80000, prefix: 16 }];
export const isPrivate = (ip: number): boolean => PRIVATE.some(c => inCidr(ip, c));

// ネットワークアドレス・ブロードキャストアドレスはホストに使えない
export function isHostAddr(ip: number, prefix: number): boolean {
  if (prefix >= 31) return true;
  const hostMask = ~maskOf(prefix) >>> 0, host = (ip & hostMask) >>> 0;
  return host !== 0 && host !== hostMask;
}
export const cidrStr = (ip: number, prefix: number): string => `${ipStr(netOf(ip, prefix))}/${prefix}`;
export const hostCount = (prefix: number): number => (prefix >= 31 ? 0 : 2 ** (32 - prefix) - 2);
