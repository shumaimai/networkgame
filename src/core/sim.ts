// ネットワークシミュレータ(画面に依存しない)
// L2: ケーブル、スイッチ、VLAN(アクセス/トランク)、無線をグラフとして扱い、同じ区画(セグメント)を求める
// L3: ホストのゲートウェイ、経路表、NAT、ポート転送、フィルタールールを評価する
// サービス: DHCP、DNS(レコード・フォワーダー)、プロキシ、Web、ファイル共有など
import { inCidr, inNet, ipStr, isHostAddr, isPrivate, parseCidr, parseCidrList, parseIp } from './ip';
import { Cable, Device, GwCfg, L3Cfg, Pool, Rule, ServerCfg, Svc, SVC, SwitchCfg, isGateway, isHost, isRouting } from './model';

export const WAN_IP = parseIp('203.0.113.2')!;
export const ISP_IP = parseIp('203.0.113.1')!;
export const WAN_PREFIX = 30;
export const PUBLIC_DNS = '8.8.8.8';
/** インターネット側から接続してくる利用者のアドレス(公開サーバーの確認に使う) */
export const REMOTE_IP = parseIp('198.51.100.200')!;
export const EXTERNAL: Record<string, string> = {
  'www.example.com': '93.184.216.34',
  'mail.example.net': '198.51.100.25',
  'update.example.org': '198.51.100.80',
};

export interface Eff {
  ip: number | null; prefix: number; gw: number | null; dns: number | null;
  dhcp: boolean;
  /** DHCPで配ってくれた機器の名前 */
  lease?: string;
  /** アドレスを取得できなかった理由 */
  note?: string;
  /** 無線でつながっているアクセスポイント */
  ap?: string;
}
export interface Iface { dev: Device; name: string; ip: number; prefix: number; node: string; seg: string; wan?: boolean }
export interface Seg { cable: string; rev: boolean }
export interface TraceItem { label: string; kind: Svc; ok: boolean; hops: string[]; path: Seg[]; back: Seg[]; failAt?: string }
interface Edge { to: string; cable: string | null; rev: boolean }
export interface Net {
  devices: Device[];
  byId: Map<string, Device>;
  ifaces: Iface[];
  eff: Map<string, Eff>;
  adj: Map<string, Edge[]>;
  trace: TraceItem[] | null;
  /** ループで通信できなくなっている区画 */
  storm: Set<string>;
}
export type Fail = { ok: false; reason: string };
const fail = <T extends object>(reason: string, extra?: T): Fail & T => ({ ok: false, reason, ...(extra as T) });

const hasDns = (d: Device): boolean => d.kind === 'server' && !!d.cfg.dnsOn;
const hasProxy = (d: Device): boolean => d.kind === 'server' && !!d.cfg.proxyOn;
const proxyAllows = (px: Device, ip: number): boolean => {
  const l = parseCidrList(px.cfg.proxyAllow);
  return !l.length || l.some(c => inCidr(ip, c));
};

