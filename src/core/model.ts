// 機器の種類・カタログ・設定の型(画面に依存しない)

export type Kind =
  | 'pc' | 'printer' | 'phone' | 'camera' | 'pos'   // お客様の端末
  | 'server' | 'nas' | 'lb'                         // サービスを動かす機器
  | 'l2' | 'l2m' | 'l3' | 'router' | 'fw' | 'ap'    // ネットワーク機器
  | 'home'                                          // 社外(自宅)からVPNでつなぐPC
  | 'cloud'                                         // クラウド(仮想ネットワークの出入口)
  | 'wan'                                           // 広域イーサネット網
  | 'internet';

export type Svc = 'ping' | 'dns' | 'web' | 'proxy' | 'file' | 'print' | 'mail' | 'voice';
export const SVC: Record<Svc, { label: string; port: string }> = {
  ping: { label: 'ping', port: 'ICMP' },
  dns: { label: 'DNS', port: '53' },
  web: { label: 'Web', port: '80/443' },
  proxy: { label: 'プロキシ', port: '8080' },
  file: { label: 'ファイル共有', port: '445' },
  print: { label: '印刷', port: '9100' },
  mail: { label: 'メール', port: '25' },
  voice: { label: '通話', port: '5060' },
};

export interface Route { dest: string; via: string }
export interface Rule { action: 'allow' | 'deny'; src: string; dst: string; svc: Svc | 'any' }
export interface Pool { start: string; end: string; prefix: number; gw: string; dns: string }
export interface DnsRecord { name: string; ip: string }
export interface Wifi { ssid: string; key: string }

export interface HostCfg {
  mode: 'static' | 'dhcp';
  ip: string; prefix: number; gw: string; dns: string;
  proxy: string;
  /** プロキシを通さずに直接つなぐ宛先(名前をカンマ区切り) */
  noProxy: string;
  wifi: Wifi;
}
export interface ServerCfg extends HostCfg {
  dnsOn: boolean; records: DnsRecord[]; forwarder: string;
  proxyOn: boolean; proxyPort: number; proxyAllow: string;
  dhcpOn: boolean; pools: Pool[];
  webOn: boolean;
  fileOn: boolean; fileAllow: string;
  mailOn: boolean;
  /** HTTPSのサーバー証明書に書かれた名前(カンマ区切り。*.example.jp の形も使える) */
  cert: string;
  /** リバースプロキシ: 名前ごとの振り分け先 */
  rpOn: boolean; rpRules: RpRule[];
  /** DKIM: 送るメールに署名を付ける。セレクターは公開鍵を探すための名前 */
  dkimOn: boolean; dkimSel: string;
  /** 監視: 登録した宛先に定期的に ping を打つ */
  monOn: boolean; monTargets: string;
}
export interface RpRule { host: string; to: string }
/** 拠点間VPN: 相手の外側のアドレス、事前共有キー、相手側のネットワーク */
export interface Tunnel { peer: string; key: string; nets: string }
export interface ZoneRec { type: 'A' | 'MX' | 'TXT'; name: string; value: string }
/** 回線(プロバイダ)側の設定: 契約しているドメインと、その公開DNSのレコード */
export interface InetCfg { domain: string; zone: ZoneRec[] }
export interface SwitchCfg {
  portMode: ('access' | 'trunk')[];
  portVlan: number[];
}
export interface Svi { vlan: number; ip: string; prefix: number; relay: string; /** VRRPの仮想IPアドレスと優先度 */ vip?: string; prio?: number }
export interface L3Cfg extends SwitchCfg { svis: Svi[]; routes: Route[]; rules: Rule[] }
export interface LanIf { ip: string; prefix: number; dhcpOn: boolean; dhcpStart: string; dhcpEnd: string; dhcpDns: string; /** VRRPの仮想IPアドレスと優先度 */ vip: string; prio: number }
export interface GwCfg {
  wan: { mode: 'auto' | 'static'; ip: string; prefix: number; gw: string };
  nat: boolean;
  lan: LanIf[];
  routes: Route[];
  rules: Rule[];
  forwards: { svc: Svc; to: string }[];
  /** リモートアクセスVPN: 認証キーと、つないできた端末に配るアドレス */
  vpn: { on: boolean; key: string; ip: string };
  tunnels: Tunnel[];
}
export interface ApCfg { ssid: string; key: string }

export type Own = 'fixed' | 'supplied' | 'bought' | 'stock';

export interface Device {
  id: string;
  model: string;
  kind: Kind;
  name: string;
  x: number; y: number;
  own: Own;
  /** 購入品・在庫品の原価(機材費の計算に使う) */
  cost: number;
  ports: string[];
  mac: string;
  cfg: any;
}
export interface PortRef { dev: string; port: number }
export interface Cable { id: string; a: PortRef; b: PortRef; free?: boolean }

