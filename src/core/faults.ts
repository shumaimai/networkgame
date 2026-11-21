// トラブル対応で仕込む不具合の一覧
// apply は机の上の状態を書き換え、何を壊したかの説明を返す。その構成に当てはまらなければ null
import { ipStr, parseIp } from './ip';
import { Rng, pick } from './job';
import { Device, GwCfg, L3Cfg, ServerCfg, SwitchCfg, World, isEndpoint, isGateway } from './model';

export interface Fault { key: string; weight: number; apply: (w: World, r: Rng) => string | null }

const bump = (s: string, delta: number): string => { const n = parseIp(s); return n == null ? s : ipStr(n + delta); };
const some = <T>(r: Rng, list: T[]): T | null => (list.length ? pick(r, list) : null);
const statics = (w: World): Device[] => w.devices.filter(d => isEndpoint(d.kind) && d.cfg.mode === 'static' && d.cfg.ip);
const pcs = (w: World): Device[] => w.devices.filter(d => d.kind === 'pc');
const servers = (w: World, f: (c: ServerCfg) => boolean): Device[] => w.devices.filter(d => (d.kind === 'server' || d.kind === 'nas') && f(d.cfg));
const gws = (w: World): Device[] => w.devices.filter(d => isGateway(d.kind));
const cableOf = (w: World, d: Device) => w.cables.findIndex(c => c.a.dev === d.id || c.b.dev === d.id);
const kindOf = (w: World, id: string) => w.devices.find(d => d.id === id)!.kind;

