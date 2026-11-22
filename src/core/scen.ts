// 拠点やクラウドをまたぐ依頼の生成(Lv.19〜)
// 本店・支店・クラウドを部品として組み合わせる。構成変更の依頼は、変更前と変更後の2つの構成を同じ材料から作り、
// 変更前を最初の机の上、変更後を模範解答にする
import { Check, Target, describe, evaluate } from './checks';
import { Base, INDUSTRIES, NAMES, finish, makeTrouble } from './genlib';
import { cidrStr, ipStr, parseIp } from './ip';
import { Builder, Factor, Job, JobCheck, Rng, SpecRow, Zone, mulberry, pick, randInt, worldCost } from './job';
import { Device, GwCfg, InetCfg, L3Cfg, World, clone, isEndpoint, makeDevice } from './model';
import { CLOUD_IP, EXTERNAL, lineIp } from './sim';

const ip = (s: string): number => parseIp(s)!;
const VNET = ip('10.20.0.0'), WNET = ip('10.0.0.0'), UPNET = ip('10.255.0.0');
const CLOUD = ipStr(CLOUD_IP), SAAS = 'saas.example.com';
const cidr = (n: number): string => cidrStr(n, 24);
const G = (d: Device): GwCfg => d.cfg as GwCfg;

// 業種ごとの拠点の呼び名(1つ目が本拠)
const SITE_LABELS: Record<string, [string, string, string]> = {
  office: ['本社', '支店', '営業所'], design: ['本社', '分室', '別館'], shop: ['本店', '駅前店', '倉庫'], clinic: ['本院', '分院', '健診所'],
  account: ['本所', '支所', '出張所'], estate: ['本店', '支店', '営業所'], factory: ['本社', '工場', '倉庫'],
};
const KEYS = ['hq', 'br', 'b2'];

/** どんな構成にするか */
interface Plan {
  branches: number;
  link: 'none' | 'wan' | 'vpn';
  /** 本拠のルーターと回線を二重にする。vipFirst は、仮想IPアドレスを元のゲートウェイのアドレスにする */
  vrrp?: boolean; vipFirst?: boolean;
  cloud?: boolean;
  /** full: DNSとファイル共有 / plain: ファイル共有(と公開Web) */
  server: 'none' | 'full' | 'plain';
  pubWeb?: boolean; mail?: boolean; dhcp?: boolean;
  /** 支店同士は通信させない */
  isolate?: boolean;
  /** 全拠点のWebを、本拠のサーバーのプロキシに通す */
  proxy?: boolean;
  /** 支店は、クラウドサービスにだけ自分の回線から直接つなぐ */
  breakout?: boolean;
}
interface SiteDef { key: string; label: string; nPc: number; printer: boolean; phone: boolean }
/** 変更前と変更後で共通の材料 */
interface Ctx {
  defs: SiteDef[]; octet: number; dom: string; pubDom: string; psk: string;
  sites: number; lines: number; wan: boolean; cloud: boolean; vrrp: boolean; hqServer: boolean; pub: boolean;
  cols: [number, number][];
}
interface Site { def: SiteDef; net: number; gw: string; pcs: Device[]; hosts: Device[]; printer?: Device; phone?: Device; rts: Device[]; sw: Device }
interface Built {
  world: World; checks: JobCheck[]; names: Map<string, string>;
  spec: SpecRow[]; tags: string[]; factors: Factor[]; hints: string[]; zones: Zone[];
}

const put = (d: Device | null | undefined, x: number, y: number): void => { if (d) { d.x = Math.round(x); d.y = Math.round(y); } };

/** 検収テスト・タグ・難易度の点数をためていく入れ物 */
function ledger(b: Builder) {
  const names = new Map(b.devices.map(d => [d.id, d.name]));
  const nameOf = (x: string) => names.get(x) ?? x;
  const checks: JobCheck[] = [], tags: string[] = ['LAN'], factors: Factor[] = [], restrict: string[] = [];
  const infra = b.devices.filter(d => !isEndpoint(d.kind) && d.own !== 'fixed').length, ends = b.devices.filter(d => isEndpoint(d.kind)).length;
  factors.push({ label: `機器の数(端末${ends}台・機材${infra}台)`, pts: Math.round(ends * 0.5 + infra * 1.5) });
  return {
    names, nameOf, checks, tags, factors, restrict,
    add: (check: Check, who?: string) => { checks.push({ check, label: describe(check, nameOf, who) }); },
    know: (on: boolean, tag: string, pts: number) => { if (on) { tags.push(tag); factors.push({ label: `必要な知識: ${tag}`, pts }); } },
    close: (nets: number) => {
      if (nets > 1) factors.splice(1, 0, { label: `ネットワークの数(${nets})`, pts: nets * 2 });
      if (restrict.length) { tags.push('通信制限'); factors.push({ label: `通信の制限(${new Set(restrict).size}種類)`, pts: new Set(restrict).size * 3 }); }
    },
  };
}
const ids = (l: Device[]): string[] => l.map(d => d.id);

