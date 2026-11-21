'use strict';
// IPv4 アドレス計算ユーティリティ
const IP = {
  parse(s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    const p = m.slice(1).map(Number);
    if (p.some(n => n > 255)) return null;
    return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  },
  str(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); },
  mask(prefix) { return prefix <= 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0; },
  inNet(ip, net, prefix) {
    const m = IP.mask(prefix);
    return ((ip & m) >>> 0) === ((net & m) >>> 0);
  },
  parseCidr(s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^([\d.]+)(?:\/(\d{1,2}))?$/);
    if (!m) return null;
    const ip = IP.parse(m[1]);
    const prefix = m[2] === undefined ? 32 : Number(m[2]);
    if (ip == null || prefix > 32) return null;
    return { ip, prefix };
  },
  isPrivate(ip) {
    return IP.inNet(ip, 0x0A000000, 8) || IP.inNet(ip, 0xAC100000, 12) || IP.inNet(ip, 0xC0A80000, 16);
  },
  isHostAddr(ip, prefix) {
    if (prefix >= 31) return true;
    const hostMask = ~IP.mask(prefix) >>> 0, host = (ip & hostMask) >>> 0;
    return host !== 0 && host !== hostMask;
  },
};