export function build(devices: Device[], cables: Cable[], opts: { trace?: boolean } = {}): Net {
  const parent = new Map<string, string>(), adj = new Map<string, Edge[]>();
  const find = (k: string): string => {
    let r = k;
    for (;;) {
      const p = parent.get(r);
      if (p === undefined) { parent.set(r, r); break; }
      if (p === r) break;
      r = p;
    }
    for (let c = k; c !== r;) { const p = parent.get(c)!; parent.set(c, r); c = p; }
    return r;
  };
  const edge = (a: string, e: Edge) => { const l = adj.get(a); if (l) l.push(e); else adj.set(a, [e]); };
  const link = (a: string, b: string, cable: string | null = null) => {
    parent.set(find(a), find(b));
    edge(a, { to: b, cable, rev: false });
    edge(b, { to: a, cable, rev: true });
  };
  const byId = new Map(devices.map(d => [d.id, d]));
  const cabled = new Set<string>();

  // フレームに付くタグ: 'u'(タグなし) と、使われているVLAN番号
  const vlans = new Set<number>([1]);
  for (const d of devices) {
    if (d.kind !== 'l2m' && d.kind !== 'l3') continue;
    for (const v of (d.cfg as SwitchCfg).portVlan) vlans.add(Number(v) || 1);
    if (d.kind === 'l3') for (const s of (d.cfg as L3Cfg).svis) vlans.add(Number(s.vlan) || 1);
  }
  const tags: (string | number)[] = ['u', ...vlans];
  const w = (d: string, p: number, t: string | number) => `w:${d}:${p}:${t}`;
  const sw = (d: string, t: string | number) => `s:${d}:${t}`;

  for (const c of cables) {
    if (!byId.has(c.a.dev) || !byId.has(c.b.dev)) continue;
    cabled.add(c.a.dev + ':' + c.a.port); cabled.add(c.b.dev + ':' + c.b.port);
    for (const t of tags) link(w(c.a.dev, c.a.port, t), w(c.b.dev, c.b.port, t), c.id);
  }
  for (const d of devices) {
    if (d.kind === 'l2' || d.kind === 'ap') {
      d.ports.forEach((_, i) => { for (const t of tags) link(w(d.id, i, t), sw(d.id, t)); });
    } else if (d.kind === 'l2m' || d.kind === 'l3') {
      const c = d.cfg as SwitchCfg;
      d.ports.forEach((_, i) => {
        if (c.portMode[i] === 'trunk') {
          for (const v of vlans) link(w(d.id, i, v), sw(d.id, v));
          link(w(d.id, i, 'u'), sw(d.id, 1));
        } else link(w(d.id, i, 'u'), sw(d.id, Number(c.portVlan[i]) || 1));
      });
    }
  }

  // 無線: ケーブルのつながっていないPCは、SSIDとキーが合うアクセスポイントにつながる
  const eff = new Map<string, Eff>();
  const hostNode = new Map<string, string>();
  const aps = devices.filter(d => d.kind === 'ap' && d.cfg.ssid);
  for (const d of devices) {
    if (!isHost(d.kind)) continue;
    if (d.kind === 'home') { eff.set(d.id, { ip: null, prefix: 24, gw: null, dns: parseIp(d.cfg.dns), dhcp: false, note: 'VPNの接続先が設定されていません' }); continue; }
    let node = w(d.id, 0, 'u'), apName: string | undefined;
    const wifi = d.cfg.wifi;
    if (d.kind === 'pc' && wifi && wifi.ssid && !cabled.has(d.id + ':0')) {
      const ap = aps.find(a => a.cfg.ssid === wifi.ssid && a.cfg.key === wifi.key);
      if (ap) { node = `wl:${d.id}`; link(node, sw(ap.id, 'u')); apName = ap.name; }
    }
    hostNode.set(d.id, node);
    const c = d.cfg;
    const dhcp = c.mode === 'dhcp' && d.kind !== 'server' && d.kind !== 'nas';
    eff.set(d.id, dhcp
      ? { ip: null, prefix: 24, gw: null, dns: null, dhcp: true, ap: apName }
      : { ip: parseIp(c.ip), prefix: Number(c.prefix), gw: parseIp(c.gw), dns: parseIp(c.dns), dhcp: false, ap: apName });
  }

  const ifaces: Iface[] = [];
  const add = (dev: Device, name: string, node: string, ip: number | null, prefix: number, wan = false) => {
    if (ip == null) return;
    ifaces.push({ dev, name, ip, prefix: Number(prefix), node, seg: find(node), wan: wan || undefined });
  };
  for (const d of devices) {
    if (d.kind === 'home') continue;
    if (isHost(d.kind)) { const e = eff.get(d.id)!; if (!e.dhcp) add(d, 'eth0', hostNode.get(d.id)!, e.ip, e.prefix); }
    else if (d.kind === 'internet') add(d, 'ISP', w(d.id, 0, 'u'), ISP_IP, WAN_PREFIX);
    else if (isGateway(d.kind)) {
      const c = d.cfg as GwCfg;
      if (c.wan.mode === 'auto') add(d, d.ports[0], w(d.id, 0, 'u'), WAN_IP, WAN_PREFIX, true);
      else add(d, d.ports[0], w(d.id, 0, 'u'), parseIp(c.wan.ip), c.wan.prefix, true);
      c.lan.forEach((l, i) => add(d, d.ports[i + 1], w(d.id, i + 1, 'u'), parseIp(l.ip), l.prefix));
    } else if (d.kind === 'l3') {
      for (const s of (d.cfg as L3Cfg).svis) add(d, 'VLAN' + s.vlan, sw(d.id, Number(s.vlan) || 1), parseIp(s.ip), s.prefix);
    }
  }

  // VPN: 自宅PCは、接続先と認証キーが合えば、VPN装置のLANにいる端末として扱う
  const isp = ifaces.find(i => i.dev.kind === 'internet');
  for (const d of devices) {
    if (d.kind !== 'home') continue;
    const e = eff.get(d.id)!, target = parseIp(d.cfg.vpn?.server);
    if (target == null) continue;
    const wan = ifaces.find(i => i.wan && i.ip === target && isp && i.seg === isp.seg);
    const v = wan ? (wan.dev.cfg as GwCfg).vpn : undefined;
    if (!wan) { e.note = `接続先 ${ipStr(target)} に応答する機器がありません`; continue; }
    if (!v?.on) { e.note = `${wan.dev.name} でVPNが動いていません`; continue; }
    if (v.key !== d.cfg.vpn.key || !v.key) { e.note = '認証キーが違います'; continue; }
    const vip = parseIp(v.ip), lan = vip == null ? undefined : ifaces.find(i => i.dev === wan.dev && !i.wan && inNet(vip, i.ip, i.prefix));
    if (vip == null || !lan) { e.note = `${wan.dev.name} がVPNで配るアドレスが、LANの範囲にありません`; continue; }
    const node = `vpn:${d.id}`;
    link(node, lan.node);
    e.ip = vip; e.prefix = lan.prefix; e.gw = lan.ip; e.note = undefined; e.lease = wan.dev.name;
    add(d, 'vpn', node, vip, lan.prefix);
  }

  // DHCP: 同じ区画にいるDHCPサーバー(またはリレー先)からアドレスを受け取る
  interface Offer { seg: string; by: string; pool: Pool; next: number }
  const offers: Offer[] = [];
  const offer = (seg: string, by: string, pool: Pool) => {
    const start = parseIp(pool.start);
    if (start != null && parseIp(pool.end) != null) offers.push({ seg, by, pool, next: start });
  };
  for (const d of devices) {
    if (d.kind === 'server' && d.cfg.dhcpOn) {
      const si = ifaces.find(i => i.dev === d);
      if (si) for (const p of (d.cfg as ServerCfg).pools) {
        const s = parseIp(p.start);
        if (s != null && inNet(s, si.ip, si.prefix)) offer(si.seg, d.name, p);
      }
    } else if (isGateway(d.kind)) {
      (d.cfg as GwCfg).lan.forEach((l, i) => {
        const li = ifaces.find(x => x.dev === d && x.name === d.ports[i + 1]);
        if (li && l.dhcpOn) offer(li.seg, d.name, { start: l.dhcpStart, end: l.dhcpEnd, prefix: l.prefix, gw: l.ip, dns: l.dhcpDns });
      });
    } else if (d.kind === 'l3') {
      for (const s of (d.cfg as L3Cfg).svis) {
        const relay = parseIp(s.relay), si = ifaces.find(i => i.dev === d && i.name === 'VLAN' + s.vlan);
        if (relay == null || !si) continue;
        const srv = ifaces.find(i => i.ip === relay && i.dev.kind === 'server' && i.dev.cfg.dhcpOn);
        if (!srv) continue;
        const p = (srv.dev.cfg as ServerCfg).pools.find(q => { const a = parseIp(q.start); return a != null && inNet(a, si.ip, si.prefix); });
        if (p) offer(si.seg, srv.dev.name, p);
      }
    }
  }
  const usedBySeg = new Map<string, Set<number>>(), countBySeg = new Map<string, number>();
  for (const i of ifaces) { const s = usedBySeg.get(i.seg) ?? new Set(); s.add(i.ip); usedBySeg.set(i.seg, s); }
  for (const d of devices) {
    const e = eff.get(d.id);
    if (!e || !e.dhcp) continue;
    const node = hostNode.get(d.id)!, seg = find(node);
    const list = offers.filter(o => o.seg === seg);
    if (!list.length) { e.note = 'DHCPサーバーから応答がありません'; continue; }
    const k = countBySeg.get(seg) ?? 0;
    countBySeg.set(seg, k + 1);
    const o = list[k % list.length], end = parseIp(o.pool.end)!;
    const used = usedBySeg.get(seg) ?? new Set<number>();
    usedBySeg.set(seg, used);
    while (o.next <= end && used.has(o.next)) o.next++;
    if (o.next > end) { e.note = `${o.by} の配布範囲に空きアドレスがありません`; continue; }
    e.ip = o.next++; used.add(e.ip);
    e.prefix = Number(o.pool.prefix); e.gw = parseIp(o.pool.gw); e.dns = parseIp(o.pool.dns); e.lease = o.by;
    add(d, 'eth0', node, e.ip, e.prefix);
  }
  // ループの検出: スイッチ同士のケーブルが輪になり、その輪にSTPのないL2スイッチが入っていると通信できなくなる
  const swLike = (id: string) => { const k = byId.get(id)?.kind; return k === 'l2' || k === 'l2m' || k === 'l3'; };
  const deg = new Map<string, number>();
  let live = cables.filter(c => byId.has(c.a.dev) && byId.has(c.b.dev) && swLike(c.a.dev) && swLike(c.b.dev));
  for (;;) {
    deg.clear();
    for (const c of live) { deg.set(c.a.dev, (deg.get(c.a.dev) ?? 0) + 1); deg.set(c.b.dev, (deg.get(c.b.dev) ?? 0) + 1); }
    const next = live.filter(c => deg.get(c.a.dev)! > 1 && deg.get(c.b.dev)! > 1);
    if (next.length === live.length) break;
    live = next;
  }
  const storm = new Set<string>();
  for (const id of deg.keys()) if (byId.get(id)!.kind === 'l2') for (const t of tags) storm.add(find(sw(id, t)));
  return { devices, byId, ifaces, eff, adj, trace: opts.trace ? [] : null, storm };
}