export interface Model {
  id: string; kind: Kind; label: string; short: string;
  ports: string[];
  /** 定価。0 は購入できない機器(お客様の端末など) */
  price: number;
  /** 倉庫で使うスロットの数 */
  size: number;
  /** 購入できるようになるレベル */
  level: number;
  prefix: string;
  desc: string;
}

const nums = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i + 1));

export const MODELS: Model[] = [
  { id: 'pc', kind: 'pc', label: 'PC', short: 'PC', ports: ['eth0'], price: 0, size: 2, level: 1, prefix: 'PC', desc: 'お客様のPC。IPアドレス、ゲートウェイ、DNS、プロキシを設定する。' },
  { id: 'printer', kind: 'printer', label: 'プリンタ', short: 'プリンタ', ports: ['eth0'], price: 0, size: 3, level: 1, prefix: 'プリンタ', desc: 'ネットワークプリンタ。印刷(9100番)を受け付ける。' },
  { id: 'phone', kind: 'phone', label: 'IP電話', short: 'IP電話', ports: ['eth0'], price: 0, size: 1, level: 1, prefix: '電話', desc: 'LANで通話する電話機。' },
  { id: 'camera', kind: 'camera', label: '防犯カメラ', short: 'カメラ', ports: ['eth0'], price: 0, size: 1, level: 1, prefix: 'カメラ', desc: '映像をNASやファイルサーバーに保存するカメラ。' },
  { id: 'pos', kind: 'pos', label: 'POSレジ', short: 'レジ', ports: ['eth0'], price: 0, size: 3, level: 1, prefix: 'レジ', desc: '売上をサーバーに送るレジ端末。' },

  { id: 'l2-5', kind: 'l2', label: 'L2スイッチ 5ポート', short: 'L2 5p', ports: nums(5), price: 4000, size: 1, level: 1, prefix: 'SW', desc: '小型のスイッチングハブ。つないだ機器を同じネットワークにまとめる。設定不要。' },
  { id: 'l2-8', kind: 'l2', label: 'L2スイッチ 8ポート', short: 'L2 8p', ports: nums(8), price: 7000, size: 1, level: 1, prefix: 'SW', desc: 'スイッチングハブ。つないだ機器を同じネットワークにまとめる。設定不要。' },
  { id: 'l2-16', kind: 'l2', label: 'L2スイッチ 16ポート', short: 'L2 16p', ports: nums(16), price: 13000, size: 2, level: 3, prefix: 'SW', desc: '端末の多いフロア向けのスイッチングハブ。設定不要。' },
  { id: 'router', kind: 'router', label: 'ルーター', short: 'ルーター', ports: ['WAN', 'LAN1', 'LAN2'], price: 20000, size: 1, level: 2, prefix: 'RT', desc: 'ネットワーク同士をつなぐ。インターネット接続(NAT)、DHCP、パケットフィルターを備える。' },
  { id: 'router-4', kind: 'router', label: '業務用ルーター 4LAN', short: 'ルーター 4LAN', ports: ['WAN', 'LAN1', 'LAN2', 'LAN3', 'LAN4'], price: 42000, size: 2, level: 19, prefix: 'RT', desc: 'LAN側のポートが4つあるルーター。社内のネットワーク、サーバー用のネットワーク、拠点間の回線を1台でつなげる。' },
  { id: 'server', kind: 'server', label: 'サーバー', short: 'サーバー', ports: ['eth0'], price: 25000, size: 3, level: 4, prefix: 'SV', desc: 'DNS、DHCP、プロキシ、Web、ファイル共有、メールの各サービスを動かせる。' },
  { id: 'nas', kind: 'nas', label: 'NAS', short: 'NAS', ports: ['eth0'], price: 14000, size: 2, level: 6, prefix: 'NAS', desc: 'ファイル共有専用の機器。サーバーより安い。' },
  { id: 'l2m-8', kind: 'l2m', label: 'VLAN対応スイッチ 8ポート', short: 'VLAN SW 8p', ports: nums(8), price: 16000, size: 1, level: 8, prefix: 'MSW', desc: 'ポートごとにVLANを割り当てられるL2スイッチ。トランクポートで複数のVLANを1本にまとめて運べる。' },
  { id: 'l3-8', kind: 'l3', label: 'L3スイッチ 8ポート', short: 'L3 8p', ports: nums(8), price: 45000, size: 2, level: 8, prefix: 'L3SW', desc: 'VLANを分け、VLAN同士を中継(ルーティング)できるスイッチ。' },
  { id: 'fw', kind: 'fw', label: 'ファイアウォール', short: 'FW', ports: ['WAN', 'DMZ', 'LAN'], price: 60000, size: 2, level: 10, prefix: 'FW', desc: '外部・DMZ・内部の3つの面を持つ。許可した通信だけを通す(それ以外は遮断)。' },
  { id: 'l2m-24', kind: 'l2m', label: 'VLAN対応スイッチ 24ポート', short: 'VLAN SW 24p', ports: nums(24), price: 38000, size: 3, level: 11, prefix: 'MSW', desc: '24ポートのVLAN対応スイッチ。' },
  { id: 'l3-24', kind: 'l3', label: 'L3スイッチ 24ポート', short: 'L3 24p', ports: nums(24), price: 98000, size: 3, level: 12, prefix: 'L3SW', desc: '24ポートのL3スイッチ。' },
  { id: 'ap', kind: 'ap', label: '無線アクセスポイント', short: '無線AP', ports: ['eth0'], price: 12000, size: 1, level: 13, prefix: 'AP', desc: '無線LANの親機。SSIDと暗号化キーが合う端末を有線LANにつなぐ。' },

  { id: 'lb', kind: 'lb', label: '負荷分散装置', short: '負荷分散', ports: ['eth0'], price: 40000, size: 2, level: 16, prefix: 'LB', desc: '届いたWebアクセスを、複数のWebサーバーに振り分ける。1台が止まっても、残りで応答を続けられる。' },
  { id: 'vserver', kind: 'server', label: '仮想サーバー', short: '仮想サーバー', ports: ['vNIC'], price: 0, size: 0, level: 1, prefix: 'VS', desc: 'クラウドの中にあるサーバー。クラウドの vNIC にだけつなげる。動かせるサービスは社内のサーバーと同じ。' },
  { id: 'cloud', kind: 'cloud', label: 'クラウド', short: 'クラウド', ports: ['WAN', 'vNIC1', 'vNIC2', 'vNIC3', 'vNIC4'], price: 0, size: 0, level: 1, prefix: '', desc: '契約済みのクラウド。仮想ネットワークの出入口で、インターネットには最初からつながっている。' },
  { id: 'wan', kind: 'wan', label: '広域イーサネット網', short: '広域イーサ', ports: ['拠点1', '拠点2', '拠点3'], price: 0, size: 0, level: 1, prefix: '', desc: '通信会社の拠点間回線。つないだ拠点同士が、1台のL2スイッチにつないだときと同じように通信できる。' },
  { id: 'home', kind: 'home', label: '自宅PC', short: '自宅PC', ports: [], price: 0, size: 0, level: 1, prefix: '', desc: '社員の自宅にあるPC。インターネットの向こうから、VPNで社内につなぐ。' },
  { id: 'internet', kind: 'internet', label: 'インターネット回線', short: '回線', ports: ['ISP'], price: 0, size: 0, level: 1, prefix: '', desc: '契約済みのインターネット回線。' },
  { id: 'internet-2', kind: 'internet', label: 'インターネット回線(2契約)', short: '回線', ports: ['回線1', '回線2'], price: 0, size: 0, level: 1, prefix: '', desc: '契約済みのインターネット回線が2本ある。' },
  { id: 'internet-3', kind: 'internet', label: 'インターネット回線(3契約)', short: '回線', ports: ['回線1', '回線2', '回線3'], price: 0, size: 0, level: 1, prefix: '', desc: '契約済みのインターネット回線が3本ある。' },
];
export const MODEL: Record<string, Model> = Object.fromEntries(MODELS.map(m => [m.id, m]));
export const CABLE_PRICE = 500;