// ---------------------------------------------------------------- 本拠・支店・クラウド
function compose(c: Ctx, p: Plan): Built {
  const b = new Builder();
  const multi = c.sites > 1, full = p.server === 'full';
  const inet = b.add(c.lines === 1 ? 'internet' : `internet-${c.lines}`, 'inet', 'インターネット', 'fixed');
  const wan = c.wan ? b.add('wan', 'wan', '広域イーサネット', 'fixed') : null;
  const cloud = c.cloud ? b.add('cloud', 'cloud', 'クラウド', 'fixed') : null;
  const svIp = `192.168.${c.octet}.53`, vsIp = ipStr(VNET + 10), dnsIp = full ? svIp : '8.8.8.8';
  if (c.pub) (inet.cfg as InetCfg).domain = c.pubDom;

  // 拠点ごとの機器と配線。ポートの並びは、変更前と変更後で同じになるようにする
  const sites: Site[] = [];
  for (let i = 0; i <= p.branches; i++) {
    const d = c.defs[i], L = multi ? d.label : '', net = ip(`192.168.${c.octet + i * 10}.0`);
    const two = i === 0 && !!p.vrrp, rn = i === 0 && c.vrrp ? 2 : 1;
    const s: Site = { def: d, net, gw: ipStr(net + (two && !p.vipFirst ? 254 : 1)), pcs: [], hosts: [], rts: [], sw: null! };
    for (let n = 1; n <= d.nPc; n++) s.pcs.push(b.add('pc', `${d.key}pc${n}`, `${L}PC-${n}`, 'supplied'));
    s.hosts.push(...s.pcs);
    if (d.printer) s.hosts.push(s.printer = b.add('printer', `${d.key}prn`, `${L}プリンタ`, 'supplied'));
    if (d.phone) s.hosts.push(s.phone = b.add('phone', `${d.key}tel`, `${L}電話`, 'supplied'));
    const ports = s.hosts.length + rn + (i === 0 && c.hqServer ? 1 : 0);
    s.rts.push(b.add('router', `${d.key}rt`, `${L}ルーター${rn === 2 ? '-1' : ''}`));
    s.sw = b.add(ports <= 5 ? 'l2-5' : ports <= 8 ? 'l2-8' : 'l2-16', `${d.key}sw`, `${L}スイッチ`);
    b.link(s.rts[0], 1, s.sw, 0);
    for (const h of s.hosts) b.plug(h, s.sw);
    sites.push(s);
  }
  const hq = sites[0], branches = sites.slice(1), H = hq.def.label;
  const sv = p.server !== 'none' ? b.add('server', 'sv', `${multi ? H : ''}サーバー`) : null;
  if (sv) b.plug(sv, hq.sw);
  if (p.vrrp) {
    const r2 = b.add('router', 'hqrt2', `${multi ? H : ''}ルーター-2`);
    hq.rts.push(r2);
    b.link(r2, 1, hq.sw, b.freePort(hq.sw));
  }

  // ルーターのLAN側
  for (const s of sites) s.rts.forEach((rt, k) => {
    const two = s.rts.length === 2, l = G(rt).lan[0];
    l.ip = ipStr(s.net + (two ? (p.vipFirst ? 2 : 1) + k : 1));
    if (two) { l.vip = s.gw; l.prio = k === 0 ? 110 : 100; }
    if (p.dhcp) Object.assign(l, { dhcpOn: true, dhcpStart: ipStr(s.net + (two ? 100 + k * 25 : 100)), dhcpEnd: ipStr(s.net + (two ? 124 + k * 25 : 150)), dhcpDns: dnsIp });
  });
  b.link(inet, 0, hq.rts[0], 0);
  if (p.vrrp) b.link(inet, 1, hq.rts[1], 0);
  if (p.breakout) b.link(inet, 1, branches[0].rts[0], 0);

  // 拠点の間
  const wIp = (n: number) => ipStr(WNET + n);
  if (p.link === 'wan' && wan) {
    const hqW = p.vrrp ? wIp(6) : wIp(1);
    hq.rts.forEach((rt, k) => {
      Object.assign(G(rt).lan[1], { ip: wIp(1 + k), prefix: 29 }, p.vrrp ? { vip: hqW, prio: k === 0 ? 110 : 100 } : {});
      b.link(rt, 2, wan, k === 0 ? 0 : 2);
      branches.forEach((s, i) => G(rt).routes.push({ dest: cidr(s.net), via: wIp(3 + i) }));
      if (p.isolate && branches.length === 2) for (const [x, y] of [[0, 1], [1, 0]]) G(rt).rules.push({ action: 'deny', src: cidr(branches[x].net), dst: cidr(branches[y].net), svc: 'any' });
    });
    branches.forEach((s, i) => {
      Object.assign(G(s.rts[0]).lan[1], { ip: wIp(3 + i), prefix: 29 });
      b.link(s.rts[0], 2, wan, 1 + i);
      G(s.rts[0]).routes.push({ dest: '0.0.0.0/0', via: hqW });
    });
  }
  if (p.link === 'vpn') branches.forEach((s, i) => {
    b.link(inet, i + 1, s.rts[0], 0);
    G(hq.rts[0]).tunnels.push({ peer: ipStr(lineIp(i + 1)), key: c.psk, nets: cidr(s.net) });
    const far = [hq.net, ...(p.isolate ? [] : branches.filter(x => x !== s).map(x => x.net)), ...(p.cloud ? [VNET] : [])];
    G(s.rts[0]).tunnels.push({ peer: ipStr(lineIp(0)), key: c.psk, nets: far.map(cidr).join(', ') });
  });

  // サーバー
  const records: { name: string; ip: string }[] = [];
  if (sv) {
    Object.assign(sv.cfg, { ip: svIp, prefix: 24, gw: hq.gw, fileOn: true, dns: full ? '' : '8.8.8.8' });
    if (full) { Object.assign(sv.cfg, { dnsOn: true, forwarder: '8.8.8.8', records }); records.push({ name: `files.${c.dom}`, ip: svIp }); }
  }
  let vs: Device | null = null;
  if (p.cloud && cloud) {
    const cg = G(cloud);
    cg.lan[0].ip = ipStr(VNET + 1);
    vs = b.add('vserver', 'vs', '仮想サーバー', 'supplied');
    Object.assign(vs.cfg, { ip: vsIp, prefix: 24, gw: ipStr(VNET + 1), dns: '8.8.8.8', fileOn: true });
    b.link(vs, 0, cloud, 1);
    G(hq.rts[0]).tunnels.push({ peer: CLOUD, key: c.psk, nets: cidr(VNET) });
    cg.tunnels.push({ peer: ipStr(lineIp(0)), key: c.psk, nets: sites.map(s => cidr(s.net)).join(', ') });
    for (const s of sites) cg.rules.push({ action: 'allow', src: cidr(s.net), dst: cidr(VNET), svc: 'any' });
    cg.rules.push({ action: 'allow', src: cidr(VNET), dst: 'any', svc: 'any' });
  }
  const z = inet.cfg as InetCfg, webHost = p.pubWeb ? vs ?? sv : null;
  if (webHost) {
    Object.assign(webHost.cfg, { webOn: true, cert: `www.${c.pubDom}` });
    G(vs ? cloud! : hq.rts[0]).forwards.push({ svc: 'web', to: webHost.cfg.ip });
    z.zone.push({ type: 'A', name: 'www', value: vs ? CLOUD : ipStr(lineIp(0)) });
  }
  const mailHost = p.mail ? vs ?? sv : null, outer = vs ? CLOUD : ipStr(lineIp(0));
  if (mailHost) {
    mailHost.cfg.mailOn = true;
    G(vs ? cloud! : hq.rts[0]).forwards.push({ svc: 'mail', to: mailHost.cfg.ip });
    z.zone.push({ type: 'A', name: 'mail', value: outer }, { type: 'MX', name: '@', value: 'mail' }, { type: 'TXT', name: '@', value: `v=spf1 ip4:${outer} -all` });
  }
  // プロキシ: 本拠のサーバーからのWebだけを通す。拠点ごとに回線があるときは、各拠点のルーターでもWebを止める
  const proxy = !!p.proxy && !!sv && full;
  if (proxy && sv) {
    sv.cfg.proxyOn = true;
    for (const rt of hq.rts) G(rt).rules.push({ action: 'allow', src: svIp, dst: 'any', svc: 'web' }, { action: 'deny', src: 'any', dst: 'any', svc: 'web' });
    if (p.link === 'vpn') for (const s of branches) G(s.rts[0]).rules.push({ action: 'deny', src: 'any', dst: 'any', svc: 'web' });
  }
  if (p.breakout) G(branches[0].rts[0]).routes.push({ dest: `${EXTERNAL[SAAS]}/32`, via: ipStr(lineIp(1) - 1) });

  // 端末
  for (const s of sites) {
    let n = 0;
    for (const h of s.hosts) {
      if (p.dhcp && h.kind === 'pc') { h.cfg.mode = 'dhcp'; continue; }
      const last = h.kind === 'pc' ? 11 + n++ : h.kind === 'printer' ? 200 : 30;
      Object.assign(h.cfg, { ip: ipStr(s.net + last), prefix: 24, gw: s.gw, dns: h.kind === 'printer' ? '' : dnsIp });
    }
    if (proxy) for (const h of s.pcs) { h.cfg.proxy = `${svIp}:8080`; if (p.breakout && s !== hq) h.cfg.noProxy = SAAS; }
    if (s.printer && full) records.push({ name: `printer${multi ? '-' + s.def.key : ''}.${c.dom}`, ip: s.printer.cfg.ip });
  }

  // ---- 検収テスト ----
  const q = ledger(b), { add, know } = q;
  const who = (s: Site) => (multi ? `${s.def.label}のPC` : s.pcs.length > 3 ? '全PC' : undefined);
  for (const s of sites) {
    add({ t: 'addr', devs: ids(s.hosts), cidr: cidr(s.net) }, multi ? `${s.def.label}の機器` : '全機器');
    if (p.dhcp) add({ t: 'dhcp', devs: ids(s.pcs) }, who(s) ?? s.pcs.map(d => d.name).join('・'));
  }
  const web = (s: Site): Check => ({ t: 'flow', from: ids(s.pcs), to: { ext: 'www.example.com' }, svc: 'web', expect: 'ok', via: proxy ? 'proxy' : undefined });
  const fileTo: Target | null = vs ? { dev: vs.id } : sv ? (full ? { name: `files.${c.dom}` } : { dev: sv.id }) : null; // 購入するサーバーは、置いたときにIDが変わる。名前で指す
  const file = (s: Site): Check => ({ t: 'flow', from: ids(s.pcs), to: fileTo!, svc: 'file', expect: 'ok' });
  for (const s of sites) {
    const prn = s.printer ?? hq.printer;
    if (prn) {
      const rec = records.find(x => x.ip === prn.cfg.ip);
      add({ t: 'flow', from: ids(s.pcs), to: rec ? { name: rec.name, dev: prn.id } : { dev: prn.id }, svc: 'print', expect: 'ok' }, who(s));
    }
    if (fileTo) add(file(s), who(s));
    add(web(s), who(s));
    if (proxy) { add({ t: 'directWeb', from: ids(s.pcs) }, who(s)); q.restrict.push('direct'); }
  }
  if (p.breakout) add({ t: 'flow', from: ids(branches[0].pcs), to: { ext: SAAS }, svc: 'web', expect: 'ok', via: 'direct', line: 1 }, who(branches[0]));
  for (const s of branches) add({ t: 'flow', from: [hq.pcs[0].id], to: { dev: s.pcs[0].id }, svc: 'ping', expect: 'ok' });
  if (hq.phone && branches[0]?.phone) add({ t: 'flow', from: [hq.phone.id], to: { dev: branches[0].phone.id }, svc: 'voice', expect: 'ok' });
  if (branches.length === 2) {
    const [x, y] = branches;
    if (p.isolate) {
      add({ t: 'flow', from: ids(x.pcs), to: { dev: y.pcs[0].id }, svc: 'ping', expect: 'ng' }, who(x));
      add({ t: 'flow', from: ids(y.pcs), to: { dev: x.pcs[0].id }, svc: 'ping', expect: 'ng' }, who(y));
      q.restrict.push('site');
    } else add({ t: 'flow', from: [x.pcs[0].id], to: { dev: y.pcs[0].id }, svc: 'ping', expect: 'ok' });
  }
  if (vs) {
    add({ t: 'addr', devs: [vs.id], cidr: cidr(VNET) });
    add({ t: 'flow', from: [vs.id], to: { ext: 'update.example.org' }, svc: 'web', expect: 'ok' });
    add({ t: 'flow', from: ['inet'], to: { pub: true, ip: CLOUD }, svc: 'file', expect: 'ng' });
    q.restrict.push('cloud');
  }
  if (webHost) add({ t: 'flow', from: ['inet'], to: { name: `www.${c.pubDom}` }, svc: 'web', expect: 'ok', https: true, by: webHost.id });
  if (mailHost) {
    add({ t: 'mailIn', domain: c.pubDom });
    add({ t: 'mailOut' });
    add({ t: 'flow', from: ids(hq.pcs), to: { dev: mailHost.id }, svc: 'mail', expect: 'ok' }, who(hq));
  }
  if (p.vrrp) add({ t: 'failover', kinds: ['router'], what: `${multi ? H + 'の' : ''}ルーター`, near: hq.pcs[0].id, checks: [web(hq), ...(fileTo ? [file(hq)] : []), ...branches.map(web)] });

  know(true, 'ルーター', 4);
  know(!!p.dhcp, 'DHCP', 3);
  know(full, 'DNS', 6);
  know(!!fileTo, 'ファイル共有', 3);
  know(p.link === 'wan', '拠点間接続', 9);
  know(p.link === 'vpn' || !!vs, '拠点間VPN', 10);
  know(!!p.vrrp, '冗長ゲートウェイ', 10);
  know(!!vs, 'クラウド', 9);
  know(!!webHost, '公開DNS', 6);
  know(!!mailHost, 'メール', 3);
  know(!!mailHost, 'SPF', 8);
  know(proxy, 'プロキシ', 7);
  know(!!p.breakout, 'プロキシの例外', 8);
  q.close(sites.length + (p.link === 'wan' ? 1 : 0) + (vs ? 1 : 0));

  // ---- 仕様書 ----
  const labels = sites.map(s => s.def.label), others = labels.slice(1).join('・');
  const spec: SpecRow[] = [{ head: 'アドレス', body: sites.map(s => `${multi ? s.def.label + ': ' : ''}${cidr(s.net)}${p.dhcp ? '(PCはDHCPで自動取得)' : ''}`).join('\n') }];
  const between = branches.length === 2 ? (p.isolate ? `\n${labels[1]}と${labels[2]}の間は通信させない` : `\n${labels[1]}と${labels[2]}の間の通信は、${H}を経由させる`) : '';
  if (p.link === 'wan') spec.push({ head: '拠点間', body: `広域イーサネット網で${labels.join('・')}をつなぐ\n広域イーサネット側のアドレスは ${cidrStr(WNET, 29)} から割り当てる${between}` });
  if (p.link === 'vpn') spec.push({ head: '拠点間', body: `インターネット経由の拠点間VPNでつなぐ。事前共有キー: ${c.psk}\n外側のアドレス: ${sites.map((s, i) => `${s.def.label} ${ipStr(lineIp(i))}(回線${i + 1})`).join('、')}${between}` });
  spec.push({ head: 'インターネット', body: p.vrrp ? '回線を2本契約済み(回線1・回線2)。ルーターを2台置き、WANを別々の回線につなぐ\nルーターが1台止まっても、通信が続くこと'
    : p.link === 'wan' ? `回線は${H}にだけある。${others}も、${H}の回線からインターネットに出る` : p.link === 'vpn' ? '回線は拠点ごとに契約済み。公開DNSは 8.8.8.8' : '回線は契約済み。公開DNSは 8.8.8.8' });
  if (proxy) spec[spec.length - 1].body += `\n${multi ? 'どの拠点の' : ''}PCも、${multi ? H + 'の' : ''}サーバーのプロキシ経由でだけWebを見られること`;
  if (p.breakout) spec[spec.length - 1].body += `\n${labels[1]}には回線2もある。${labels[1]}のPCは、クラウドサービス ${SAAS} にだけ、プロキシも${H}も通さずに回線2から直接つなぐ\n回線2のプロバイダ側のアドレスは ${ipStr(lineIp(1) - 1)}`;
  if (records.length) spec.push({ head: '名前', body: records.map(x => `${x.name} → ${q.nameOf(b.devices.find(d => d.cfg.ip === x.ip)!.id)}`).join('\n') + (multi ? `\nDNSサーバーは${H}のサーバーを全拠点で使う` : '') });
  if (sv && !full && !vs) spec.push({ head: 'ファイル共有', body: `${sv.name}(${svIp})の共有フォルダを、社内のPCから使う` });
  if (vs) spec.push({ head: 'クラウド', body: `仮想ネットワーク: ${cidr(VNET)}(クラウドの vNET は ${ipStr(VNET + 1)})\n仮想サーバー: ${vsIp}。共有フォルダを社内のPCから使う\nクラウドの外側のアドレス: ${CLOUD}\n${multi ? H + 'の' : ''}ルーターとクラウドを拠点間VPNでつなぐ。事前共有キー: ${c.psk}\nセキュリティグループでは、社内から仮想ネットワークへの通信と、仮想サーバーから外への通信を許可する` });
  if (webHost) spec.push({ head: 'ドメイン', body: `${c.pubDom}(契約済み。回線の「公開DNS」にレコードを登録する)\nWebサイトは https://www.${c.pubDom} で公開し、${webHost.name}が応答する\n外側のアドレス: ${vs ? `クラウド ${CLOUD}` : `会社 ${ipStr(lineIp(0))}`}` + (mailHost ? `\nメールは mail.${c.pubDom} で受け取り、${mailHost.name}が処理する。SPFレコードで送信元を示す` : '') });

  // ---- 方針 ----
  const hints: string[] = [];
  if (multi) hints.push(`拠点ごとにルーターとL2スイッチを置き、端末のゲートウェイをその拠点のルーターにします。${full ? `サーバーは${H}に1台だけ置きます。ほかの拠点のPCも、DNSサーバーにこのサーバーを指定します。` : ''}`);
  if (p.link === 'wan') {
    hints.push('広域イーサネット網は、つないだ機器同士が同じネットワークになる回線です。各拠点のルーターのLAN2をつなぎ、仕様書の範囲から別々のアドレスを付けます。');
    hints.push(`${H}のルーターには、ほかの拠点のネットワークへ向かうルートを書きます(ネクストホップは、相手のルーターの広域イーサネット側のアドレス)。ほかの拠点のルーターには、宛先 0.0.0.0/0 で${H}のルーターへ向かうルートを書きます。これで${H}の回線からインターネットに出られます。`);
    if (p.isolate) hints.push(`${labels[1]}と${labels[2]}の間の通信は${H}のルーターを通るので、${H}のルーターに拒否ルールを書きます。`);
  }
  if (p.link === 'vpn') hints.push('各拠点のルーターのWANを、それぞれの回線につなぎます。ルーターの「拠点間VPN」に、相手の外側のアドレス、事前共有キー、相手側のネットワークを登録します。設定は両側のルーターに要ります。' + (branches.length === 2 && !p.isolate ? `${labels[1]}と${labels[2]}の間は${H}を経由するので、相手側のネットワークに${H}と、もう一方の拠点の両方を書きます。` : ''));
  if (p.vrrp) {
    hints.push('2台のルーターのLAN1を同じスイッチにつなぎ、WANは別々の回線につなぎます。LAN1のIPアドレスは2台で別々にし、「仮想IPアドレス」には2台とも同じアドレスを入れます。端末のゲートウェイは、この仮想IPアドレスにします。');
    if (p.vipFirst) hints.push('仮想IPアドレスを、いま端末がゲートウェイにしているアドレスにすると、端末の設定を変えずに済みます。その場合、もとのルーターのLAN1は別のアドレスに変えます。');
    if (p.dhcp) hints.push('DHCPは2台ともオンにし、配る範囲が重ならないように分けます。それぞれの範囲は、1台だけでも全部のPCに配れる大きさにします。');
    if (p.link === 'wan') hints.push('広域イーサネット側(LAN2)にも仮想IPアドレスを設定し、ほかの拠点からのルートはその仮想IPアドレスに向けます。');
  }
  if (vs) {
    hints.push('仮想サーバーをクラウドの vNIC につなぎ、クラウドの vNET に仮想ネットワークのアドレスを付けます。仮想サーバーのゲートウェイは、この vNET のアドレスです。');
    hints.push(`${multi ? H + 'の' : ''}ルーターとクラウドの両方に、拠点間VPNを設定します。クラウドの外側のアドレスは ${CLOUD} です。${multi ? `クラウド側の「相手側のネットワーク」には、全拠点のネットワークを書きます。${p.link === 'vpn' ? `${others}のルーターでは、${H}向けのVPNの相手側のネットワークに、仮想ネットワークも加えます。` : ''}` : ''}`);
    hints.push('クラウドは、セキュリティグループ(フィルター)で許可した通信だけを通します。社内のネットワークから仮想ネットワークへの許可と、仮想ネットワークから外への許可を書きます。');
  }
  if (webHost) hints.push(vs ? `クラウドの「ポート転送」でWebを仮想サーバーへ送ります。公開DNSの www のAレコードは、クラウドの外側のアドレス(${CLOUD})にします。仮想サーバーの証明書の名前は www.${c.pubDom} です。` : '');
  if (proxy) hints.push(`${multi ? H + 'の' : ''}サーバーでプロキシを動かし、${multi ? '全拠点の' : ''}PCのプロキシ欄に「サーバーのIP:8080」を入れます。${multi ? H + 'の' : ''}ルーターのフィルターで、サーバーからのWebを許可し、その下でほかのWebを拒否します。${p.link === 'vpn' ? '拠点ごとに回線があるので、ほかの拠点のルーターでもWebを拒否します。' : ''}`);
  if (p.breakout) hints.push(`${labels[1]}のルーターのWANを回線2につなぎます。${labels[1]}のルーターに、宛先 ${EXTERNAL[SAAS]}/32、ネクストホップ ${ipStr(lineIp(1) - 1)}(回線2のプロバイダ側)のルートを書きます。宛先の範囲が狭いルートが優先されるので、この宛先だけが回線2から出ていき、ほかは 0.0.0.0/0 のルートで${H}へ向かいます。${labels[1]}のPCの「プロキシを使わない宛先」に ${SAAS} を入れます。`);
  if (p.mail && vs) hints.push(`メールも仮想サーバーで動かし、クラウドのポート転送でメール(25)を仮想サーバーへ送ります。公開DNSには mail のAレコード、MXレコード、SPFのTXTレコード(v=spf1 ip4:${CLOUD} -all)を登録します。`);

  // ---- 配置 ----
  put(inet, 700, 82); put(wan, 700, 245); put(cloud, 1210, 118); put(vs, 1210, 292);
  sites.forEach((s, i) => {
    const [x0, x1] = c.cols[i], cx = (x0 + x1) / 2;
    if (i === 0 && c.vrrp) { put(s.rts[0], cx - 100, 400); put(s.rts[1], cx + 180, 400); } else put(s.rts[0], cx, 400);
    put(s.sw, cx, 545);
    const n = s.hosts.length, step = Math.min(125, (x1 - x0 - 70) / n);
    s.hosts.forEach((h, k) => put(h, cx - (step * (n - 1)) / 2 + step * k, 690));
    if (i === 0) put(sv, x0 + 78, 408);
  });
  const zones: Zone[] = [];
  if (multi || c.cloud) c.cols.forEach(([x0, x1], i) => zones.push({ label: multi ? c.defs[i].label : '社内', x: x0 - 8, y: 322, w: x1 - x0 + 16, h: 468, tone: 'site' }));
  if (c.cloud) zones.push({ label: 'クラウド', x: 1040, y: 14, w: 346, h: 380, tone: 'cloud' });

  return { world: b.world(), checks: q.checks, names: q.names, spec, tags: q.tags, factors: q.factors, hints: hints.filter(Boolean), zones };
}