const ifs = (net: Net, dev: Device): Iface[] => net.ifaces.filter(i => i.dev === dev);
const owns = (net: Net, dev: Device, ip: number): boolean => net.ifaces.some(i => i.dev === dev && i.ip === ip);
const neighbors = (net: Net, iface: Iface, ip: number): Iface[] => net.ifaces.filter(i => i !== iface && i.seg === iface.seg && i.ip === ip);
export const effOf = (net: Net, dev: Device): Eff | undefined => net.eff.get(dev.id);
export const ipOf = (net: Net, dev: Device): number | null => (isHost(dev.kind) ? net.eff.get(dev.id)?.ip ?? null : ifs(net, dev)[0]?.ip ?? null);

// インターフェース a から b まで、実際に通るケーブルの並びを求める
function physPath(net: Net, a: Iface, b: Iface): Seg[] {
  const prev = new Map<string, { from: string; cable: string | null; rev: boolean } | null>([[a.node, null]]), queue = [a.node];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur === b.node) {
      const path: Seg[] = [];
      for (let e = prev.get(cur); e; e = prev.get(e.from)) if (e.cable) path.unshift({ cable: e.cable, rev: e.rev });
      return path;
    }
    for (const e of net.adj.get(cur) ?? []) {
      if (!prev.has(e.to)) { prev.set(e.to, { from: cur, cable: e.cable, rev: e.rev }); queue.push(e.to); }
    }
  }
  return [];
}

