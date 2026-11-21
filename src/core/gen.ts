// 依頼の自動生成
// 1) 顧客像と要件を決める → 2) 正解の構成を組み立てる → 3) 検収テストを作る → 4) シミュレータで確かめる
// トラブル対応は、正解の構成に不具合を入れて壊したものを初期状態にする
import { Check, Target, describe, evaluate } from './checks';
import { cidrStr, ipStr, parseIp } from './ip';
import { Builder, DESK_W, Difficulty, Factor, Job, JobCheck, Rng, SpecRow, mulberry, pick, randInt, shuffle, worldCost } from './job';
import { Device, GwCfg, L3Cfg, Rule, ServerCfg, clone, isEndpoint } from './model';
import { faultCatalog } from './faults';

const ip = (s: string): number => parseIp(s)!;

interface Industry {
  id: string; label: string; suffix: string[]; groups: string[]; guest?: string;
  extra: ('printer' | 'phone' | 'pos' | 'camera')[];
  person: string[];
}
const INDUSTRIES: Industry[] = [
  { id: 'office', label: '事務所', suffix: ['商事', '税理士事務所', '企画', '法律事務所'], groups: ['総務部', '営業部', '経理部'], extra: ['printer', 'phone'], person: ['総務の担当者', '社長', '所長'] },
  { id: 'design', label: '設計事務所', suffix: ['設計事務所', 'デザイン', '建築工房'], groups: ['設計室', '営業部'], extra: ['printer'], person: ['所長', '設計主任'] },
  { id: 'shop', label: '店舗', suffix: ['マート', '書店', 'ベーカリー', '薬局'], groups: ['事務室', '売り場'], extra: ['printer', 'pos', 'camera'], person: ['店長', 'オーナー'] },
  { id: 'clinic', label: 'クリニック', suffix: ['クリニック', '歯科', '動物病院'], groups: ['受付', '診察室'], extra: ['printer', 'phone'], person: ['院長', '事務長'] },
  { id: 'school', label: '学習塾', suffix: ['学習塾', 'ゼミナール', '英会話教室'], groups: ['職員室'], guest: '教室', extra: ['printer'], person: ['塾長', '教室長'] },
  { id: 'hotel', label: '宿泊施設', suffix: ['ホテル', '旅館', 'ゲストハウス'], groups: ['事務所'], guest: 'ロビー', extra: ['printer', 'phone'], person: ['支配人', '女将'] },
  { id: 'cafe', label: '飲食店', suffix: ['カフェ', '珈琲店', '食堂'], groups: ['事務室'], guest: '客席', extra: ['printer', 'pos'], person: ['店長', 'マスター'] },
  { id: 'factory', label: '工場', suffix: ['製作所', '工業', '食品'], groups: ['事務所', '製造ライン'], extra: ['printer', 'camera'], person: ['工場長', '総務の担当者'] },
];
const NAMES: [string, string][] = [
  ['みどり', 'midori'], ['あおば', 'aoba'], ['北斗', 'hokuto'], ['さくら', 'sakura'], ['つばめ', 'tsubame'], ['ひまわり', 'himawari'],
  ['白樺', 'shirakaba'], ['ポラリス', 'polaris'], ['かもめ', 'kamome'], ['こだま', 'kodama'], ['すばる', 'subaru'], ['やまびこ', 'yamabiko'],
  ['あさひ', 'asahi'], ['しらゆり', 'shirayuri'], ['三日月', 'mikazuki'], ['はやぶさ', 'hayabusa'], ['もみじ', 'momiji'], ['わかば', 'wakaba'],
];

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
    const j = attempt((seed + k * 104729) >>> 0, seed, level, opts);
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
  const internet = cap >= 2 && (cap === 2 || chance(0.88));
  const dns = internet && want(4, 0.55);
  const proxy = dns && want(6, 0.4);
  const nasWanted = want(7, 0.45);
  const fw = internet && want(10, 0.4);
  const vlan = want(8, 0.55);
  const subnet = !vlan && want(5, 0.35);
  let dhcp: 'none' | 'router' | 'server' = 'none';
  if (vlan) dhcp = want(9, 0.5) ? 'server' : 'none';
  else if (cap >= 3 && (cap === 3 ? chance(0.8) : chance(0.5))) dhcp = fw ? 'server' : internet || cap >= 5 ? 'router' : 'none';

  const ind = pick(r, INDUSTRIES.filter(i => (cap >= 7 || !i.guest) && (cap >= 3 || i.id !== 'factory')));
  const [jp, romaji] = pick(r, NAMES);
  const client = jp + pick(r, ind.suffix), dom = romaji + '.local';
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
    key: 'g' + i, label, short: label.replace(/[部室]$/, ''), role, net: ip(`192.168.${octet + i * 10}.0`), prefix: 24, vlan: 10 + i * 10,
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
      const d = b.add('pc', `${g.key}pc${i + 1}`, `${g.role === 'guest' ? 'ゲスト' : tag(g)}PC-${i + 1}`, 'supplied');
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
  if (inet && gwDev) b.link(inet, 0, gwDev, 0);

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
    for (const g of groups) {
      if (direct) for (const h of g.hosts) { c.portVlan[p] = g.vlan; b.link(h, 0, l3, p++); }
      else {
        const s = swFor(g.hosts.length + 1, 'sw' + g.key, 'スイッチ' + letter(groups.indexOf(g)));
        if (!s) return null;
        g.sw = s;
        c.portVlan[p] = g.vlan; b.link(s, 0, l3, p++);
        for (const h of g.hosts) b.plug(h, s);
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
      for (const h of g.hosts) b.plug(h, s);
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
    if (proxy) { c.proxyOn = true; if (guests.length) c.proxyAllow = staff.map(cidr).join(', '); }
  }
  if (nas) { nasIp = take(srvGroup, 'nas'); hostCfg(nas, srvGroup, nasIp); if (nasBought) records.push({ name: `nas.${dom}`, ip: nasIp }); }
  if (web && gwDev) {
    const g = gwDev.cfg as GwCfg;
    webIp = ipStr(dmzNet + 80);
    b.link(web, 0, gwDev, 1);
    g.lan[0].ip = ipStr(dmzNet + 1); g.lan[0].prefix = 24;
    Object.assign(web.cfg, { ip: webIp, prefix: 24, gw: ipStr(dmzNet + 1), webOn: true });
    g.forwards.push({ svc: 'web', to: webIp });
    if (dns) records.push({ name: `www.${dom}`, ip: webIp });
  }

  // 端末の設定
  const dnsFor = (g: Group) => (dns && g.role === 'staff' ? serverIp : internet ? '8.8.8.8' : '');
  for (const g of groups) {
    const [ds, de] = dhcpRange(g);
    for (const h of g.hosts) {
      if (g.dhcp && h.kind === 'pc') h.cfg.mode = 'dhcp';
      else {
        hostCfg(h, g, take(g, h.kind === 'pc' ? 'pc' : h.kind === 'printer' ? 'printer' : 'misc'));
        h.cfg.dns = h.kind === 'printer' ? '' : dnsFor(g);
      }
      if (proxy && h.kind === 'pc' && g.role === 'staff') h.cfg.proxy = `${serverIp}:8080`;
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
        for (const g of guests) rules.push({ action: 'allow', src: cidr(g), dst: 'any', svc: 'any' });
      } else for (const g of inner) rules.push({ action: 'allow', src: cidr(g), dst: 'any', svc: 'any' });
    } else {
      if (!l3) for (const g of guests) for (const o of staff) rules.push({ action: 'deny', src: cidr(g), dst: cidr(o), svc: 'any' });
      if (proxy) {
        rules.push({ action: 'allow', src: serverIp, dst: 'any', svc: 'web' });
        for (const g of guests) rules.push({ action: 'allow', src: cidr(g), dst: 'any', svc: 'web' });
        rules.push({ action: 'deny', src: 'any', dst: 'any', svc: 'web' });
      }
    }
    c.rules = rules;
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
    add({ t: 'flow', from: ['inet'], to: { pub: true }, svc: 'web', expect: 'ok' });
    if (dns) add({ t: 'flow', from: ids(home.pcs), to: { name: `www.${dom}` }, svc: 'web', expect: 'ok', via: proxy ? 'proxy' : undefined }, whoPc(home));
    add({ t: 'flow', from: ['inet'], to: { pub: true }, svc: 'file', expect: 'ng' });
    restrict.push('dmz');
  }
  // ---- 4) 確かめる ----
  layout(b, { groups, inet, gwDev, l3, side: [server, nas].filter((x): x is Device => !!x), web });
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
  if (restrict.length) { tags.push('通信制限'); factors.push({ label: `通信の制限(${new Set(restrict).size}種類)`, pts: new Set(restrict).size * 3 }); }

  const person = pick(r, ind.person);
  const spec: SpecRow[] = [];
  spec.push({ head: 'アドレス', body: groups.map(g => `${multi ? g.label + ': ' : ''}${cidr(g)}${g.dhcp ? '(PCはDHCPで自動取得)' : ''}`).join('\n') });
  if (internet) spec.push({ head: 'インターネット', body: proxy ? '社員のPCはプロキシ経由でだけWebを見られること' : `回線は契約済み。公開DNSは 8.8.8.8` });
  if (records.length) spec.push({ head: '名前', body: records.map(x => `${x.name} → ${nameOf(b.devices.find(d => d.cfg.ip === x.ip)!.id)}`).join('\n') });
  if (nas) spec.push({ head: 'ファイル共有', body: `${nasBought ? 'NASを新しく用意する' : 'お客様のNASを使う'}。使えるのは ${nasGroups.map(g => (multi ? g.label : '社内のPC')).join('・')}${cams.length ? ' とカメラ' : ''}` });
  if (guests.length) spec.push({ head: 'ゲスト用', body: `${guests[0].label}のPCはインターネットだけ使える。社内の機器には届かないこと` });
  if (web) spec.push({ head: '公開サーバー', body: 'Webサーバーをインターネットに公開する。公開サーバーから社内には入れないこと' });

  const talk: string[] = [];
  const things = [`PC${b.devices.filter(d => d.kind === 'pc').length}台`, printerGroups.length ? 'プリンタ' : '', phones.length ? '電話' : '', cams.length ? '防犯カメラ' : '', b.devices.some(d => d.kind === 'pos') ? 'レジ' : ''].filter(Boolean).join('、');
  talk.push(`${ind.label}の${things}をネットワークにつなぎたいんです。`);
  if (multi) talk.push(`${groups.map(g => g.label).join('と')}でネットワークを分けてください。`);
  if (internet) talk.push(proxy ? 'Webはプロキシを通したときだけ見られるようにしてください。' : 'インターネットも使えるようにお願いします。');
  if (dhcp !== 'none') talk.push('PCのアドレスは自動で配られるようにしてほしいです。');
  if (dns) talk.push('プリンタなどは名前で使えるようにしたいです。');
  if (nas) talk.push(nasGroups.length < staff.length ? `共有フォルダは${nasGroups[0].label}だけが使えるように。` : '共有フォルダも使います。');
  if (guests.length) talk.push(`${guests[0].label}のPCからは、社内の機器が見えないようにしてください。`);
  if (web) talk.push('自社のWebサイトも外に公開したいです。');
  talk.push('細かい条件は仕様書にまとめました。');

  const hints = planHints({ internet, dhcp, dns, proxy, nas: !!nas, vlan, fw, subnet, guest: guests.length > 0, multi, routed });
  const title = fw ? '公開サーバーのある社内ネットワーク' : vlan ? '部署ごとに分けたネットワーク' : proxy ? 'プロキシ経由のインターネット接続'
    : nas ? 'ファイル共有のあるネットワーク' : dns ? '社内DNSのあるネットワーク' : multi ? '2つのネットワークをつなぐ' : dhcp !== 'none' ? 'アドレスを自動で配るLAN'
      : internet ? 'インターネット開通' : 'はじめての社内LAN';

  const supplied = b.devices.filter(d => d.own === 'supplied').map(d => ({ id: d.id, model: d.model, name: d.name }));
  const par = worldCost(solution);
  const base: Omit<Job, 'difficulty' | 'reward' | 'xp' | 'minutes'> = {
    id: `j${id}`, seed: id, kind: 'build', client, industry: ind.label, person, title, brief: talk.join(''), spec, tags,
    supplied, checks, initial: { devices: inet ? [clone(inet)] : [], cables: [] }, solution, par, hints, faults: [],
  };

  if ((opts.kind ?? 'build') === 'build') return finish(base, factors);

  // ---- トラブル対応: 正解を壊す ----
  const broken = clone(solution);
  for (const d of broken.devices) if (d.own === 'bought') { d.own = 'supplied'; d.cost = 0; }
  for (const c of broken.cables) c.free = true;
  const count = Math.min(4, 1 + Math.floor(cap / 3) + (chance(0.4) ? 1 : 0));
  const picked: { desc: string; weight: number }[] = [];
  const fr = mulberry(seed ^ 0x9e3779b9);
  for (const f of shuffle(fr, faultCatalog)) {
    if (picked.length >= count) break;
    // 単独で入れたときに、検収テストが1つ以上落ちる不具合だけを使う
    const solo = clone(solution), s1 = mulberry(seed + f.key.length * 977);
    if (!f.apply(solo, s1)) continue;
    if (evaluate(solo, rawChecks, nameOf).every(x => x.ok)) continue;
    const desc = f.apply(broken, mulberry(seed + f.key.length * 977));
    if (desc) picked.push({ desc, weight: f.weight });
  }
  if (!picked.length || evaluate(broken, rawChecks, nameOf).every(x => x.ok)) return null;
  // 直す仕事は組み立てより手数が少ないので、規模の点数は半分にする
  const scale = Math.round(factors.reduce((t, f) => t + f.pts, 0) * 0.4);
  factors.length = 0;
  factors.push({ label: 'ネットワークの規模と内容', pts: scale });
  factors.push({ label: `不具合の数(${picked.length})`, pts: picked.length * 3 });
  factors.push({ label: '不具合の見つけにくさ', pts: picked.reduce((s, p) => s + p.weight, 0) });
  const symptom = evaluate(broken, rawChecks, nameOf).map((x, i) => (x.ok ? '' : checks[i].label)).filter(Boolean);
  return finish({
    ...base, kind: 'trouble', title: troubleTitle(symptom, r), supplied: [], initial: broken, par: 0,
    brief: `${pick(r, ['先週から', '昨日の模様替えのあとから', '機器を入れ替えてから', '今朝から'])}調子が悪くて困っています。${symptom.length > 1 ? 'いくつか不具合が重なっているかもしれません。' : ''}前に頼んだ業者とは連絡がつかなくて…。仕様書のとおりに動くよう直してください。`,
    hints: ['まず検収テストで落ちている項目を見て、どの機器の通信が失敗しているかを絞ります。', '失敗している機器を選び、診断ツールの ping を近い相手から順に打ちます(同じネットワークの機器 → ゲートウェイ → その先)。', '止まった場所の機器の設定と配線を、仕様書と見比べます。'],
    faults: picked.map(p => p.desc),
  }, factors);
}