export const isEndpoint = (k: Kind): boolean => k === 'pc' || k === 'printer' || k === 'phone' || k === 'camera' || k === 'pos';
/** 自分のIPアドレスを1つ持ち、ゲートウェイ経由で通信する機器 */
export const isHost = (k: Kind): boolean => isEndpoint(k) || k === 'server' || k === 'nas' || k === 'lb' || k === 'home';
export const isGateway = (k: Kind): boolean => k === 'router' || k === 'fw' || k === 'cloud';
/** 許可ルールに当てはまらない通信を遮断する機器 */
export const deniesByDefault = (k: Kind): boolean => k === 'fw' || k === 'cloud';
export const isManaged = (k: Kind): boolean => k === 'l2m' || k === 'l3';
export const isRouting = (k: Kind): boolean => isGateway(k) || k === 'l3' || k === 'internet';

const hostCfg = (): HostCfg => ({ mode: 'static', ip: '', prefix: 24, gw: '', dns: '', proxy: '', noProxy: '', wifi: { ssid: '', key: '' } });
const lanIf = (): LanIf => ({ ip: '', prefix: 24, dhcpOn: false, dhcpStart: '', dhcpEnd: '', dhcpDns: '', vip: '', prio: 100 });

export function defaultCfg(m: Model): any {
  switch (m.kind) {
    case 'pc': case 'printer': case 'phone': case 'camera': case 'pos':
      return hostCfg();
    case 'server': case 'nas': {
      const c: ServerCfg = {
        ...hostCfg(),
        dnsOn: false, records: [], forwarder: '',
        proxyOn: false, proxyPort: 8080, proxyAllow: '',
        dhcpOn: false, pools: [],
        webOn: false,
        fileOn: m.kind === 'nas', fileAllow: '',
        mailOn: false, cert: '',
        rpOn: false, rpRules: [], dkimOn: false, dkimSel: 's1', monOn: false, monTargets: '',
      };
      return c;
    }
    case 'l2m':
      return { portMode: m.ports.map(() => 'access'), portVlan: m.ports.map(() => 1) } satisfies SwitchCfg;
    case 'l3':
      return { portMode: m.ports.map(() => 'access'), portVlan: m.ports.map(() => 1), svis: [], routes: [], rules: [] } satisfies L3Cfg;
    case 'router':
    case 'fw':
    case 'cloud':
      // クラウドは vNIC がすべて同じ仮想ネットワークなので、LAN側のインターフェースは1つ
      return { wan: { mode: 'auto', ip: '', prefix: 30, gw: '' }, nat: true, lan: (m.kind === 'cloud' ? ['vNET'] : m.ports.slice(1)).map(lanIf), routes: [], rules: [], forwards: [], vpn: { on: false, key: '', ip: '' }, tunnels: [] } satisfies GwCfg;
    case 'lb':
      return { ...hostCfg(), backends: '', cert: '' };
    case 'internet':
      return { domain: '', zone: [] } satisfies InetCfg;
    case 'home':
      return { vpn: { server: '', key: '' }, dns: '' };
    case 'ap':
      return { ssid: '', key: '' } satisfies ApCfg;
    default:
      return {};
  }
}