// ---------------------------------------------------------------- L3スイッチの二重化
function composeCore(r: Rng, octet: number, dom: string, groupLabels: string[]): Built {
  const b = new Builder(), internet = r() < 0.7;
  const groups = groupLabels.slice(0, 2).map((label, i) => ({ label, net: ip(`192.168.${octet + i * 10}.0`), vlan: 10 + i * 10, pcs: [] as Device[], hosts: [] as Device[], printer: undefined as Device | undefined }));
  groups.forEach((g, i) => {
    const short = g.label.replace(/[部室]$/, '');
    for (let n = 1; n <= (i === 0 ? randInt(r, 2, 3) : randInt(r, 2, 3)); n++) g.pcs.push(b.add('pc', `g${i}pc${n}`, `${short}PC-${n}`, 'supplied'));
    g.hosts.push(...g.pcs);
    if (i === 0) g.hosts.push(g.printer = b.add('printer', 'g0prn', `${short}プリンタ`, 'supplied'));
  });
  const srv = { net: ip(`192.168.${octet + 100}.0`), vlan: 100 }, svIp = ipStr(srv.net + 53);
  // 各階のVLAN対応スイッチ(お客様の既設)から、2台のL3スイッチへトランクでつなぐ
  const all = groups.flatMap(g => g.hosts.map(h => ({ h, g }))), floors: Device[][] = [[], []];
  const msw = [0, 1].map(i => b.add('l2m-8', `msw${i + 1}`, `${i + 1}階スイッチ`, 'supplied'));
  all.forEach(({ h, g }, i) => { floors[i % 2].push(h); msw[i % 2].cfg.portVlan[b.plug(h, msw[i % 2])] = g.vlan; });
  const sv = b.add('server', 'sv', 'サーバー');
  msw[0].cfg.portVlan[b.plug(sv, msw[0])] = srv.vlan;
  const inet = internet ? b.add('internet', 'inet', 'インターネット', 'fixed') : null, rt = internet ? b.add('router', 'rt', 'ルーター') : null;
  if (inet && rt) {
    b.link(inet, 0, rt, 0);
    msw[0].cfg.portVlan[b.plug(rt, msw[0], 1)] = 99;
    Object.assign(G(rt).lan[0], { ip: ipStr(UPNET + 1), prefix: 29 });
    for (const n of [...groups, srv]) G(rt).routes.push({ dest: cidr(n.net), via: ipStr(UPNET + 4) });
  }
  const l3 = [b.add('l3-8', 'l3a', 'L3スイッチ-1'), b.add('l3-8', 'l3b', 'L3スイッチ-2')];
  l3.forEach((d, k) => {
    const cfg = d.cfg as L3Cfg;
    msw.forEach((m, i) => { m.cfg.portMode[7 - k] = 'trunk'; cfg.portMode[i] = 'trunk'; b.link(m, 7 - k, d, i); });
    for (const n of [...groups, srv]) cfg.svis.push({ vlan: n.vlan, ip: ipStr(n.net + 252 + k), prefix: 24, relay: '', vip: ipStr(n.net + 254), prio: k === 0 ? 110 : 100 });
    if (rt) {
      cfg.svis.push({ vlan: 99, ip: ipStr(UPNET + 2 + k), prefix: 29, relay: '', vip: ipStr(UPNET + 4), prio: k === 0 ? 110 : 100 });
      cfg.routes.push({ dest: '0.0.0.0/0', via: ipStr(UPNET + 1) });
    }
  });
  const records = [{ name: `files.${dom}`, ip: svIp }];
  Object.assign(sv.cfg, { ip: svIp, prefix: 24, gw: ipStr(srv.net + 254), dnsOn: true, forwarder: internet ? '8.8.8.8' : '', records, fileOn: true });
  for (const g of groups) {
    let n = 0;
    for (const h of g.hosts) Object.assign(h.cfg, { ip: ipStr(g.net + (h.kind === 'pc' ? 11 + n++ : 200)), prefix: 24, gw: ipStr(g.net + 254), dns: h.kind === 'printer' ? '' : svIp });
    if (g.printer) records.push({ name: `printer.${dom}`, ip: g.printer.cfg.ip });
  }

  const q = ledger(b), { add, know } = q, [g0, g1] = groups, prn = g0.printer!;
  const cross: Check = { t: 'flow', from: [g0.pcs[0].id], to: { dev: g1.pcs[0].id }, svc: 'ping', expect: 'ok' };
  const file = (g: typeof g0): Check => ({ t: 'flow', from: ids(g.pcs), to: { name: `files.${dom}` }, svc: 'file', expect: 'ok' });
  const web = (g: typeof g0): Check => ({ t: 'flow', from: ids(g.pcs), to: { ext: 'www.example.com' }, svc: 'web', expect: 'ok' });
  for (const g of groups) {
    add({ t: 'addr', devs: ids(g.hosts), cidr: cidr(g.net) }, `${g.label}の機器`);
    add({ t: 'flow', from: ids(g.pcs), to: { name: `printer.${dom}`, dev: prn.id }, svc: 'print', expect: 'ok' }, `${g.label}のPC`);
    add(file(g), `${g.label}のPC`);
    if (internet) add(web(g), `${g.label}のPC`);
  }
  add(cross);
  add({ t: 'failover', kinds: ['l3'], what: 'L3スイッチ', near: g0.pcs[0].id, checks: [cross, file(g0), file(g1), ...(internet ? [web(g0), web(g1)] : [])] });
  add({ t: 'redundant', checks: [cross, file(g1)] });
  know(internet, 'ルーター', 4);
  know(true, 'DNS', 6); know(true, 'ファイル共有', 3); know(true, 'VLAN', 10); know(true, 'トランク', 8); know(true, '冗長化', 8); know(true, '冗長ゲートウェイ', 10);
  q.close(3 + (internet ? 1 : 0));

  const spec: SpecRow[] = [
    { head: 'アドレス', body: groups.map(g => `${g.label}: ${cidr(g.net)}(VLAN ${g.vlan})`).join('\n') + `\nサーバー: ${cidr(srv.net)}(VLAN ${srv.vlan})` },
    { head: 'フロア', body: floors.map((f, i) => `${i + 1}階(${msw[i].name}): ${f.map(h => h.name).join('、')}`).join('\n') + '\n各階の機器は、その階のVLAN対応スイッチ(お客様の既設)につなぐ\nサーバー' + (rt ? 'とルーター' : '') + 'は1階スイッチにつなぐ' },
    { head: 'L3スイッチ', body: 'L3スイッチを2台置き、各階のスイッチからそれぞれにトランクでつなぐ\nどちらか1台が止まっても、ケーブルが1本切れても、通信が続くこと' },
    { head: '名前', body: records.map(x => `${x.name} → ${q.nameOf(b.devices.find(d => d.cfg.ip === x.ip)!.id)}`).join('\n') },
  ];
  if (rt) spec.push({ head: 'インターネット', body: `回線は契約済み。公開DNSは 8.8.8.8\nルーターとL3スイッチの間のネットワーク: ${cidrStr(UPNET, 29)}(VLAN 99)` });
  const hints = [
    '2台のL3スイッチに、同じVLANのVLANインターフェースを作ります。IPアドレスは2台で別々にし、「仮想IP」には2台とも同じアドレスを入れます。端末とサーバーのゲートウェイは、この仮想IPアドレスにします。',
    '各階のスイッチから、2台のL3スイッチへ1本ずつトランクでつなぎます。トランクは両側のポートをトランクにします。VLAN対応スイッチとL3スイッチは、輪になっても通信が止まりません。',
    'サーバーは1階スイッチのポートにつなぎ、そのポートにサーバー用のVLAN番号を割り当てます。L3スイッチには、サーバー用のVLANインターフェースも2台とも作ります。',
  ];
  if (rt) hints.push('ルーターのLAN1も1階スイッチにつなぎ、そのポートをVLAN 99にします。L3スイッチ2台にVLAN 99のインターフェースと仮想IPを作り、デフォルトルートをルーターに向けます。ルーターには、社内の各ネットワークへ戻るルートを、VLAN 99の仮想IPアドレス宛に書きます。');

  put(inet, 700, 82); put(rt, 700, 235); put(l3[0], 430, 395); put(l3[1], 900, 395); put(msw[0], 330, 548); put(msw[1], 1010, 548);
  floors[0].forEach((h, k) => put(h, 90 + 125 * k, 690));
  floors[1].forEach((h, k) => put(h, 800 + 125 * k, 690));
  put(sv, 620, 690);
  return { world: b.world(), checks: q.checks, names: q.names, spec, tags: q.tags, factors: q.factors, hints, zones: [] };
}