function troubleTitle(symptom: string[], r: Rng): string {
  const s = symptom.join(' ');
  if (/印刷/.test(s) && symptom.length === 1) return '印刷できない';
  if (/Web|開ける|インターネット/.test(s)) return pick(r, ['インターネットにつながらない', 'Webが見られない']);
  if (/共有/.test(s)) return '共有フォルダが開けない';
  if (/通信できない|出られない|使えない/.test(s)) return '見えてはいけないものが見えている';
  return pick(r, ['ネットワークの調子が悪い', '急につながらなくなった']);
}

function finish(base: Omit<Job, 'difficulty' | 'reward' | 'xp' | 'minutes'>, factors: Factor[]): Job {
  const score = factors.reduce((s, f) => s + f.pts, 0);
  const stars = score < 9 ? 1 : score < 18 ? 2 : score < 30 ? 3 : score < 45 ? 4 : 5;
  const difficulty: Difficulty = { stars, score, factors };
  const labor = 5000 + score * 1100;
  const reward = Math.round((base.par * 1.12 + labor) / 500) * 500;
  return { ...base, difficulty, reward, xp: 20 + score * 6, minutes: Math.round(4 + score * 0.45) };
}

interface Feats { internet: boolean; dhcp: string; dns: boolean; proxy: boolean; nas: boolean; vlan: boolean; fw: boolean; subnet: boolean; guest: boolean; multi: boolean; routed: boolean }
function planHints(f: Feats): string[] {
  const h: string[] = [];
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
  if (f.fw) h.push('WebサーバーはDMZにつなぎ、ファイアウォールの「ポート転送」でWebをサーバーへ送ります。DMZから社内への許可ルールは作りません。');
  return h;
}