export const faultCatalog: Fault[] = [
  { key: 'unplug-host', weight: 1, apply: (w, r) => {
    const d = some(r, w.devices.filter(x => isEndpoint(x.kind) && cableOf(w, x) >= 0));
    if (!d) return null;
    w.cables.splice(cableOf(w, d), 1);
    return `${d.name} のケーブルが抜けている`;
  } },
  { key: 'unplug-uplink', weight: 1, apply: (w, r) => {
    const i = some(r, w.cables.map((c, n) => (!isEndpoint(kindOf(w, c.a.dev)) && !isEndpoint(kindOf(w, c.b.dev)) ? n : -1)).filter(n => n >= 0));
    if (i == null) return null;
    const c = w.cables[i], a = w.devices.find(d => d.id === c.a.dev)!, b = w.devices.find(d => d.id === c.b.dev)!;
    w.cables.splice(i, 1);
    return `${a.name} と ${b.name} の間のケーブルが抜けている`;
  } },
  { key: 'wan-port', weight: 2, apply: w => {
    const c = w.cables.find(x => x.a.dev === 'inet' || x.b.dev === 'inet');
    if (!c) return null;
    const end = c.a.dev === 'inet' ? c.b : c.a, g = w.devices.find(d => d.id === end.dev)!;
    const free = g.ports.findIndex((_, i) => i > 0 && !w.cables.some(x => (x.a.dev === g.id && x.a.port === i) || (x.b.dev === g.id && x.b.port === i)));
    if (free < 0) return null;
    end.port = free;
    return `回線が ${g.name} の ${g.ports[free]} ポートに挿さっている(正しくは ${g.ports[0]})`;
  } },
  { key: 'ip-other-net', weight: 1, apply: (w, r) => {
    const d = some(r, statics(w));
    if (!d) return null;
    const old = d.cfg.ip;
    d.cfg.ip = bump(old, d.cfg.prefix === 24 ? 256 * 10 : 2 ** (32 - d.cfg.prefix));
    return `${d.name} のIPアドレスが別のネットワークのもの(${d.cfg.ip})になっている。正しくは ${old} など`;
  } },
  { key: 'ip-dup', weight: 2, apply: (w, r) => {
    const l = statics(w), d = some(r, l);
    const o = d && l.find(x => x !== d && x.cfg.gw === d.cfg.gw && x.cfg.prefix === d.cfg.prefix);
    if (!d || !o) return null;
    const old = d.cfg.ip;
    d.cfg.ip = o.cfg.ip;
    return `${d.name} のIPアドレスが ${o.name} と同じ(${o.cfg.ip})になっている。元は ${old}`;
  } },
  { key: 'gw-wrong', weight: 2, apply: (w, r) => {
    const d = some(r, statics(w).filter(x => x.cfg.gw));
    if (!d) return null;
    const old = d.cfg.gw;
    d.cfg.gw = bump(old, /\.1$/.test(old) ? 253 : -3);
    return `${d.name} のデフォルトゲートウェイが違う(${d.cfg.gw})。正しくは ${old}`;
  } },
  { key: 'mask-wrong', weight: 3, apply: (w, r) => {
    const d = some(r, statics(w).filter(x => x.cfg.gw && x.cfg.prefix === 24 && (parseIp(x.cfg.ip)! & 128) !== (parseIp(x.cfg.gw)! & 128)));
    if (!d) return null;
    d.cfg.prefix = 25;
    return `${d.name} のサブネットマスクが /25 になっていて、ゲートウェイが自分のネットワークの外に見えている。正しくは /24`;
  } },
  { key: 'dns-typo', weight: 2, apply: (w, r) => {
    const d = some(r, pcs(w).filter(x => x.cfg.mode === 'static' && x.cfg.dns));
    if (!d) return null;
    const old = d.cfg.dns;
    d.cfg.dns = old === '8.8.8.8' ? '8.8.4.8' : bump(old, 1);
    return `${d.name} のDNSサーバーが打ち間違い(${d.cfg.dns})。正しくは ${old}`;
  } },
  { key: 'stale-static', weight: 2, apply: (w, r) => {
    const d = some(r, pcs(w).filter(x => x.cfg.mode === 'dhcp'));
    if (!d) return null;
    Object.assign(d.cfg, { mode: 'static', ip: '192.168.0.25', prefix: 24, gw: '192.168.0.1', dns: '192.168.0.1' });
    return `${d.name} が「自動取得」ではなく、よそで使っていた固定のアドレス(192.168.0.25)のままになっている`;
  } },
  { key: 'dhcp-off', weight: 2, apply: w => {
    for (const g of gws(w)) for (const l of (g.cfg as GwCfg).lan) if (l.dhcpOn) { l.dhcpOn = false; return `${g.name} のDHCPがオフになっている`; }
    const s = servers(w, c => c.dhcpOn)[0];
    if (!s) return null;
    s.cfg.dhcpOn = false;
    return `${s.name} のDHCPサービスが止まっている`;
  } },
  { key: 'dhcp-small', weight: 3, apply: w => {
    for (const g of gws(w)) for (const l of (g.cfg as GwCfg).lan) if (l.dhcpOn) { const old = l.dhcpEnd; l.dhcpEnd = l.dhcpStart; return `${g.name} のDHCPの配布範囲が1個しかない。終わりは ${old} など`; }
    const s = servers(w, c => c.dhcpOn && c.pools.length > 0)[0];
    if (!s) return null;
    const p = (s.cfg as ServerCfg).pools[0], old = p.end;
    p.end = p.start;
    return `${s.name} のDHCPの配布範囲(${p.start}〜)が1個しかない。終わりは ${old} など`;
  } },
  { key: 'dhcp-gw', weight: 3, apply: w => {
    const s = servers(w, c => c.dhcpOn && c.pools.some(p => !!p.gw))[0];
    if (!s) return null;
    const p = (s.cfg as ServerCfg).pools.find(x => !!x.gw)!, old = p.gw;
    p.gw = bump(old, /\.254$/.test(old) ? -4 : 4);
    return `${s.name} のDHCPが配るゲートウェイが違う(${p.gw})。正しくは ${old}`;
  } },
  { key: 'dhcp-dns', weight: 3, apply: w => {
    for (const g of gws(w)) for (const l of (g.cfg as GwCfg).lan) if (l.dhcpOn && l.dhcpDns) { const old = l.dhcpDns; l.dhcpDns = old === '8.8.8.8' ? '8.8.4.8' : bump(old, 1); return `${g.name} のDHCPが配るDNSサーバーが違う(${l.dhcpDns})。正しくは ${old}`; }
    return null;
  } },
  { key: 'relay-missing', weight: 3, apply: w => {
    for (const d of w.devices) if (d.kind === 'l3') { const s = (d.cfg as L3Cfg).svis.find(x => x.relay); if (s) { const old = s.relay; s.relay = ''; return `${d.name} のVLAN${s.vlan}にDHCPリレーが設定されていない。転送先は ${old}`; } }
    return null;
  } },
  { key: 'lan-ip', weight: 2, apply: w => {
    const g = gws(w).find(x => (x.cfg as GwCfg).lan.some(l => l.ip && !l.dhcpOn && l.prefix === 24));
    if (!g) return null;
    const l = (g.cfg as GwCfg).lan.find(x => x.ip && !x.dhcpOn && x.prefix === 24)!, old = l.ip;
    l.ip = bump(old, 9);
    return `${g.name} のLAN側のIPアドレスが ${l.ip} になっている。端末が指しているゲートウェイは ${old}`;
  } },
  { key: 'route-missing', weight: 3, apply: (w, r) => {
    const d = some(r, w.devices.filter(x => (x.cfg.routes?.length ?? 0) > 0));
    if (!d) return null;
    const gone = d.cfg.routes.pop();
    return `${d.name} のスタティックルート ${gone.dest} → ${gone.via} が消えている`;
  } },
  { key: 'route-hop', weight: 3, apply: (w, r) => {
    const d = some(r, w.devices.filter(x => (x.cfg.routes?.length ?? 0) > 0));
    if (!d) return null;
    const rt = d.cfg.routes[0], old = rt.via;
    rt.via = bump(old, 4);
    return `${d.name} のルート ${rt.dest} のネクストホップが違う(${rt.via})。正しくは ${old}`;
  } },
  { key: 'vlan-port', weight: 3, apply: (w, r) => {
    const d = some(r, w.devices.filter(x => x.kind === 'l3' || x.kind === 'l2m'));
    if (!d) return null;
    const c = d.cfg as SwitchCfg;
    const used = c.portVlan.map((v, i) => (v !== 99 && c.portMode[i] !== 'trunk' && w.cables.some(x => (x.a.dev === d.id && x.a.port === i) || (x.b.dev === d.id && x.b.port === i)) ? i : -1)).filter(i => i >= 0);
    const i = some(r, used);
    const other = i == null ? undefined : used.map(k => c.portVlan[k]).find(v => v !== c.portVlan[i]);
    if (i == null || other === undefined) return null;
    const old = c.portVlan[i];
    c.portVlan[i] = other;
    return `${d.name} のポート${i + 1}のVLANが ${other} になっている。正しくは ${old}`;
  } },
  { key: 'trunk-access', weight: 3, apply: (w, r) => {
    const d = some(r, w.devices.filter(x => (x.kind === 'l3' || x.kind === 'l2m') && (x.cfg as SwitchCfg).portMode.includes('trunk')));
    if (!d) return null;
    const c = d.cfg as SwitchCfg, i = c.portMode.indexOf('trunk');
    c.portMode[i] = 'access';
    return `${d.name} のポート${i + 1}がトランクになっていない(相手側はトランク)`;
  } },
  { key: 'wifi-key', weight: 2, apply: w => {
    const d = w.devices.find(x => x.kind === 'pc' && x.cfg.wifi?.ssid);
    if (!d) return null;
    const old = d.cfg.wifi.key;
    d.cfg.wifi.key = old.slice(0, -1) + (old.endsWith('0') ? '1' : '0');
    return `${d.name} の無線LANの暗号化キーが違う(${d.cfg.wifi.key})。正しくは ${old}`;
  } },
  { key: 'wifi-ssid', weight: 2, apply: w => {
    const ap = w.devices.find(x => x.kind === 'ap' && x.cfg.ssid);
    if (!ap) return null;
    const old = ap.cfg.ssid;
    ap.cfg.ssid = old.replace('-wifi', '-guest');
    return `${ap.name} のSSIDが違う(${ap.cfg.ssid})。正しくは ${old}`;
  } },
  { key: 'vpn-key', weight: 2, apply: w => {
    const g = gws(w).find(x => (x.cfg as GwCfg).vpn?.on);
    if (!g) return null;
    const old = g.cfg.vpn.key;
    g.cfg.vpn.key = old + '0';
    return `${g.name} のVPNの認証キーが違う(${g.cfg.vpn.key})。自宅PCのキーは ${old}`;
  } },
  { key: 'vpn-addr', weight: 3, apply: w => {
    const g = gws(w).find(x => (x.cfg as GwCfg).vpn?.on);
    if (!g) return null;
    const old = g.cfg.vpn.ip;
    g.cfg.vpn.ip = '10.99.0.5';
    return `${g.name} がVPNで配るアドレス(10.99.0.5)が、LANの範囲にない。元は ${old}`;
  } },
  { key: 'mail-off', weight: 1, apply: w => {
    const s = servers(w, c => c.mailOn)[0];
    if (!s) return null;
    s.cfg.mailOn = false;
    return `${s.name} のメールサービスが止まっている`;
  } },
  { key: 'record-wrong', weight: 2, apply: (w, r) => {
    const s = some(r, servers(w, c => c.dnsOn && c.records.length > 0));
    if (!s) return null;
    const rec = pick(r, (s.cfg as ServerCfg).records), old = rec.ip;
    rec.ip = bump(old, 7);
    return `${s.name} のDNSレコード ${rec.name} が古いアドレス(${rec.ip})を指している。正しくは ${old}`;
  } },
  { key: 'forwarder', weight: 2, apply: w => {
    const s = servers(w, c => c.dnsOn && !!c.forwarder)[0];
    if (!s) return null;
    s.cfg.forwarder = '';
    return `${s.name} のDNSにフォワーダーが設定されていない(8.8.8.8 など)`;
  } },
  { key: 'dns-off', weight: 1, apply: w => {
    const s = servers(w, c => c.dnsOn)[0];
    if (!s) return null;
    s.cfg.dnsOn = false;
    return `${s.name} のDNSサービスが止まっている`;
  } },
  { key: 'proxy-port', weight: 2, apply: w => {
    const s = servers(w, c => c.proxyOn)[0];
    if (!s) return null;
    s.cfg.proxyPort = 3128;
    return `${s.name} のプロキシの待受ポートが 3128 になっている。PC側の設定は 8080`;
  } },
  { key: 'proxy-allow', weight: 3, apply: w => {
    const s = servers(w, c => c.proxyOn)[0], p = pcs(w).find(x => x.cfg.proxy && x.cfg.mode === 'static');
    if (!s || !p) return null;
    s.cfg.proxyAllow = bump(p.cfg.ip, 256 * 3).replace(/\.\d+$/, '.0') + '/24';
    return `${s.name} のプロキシの「利用を許可」が別のネットワーク(${s.cfg.proxyAllow})になっている`;
  } },
  { key: 'pc-proxy', weight: 1, apply: (w, r) => {
    const d = some(r, pcs(w).filter(x => x.cfg.proxy));
    if (!d) return null;
    const old = d.cfg.proxy;
    d.cfg.proxy = '';
    return `${d.name} にプロキシが設定されていない。正しくは ${old}`;
  } },
  { key: 'rule-order', weight: 3, apply: w => {
    for (const d of w.devices) {
      const rules = d.cfg.rules as { action: string }[] | undefined;
      const i = rules ? rules.findIndex(x => x.action === 'deny') : -1;
      if (rules && i > 0 && rules.slice(0, i).some(x => x.action === 'allow')) { rules.unshift(rules.splice(i, 1)[0]); return `${d.name} のルールの順番が違う。拒否ルールが許可ルールより先に評価されている`; }
    }
    return null;
  } },
  { key: 'rule-missing', weight: 3, apply: (w, r) => {
    const d = some(r, w.devices.filter(x => (x.cfg.rules?.length ?? 0) > 0));
    if (!d) return null;
    const i = Math.floor(r() * d.cfg.rules.length), gone = d.cfg.rules.splice(i, 1)[0];
    return `${d.name} のルール「${gone.action === 'allow' ? '許可' : '拒否'} ${gone.src} → ${gone.dst}」が消えている`;
  } },
  { key: 'forward', weight: 2, apply: w => {
    const g = gws(w).find(x => (x.cfg as GwCfg).forwards.length > 0);
    if (!g) return null;
    const f = (g.cfg as GwCfg).forwards[0], old = f.to;
    f.to = bump(old, 1);
    return `${g.name} のポート転送の宛先が違う(${f.to})。正しくは ${old}`;
  } },
  { key: 'nat-off', weight: 3, apply: w => {
    const g = gws(w).find(x => w.cables.some(c => (c.a.dev === x.id && c.a.port === 0) || (c.b.dev === x.id && c.b.port === 0)));
    if (!g) return null;
    g.cfg.nat = false;
    return `${g.name} のNATがオフになっている`;
  } },
  { key: 'file-allow', weight: 2, apply: w => {
    const s = servers(w, c => c.fileOn && !!c.fileAllow)[0];
    if (!s) return null;
    const old = s.cfg.fileAllow;
    s.cfg.fileAllow = '192.168.250.0/24';
    return `${s.name} のファイル共有の「利用を許可」が別のネットワークになっている。正しくは ${old}`;
  } },
  { key: 'file-off', weight: 1, apply: w => {
    const s = w.devices.find(d => d.kind === 'server' && d.cfg.fileOn);
    if (!s) return null;
    s.cfg.fileOn = false;
    return `${s.name} のファイル共有が止まっている`;
  } },
  { key: 'web-off', weight: 1, apply: w => {
    const s = servers(w, c => c.webOn)[0];
    if (!s) return null;
    s.cfg.webOn = false;
    return `${s.name} のWebサービスが止まっている`;
  } },
];