// ---------------------------------------------------------------- 依頼の種類
interface Tpl { key: string; lv: number; title: string; make(r: Rng): { before?: Plan; after: Plan } }
const some = (r: Rng, q: number): boolean => r() < q;
const TEMPLATES: Tpl[] = [
  { key: 'wan', lv: 19, title: '2つの拠点を広域イーサネットでつなぐ', make: r => ({ after: { branches: 1, link: 'wan', server: some(r, 0.6) ? 'full' : 'none', dhcp: some(r, 0.4) } }) },
  { key: 'branch', lv: 19, title: '新しい拠点をつなぐ', make: r => { const after: Plan = { branches: 1, link: 'wan', server: some(r, 0.6) ? 'full' : 'none', dhcp: some(r, 0.4) }; return { before: { ...after, branches: 0, link: 'none' }, after }; } },
  { key: 'wanproxy', lv: 19, title: '全拠点のWebを本拠のプロキシに通す', make: r => ({ after: { branches: 1, link: 'wan', server: 'full', proxy: true, dhcp: some(r, 0.3) } }) },
  { key: 'toproxy', lv: 19, title: '拠点のWebをプロキシ経由に切り替える', make: r => { const after: Plan = { branches: 1, link: 'wan', server: 'full', proxy: true, dhcp: some(r, 0.3) }; return { before: { ...after, proxy: false }, after }; } },
  { key: 'branchvpn', lv: 20, title: '新しい拠点を拠点間VPNでつなぐ', make: r => { const after: Plan = { branches: 1, link: 'vpn', server: some(r, 0.6) ? 'full' : 'none', dhcp: some(r, 0.4) }; return { before: { ...after, branches: 0, link: 'none' }, after }; } },
  { key: 'addsite', lv: 20, title: '3つ目の拠点を増やす', make: r => { const after: Plan = { branches: 2, link: 'wan', server: 'full', isolate: some(r, 0.5) }; return { before: { ...after, branches: 1, isolate: false }, after }; } },
  { key: 'wan3', lv: 20, title: '3つの拠点をつなぐ', make: r => ({ after: { branches: 2, link: some(r, 0.5) ? 'wan' : 'vpn', server: 'full', isolate: some(r, 0.6) } }) },
  { key: 'vpn', lv: 20, title: '拠点間VPNで2つの拠点をつなぐ', make: r => ({ after: { branches: 1, link: 'vpn', server: some(r, 0.6) ? 'full' : 'none', dhcp: some(r, 0.4) } }) },
  { key: 'wan2vpn', lv: 20, title: '広域イーサネットから拠点間VPNへ切り替える', make: r => { const after: Plan = { branches: 1, link: 'vpn', server: some(r, 0.6) ? 'full' : 'none', dhcp: some(r, 0.4) }; return { before: { ...after, link: 'wan' }, after }; } },
  { key: 'vrrp', lv: 21, title: 'ルーターと回線を二重にする', make: r => ({ after: { branches: 0, link: 'none', vrrp: true, server: some(r, 0.4) ? 'full' : 'none', dhcp: some(r, 0.5) } }) },
  { key: 'tovrrp', lv: 21, title: 'ルーターを2台に増やす', make: r => { const after: Plan = { branches: 0, link: 'none', vrrp: true, vipFirst: true, server: some(r, 0.4) ? 'full' : 'none', dhcp: some(r, 0.5) }; return { before: { ...after, vrrp: false }, after }; } },
  { key: 'cloud', lv: 22, title: 'クラウドの仮想サーバーを使う', make: r => ({ after: { branches: 0, link: 'none', cloud: true, server: 'none', pubWeb: some(r, 0.5), dhcp: some(r, 0.4) } }) },
  { key: 'tocloud', lv: 22, title: '社内のサーバーをクラウドへ移す', make: r => { const pubWeb = some(r, 0.5), dhcp = some(r, 0.4); return { before: { branches: 0, link: 'none', server: 'plain', pubWeb, dhcp }, after: { branches: 0, link: 'none', cloud: true, server: 'none', pubWeb, dhcp } }; } },
  { key: 'core', lv: 23, title: 'L3スイッチを二重にする', make: () => ({ after: { branches: 0, link: 'none', server: 'none' } }) },
  { key: 'wanvrrp', lv: 23, title: '本拠を二重にした拠点間ネットワーク', make: r => ({ after: { branches: 1, link: 'wan', vrrp: true, server: 'full', dhcp: some(r, 0.3) } }) },
  { key: 'vpncloud', lv: 24, title: '2つの拠点とクラウドをつなぐ', make: r => ({ after: { branches: 1, link: 'vpn', cloud: true, server: 'none', pubWeb: some(r, 0.5) } }) },
  { key: 'wancloud', lv: 23, title: '拠点で共有しているサーバーをクラウドへ移す', make: () => ({ before: { branches: 1, link: 'wan', server: 'plain' }, after: { branches: 1, link: 'wan', cloud: true, server: 'none' } }) },
  { key: 'cloudmail', lv: 24, title: 'Webとメールをクラウドで動かす', make: () => ({ after: { branches: 0, link: 'none', cloud: true, server: 'none', pubWeb: true, mail: true } }) },
  { key: 'mailmove', lv: 24, title: 'Webとメールをクラウドへ移す', make: r => { const dhcp = some(r, 0.4); return { before: { branches: 0, link: 'none', server: 'plain', pubWeb: true, mail: true, dhcp }, after: { branches: 0, link: 'none', cloud: true, server: 'none', pubWeb: true, mail: true, dhcp } }; } },
  { key: 'breakout', lv: 24, title: '支店からクラウドサービスへ直接つなぐ', make: () => ({ after: { branches: 1, link: 'wan', server: 'full', proxy: true, breakout: true } }) },
];