type Hop = { iface: Iface; hop: number; direct?: boolean; wan?: boolean } | { err: string };

// dev から dst へ送るときの出力インターフェースと次の中継先を決める
function lookup(net: Net, dev: Device, dst: number): Hop {
  const list = ifs(net, dev);
  if (isHost(dev.kind)) {
    const i = list[0], e = net.eff.get(dev.id)!;
    if (!i) return { err: `${dev.name} にIPアドレスがありません` };
    if (inNet(dst, i.ip, i.prefix)) return { iface: i, hop: dst, direct: true };
    if (e.gw == null) return { err: `${dev.name} にデフォルトゲートウェイが設定されていません` };
    if (!inNet(e.gw, i.ip, i.prefix)) return { err: `${dev.name} のゲートウェイ ${ipStr(e.gw)} は自分のネットワークの外です` };
    return { iface: i, hop: e.gw };
  }
  let best: (Hop & { len: number }) | null = null;
  const cand = (len: number, r: Hop) => { if (!best || len > best.len) best = { len, ...r }; };
  for (const i of list) if (inNet(dst, i.ip, i.prefix)) cand(i.prefix + 0.5, { iface: i, hop: dst, direct: true });
  for (const r of (dev.cfg.routes ?? []) as { dest: string; via: string }[]) {
    const c = parseCidr(r.dest), via = parseIp(r.via);
    if (!c || via == null || !inCidr(dst, c)) continue;
    const out = list.find(i => inNet(via, i.ip, i.prefix));
    if (out) cand(c.prefix, { iface: out, hop: via });
  }
  if (isGateway(dev.kind)) {
    const c = dev.cfg as GwCfg, wi = list.find(i => i.wan), gw = c.wan.mode === 'auto' ? ISP_IP : parseIp(c.wan.gw);
    if (wi && gw != null) cand(-1, { iface: wi, hop: gw, wan: true });
  }
  return best ?? { err: `${dev.name} に ${ipStr(dst)} への経路がありません` };
}