// 機器IDから決まるMACアドレス(文書用の 00-00-5E-00-53-xx を先頭にした見た目)
export function macOf(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  const b = [(h >>> 16) & 255, (h >>> 8) & 255, h & 255].map(x => x.toString(16).toUpperCase().padStart(2, '0'));
  return `00-00-5E-${b.join('-')}`;
}

export function makeDevice(model: string, id: string, name: string, own: Own, x = 0, y = 0, cost = 0): Device {
  const m = MODEL[model];
  if (!m) throw new Error('unknown model ' + model);
  return { id, model, kind: m.kind, name, x, y, own, cost, ports: m.ports.slice(), mac: macOf(id), cfg: defaultCfg(m) };
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** 古いセーブの機器に、あとから増えた設定項目を補う */
export function fillCfg(d: Device): void {
  const def = defaultCfg(MODEL[d.model]);
  for (const k of Object.keys(def)) if (d.cfg[k] === undefined) d.cfg[k] = def[k];
  for (const l of (d.cfg.lan ?? []) as LanIf[]) { l.vip ??= ''; l.prio ??= 100; }
  for (const s of (d.cfg.svis ?? []) as Svi[]) { s.vip ??= ''; s.prio ??= 100; }
}

/** その2つのポートをケーブルでつなげるか。つなげないときは理由を返す */
export function linkError(a: Device, pa: number, b: Device, pb: number): string | null {
  for (const [x, px, y] of [[a, pa, b], [b, pb, a]] as [Device, number, Device][]) {
    if (x.kind === 'cloud' && px === 0) return 'クラウドは最初からインターネットにつながっています。WANにケーブルは要りません。';
    if (x.kind === 'cloud' && y.model !== 'vserver') return 'クラウドの vNIC には、仮想サーバーだけをつなげます。';
    if (x.model === 'vserver' && y.kind !== 'cloud') return '仮想サーバーはクラウドの中にあります。クラウドの vNIC につなぎます。';
  }
  return null;
}

/** DKIMの公開鍵(機器ごとに決まる短い文字列)。公開DNSのTXTレコードに p= として登録する */
export function dkimKey(d: Device): string {
  let h = 2166136261;
  for (const ch of 'dkim' + d.id + d.mac) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 'MIGf' + h.toString(36).toUpperCase().padStart(7, '0');
}

/** 机の上の状態(機器とケーブル) */
export interface World { devices: Device[]; cables: Cable[] }
