// 依頼の自動生成
// 1) 顧客像と要件を決める → 2) 正解の構成を組み立てる → 3) 検収テストを作る → 4) シミュレータで確かめる
// トラブル対応は、正解の構成に不具合を入れて壊したものを初期状態にする
import { Check, Target, describe, evaluate } from './checks';
import { cidrStr, ipStr, parseIp } from './ip';
import { Builder, DESK_H, DESK_W, Factor, Job, JobCheck, SpecRow, mulberry, pick, randInt, worldCost } from './job';
import { Device, GwCfg, InetCfg, L3Cfg, Rule, ServerCfg, dkimKey, isEndpoint, isGateway, isHost, makeDevice } from './model';
import { scenario } from './scen';
import { EXTERNAL } from './sim';
import { Base, INDUSTRIES, NAMES, finish, makeTrouble, shortLabel } from './genlib';
import { join } from '../i18n/runtime';

const ip = (s: string): number => parseIp(s)!;

interface Group {
  key: string; label: string; short: string; role: 'staff' | 'guest';
  net: number; prefix: number; vlan: number; gw: number;
  hosts: Device[]; pcs: Device[]; printer?: Device; sw?: Device;
  dhcp: boolean; seq: Record<string, number>; cursor: number;
}
const size = (g: { prefix: number }): number => 2 ** (32 - g.prefix);
const cidr = (g: { net: number; prefix: number }): string => cidrStr(g.net, g.prefix);

// グループ内で次に使う固定アドレス
function take(g: Group, cls: 'pc' | 'printer' | 'misc' | 'server' | 'nas'): string {
  if (g.prefix === 24) {
    const base = { pc: 11, printer: 200, misc: 30, server: 53, nas: 60 }[cls];
    const n = g.seq[cls] ?? 0;
    g.seq[cls] = n + 1;
    return ipStr(g.net + base + n);
  }
  let a = g.cursor++;
  if (a === g.gw) a = g.cursor++;
  return ipStr(a);
}
const dhcpRange = (g: Group): [string, string] =>
  g.prefix === 24 ? [ipStr(g.net + 100), ipStr(g.net + 150)] : [ipStr(g.net + size(g) / 2), ipStr(g.net + size(g) - 3)];

export interface GenOpts { kind?: 'build' | 'trouble'; ease?: number }

export function generate(seed: number, level: number, opts: GenOpts = {}): Job {
  for (let k = 0; k < 60; k++) {
    const s = (seed + k * 104729) >>> 0;
    // Lv.19 からは、拠点やクラウドをまたぐ依頼(scen.ts)も混ざる
    const j = (level >= 19 ? scenario(s, seed, level, opts) : null) ?? attempt(s, seed, level, opts);
    if (j) return j;
  }
  throw new Error(`依頼を生成できませんでした (seed=${seed}, level=${level})`);
}