// 模範解答の見た目の配置(トラブル対応では、これが最初の机の上になる)
function layout(b: Builder, t: { groups: Group[]; inet: Device | null; gwDev: Device | null; l3: Device | null; side: Device[]; web: Device | null }): void {
  const cx = t.side.length ? DESK_W / 2 - 90 : DESK_W / 2;
  const put = (d: Device | null | undefined, x: number, y: number) => { if (d) { d.x = Math.round(x); d.y = Math.round(y); } };
  const n = t.groups.reduce((s, g) => s + g.hosts.length, 0), gaps = t.groups.length - 1;
  const width = (t.side.length ? DESK_W - 330 : DESK_W - 140);
  const step = Math.min(132, width / (n + gaps * 0.7));
  const two = step < 112;
  // ある段だけを、上から下まで等間隔に並べる
  const hasSw = t.groups.some(g => g.sw);
  const tiers = [t.inet ? 'inet' : '', t.gwDev ? 'gw' : '', t.l3 ? 'l3' : '', hasSw ? 'sw' : '', 'host'].filter(Boolean);
  const top = t.inet ? 82 : 150, bottom = two ? 585 : 650;
  const yOf = (k: string) => (tiers.length === 1 ? bottom : top + ((bottom - top) * tiers.indexOf(k)) / (tiers.length - 1));
  put(t.inet, cx, yOf('inet'));
  put(t.gwDev, cx, yOf('gw'));
  put(t.web, cx + 330, yOf('gw'));
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