// 中継する機器のフィルター。遮断するときは理由を返す
function filter(dev: Device, src: number, dst: number, svc: Svc): string | null {
  const rules = (dev.cfg.rules ?? []) as Rule[];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i], s = parseCidr(r.src), d = parseCidr(r.dst);
    if (!s || !d || !inCidr(src, s) || !inCidr(dst, d)) continue;
    if (r.svc !== 'any' && r.svc !== svc) continue;
    return r.action === 'allow' ? null : `${dev.name} のフィルター(ルール${i + 1})で遮断されました`;
  }
  return dev.kind === 'fw' ? `${dev.name} に許可ルールがないため遮断されました(ファイアウォールは許可した通信だけを通します)` : null;
}

interface SendOk {
  ok: true; end: Device; hops: string[]; path: Seg[];
  /** 送信元アドレスを書き換えた機器(内側から順) */
  nats: { dev: Device; ip: number }[];
  /** ポート転送で宛先を書き換えた機器 */
  dnat?: Device;
  /** WAN側へ出ていった機器 */
  wanOut: Device[];
  /** 宛先の機器から見た送信元アドレス */
  srcSeen: number;
}
type SendNg = Fail & { hops: string[]; path: Seg[]; at: string };

// 片方向にパケットを送る
function send(net: Net, src: Device, srcIp: number, dst: number, svc: Svc, back = false): SendOk | SendNg {
  const hops = [src.name], path: Seg[] = [], nats: SendOk['nats'] = [], wanOut: Device[] = [];
  let cur = src, curSrc = srcIp, inIf: Iface | null = null, dnat: Device | undefined;
  const stop = (reason: string): SendNg => fail(reason, { hops, path, at: cur.id });
  const done = (): SendOk => ({ ok: true, end: cur, hops, path, nats, dnat, wanOut, srcSeen: curSrc });
  for (let ttl = 0; ttl < 24; ttl++) {
    let forwarded = false;
    if (owns(net, cur, dst)) {
      const fwd = !back && cur !== src && isGateway(cur.kind) && inIf?.wan
        ? (cur.cfg as GwCfg).forwards.find(f => f.svc === svc && parseIp(f.to) != null) : undefined;
      if (!fwd) return done();
      dst = parseIp(fwd.to)!; dnat = cur; forwarded = true;
    }
    if (cur.kind === 'internet') {
      const ii = ifs(net, cur)[0];
      if (!inNet(dst, ii.ip, ii.prefix)) {
        if (isPrivate(dst)) return stop('インターネット上ではプライベートアドレス宛の通信は破棄されます(NATが必要)');
        return done();
      }
    }
    if (cur !== src) {
      if (!isRouting(cur.kind)) return stop(`${cur.name} は中継する機器ではありません(ゲートウェイの指定先を確認)`);
      if (!back && !forwarded) { const why = filter(cur, curSrc, dst, svc); if (why) return stop(why); }
    }
    const r = lookup(net, cur, dst);
    if ('err' in r) return stop(r.err);
    if (isGateway(cur.kind) && r.iface.wan) {
      wanOut.push(cur);
      if (!back && (cur.cfg as GwCfg).nat) { nats.push({ dev: cur, ip: r.iface.ip }); curSrc = r.iface.ip; }
    }
    if (net.storm.has(r.iface.seg)) return stop(`${cur.name} のつながるネットワークでループが起きています(スイッチ同士のケーブルが輪になっている)`);
    const n = neighbors(net, r.iface, r.hop);
    if (n.length > 1) return stop(`IPアドレス ${ipStr(r.hop)} が重複しています(${n.map(i => i.dev.name).join(' / ')})`);
    if (!n.length) {
      if (r.wan) return stop(`${cur.name} の${cur.ports[0]}ポートの先に、次の中継先 ${ipStr(r.hop)} が見つかりません`);
      if (r.direct) return stop(`${cur.name} と同じネットワーク上に ${ipStr(r.hop)} が見つかりません(配線・IP・VLANを確認)`);
      return stop(`${cur.name} から${isHost(cur.kind) ? 'ゲートウェイ' : '中継先'} ${ipStr(r.hop)} に届きません(配線・IPを確認)`);
    }
    path.push(...physPath(net, r.iface, n[0]));
    inIf = n[0];
    cur = n[0].dev;
    hops.push(cur.name);
  }
  return stop('経路がループしています(ルートの設定を確認)');
}