function attempt(seed: number, id: number, level: number, opts: GenOpts): Job | null {
  const r = mulberry(seed);
  const chance = (p: number) => r() < p;
  const ease = opts.ease ?? r();
  const cap = Math.max(1, Math.min(level, Math.round(1 + (level - 1) * (0.35 + 0.65 * ease))));
  // そのレベルで新しく学ぶ内容は、出やすくする
  const want = (lv: number, p: number) => cap >= lv && (cap === lv ? chance(0.8) : chance(p));

  // ---- 1) 要件を決める ----
  // あとから増えた内容(Lv.17〜)は別の乱数で決める。それまでのレベルの依頼の中身を変えないため
  // これらを出すと決めたら、前提になる内容(インターネット、DNS、ファイアウォールなど)も入れる
  const r2 = mulberry(seed ^ 0x5bd1e995);
  const want2 = (lv: number, p: number) => cap >= lv && (cap === lv ? r2() < 0.8 : r2() < p);
  const rp = want2(17, 0.3), saas = want2(18, 0.3), dkimWanted = want2(18, 0.3), monWanted = want2(23, 0.35);
  const lbTls = cap >= 17 && r2() < 0.6;
  const internet = (cap >= 2 && (cap === 2 || chance(0.88))) || rp || saas || dkimWanted;
  const dns = internet && (want(4, 0.55) || saas || dkimWanted || monWanted);
  const proxy = dns && (want(6, 0.4) || saas);
  const nasWanted = want(7, 0.45);
  const fw = internet && (want(10, 0.4) || rp || dkimWanted);
  const vlan = want(8, 0.55);
  const subnet = !vlan && want(5, 0.35);
  const trunk = vlan && want(11, 0.45);
  const redundant = trunk && want(12, 0.5);
  const pub = fw && (want(15, 0.55) || rp || dkimWanted);
  const lbOn = fw && want(16, 0.5) && !rp;
  const termLb = lbOn && lbTls && pub;
  const mail = dns && (want(12, 0.35) || (pub && chance(0.7)) || dkimWanted);
  const wifi = want(13, 0.45);
  const vpnWanted = internet && !vlan && !lbOn && want(14, 0.5);
  let dhcp: 'none' | 'router' | 'server' = 'none';
  if (vlan) dhcp = want(9, 0.5) ? 'server' : 'none';
  else if (cap >= 3 && (cap === 3 ? chance(0.8) : chance(0.5))) dhcp = fw ? 'server' : internet || cap >= 5 ? 'router' : 'none';

  const ind = pick(r, INDUSTRIES.filter(i => (cap >= 7 || !i.guest) && (cap >= 3 || i.id !== 'factory')));
  const [jp, romaji] = pick(r, NAMES);
  const client = join(jp, pick(r, ind.suffix)), dom = romaji + '.local';
  const guestOn = !!ind.guest && internet && (vlan || !fw) && cap >= 7;
  const maxGroups = vlan ? 3 : fw ? 1 : cap >= 5 ? 2 : 1;
  const staffLabels = ind.groups.slice(0, Math.max(1, Math.min(ind.groups.length, guestOn ? maxGroups - 1 : maxGroups, vlan ? 3 : chance(0.6) ? 2 : 1)));
  if (vlan && staffLabels.length + (guestOn ? 1 : 0) < 2) return null;
  const labels: { label: string; role: 'staff' | 'guest' }[] = [...staffLabels.map(l => ({ label: l, role: 'staff' as const })), ...(guestOn ? [{ label: ind.guest!, role: 'guest' as const }] : [])];
  const multi = labels.length > 1;
  const routed = multi || internet || fw;   // ルーター(またはFW/L3)が要る
  if (dhcp === 'router' && !routed) dhcp = 'none';
  const needServer = dns || proxy || dhcp === 'server';
  const serverNet = vlan && (needServer || nasWanted);
  const nasBought = nasWanted && dns;

  const b = new Builder();
  const octet = randInt(r, 1, 12) * 10;
  const mk = (i: number, label: string, role: 'staff' | 'guest'): Group => ({
    key: 'g' + i, label, short: shortLabel(label), role, net: ip(`192.168.${octet + i * 10}.0`), prefix: 24, vlan: 10 + i * 10,
    gw: 0, hosts: [], pcs: [], dhcp: false, seq: {}, cursor: 0,
  });
  const groups = labels.map((l, i) => mk(i, l.label, l.role));
  const staff = groups.filter(g => g.role === 'staff'), guests = groups.filter(g => g.role === 'guest');

  // 端末を用意する
  const bigSwitch = cap >= 3;
  const tag = (g: Group) => (multi ? g.short : '');
  for (const g of groups) {
    const nPc = g.role === 'guest' ? randInt(r, 2, 3) : randInt(r, 2, Math.min(5, 2 + Math.ceil(cap / 3)));
    for (let i = 0; i < nPc; i++) {
      const d = b.add('pc', `${g.key}pc${i + 1}`, join(g.role === 'guest' ? 'ゲスト' : tag(g), `PC-${i + 1}`), 'supplied');
      g.hosts.push(d); g.pcs.push(d);
    }
    if (g.role === 'guest') continue;
    const first = g === staff[0];
    if (ind.extra.includes('printer') && (first || chance(0.45))) {
      g.printer = b.add('printer', `${g.key}prn`, `${tag(g)}プリンタ`, 'supplied');
      g.hosts.push(g.printer);
    }
    const last = g === staff[staff.length - 1];
    if (ind.extra.includes('phone') && cap >= 3 && chance(0.4)) g.hosts.push(b.add('phone', `${g.key}tel`, `${tag(g)}電話`, 'supplied'));
    if (ind.extra.includes('pos') && last) for (let i = 0; i < randInt(r, 1, 2); i++) g.hosts.push(b.add('pos', `${g.key}pos${i + 1}`, `レジ-${i + 1}`, 'supplied'));
    if (ind.extra.includes('camera') && nasWanted && last) for (let i = 0; i < randInt(r, 1, 2); i++) g.hosts.push(b.add('camera', `${g.key}cam${i + 1}`, `カメラ-${i + 1}`, 'supplied'));
    if (!bigSwitch) while (g.hosts.length > 6) { const d = g.hosts.pop()!; b.devices.splice(b.devices.indexOf(d), 1); if (g.printer === d) g.printer = undefined; g.pcs = g.pcs.filter(x => x !== d); }
  }
  if (!staff[0].printer && !nasWanted && !internet) {
    staff[0].printer = b.add('printer', `${staff[0].key}prn`, `${tag(staff[0])}プリンタ`, 'supplied');
    staff[0].hosts.push(staff[0].printer);
  }

  // 無線でつなぐノートPCと、アクセスポイント
  const wireless = new Set<Device>();
  const ssid = `${romaji}-wifi`, wifiKey = `${romaji.slice(0, 3)}${randInt(r, 1000, 9999)}`;
  if (wifi) {
    const list = staff[0].pcs.slice(-Math.min(2, staff[0].pcs.length - 1));
    list.forEach((d, i) => { wireless.add(d); d.name = `ノートPC-${i + 1}`; d.cfg.wifi = { ssid, key: wifiKey }; });
  }

  // アドレス設計
  const home = staff[0];
  const inHome = (needServer ? 1 : 0) + (nasWanted ? 1 : 0);
  if (subnet) {
    const need = Math.max(...groups.map(g => g.hosts.length + (g === home ? inHome : 0)));
    const sz = [16, 32, 64, 128].find(s => s >= 2 * (need + 4)) ?? 128;
    if (sz * groups.length > 256) return null;
    const start = randInt(r, 0, Math.floor(256 / sz) - groups.length) * sz;
    groups.forEach((g, i) => { g.net = ip(`192.168.${octet}.0`) + start + i * sz; g.prefix = 32 - Math.log2(sz); });
  }
  for (const g of groups) {
    g.gw = vlan ? g.net + size(g) - 2 : g.net + 1;
    g.cursor = g.net + (vlan ? 1 : 2);
    g.dhcp = dhcp !== 'none';
  }
  const srvNet = { net: ip(`192.168.${octet + 100}.0`), prefix: 24 };
  const srvGroup: Group = serverNet ? { ...mk(9, 'サーバー', 'staff'), net: srvNet.net, gw: srvNet.net + 254, vlan: 100 } : home;
  const upNet = ip('10.255.0.0'), dmzNet = ip(`172.16.${octet}.0`);

  // ---- 2) 正解の構成を組み立てる ----
  const inet = internet ? b.add('internet', 'inet', 'インターネット', 'fixed') : null;
  const gwDev = fw ? b.add('fw', 'fw', 'ファイアウォール') : routed && (internet || !vlan) ? b.add('router', 'rt', 'ルーター') : null;
  const l3 = vlan ? b.add('l3-8', 'l3', 'L3スイッチ') : null;
  const server = needServer ? b.add('server', 'sv', 'サーバー') : null;
  const nas = nasWanted ? b.add('nas', 'nas', 'NAS', nasBought ? 'bought' : 'supplied') : null;
  const web = fw ? b.add('server', 'web', 'Webサーバー') : null;
  const ap = wireless.size ? b.add('ap', 'ap', '無線AP') : null;
  if (ap) Object.assign(ap.cfg, { ssid, key: wifiKey });
  const wired = (g: Group) => g.hosts.filter(h => !wireless.has(h));
  let floors: { hosts: Device[]; sw?: Device }[] | null = null;
  if (inet && gwDev) b.link(inet, 0, gwDev, 0);
  // テレワーク: 自宅PCがVPNで社内に入る
  const vpnKey = `vpn-${romaji.slice(0, 4)}${randInt(r, 10, 99)}`;
  const homePc = vpnWanted && !rp && gwDev && (nasWanted || staff[0].printer) ? b.add('home', 'home', '自宅PC', 'fixed') : null;
  if (homePc && gwDev) {
    const h = staff[0];
    (gwDev.cfg as GwCfg).vpn = { on: true, key: vpnKey, ip: ipStr(h.net + (h.prefix === 24 ? 240 : size(h) - 2)) };
    homePc.cfg.vpn = { server: '203.0.113.2', key: vpnKey };
  }

  const swFor = (n: number, id: string, name: string): Device | null => {
    const model = n <= 5 ? 'l2-5' : n <= 8 ? 'l2-8' : n <= 16 && bigSwitch ? 'l2-16' : null;
    return model ? b.add(model, id, name) : null;
  };
  const letter = (i: number) => (groups.length > 1 ? 'ABC'[i] : '');

  if (l3) {
    const c = l3.cfg as L3Cfg;
    const extra = (server ? 1 : 0) + (nas ? 1 : 0) + (gwDev ? 1 : 0);
    const direct = groups.reduce((s, g) => s + g.hosts.length, 0) + extra <= 8;
    let p = 0;
    if (trunk) {
      // 各階にVLAN対応スイッチ(お客様の既設)があり、L3スイッチまでトランクで運ぶ
      floors = [{ hosts: [] }, { hosts: [] }];
      const vlanOf = new Map<Device, number>();
      for (const g of groups) g.hosts.forEach((h, i) => { floors![i % 2].hosts.push(h); vlanOf.set(h, g.vlan); });
      const msws = floors.map((f, i) => {
        const need = f.hosts.length + 3;
        const m = b.add(need <= 8 ? 'l2m-8' : 'l2m-24', 'msw' + (i + 1), `${i + 1}階スイッチ`, 'supplied');
        f.sw = m;
        for (const h of f.hosts) if (!wireless.has(h)) m.cfg.portVlan[b.plug(h, m)] = vlanOf.get(h)!;
        if (ap && i === 0) m.cfg.portVlan[b.plug(ap, m)] = staff[0].vlan;
        const up = m.ports.length - 1;
        m.cfg.portMode[up] = 'trunk'; c.portMode[p] = 'trunk';
        b.link(m, up, l3, p++);
        return m;
      });
      if (redundant) {
        const a = msws[0].ports.length - 2, z = msws[1].ports.length - 2;
        msws[0].cfg.portMode[a] = 'trunk'; msws[1].cfg.portMode[z] = 'trunk';
        b.link(msws[0], a, msws[1], z);
      }
      for (const g of groups) c.svis.push({ vlan: g.vlan, ip: ipStr(g.gw), prefix: g.prefix, relay: '' });
    } else for (const g of groups) {
      if (direct) {
        for (const h of wired(g)) { c.portVlan[p] = g.vlan; b.link(h, 0, l3, p++); }
        if (ap && g === staff[0]) { c.portVlan[p] = g.vlan; b.link(ap, 0, l3, p++); }
      } else {
        const s = swFor(g.hosts.length + 1, 'sw' + g.key, 'スイッチ' + letter(groups.indexOf(g)));
        if (!s) return null;
        g.sw = s;
        c.portVlan[p] = g.vlan; b.link(s, 0, l3, p++);
        for (const h of wired(g)) b.plug(h, s);
        if (ap && g === staff[0]) b.plug(ap, s);
      }
      c.svis.push({ vlan: g.vlan, ip: ipStr(g.gw), prefix: g.prefix, relay: '' });
    }
    if (serverNet) {
      for (const s of [server, nas]) if (s) { c.portVlan[p] = 100; b.link(s, 0, l3, p++); }
      c.svis.push({ vlan: 100, ip: ipStr(srvGroup.gw), prefix: 24, relay: '' });
    }
    if (gwDev) {
      const g = gwDev.cfg as GwCfg, lanIdx = fw ? 1 : 0;
      c.portVlan[7] = 99; b.link(l3, 7, gwDev, lanIdx + 1);
      c.svis.push({ vlan: 99, ip: ipStr(upNet + 2), prefix: 30, relay: '' });
      c.routes.push({ dest: '0.0.0.0/0', via: ipStr(upNet + 1) });
      g.lan[lanIdx].ip = ipStr(upNet + 1); g.lan[lanIdx].prefix = 30;
      for (const n of [...groups, ...(serverNet ? [srvGroup] : [])]) g.routes.push({ dest: cidr(n), via: ipStr(upNet + 2) });
    }
    for (const g of guests) for (const o of [...staff, ...(serverNet ? [srvGroup] : [])]) c.rules.push({ action: 'deny', src: cidr(g), dst: cidr(o), svc: 'any' });
  } else {
    groups.forEach((g, i) => {
      const n = g.hosts.length + (gwDev ? 1 : 0) + (g === home ? inHome : 0);
      const s = swFor(n, 'sw' + g.key, 'スイッチ' + letter(i));
      if (!s) return;
      g.sw = s;
      if (gwDev) {
        const lanIdx = fw ? 1 : i, c = gwDev.cfg as GwCfg;
        b.link(gwDev, lanIdx + 1, s, b.freePort(s));
        c.lan[lanIdx].ip = ipStr(g.gw); c.lan[lanIdx].prefix = g.prefix;
      }
      for (const h of wired(g)) b.plug(h, s);
      if (ap && g === home) b.plug(ap, s);
      if (g === home) for (const x of [server, nas]) if (x) b.plug(x, s);
    });
    if (groups.some(g => !g.sw)) return null;
  }

  // サーバー類の設定
  const hostCfg = (d: Device, g: Group, addr: string) => Object.assign(d.cfg, { ip: addr, prefix: g.prefix, gw: routed ? ipStr(g.gw) : '' });
  const records: { name: string; ip: string }[] = [];
  let serverIp = '', nasIp = '', webIp = '';
  if (server) {
    serverIp = take(srvGroup, 'server');
    hostCfg(server, srvGroup, serverIp);
    const c = server.cfg as ServerCfg;
    if (dns) { c.dnsOn = true; c.forwarder = '8.8.8.8'; c.records = records; }
    if (mail) { c.mailOn = true; records.push({ name: `mail.${dom}`, ip: serverIp }); }
    if (proxy) { c.proxyOn = true; if (guests.length) c.proxyAllow = staff.map(cidr).join(', '); }
  }
  if (nas) { nasIp = take(srvGroup, 'nas'); hostCfg(nas, srvGroup, nasIp); if (nasBought) records.push({ name: `nas.${dom}`, ip: nasIp }); }
  const pubDom = `${romaji}.example.jp`;
  let lb: Device | null = null, dmzSw: Device | null = null, dmzHosts: Device[] = [];
  let rpSites: { name: string; dev: Device }[] = [];
  const dkim = dkimWanted && pub && mail && !!server && !!web;
  if (web && gwDev) {
    const g = gwDev.cfg as GwCfg, gwIp = ipStr(dmzNet + 1);
    webIp = ipStr(dmzNet + 80);
    g.lan[0].ip = gwIp; g.lan[0].prefix = 24;
    const webs = [web];
    if (lbOn) {
      // Webサーバー2台と負荷分散装置を、DMZのスイッチにまとめる
      web.name = 'Webサーバー-1';
      webs.push(b.add('server', 'web2', 'Webサーバー-2'));
      lb = b.add('lb', 'lb', '負荷分散装置');
      dmzSw = b.add('l2-5', 'swdmz', 'DMZスイッチ');
      b.link(gwDev, 1, dmzSw, 0);
      for (const d of [...webs, lb]) b.plug(d, dmzSw);
      Object.assign(lb.cfg, { ip: webIp, prefix: 24, gw: gwIp, backends: webs.map((_, i) => ipStr(dmzNet + 81 + i)).join(', ') });
      dmzHosts = [...webs, lb];
    } else if (rp) {
      // リバースプロキシが外からのアクセスを受け、名前ごとにお客様のWebサーバーへ転送する
      web.name = 'リバースプロキシ';
      const apps = [b.add('server', 'app1', 'Webサーバー-1', 'supplied'), b.add('server', 'app2', 'Webサーバー-2', 'supplied')];
      dmzSw = b.add('l2-5', 'swdmz', 'DMZスイッチ');
      b.link(gwDev, 1, dmzSw, 0);
      for (const d of [web, ...apps]) b.plug(d, dmzSw);
      rpSites = [{ name: 'www', dev: apps[0] }, { name: pick(r2, ['shop', 'blog', 'recruit', 'support']), dev: apps[1] }];
      apps.forEach((a, i) => Object.assign(a.cfg, { ip: ipStr(dmzNet + 81 + i), prefix: 24, gw: gwIp, webOn: true }));
      Object.assign(web.cfg, { ip: webIp, prefix: 24, gw: gwIp, rpOn: true, cert: `*.${pubDom}`, rpRules: rpSites.map((x, i) => ({ host: `${x.name}.${pubDom}`, to: ipStr(dmzNet + 81 + i) })) });
      dmzHosts = [web, ...apps];
    } else b.link(web, 0, gwDev, 1);
    // 負荷分散装置に証明書を入れる(TLSの終端)依頼では、Webサーバー側の証明書は要らない
    if (!rp) webs.forEach((w, i) => Object.assign(w.cfg, { ip: lbOn ? ipStr(dmzNet + 81 + i) : webIp, prefix: 24, gw: gwIp, webOn: true, cert: pub && !termLb ? `www.${pubDom}` : '' }));
    if (termLb) lb!.cfg.cert = `www.${pubDom}`;
    g.forwards.push({ svc: 'web', to: webIp });
    if (dns && !rp) records.push({ name: `www.${dom}`, ip: webIp });
    if (pub && inet) {
      // 契約済みのドメイン。公開DNSのレコードは回線(プロバイダ)側に登録する
      const z = inet.cfg as InetCfg;
      z.domain = pubDom;
      z.zone.push({ type: 'A', name: 'www', value: '203.0.113.2' });
      for (const x of rpSites.slice(1)) z.zone.push({ type: 'A', name: x.name, value: '203.0.113.2' });
      if (dkim && server) {
        Object.assign(server.cfg, { dkimOn: true, dkimSel: 's1' });
        z.zone.push({ type: 'TXT', name: 's1._domainkey', value: `v=DKIM1; k=rsa; p=${dkimKey(server)}` }, { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=reject' });
      }
      if (mail && server) {
        z.zone.push({ type: 'A', name: 'mail', value: '203.0.113.2' }, { type: 'MX', name: '@', value: 'mail' }, { type: 'TXT', name: '@', value: 'v=spf1 ip4:203.0.113.2 -all' });
        g.forwards.push({ svc: 'mail', to: serverIp });
      }
    }
  }
  const extMail = pub && mail && !!server && !!web;

  // 端末の設定
  const SAAS = 'saas.example.com', saasOn = saas && proxy;
  const dnsFor = (g: Group) => (dns && g.role === 'staff' ? serverIp : internet ? '8.8.8.8' : '');
  for (const g of groups) {
    const [ds, de] = dhcpRange(g);
    for (const h of g.hosts) {
      if (g.dhcp && h.kind === 'pc') h.cfg.mode = 'dhcp';
      else {
        hostCfg(h, g, take(g, h.kind === 'pc' ? 'pc' : h.kind === 'printer' ? 'printer' : 'misc'));
        h.cfg.dns = h.kind === 'printer' ? '' : dnsFor(g);
      }
      if (proxy && h.kind === 'pc' && g.role === 'staff') { h.cfg.proxy = `${serverIp}:8080`; if (saasOn) h.cfg.noProxy = SAAS; }
    }
    if (g.printer && dns) records.push({ name: `printer${staff.filter(x => x.printer).length > 1 ? staff.indexOf(g) + 1 : ''}.${dom}`, ip: g.printer.cfg.ip });
    if (!g.dhcp) continue;
    if (dhcp === 'router' && gwDev) {
      const l = (gwDev.cfg as GwCfg).lan[groups.indexOf(g)];
      Object.assign(l, { dhcpOn: true, dhcpStart: ds, dhcpEnd: de, dhcpDns: dnsFor(g) });
    } else if (server) {
      const c = server.cfg as ServerCfg;
      c.dhcpOn = true;
      c.pools.push({ start: ds, end: de, prefix: g.prefix, gw: routed ? ipStr(g.gw) : '', dns: dnsFor(g) });
      if (l3) (l3.cfg as L3Cfg).svis.find(s => s.vlan === g.vlan)!.relay = serverIp;
    }
  }
  // NASを使えるグループ(カメラは個別に許可)
  const nasGroups = staff.length > 1 && chance(0.6) ? [staff[0]] : staff;
  const cams = b.devices.filter(d => d.kind === 'camera');
  if (nas && (nasGroups.length < staff.length || guests.length)) {
    nas.cfg.fileAllow = [...nasGroups.map(cidr), ...cams.filter(c => !nasGroups.some(g => g.hosts.includes(c))).map(c => c.cfg.ip)].join(', ');
  }

  // フィルター
  if (gwDev) {
    const c = gwDev.cfg as GwCfg, rules: Rule[] = [];
    const inner = [...groups, ...(serverNet ? [srvGroup] : [])];
    if (fw) {
      if (proxy) {
        rules.push({ action: 'allow', src: serverIp, dst: 'any', svc: 'any' });
        for (const g of staff) rules.push({ action: 'allow', src: cidr(g), dst: cidrStr(dmzNet, 24), svc: 'any' });
        if (saasOn) for (const g of staff) rules.push({ action: 'allow', src: cidr(g), dst: EXTERNAL[SAAS], svc: 'web' });
        for (const g of guests) rules.push({ action: 'allow', src: cidr(g), dst: 'any', svc: 'any' });
      } else for (const g of inner) rules.push({ action: 'allow', src: cidr(g), dst: 'any', svc: 'any' });
    } else {
      if (!l3) for (const g of guests) for (const o of staff) rules.push({ action: 'deny', src: cidr(g), dst: cidr(o), svc: 'any' });
      if (proxy) {
        rules.push({ action: 'allow', src: serverIp, dst: 'any', svc: 'web' });
        for (const g of guests) rules.push({ action: 'allow', src: cidr(g), dst: 'any', svc: 'web' });
        if (saasOn) for (const g of staff) rules.push({ action: 'allow', src: cidr(g), dst: EXTERNAL[SAAS], svc: 'web' });
        rules.push({ action: 'deny', src: 'any', dst: 'any', svc: 'web' });
      }
    }
    c.rules = rules;
  }

  // 監視: サーバーから、IPアドレスを持つ機材すべてに ping を打つ
  const mon = monWanted && !!server;
  if (mon && server) {
    const first = (d: Device): string => (isGateway(d.kind) ? (d.cfg as GwCfg).lan.find(l => l.ip)?.ip : d.kind === 'l3' ? (d.cfg as L3Cfg).svis[0]?.ip : d.cfg.ip) ?? '';
    Object.assign(server.cfg, { monOn: true, monTargets: b.devices.filter(d => d !== server && (isGateway(d.kind) || ['l3', 'server', 'nas', 'lb'].includes(d.kind))).map(first).join(', ') });
  }

  // ---- 3) 検収テスト ----
  const names = new Map(b.devices.map(d => [d.id, d.name]));
  const nameOf = (x: string) => names.get(x) ?? x;
  const checks: JobCheck[] = [];
  const add = (check: Check, who?: string) => checks.push({ check, label: describe(check, nameOf, who) });
  const ids = (l: Device[]) => l.map(d => d.id);
  const whoPc = (g: Group) => (g.role === 'guest' ? 'ゲストPC' : multi ? `${g.label}のPC` : g.pcs.length > 3 ? '全PC' : undefined);
  const restrict: string[] = [];

  for (const g of groups) {
    add({ t: 'addr', devs: ids(g.hosts), cidr: cidr(g) }, multi ? `${g.label}の機器` : '全機器');
    if (g.dhcp) add({ t: 'dhcp', devs: ids(g.pcs) }, whoPc(g) ?? ids(g.pcs).map(nameOf).join('・'));
  }
  const printerGroups = staff.filter(g => g.printer);
  for (const g of staff) {
    const pg = g.printer ? g : printerGroups[0];
    if (!pg) continue;
    const rec = records.find(x => x.ip === pg.printer!.cfg.ip);
    add({ t: 'flow', from: ids(g.pcs), to: rec ? { name: rec.name, dev: pg.printer!.id } : { dev: pg.printer!.id }, svc: 'print', expect: 'ok' }, whoPc(g));
  }
  if (!printerGroups.length && !internet && !nas) add({ t: 'flow', from: [home.pcs[0].id], to: { dev: home.pcs[1].id }, svc: 'ping', expect: 'ok' });
  const phones = b.devices.filter(d => d.kind === 'phone');
  if (phones.length >= 2) add({ t: 'flow', from: [phones[0].id], to: { dev: phones[1].id }, svc: 'voice', expect: 'ok' });
  if (internet) {
    for (const g of groups) {
      const viaProxy = proxy && g.role === 'staff';
      if (!viaProxy) add({ t: 'flow', from: ids(g.pcs), to: { ext: '8.8.8.8' }, svc: 'ping', expect: 'ok' }, whoPc(g));
      add({ t: 'flow', from: ids(g.pcs), to: { ext: 'www.example.com' }, svc: 'web', expect: 'ok', via: viaProxy ? 'proxy' : undefined }, whoPc(g));
      if (viaProxy) { add({ t: 'directWeb', from: ids(g.pcs) }, whoPc(g)); restrict.push('direct'); }
      if (viaProxy && saasOn) add({ t: 'flow', from: ids(g.pcs), to: { ext: SAAS }, svc: 'web', expect: 'ok', via: 'direct' }, whoPc(g));
    }
    const pos = b.devices.filter(d => d.kind === 'pos');
    if (pos.length && !proxy) add({ t: 'flow', from: ids(pos), to: { ext: 'update.example.org' }, svc: 'web', expect: 'ok' }, 'レジ');
  }
  if (nas) {
    const to: Target = nasBought ? { name: `nas.${dom}` } : { dev: nas.id };
    for (const g of staff) {
      const allowed = nasGroups.includes(g);
      add({ t: 'flow', from: ids(g.pcs), to, svc: 'file', expect: allowed ? 'ok' : 'ng' }, whoPc(g));
      if (!allowed) restrict.push('nas');
    }
    if (cams.length) add({ t: 'flow', from: ids(cams), to, svc: 'file', expect: 'ok' }, 'カメラ');
    if (!nasBought) for (const g of guests) { add({ t: 'flow', from: ids(g.pcs), to, svc: 'file', expect: 'ng' }, whoPc(g)); restrict.push('nas'); }
  }
  for (const g of guests) {
    const targets = staff.flatMap(s => [s.pcs[0], s.printer].filter((x): x is Device => !!x));
    for (const t of targets.slice(0, 3)) add({ t: 'flow', from: ids(g.pcs), to: { dev: t.id }, svc: 'ping', expect: 'ng' }, whoPc(g));
    restrict.push('guest');
    if (proxy) add({ t: 'noProxy', from: ids(g.pcs) }, whoPc(g));
  }
  if (web) {
    if (rpSites.length) for (const x of rpSites) add({ t: 'flow', from: ['inet'], to: { name: `${x.name}.${pubDom}` }, svc: 'web', expect: 'ok', https: true, by: x.dev.id });
    else if (pub) add({ t: 'flow', from: ['inet'], to: { name: `www.${pubDom}` }, svc: 'web', expect: 'ok', https: true });
    else add({ t: 'flow', from: ['inet'], to: { pub: true }, svc: 'web', expect: 'ok' });
    if (lb) add({ t: 'lb', min: 2 });
    if (extMail) { add({ t: 'mailIn', domain: pubDom }); add({ t: 'mailOut' }); }
    if (dkim) { add({ t: 'dkim' }); add({ t: 'dmarc' }); }
    if (dns && !rp) add({ t: 'flow', from: ids(home.pcs), to: { name: `www.${dom}` }, svc: 'web', expect: 'ok', via: proxy ? 'proxy' : undefined }, whoPc(home));
    add({ t: 'flow', from: ['inet'], to: { pub: true }, svc: 'file', expect: 'ng' });
    restrict.push('dmz');
  }
  if (homePc) {
    homePc.cfg.dns = dnsFor(home);
    if (nas) add({ t: 'flow', from: ['home'], to: nasBought ? { name: `nas.${dom}` } : { dev: nas.id }, svc: 'file', expect: 'ok' });
    else add({ t: 'flow', from: ['home'], to: { dev: home.printer!.id }, svc: 'print', expect: 'ok' });
    add({ t: 'flow', from: ['home'], to: { dev: home.pcs[0].id }, svc: 'ping', expect: 'ok' });
  }
  if (mail) add({ t: 'flow', from: ids(home.pcs), to: { name: `mail.${dom}` }, svc: 'mail', expect: 'ok' }, whoPc(home));
  if (wireless.size) add({ t: 'wifi', devs: ids([...wireless]) });
  if (mon) add({ t: 'monitor' });
  if (redundant) {
    const sub: Check[] = [];
    for (const g of staff) for (const o of staff) if (g !== o) sub.push({ t: 'flow', from: [g.pcs[0].id], to: { dev: o.pcs[0].id }, svc: 'ping', expect: 'ok' });
    if (!sub.length) sub.push({ t: 'flow', from: [staff[0].pcs[0].id], to: { dev: staff[0].pcs[1].id }, svc: 'ping', expect: 'ok' });
    add({ t: 'redundant', checks: sub });
  }
  // ---- 4) 確かめる ----
  layout(b, { groups: floors ?? groups, inet, gwDev, l3, side: [server, nas].filter((x): x is Device => !!x), web: lb || rp ? null : web, dmzSw, dmzHosts });
  if (homePc && inet) { homePc.x = inet.x - 330; homePc.y = inet.y + 24; }
  if (ap) {
    const ws = [...wireless];
const mx = ws.reduce((t, d) => t + d.x, 0) / ws.length, top = Math.min(...ws.map(d => d.y));
    // 無線の端末の近くで、ほかの機器と重ならない場所を探す
    search: for (const dy of [150, 260, 370]) for (const dx of [62, -62, 190, -190, 320, -320, 450, -450]) {
      const x = Math.round(mx + dx), y = top - dy;
      if (x < 90 || x > 1310 || y < 120) continue;
      if (b.devices.every(d => d === ap || Math.abs(d.x - x) >= (isEndpoint(d.kind) ? 100 : 60 + d.ports.length * 11 + 70) || Math.abs(d.y - y) >= 120)) { ap.x = x; ap.y = y; break search; }
    }
    if (!ap.x) return null;
  }
  const solution = b.world();
  const rawChecks = checks.map(c => c.check);
  if (evaluate(solution, rawChecks, nameOf).some(x => !x.ok)) return null;

  // ---- 文章・難易度・報酬 ----
  const tags: string[] = ['LAN'];
  const factors: Factor[] = [];
  const infra = b.devices.filter(d => !isEndpoint(d.kind) && d.kind !== 'internet').length;
  const ends = b.devices.filter(d => isEndpoint(d.kind)).length;
  factors.push({ label: `機器の数(端末${ends}台・機材${infra}台)`, pts: Math.round(ends * 0.5 + infra * 1.5) });
  const nets = groups.length + (serverNet ? 1 : 0) + (web ? 1 : 0) + (l3 && gwDev ? 1 : 0);
  if (nets > 1) factors.push({ label: `ネットワークの数(${nets})`, pts: nets * 2 });
  const know = (on: boolean, tagName: string, pts: number) => { if (on) { tags.push(tagName); factors.push({ label: `必要な知識: ${tagName}`, pts }); } };
  know(internet, 'ルーター', 4);
  know(dhcp === 'router', 'DHCP', 3);
  know(dns, 'DNS', 6);
  know(subnet, 'サブネット', 5);
  know(proxy, 'プロキシ', 7);
  know(!!nas, 'ファイル共有', 3);
  know(vlan, 'VLAN', 10);
  know(dhcp === 'server', 'DHCPサーバー', vlan ? 8 : 4);
  know(fw, 'ファイアウォール', 10);
  know(trunk, 'トランク', 8);
  know(redundant, '冗長化', 8);
  know(mail, 'メール', 3);
  know(wireless.size > 0, '無線LAN', 5);
  know(!!homePc, 'VPN', 7);
  know(pub, '公開DNS', 6);
  know(extMail, 'SPF', 8);
  know(!!lb, '負荷分散', 8);
  know(rp, 'リバースプロキシ', 9);
  know(dkim, '送信ドメイン認証', 8);
  know(saasOn, 'プロキシの例外', 5);
  know(mon, '監視', 4);
  if (restrict.length) { tags.push('通信制限'); factors.push({ label: `通信の制限(${new Set(restrict).size}種類)`, pts: new Set(restrict).size * 3 }); }

  const person = pick(r, ind.person);
  const spec: SpecRow[] = [];
  spec.push({ head: 'アドレス', body: groups.map(g => `${multi ? g.label + ': ' : ''}${cidr(g)}${g.dhcp ? '(PCはDHCPで自動取得)' : ''}`).join('\n') });
  if (internet) spec.push({ head: 'インターネット', body: proxy ? '社員のPCはプロキシ経由でだけWebを見られること' + (saasOn ? `\nクラウドサービス ${SAAS} だけは、プロキシを通さず直接つなぐ` : '') : `回線は契約済み。公開DNSは 8.8.8.8` });
  if (records.length) spec.push({ head: '名前', body: records.map(x => `${x.name} → ${nameOf(b.devices.find(d => d.cfg.ip === x.ip)!.id)}`).join('\n') });
  if (nas) spec.push({ head: 'ファイル共有', body: `${nasBought ? 'NASを新しく用意する' : 'お客様のNASを使う'}。使えるのは ${nasGroups.map(g => (multi ? g.label : '社内のPC')).join('・')}${cams.length ? ' とカメラ' : ''}` });
  if (guests.length) spec.push({ head: 'ゲスト用', body: `${guests[0].label}のPCはインターネットだけ使える。社内の機器には届かないこと` });
  if (floors) spec.push({ head: 'フロア', body: floors.map((f, i) => `${i + 1}階(${f.sw!.name}): ${f.hosts.map(h => h.name).join('、')}`).join('\n') + '\n各階の機器は、その階のVLAN対応スイッチ(お客様の既設)につなぐ' + (redundant ? '\nスイッチ同士のケーブルが1本切れても止まらないこと' : '') });
  if (wireless.size) spec.push({ head: '無線LAN', body: `SSID: ${ssid} / 暗号化キー: ${wifiKey}\n${[...wireless].map(d => d.name).join('・')} は無線でつなぐ` });
  if (homePc) spec.push({ head: 'テレワーク', body: `自宅PCからVPNで社内につなぐ。認証キー: ${vpnKey}\n会社の外側のアドレスは 203.0.113.2` });
  if (pub) spec.push({ head: 'ドメイン', body: `${pubDom}(契約済み。回線の「公開DNS」にレコードを登録する)\n会社の外側のアドレスは 203.0.113.2\n` + (rp ? `公開するWebサイト: ${rpSites.map(x => `https://${x.name}.${pubDom}`).join('、')}` : `Webサイトは https://www.${pubDom} で公開する`) + (extMail ? `\nメールは mail.${pubDom} で受け取る。SPFレコードで送信元を示す` : '')
    + (dkim ? '\nDKIMの署名を付け、公開鍵を s1._domainkey のTXTレコードに登録する\nDMARCのレコード(_dmarc)で、認証に失敗したメールを拒否するよう示す' : '') });
  if (rp) spec.push({ head: 'リバースプロキシ', body: rpSites.map(x => `${x.name}.${pubDom} → ${x.dev.name}`).join('\n') + '\n外から届いたWebアクセスはリバースプロキシが受け、名前を見てWebサーバーへ転送する\n証明書はリバースプロキシに入れる(2つの名前の両方に当てはまるもの)\nWebサーバー2台はお客様の機器を使う' });
  if (lb) spec.push({ head: '負荷分散', body: 'Webサーバーを2台用意し、負荷分散装置で振り分ける\n外から届いたWebアクセスは負荷分散装置へ送る' + (termLb ? '\n証明書は負荷分散装置に入れる' : '') });
  if (mon) spec.push({ head: '監視', body: 'サーバーで監視サービスを動かす\n監視先: ルーター、ファイアウォール、L3スイッチ、サーバー、NASなど、IPアドレスを持つ機材すべて' });
  if (web) spec.push({ head: '公開サーバー', body: 'Webサーバーをインターネットに公開する。公開サーバーから社内には入れないこと' });

  const talk: string[] = [];
  const things = [`PC${b.devices.filter(d => d.kind === 'pc').length}台`, printerGroups.length ? 'プリンタ' : '', phones.length ? '電話' : '', cams.length ? '防犯カメラ' : '', b.devices.some(d => d.kind === 'pos') ? 'レジ' : ''].filter(Boolean).join('、');
  talk.push(pick(r, [
    `${things}をつないで使えるようにしてください。`,
    `うちの${ind.label}に${things}があります。これをネットワークにつなぎたいんです。`,
    `${things}を入れたのですが、配線も設定もまだです。お願いできますか。`,
    `${things}のネットワークを、一から組んでほしいんです。`,
  ]));
  if (multi) talk.push(`${groups.map(g => g.label).join('と')}でネットワークを分けてください。`);
  if (internet) talk.push(proxy ? 'Webはプロキシを通したときだけ見られるようにしてください。' : 'インターネットも使えるようにお願いします。');
  if (dhcp !== 'none') talk.push('PCのアドレスは自動で配られるようにしてほしいです。');
  if (dns) talk.push('プリンタなどは名前で使えるようにしたいです。');
  if (nas) talk.push(nasGroups.length < staff.length ? `共有フォルダは${nasGroups[0].label}だけが使えるように。` : '共有フォルダも使います。');
  if (guests.length) talk.push(`${guests[0].label}のPCからは、社内の機器が見えないようにしてください。`);
  if (floors) talk.push('席は1階と2階に分かれていて、各階にVLAN対応のスイッチがあります。' + (redundant ? 'ケーブルが1本切れても仕事が止まらないようにしたいです。' : ''));
  if (mail) talk.push('社内のメールサーバーも立ててください。');
  if (wireless.size) talk.push('ノートPCは無線でつなぎたいです。');
  if (homePc) talk.push('自宅からも、社内にいるときと同じように仕事をしたいです。');
  if (web) talk.push(rp ? 'Webサイトが2つに増えました。外からのアクセスは1台で受けて、それぞれのWebサーバーへ振り分けたいです。' : pub ? 'ドメインを取ったので、その名前でWebサイトを公開したいです。' : '自社のWebサイトも外に公開したいです。');
  if (saasOn) talk.push('経費精算のクラウドサービスだけは、プロキシを通さずにつなぎたいです。');
  if (dkim) talk.push('取引先から、うちのメールが迷惑メールに振り分けられると言われました。対策もお願いします。');
  if (mon) talk.push('機器が止まったらすぐ分かるように、監視もしてほしいです。');
  if (extMail) talk.push('社外とのメールにも同じドメインを使います。');
  if (lb) talk.push('アクセスが増えてきたので、Webサーバーを2台にして振り分けてください。');
  talk.push(pick(r, ['アドレスなどの条件は仕様書に書きました。', '条件は仕様書のとおりです。', '仕様書を付けておきます。']));

  const hints = planHints({ internet, dhcp, dns, proxy, nas: !!nas, vlan, fw, subnet, guest: guests.length > 0, multi, routed, trunk, redundant, mail, wifi: wireless.size > 0, vpn: !!homePc, pub, spf: extMail, lb: !!lb, rp, dkim, saas: saasOn, mon, termLb });
  const title = rp ? '2つのWebサイトをリバースプロキシで公開' : lb ? 'アクセスの多いWebサイトの公開' : extMail ? '自社ドメインでWebとメールを使う' : pub ? '自社ドメインでWebサイトを公開' : homePc && !fw ? '自宅からもつながるネットワーク' : wireless.size && !fw && !vlan ? '無線LANのあるネットワーク' : redundant ? '止まらない社内ネットワーク' : trunk ? '2つの階にまたがるネットワーク' : fw ? '公開サーバーのある社内ネットワーク' : vlan ? '部署ごとに分けたネットワーク' : proxy ? 'プロキシ経由のインターネット接続'
    : nas ? 'ファイル共有のあるネットワーク' : dns ? '社内DNSのあるネットワーク' : multi ? '2つのネットワークをつなぐ' : dhcp !== 'none' ? 'アドレスを自動で配るLAN'
      : internet ? 'インターネット開通' : 'はじめての社内LAN';

  const supplied = b.devices.filter(d => d.own === 'supplied').map(d => ({ id: d.id, model: d.model, name: d.name }));
  const par = worldCost(solution);
  const base: Base = {
    id: `j${id}`, seed: id, kind: 'build', client, industry: ind.label, person, title, brief: talk.join(''), spec, tags,
    supplied, checks, initial: { devices: b.devices.filter(d => d.own === 'fixed').map(d => { const n = makeDevice(d.model, d.id, d.name, 'fixed', d.x, d.y); if (d.kind === 'internet') n.cfg.domain = d.cfg.domain; return n; }), cables: [] }, solution, par, hints, faults: [],
  };

  if ((opts.kind ?? 'build') === 'build') return finish(base, factors);

  return makeTrouble(base, factors, seed, cap, r, nameOf);
}

interface Feats { internet: boolean; dhcp: string; dns: boolean; proxy: boolean; nas: boolean; vlan: boolean; fw: boolean; subnet: boolean; guest: boolean; multi: boolean; routed: boolean; trunk: boolean; redundant: boolean; mail: boolean; wifi: boolean; vpn: boolean; pub: boolean; spf: boolean; lb: boolean; rp: boolean; dkim: boolean; saas: boolean; mon: boolean; termLb: boolean }
function planHints(f: Feats): string[] {
  const h: string[] = [];
  if (f.dns || f.proxy || f.dhcp === 'server') h.push('サーバーは1台で足ります。DNS・DHCP・プロキシなどのサービスは同じサーバーで一緒に動かせます。別のネットワークのPCも、ルーターやL3スイッチを通して同じサーバーを使えます。');
  h.push(f.vlan ? '中心にL3スイッチを置き、グループごとにVLANを分けます。各VLANのインターフェースに付けたIPが、そのグループのゲートウェイになります。'
    : f.multi ? 'グループごとにスイッチを用意し、ルーターのLAN1とLAN2に分けてつなぎます。ルーターの各LANのIPが、それぞれのゲートウェイです。'
      : '端末をL2スイッチにつなぎ、同じネットワークのIPアドレスを設定します。');
  if (f.subnet) h.push('サブネットマスクが /24 ではありません。仕様書の範囲に収まるアドレスを選び、マスクも合わせます(例: /26 は 64個ずつ)。');
  if (f.internet) h.push(f.fw ? 'ファイアウォールのWANを回線につなぎます。ファイアウォールは許可ルールに当てはまる通信だけを通します。' : 'ルーターのWANを回線につなぎ、端末のゲートウェイをルーターのLAN側のIPにします。');
  if (f.vlan && f.internet) h.push('L3スイッチとルーターの間にも小さなネットワークが要ります。L3スイッチにはデフォルトルート、ルーターには各グループへ戻るルートを書きます。');
  if (f.dhcp === 'router') h.push('ルーターのLANでDHCPをオンにし、配る範囲を仕様書のネットワーク内に設定します。PCは「自動取得」にします。');
  if (f.dhcp === 'server') h.push(f.vlan ? 'サーバーでDHCPを動かし、グループごとの配布範囲を作ります。L3スイッチの各VLANに「DHCPリレー」でサーバーのIPを指定します。' : 'サーバーでDHCPを動かし、配布範囲・ゲートウェイ・DNSを設定します。PCは「自動取得」にします。');
  if (f.dns) h.push('サーバーでDNSを動かし、仕様書の名前をレコードに登録します。外部の名前はフォワーダー(8.8.8.8)へ転送します。PCのDNSはこのサーバーにします。');
  if (f.proxy) h.push('サーバーでプロキシを動かし、PCのプロキシ欄に「サーバーのIP:8080」を入れます。直接のWebは、ルーターやファイアウォールのルールでサーバー以外を拒否します。');
  if (f.nas) h.push('NASの「利用を許可」に、使ってよいネットワークだけを書くと、ほかからは使えなくなります。');
  if (f.guest) h.push('ゲストから社内への通信は、中継する機器(ルーターやL3スイッチ)に拒否ルールを書いて止めます。ゲストのDNSは 8.8.8.8 にします。');
  if (f.trunk) h.push('各階のVLAN対応スイッチでは、端末のポートにその部署のVLAN番号を割り当てます。L3スイッチへ上がるポートは、両側とも「トランク」にします。');
  if (f.redundant) h.push('1階と2階のスイッチ同士もトランクでつなぐと、L3スイッチへの道が2通りになります。VLAN対応スイッチとL3スイッチは輪になっても止まりませんが、設定のいらないL2スイッチを輪に入れると通信できなくなります。');
  if (f.mail) h.push('サーバーでメールサービスをオンにし、DNSに mail の名前を登録します。');
  if (f.wifi) h.push('無線アクセスポイントをスイッチにつなぎ、SSIDと暗号化キーを仕様書どおりに設定します。ノートPCにはケーブルをつながず、同じSSIDとキーを入れます。');
  if (f.vpn) h.push('ルーター(またはファイアウォール)でVPNをオンにし、認証キーと、自宅PCに配る社内のアドレスを決めます。自宅PCには、会社の外側のアドレスと同じ認証キーを入れます。');
  if (f.pub) h.push('机の奥の回線(雲)をクリックすると、契約したドメインの公開DNSを編集できます。www のAレコードに会社の外側のアドレス(203.0.113.2)を登録し、Webサーバーの証明書の名前を公開する名前に合わせます。');
  if (f.spf) h.push('社外からメールを受け取るには、MXレコードでメールサーバーの名前を示し、その名前のAレコードを外側のアドレスにして、ファイアウォールでメール(25)をサーバーへ転送します。社外へ送るメールのために、TXTレコードに v=spf1 ip4:203.0.113.2 -all を登録します。');
  if (f.rp) h.push('DMZのスイッチに、リバースプロキシにするサーバーとWebサーバー2台をつなぎます。サーバーの「リバースプロキシ」をオンにして、名前ごとの転送先にWebサーバーのIPアドレスを書きます。ファイアウォールのポート転送の宛先は、リバースプロキシにします。証明書の名前を「*.ドメイン名」にすると、2つの名前の両方に当てはまります。公開DNSには、2つの名前のAレコードを両方登録します。');
  if (f.dkim) h.push('メールサーバーでDKIMをオンにすると、設定画面に公開鍵が出ます。公開DNSに s1._domainkey のTXTレコードを作り、v=DKIM1; k=rsa; p=公開鍵 を登録します。_dmarc のTXTレコードには v=DMARC1; p=reject を登録します。');
  if (f.saas) h.push('PCの「プロキシを使わない宛先」に saas.example.com を入れます。ルーターやファイアウォールのルールでは、社員のネットワークから 198.51.100.90 へのWebを、拒否ルールより上で許可します。');
  if (f.mon) h.push('サーバーで監視をオンにし、監視先にルーター、L3スイッチ、ほかのサーバーやNASのIPアドレスを並べます。ルーターやファイアウォールは、LAN側のアドレスを書きます。');
  if (f.termLb) h.push('証明書は負荷分散装置の設定に入れます。Webサーバー側の証明書は空欄でかまいません。');
  if (f.lb) h.push('負荷分散装置とWebサーバー2台をDMZのスイッチにつなぎ、装置の「振り分け先」に2台のIPアドレスを書きます。ポート転送の宛先は負荷分散装置にします。');
  if (f.fw) h.push('WebサーバーはDMZにつなぎ、ファイアウォールの「ポート転送」でWebをサーバーへ送ります。DMZから社内への許可ルールは作りません。');
  return h;
}

// 模範解答の見た目の配置(トラブル対応では、これが最初の机の上になる)
function layout(_b: Builder, t: { groups: { hosts: Device[]; sw?: Device }[]; inet: Device | null; gwDev: Device | null; l3: Device | null; side: Device[]; web: Device | null; dmzSw: Device | null; dmzHosts: Device[] }): void {
  const cx = t.side.length ? DESK_W / 2 - 90 : DESK_W / 2;
  const put = (d: Device | null | undefined, x: number, y: number) => { if (d) { d.x = Math.round(x); d.y = Math.round(y); } };
  const n = t.groups.reduce((s, g) => s + g.hosts.length, 0), gaps = t.groups.length - 1;
  const width = (t.side.length ? DESK_W - 330 : DESK_W - 140);
  const step = Math.min(132, width / (n + gaps * 0.7));
  const two = step < 112;
  // ある段だけを、上から下まで並べる。段の間隔は、上の段のポートの下端と下の段のポートの上端が重ならない広さにする
  const hasSw = t.groups.some(g => g.sw);
  const tiers = [t.inet ? 'inet' : '', t.gwDev ? 'gw' : '', t.l3 ? 'l3' : '', hasSw ? 'sw' : '', 'host'].filter(Boolean);
  const portRows = (d?: Device | null) => (d ? Math.ceil(Math.max(1, d.ports.length - (isGateway(d.kind) ? 1 : 0)) / 12) : 1);
  const down = (d?: Device | null) => (!d ? 0 : d.kind === 'internet' ? 72 : isHost(d.kind) ? 8 : 58 + 24 * (portRows(d) - 1));
  const up = (d?: Device | null) => (!d ? 0 : isGateway(d.kind) ? 72 : isHost(d.kind) ? 64 : 54);
  const sDown = (d?: Device | null) => (!d ? 0 : isHost(d.kind) ? 98 : d.kind === 'internet' ? (d.ports.length > 1 ? 94 : 80) : 46 + 24 * portRows(d) + 18);
  const sUp = (d?: Device | null) => (!d ? 0 : isGateway(d.kind) ? 80 : isHost(d.kind) ? 72 : d.kind === 'internet' ? 68 : 58);
  const repOf = (k: string) => k === 'inet' ? t.inet : k === 'gw' ? t.gwDev : k === 'l3' ? t.l3 : k === 'sw'
    ? t.groups.map(g => g.sw).filter((s): s is Device => !!s).reduce<Device | undefined>((a, b) => (!a || portRows(a) < portRows(b) ? b : a), undefined)
    : t.groups[0]?.hosts[0];
  // ポートが重ならない最小の間隔と、枠(機器の形)まで離れた間隔のあいだで、机に収まるよう伸縮する
  const pairs = tiers.slice(1).map(k => [repOf(tiers[tiers.indexOf(k) - 1]), repOf(k)] as const);
  const min = pairs.map(([a, b]) => down(a) + up(b) + 4);
  const wide = pairs.map(([a, b]) => sDown(a) + sUp(b) + 6);
  const avail = DESK_H - 100 - (two ? 110 : 0) - (t.inet ? 64 : 150);
  const minSum = min.reduce((s, v) => s + v, 0), wideSum = wide.reduce((s, v) => s + v, 0);
  const grow = wideSum > minSum ? Math.min(1, Math.max(0, (avail - minSum) / (wideSum - minSum))) : 0;
  const ys: Record<string, number> = {};
  let y = t.inet ? 64 : 150;
  for (const [i, k] of tiers.slice(1).entries()) y += min[i] + (wide[i] - min[i]) * grow, ys[k] = y;
  ys[tiers[0]] = t.inet ? 64 : 150;
  const yOf = (k: string) => ys[k] ?? 650;
  put(t.inet, cx, yOf('inet'));
  put(t.gwDev, cx, yOf('gw'));
  put(t.web, cx + 330, yOf('gw'));
  put(t.dmzSw, cx - 330, yOf('gw') + 20);
  t.dmzHosts.forEach((d, i) => put(d, cx - 460 + i * 130, 92));
  put(t.l3, cx, yOf('l3'));
  let x = cx - (step * (n - 1 + gaps * 0.7)) / 2;
  let k = 0;
  for (const g of t.groups) {
    const xs: number[] = [];
    for (const h of g.hosts) { put(h, x, yOf('host') + (two && k % 2 ? 110 : 0)); xs.push(x); x += step; k++; }
    x += step * 0.7;
    const mid = xs.reduce((s, v) => s + v, 0) / xs.length;
    put(g.sw, t.groups.length > 1 ? mid : cx, yOf('sw'));
  }
  const sideY = yOf(t.l3 ? 'l3' : hasSw ? 'sw' : 'host');
  t.side.forEach((d, i) => put(d, DESK_W - 130, Math.min(sideY, 480) + i * 150));
}