/** 生成に失敗した理由を受け取る(テスト用) */
export const scenDebug: { log?: (m: string) => void } = {};

const linesOf = (p: Plan): number => (p.vrrp || p.breakout ? 2 : p.link === 'vpn' ? 1 + p.branches : 1);

export function scenario(seed: number, id: number, level: number, opts: { kind?: 'build' | 'trouble'; ease?: number }): Job | null {
  const r = mulberry(seed ^ 0x2545f491);
  const ease = opts.ease ?? r();
  const cap = Math.max(1, Math.min(level, Math.round(1 + (level - 1) * (0.35 + 0.65 * ease))));
  if (cap < 19) return null;
  const pool = TEMPLATES.filter(t => t.lv <= cap);
  // そのレベルで新しく出てくる種類は、出やすくする
  if (!some(r, pool.some(t => t.lv === cap) ? 0.85 : 0.6)) return null;
  const tpl = pick(r, pool.flatMap(t => Array<Tpl>(t.lv === cap ? 4 : 1).fill(t)));
  const { before, after } = tpl.make(r);
  const plans = before ? [before, after] : [after];

  const ind = pick(r, INDUSTRIES.filter(i => SITE_LABELS[i.id]));
  const [jp, romaji] = pick(r, NAMES);
  const sites = Math.max(...plans.map(p => p.branches)) + 1, cloud = plans.some(p => p.cloud), vrrp = plans.some(p => p.vrrp);
  const cols: [number, number][] = sites === 3 ? [[20, 520], [540, 950], [970, 1380]] : sites === 2 ? (cloud ? [[20, 520], [540, 1020]] : [[30, 720], [760, 1370]]) : cloud ? [[60, 1000]] : [[200, 1200]];
  const defs: SiteDef[] = cols.map(([x0, x1], i) => {
    const room = Math.min(6, Math.floor((x1 - x0 - 40) / 118)) - (i === 0 && vrrp ? 1 : 0);
    const printer = i === 0 || some(r, 0.5), phone = ind.extra.includes('phone') && room >= 4 && some(r, 0.6);
    return { key: KEYS[i], label: SITE_LABELS[ind.id][i], nPc: Math.max(2, Math.min(i === 0 ? 3 : 2, room - (printer ? 1 : 0) - (phone ? 1 : 0))), printer, phone };
  });
  const c: Ctx = {
    defs, octet: randInt(r, 1, 12) * 10, dom: `${romaji}.local`, pubDom: `${romaji}.example.jp`, psk: `psk-${romaji.slice(0, 4)}${randInt(r, 10, 99)}`,
    sites, lines: Math.max(...plans.map(linesOf)), wan: plans.some(p => p.link === 'wan'), cloud, vrrp,
    hqServer: plans.some(p => p.server !== 'none'), pub: plans.some(p => p.pubWeb || p.mail), cols,
  };
  const sol = tpl.key === 'core' ? composeCore(r, c.octet, c.dom, ind.groups.length >= 2 ? ind.groups : ['総務部', '営業部']) : compose(c, after);
  const old = before ? compose(c, before) : null;
  const names = new Map([...(old?.names ?? []), ...sol.names]);
  const nameOf = (x: string) => names.get(x) ?? x;

  // 構成変更: 変更前の機器とケーブルは、お客様のものとして扱う
  let initial: World;
  const checks = sol.checks.slice(), solution = sol.world;
  if (old) {
    initial = clone(old.world);
    for (const d of initial.devices) if (d.own === 'bought') { d.own = 'supplied'; d.cost = 0; }
    for (const k of initial.cables) k.free = true;
    const had = new Set(initial.devices.map(d => d.id));
    const key = (k: World['cables'][number]) => [`${k.a.dev}:${k.a.port}`, `${k.b.dev}:${k.b.port}`].sort().join('|');
    const cables = new Set(initial.cables.map(key));
    for (const d of solution.devices) if (had.has(d.id) && d.own === 'bought') { d.own = 'supplied'; d.cost = 0; }
    for (const k of solution.cables) if (cables.has(key(k))) k.free = true;
    const extra: Check[] = [];
    if (before!.server !== 'none' && after.server === 'none') extra.push({ t: 'gone', dev: 'sv' });
    if (before!.link === 'wan' && after.link !== 'wan') extra.push({ t: 'unused', dev: 'wan' });
    for (const x of extra) checks.push({ check: x, label: describe(x, nameOf) });
  } else {
    initial = { devices: solution.devices.filter(d => d.own === 'fixed').map(d => { const n = makeDevice(d.model, d.id, d.name, 'fixed', d.x, d.y); if (d.kind === 'internet') n.cfg.domain = d.cfg.domain; return n; }), cables: [] };
  }
  const raw = checks.map(x => x.check);
  const bad = evaluate(solution, raw, nameOf).findIndex(x => !x.ok);
  if (bad >= 0) { scenDebug.log?.(`${tpl.key}: ${checks[bad].label} / ${evaluate(solution, raw, nameOf)[bad].reason}`); return null; }
  if (evaluate(initial, raw, nameOf).every(x => x.ok)) { scenDebug.log?.(`${tpl.key}: 最初から全部合格`); return null; }

  // ---- 文章 ----
  const [H, B, B2] = defs.map(d => d.label), full = after.server === 'full';
  const say: Record<string, string[]> = {
    wan: [`${H}と${B}のネットワークを、まとめてお願いします。`, '拠点の間は、通信会社の広域イーサネットを契約してあります。', `インターネットの回線は${H}にしかありません。${B}からも使えるようにしてください。`],
    branch: [`${B}を新しく開くことになりました。`, `${H}のネットワークは今のまま使い、${B}をつなげてください。`, '拠点の間は、広域イーサネットを契約してあります。'],
    wan3: [`${H}・${B}・${B2}の3か所をつないでください。`, after.link === 'wan' ? '拠点の間は、広域イーサネットを契約してあります。' : '回線は拠点ごとに契約してあります。拠点の間はVPNでお願いします。', after.isolate ? `${B}と${B2}の間は、通信できないようにしてください。` : `${B}と${B2}の間でも通信します。`],
    vpn: [`${H}と${B}を、インターネット経由のVPNでつないでください。`, '回線は拠点ごとに契約してあります。'],
    wan2vpn: ['広域イーサネットを解約することにしました。', `${B}にもインターネット回線を引いたので、拠点間VPNに切り替えてください。`, '切り替えが済んだら、広域イーサネットのケーブルは外してください。'],
    vrrp: ['先月ルーターが壊れて、丸一日仕事になりませんでした。', 'ルーターと回線を2つずつにして、片方が止まっても使えるようにしてください。'],
    tovrrp: ['ルーターが壊れると仕事が止まるので、2台に増やします。回線も1本、追加で契約しました。', 'いまのネットワークはそのまま使います。'],
    cloud: ['サーバーは社内に置かず、クラウドの仮想サーバーを使います。契約は済んでいます。', '社内のPCから、仮想サーバーの共有フォルダを使えるようにしてください。', after.pubWeb ? 'Webサイトも仮想サーバーで公開します。' : ''],
    tocloud: ['社内のサーバーが古くなったので、クラウドの仮想サーバーに引っ越します。', `共有フォルダ${after.pubWeb ? 'とWebサイト' : ''}を移してください。`, '引っ越しが済んだら、古いサーバーは片付けてください。'],
    core: ['部署をまたぐ通信はすべてL3スイッチを通るので、止まると全員の仕事が止まります。', 'L3スイッチを2台にして、1台が止まっても使えるようにしてください。', '各階には、VLAN対応のスイッチがあります。'],
    wanvrrp: [`${H}のルーターが止まると、${B}までインターネットが使えなくなります。`, `${H}のルーターと回線を二重にしてください。`, '拠点の間は、広域イーサネットを契約してあります。'],
    vpncloud: [`${H}と${B}の両方から、クラウドの仮想サーバーを使います。`, `クラウドとのVPNは${H}にだけ張り、${B}は${H}を通して使います。`, after.pubWeb ? 'Webサイトも仮想サーバーで公開します。' : ''],
    wancloud: [`${H}のサーバーが古くなったので、クラウドの仮想サーバーに引っ越します。`, `${B}からも、今までどおり共有フォルダを使います。`, '引っ越しが済んだら、古いサーバーは片付けてください。'],
    wanproxy: [`${H}と${B}のネットワークを、まとめてお願いします。`, '拠点の間は、広域イーサネットを契約してあります。', `Webは、どの拠点からも${H}のプロキシを通したときだけ見られるようにしてください。`],
    toproxy: ['Webの閲覧を記録に残すことになりました。', `どの拠点のPCも、${H}のサーバーのプロキシを通したときだけWebを見られるようにしてください。`, 'いまのネットワークはそのまま使います。'],
    branchvpn: [`${B}を新しく開くことになりました。`, `${H}のネットワークは今のまま使い、${B}とは拠点間VPNでつないでください。`, `${B}のインターネット回線は契約してあります。`],
    addsite: [`${B2}を新しく開くことになりました。`, `${H}と${B}のネットワークは今のまま使い、${B2}を広域イーサネットにつなげてください。`, after.isolate ? `${B}と${B2}の間は、通信できないようにしてください。` : ''],
    mailmove: ['社内のサーバーが古くなったので、クラウドの仮想サーバーに引っ越します。', '共有フォルダ、Webサイト、メールをすべて移してください。', '引っ越しが済んだら、古いサーバーは片付けてください。'],
    breakout: [`${H}と${B}のネットワークを、まとめてお願いします。Webは${H}のプロキシを通します。`, `ただし、${B}でよく使うクラウドサービスだけは、${B}の回線から直接つなぎたいです。`, '拠点の間は、広域イーサネットを契約してあります。'],
    cloudmail: ['Webサイトとメールを、クラウドの仮想サーバーで動かします。契約は済んでいます。', 'メールは自社ドメインで送り受けします。', '共有フォルダも仮想サーバーに置きます。'],
  };
  const talk = say[tpl.key].filter(Boolean);
  if (full && !old && tpl.key !== 'core') talk.push(sites > 1 ? `プリンタと共有フォルダは、どの拠点からも名前で使えるようにしてください。` : 'プリンタと共有フォルダは、名前で使えるようにしてください。');
  if (after.dhcp) talk.push('PCのアドレスは自動で配られるようにしてほしいです。');
  talk.push(pick(r, ['アドレスなどの条件は仕様書に書きました。', '条件は仕様書のとおりです。', '仕様書を付けておきます。']));

  const spec = sol.spec.slice(), hints = sol.hints.slice(), tags = sol.tags.slice(), factors = sol.factors.slice();
  if (old) {
    const rows: Record<string, string> = {
      branch: `${H}の機器と設定は、いまのものを使う\n${B}の端末はお客様が用意してある。${B}のルーターとスイッチを新しく用意する`,
      wan2vpn: `${B}に回線2を新しく契約済み。${B}のルーターのWANを回線2につなぐ\n広域イーサネットは解約するので、ケーブルをすべて外す`,
      tovrrp: '回線2を新しく契約済み。ルーターを1台追加する\nいまの機器と配線は、そのまま使ってよい',
      tocloud: '共有フォルダ' + (after.pubWeb ? 'とWebサイト' : '') + 'を仮想サーバーへ移し、いまのサーバーを撤去する' + (after.pubWeb ? '\n公開DNSのレコードも、新しい公開先に合わせる' : ''),
      wancloud: `共有フォルダを仮想サーバーへ移し、いまのサーバーを撤去する\n${B}からも、${H}を通して仮想サーバーを使う`,
      toproxy: `${H}のサーバーでプロキシを動かし、全拠点のPCに設定する\nプロキシを通さないWebは、${H}のルーターで拒否する`,
      branchvpn: `${H}の機器と設定は、いまのものを使う\n${B}の端末はお客様が用意してある。${B}のルーターとスイッチを新しく用意する\n${B}のルーターのWANは回線2につなぐ`,
      addsite: `${H}と${B}の機器と設定は、いまのものを使う\n${B2}の端末はお客様が用意してある。${B2}のルーターとスイッチを新しく用意する`,
      mailmove: '共有フォルダ、Webサイト、メールを仮想サーバーへ移し、いまのサーバーを撤去する\n公開DNSのレコード(A、SPF)も、新しい公開先に合わせる',
    };
    spec.push({ head: '変更内容', body: rows[tpl.key] });
    tags.push('構成変更');
    factors.push({ label: '動いているネットワークの作り替え', pts: 5 });
    hints.unshift('最初の机の上は、いま動いているネットワークです。検収テストで不合格の項目が、これから変える部分です。合格している項目を壊さないように進めます。');
    if (after.cloud) hints.push('先に仮想サーバーを設定して社内から使えることを確かめ、そのあとで古いサーバーを机から片付けます。');
    if (tpl.key === 'wan2vpn') hints.push('広域イーサネット向けのルートは、ケーブルを外すと使えなくなります。拠点間VPNの設定を両側に入れてから、ルートを消してケーブルを外します。');
  }

  const had = new Set(initial.devices.map(d => d.id));
  const base: Base = {
    id: `j${id}`, seed: id, kind: old ? 'migrate' : 'build', client: jp + pick(r, ind.suffix), industry: ind.label, person: pick(r, ind.person),
    title: tpl.title.replace('本拠', H).replace('支店', B), brief: talk.join(''), spec, tags, zones: sol.zones,
    supplied: solution.devices.filter(d => d.own === 'supplied' && !had.has(d.id)).map(d => ({ id: d.id, model: d.model, name: d.name })),
    checks, initial, solution, par: worldCost(solution), hints, faults: [],
  };
  if ((opts.kind ?? 'build') === 'build') return finish(base, factors);
  // トラブル対応は、変更後の構成を壊したものにする
  return makeTrouble({ ...base, kind: 'build', spec: sol.spec, hints: sol.hints, tags: sol.tags, checks: sol.checks }, sol.factors, seed, cap, r, nameOf);
}