export interface ReachOk { ok: true; end: Device; hops: string[]; path: Seg[]; back: Seg[]; srcSeen: number }
export type ReachNg = Fail & { hops: string[]; path: Seg[]; back: Seg[]; failAt: string };
export interface FlowOpts { svc?: Svc; label?: string }

// 往復の疎通確認(行き + 戻り)。src が回線(internet)のときは外部の利用者からの接続として扱う
export function reach(net: Net, src: Device, dst: number, opts: FlowOpts = {}): ReachOk | ReachNg {
  const svc = opts.svc ?? 'ping';
  const res = ((): ReachOk | ReachNg => {
    const early = (reason: string): ReachNg => fail(reason, { hops: [src.name], path: [], back: [], failAt: src.id });
    let srcIp: number;
    if (src.kind === 'internet') srcIp = REMOTE_IP;
    else {
      const si = ifs(net, src)[0];
      if (!si) {
        const e = net.eff.get(src.id);
        if (src.kind === 'home') return early(`${src.name} はVPNにつながっていません(${e?.note ?? ''})`);
        return early(e?.dhcp ? `${src.name} はIPアドレスを取得できていません(${e.note ?? 'DHCP'})` : `${src.name} にIPアドレスが設定されていません`);
      }
      if (!isHostAddr(si.ip, si.prefix)) return early(`${src.name} のIP ${ipStr(si.ip)} はネットワークアドレスかブロードキャストアドレスのため使えません`);
      const dup = neighbors(net, si, si.ip);
      if (dup.length) return early(`${src.name} のIP ${ipStr(si.ip)} が ${dup[0].dev.name} と重複しています`);
      srcIp = si.ip;
    }
    const f = send(net, src, srcIp, dst, svc);
    if (!f.ok) return fail(f.reason, { hops: f.hops, path: f.path, back: [], failAt: f.at });
    // 戻り: アドレスを書き換えた機器を外側から順にたどり、最後に送信元へ
    const back: Seg[] = [];
    let node = f.end;
    const ng = (b: SendNg): ReachNg => fail(`行きは届きますが、戻りの通信が失敗: ${b.reason}`, { hops: f.hops, path: f.path, back: back.concat(b.path), failAt: b.at });
    for (let i = f.nats.length - 1; i >= 0; i--) {
      const b = send(net, node, 0, f.nats[i].ip, svc, true);
      if (!b.ok) return ng(b);
      back.push(...b.path);
      node = f.nats[i].dev;
    }
    const b = send(net, node, 0, srcIp, svc, true);
    if (!b.ok) return ng(b);
    back.push(...b.path);
    if (f.dnat && !b.wanOut.includes(f.dnat)) {
      return fail(`行きは届きますが、${f.end.name} からの返事が ${f.dnat.name} を通らずに出ていきます(ゲートウェイを確認)`, { hops: f.hops, path: f.path, back, failAt: f.end.id });
    }
    return { ok: true, end: f.end, hops: f.hops, path: f.path, back, srcSeen: f.srcSeen };
  })();
  if (net.trace) net.trace.push({ label: opts.label ?? SVC[svc].label, kind: svc, ok: res.ok, hops: res.hops, path: res.path, back: res.back, failAt: res.ok ? undefined : res.failAt });
  return res;
}

/** 経路上の機器を順に返す(tracert) */
export function traceroute(net: Net, src: Device, dst: number): { ok: boolean; hops: string[]; reason?: string } {
  const si = ifs(net, src)[0];
  if (!si) return { ok: false, hops: [src.name], reason: `${src.name} にIPアドレスがありません` };
  const f = send(net, src, si.ip, dst, 'ping');
  return f.ok ? { ok: true, hops: f.hops } : { ok: false, hops: f.hops, reason: f.reason };
}

// 届いた先の機器が、そのサービスを受け付けるか
function accepts(end: Device, svc: Svc, srcSeen: number): string | null {
  switch (svc) {
    case 'ping': return null;
    case 'web':
      if (end.kind === 'internet' || (end.kind === 'server' && end.cfg.webOn)) return null;
      return `${end.name} ではWebサービスが動いていません`;
    case 'file': {
      if (!((end.kind === 'server' || end.kind === 'nas') && end.cfg.fileOn)) return `${end.name} ではファイル共有が動いていません`;
      const l = parseCidrList(end.cfg.fileAllow);
      return !l.length || l.some(c => inCidr(srcSeen, c)) ? null : `${end.name} のファイル共有が ${ipStr(srcSeen)} からの利用を許可していません`;
    }
    case 'print': return end.kind === 'printer' ? null : `${end.name} はプリンタではありません`;
    case 'mail': return end.kind === 'server' && end.cfg.mailOn ? null : `${end.name} ではメールサービスが動いていません`;
    case 'voice': return end.kind === 'phone' ? null : `${end.name} は電話機ではありません`;
    case 'dns': return hasDns(end) || end.kind === 'internet' ? null : `${end.name} ではDNSサービスが動いていません`;
    case 'proxy': return hasProxy(end) ? null : `${end.name} ではプロキシサービスが動いていません`;
  }
}

export type ConnOk = { ok: true; end: Device; hops: string[]; ip: number };
/** 指定のサービスで接続する。host はIPアドレスか名前 */
export function connect(net: Net, src: Device, host: string | number, svc: Svc, label?: string): ConnOk | Fail {
  let ip = typeof host === 'number' ? host : parseIp(host);
  if (ip == null) {
    const d = resolve(net, src, String(host));
    if (!d.ok) return d;
    ip = d.ip;
  }
  const r = reach(net, src, ip, { svc, label });
  if (!r.ok) return fail(r.reason);
  const why = accepts(r.end, svc, r.srcSeen);
  return why ? fail(why) : { ok: true, end: r.end, hops: r.hops, ip };
}

// 名前解決。参照DNSを持たず自分でDNSサービスを動かしている機器は、自分に問い合わせる
export function resolve(net: Net, src: Device, name: string): { ok: true; ip: number } | Fail {
  name = String(name).trim().toLowerCase();
  if (src.kind === 'internet') {
    return EXTERNAL[name] ? { ok: true, ip: parseIp(EXTERNAL[name])! } : fail(`公開DNSは ${name} を知りません`);
  }
  const dnsIp = net.eff.get(src.id)?.dns ?? null;
  if (dnsIp == null) return hasDns(src) ? lookupOn(net, src, name, 0) : fail(`${src.name} にDNSサーバーが設定されていません`);
  const r = reach(net, src, dnsIp, { svc: 'dns', label: 'DNS問い合わせ' });
  if (!r.ok) return fail(`DNSサーバー ${ipStr(dnsIp)} に届きません: ${r.reason}`);
  return answer(net, r.end, ipStr(dnsIp), name, 0);
}
function answer(net: Net, server: Device, addr: string, name: string, depth: number): { ok: true; ip: number } | Fail {
  if (server.kind === 'internet') {
    if (addr !== PUBLIC_DNS) return fail(`${addr} はDNSサーバーではありません`);
    if (!EXTERNAL[name]) return fail(`公開DNSは ${name} を知りません(社内の名前は社内のDNSサーバーに登録します)`);
    return { ok: true, ip: parseIp(EXTERNAL[name])! };
  }
  if (!hasDns(server)) return fail(`${server.name} ではDNSサービスが動いていません`);
  return lookupOn(net, server, name, depth);
}
function lookupOn(net: Net, server: Device, name: string, depth: number): { ok: true; ip: number } | Fail {
  const c = server.cfg as ServerCfg;
  const rec = c.records.find(r => String(r.name).trim().toLowerCase() === name);
  if (rec) {
    const ip = parseIp(rec.ip);
    return ip == null ? fail(`${server.name} の ${name} のレコードに正しいIPアドレスが入っていません`) : { ok: true, ip };
  }
  const fwd = parseIp(c.forwarder);
  if (fwd == null) return fail(`${server.name} に ${name} のレコードがなく、フォワーダー(外部の名前の転送先)も未設定です`);
  if (depth >= 3) return fail('DNSの転送がループしています');
  const f = reach(net, server, fwd, { svc: 'dns', label: 'DNS転送' });
  if (!f.ok) return fail(`${server.name} がフォワーダー ${c.forwarder} に問い合わせできません: ${f.reason}`);
  if (f.end === server) return fail(`${server.name} のフォワーダーが自分自身を指しています`);
  return answer(net, f.end, ipStr(fwd), name, depth + 1);
}

export type BrowseOk = { ok: true; via: 'proxy' | 'direct'; hops: string[] };
/** Web閲覧。PCにプロキシ設定があればプロキシ経由。direct を指定するとプロキシ設定を無視する */
export function browse(net: Net, src: Device, host: string, direct = false): BrowseOk | Fail {
  const p = direct ? '' : String(src.cfg.proxy ?? '').trim();
  if (!p) {
    const w = connect(net, src, host, 'web', 'Webアクセス');
    return w.ok ? { ok: true, via: 'direct', hops: w.hops } : w;
  }
  const m = p.match(/^(.+):(\d+)$/);
  if (!m) return fail(`${src.name} のプロキシ設定は「アドレス:ポート」の形式で入力してください`);
  let pip = parseIp(m[1]);
  if (pip == null) {
    const d = resolve(net, src, m[1]);
    if (!d.ok) return fail(`プロキシ名 ${m[1]} を解決できません: ${d.reason}`);
    pip = d.ip;
  }
  const r = reach(net, src, pip, { svc: 'proxy', label: 'プロキシへ接続' });
  if (!r.ok) return fail(`プロキシ ${m[1]} に届きません: ${r.reason}`);
  const px = r.end;
  if (!hasProxy(px)) return fail(`${px.name} ではプロキシサービスが動いていません`);
  if (Number(m[2]) !== Number(px.cfg.proxyPort)) return fail(`${px.name} のプロキシは ${px.cfg.proxyPort} 番ポートで待ち受けています(PC側の設定: ${m[2]})`);
  if (!proxyAllows(px, r.srcSeen)) return fail(`${px.name} のプロキシが ${ipStr(r.srcSeen)} からの利用を許可していません`);
  const w = connect(net, px, host, 'web', 'Webアクセス(プロキシから)');
  if (!w.ok) return fail(`${px.name} からWebサイトに届きません: ${w.reason}`);
  return { ok: true, via: 'proxy', hops: r.hops.concat(w.hops.slice(1)) };
}

/** src から使えてしまうプロキシサーバーを探す(分離の確認用) */
export function usableProxy(net: Net, src: Device): Device | null {
  const ip = ipOf(net, src);
  if (ip == null) return null;
  for (const px of net.devices) {
    const pip = hasProxy(px) ? ipOf(net, px) : null;
    if (pip == null) continue;
    const r = reach(net, src, pip, { svc: 'proxy' });
    if (r.ok && r.end === px && proxyAllows(px, r.srcSeen)) return px;
  }
  return null;
}

export interface ArpEntry { ip: string; mac: string; dup: boolean }
/** 同じネットワーク上で見えている機器のIPとMACの対応(ARP表) */
export function arpTable(net: Net, dev: Device): ArpEntry[] {
  const me = ifs(net, dev)[0];
  if (!me) return [];
  const list = net.ifaces.filter(i => i !== me && i.seg === me.seg && inNet(i.ip, me.ip, me.prefix)).sort((a, b) => a.ip - b.ip);
  return list.map(i => ({ ip: ipStr(i.ip), mac: i.dev.mac, dup: list.filter(x => x.ip === i.ip).length > 1 || i.ip === me.ip }));
}
