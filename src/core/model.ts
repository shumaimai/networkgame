// 機器の種類・カタログ・設定の型(画面に依存しない)

export type Kind =
  | 'pc' | 'printer' | 'phone' | 'camera' | 'pos'   // お客様の端末
  | 'server' | 'nas'                                // サービスを動かす機器
  | 'l2' | 'l2m' | 'l3' | 'router' | 'fw' | 'ap'    // ネットワーク機器
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
  wifi: Wifi;
}
export interface ServerCfg extends HostCfg {
  dnsOn: boolean; records: DnsRecord[]; forwarder: string;
  proxyOn: boolean; proxyPort: number; proxyAllow: string;
  dhcpOn: boolean; pools: Pool[];
  webOn: boolean;
  fileOn: boolean; fileAllow: string;
  mailOn: boolean;
}
export interface SwitchCfg {
  portMode: ('access' | 'trunk')[];
  portVlan: number[];
}
export interface Svi { vlan: number; ip: string; prefix: number; relay: string }
export interface L3Cfg extends SwitchCfg { svis: Svi[]; routes: Route[]; rules: Rule[] }
export interface LanIf { ip: string; prefix: number; dhcpOn: boolean; dhcpStart: string; dhcpEnd: string; dhcpDns: string }
export interface GwCfg {
  wan: { mode: 'auto' | 'static'; ip: string; prefix: number; gw: string };
  nat: boolean;
  lan: LanIf[];
  routes: Route[];
  rules: Rule[];
  forwards: { svc: Svc; to: string }[];
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
  /** 倉庫で占める広さ */
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
  { id: 'server', kind: 'server', label: 'サーバー', short: 'サーバー', ports: ['eth0'], price: 25000, size: 3, level: 4, prefix: 'SV', desc: 'DNS、DHCP、プロキシ、Web、ファイル共有、メールの各サービスを動かせる。' },
  { id: 'nas', kind: 'nas', label: 'NAS', short: 'NAS', ports: ['eth0'], price: 14000, size: 2, level: 6, prefix: 'NAS', desc: 'ファイル共有専用の機器。サーバーより安い。' },
  { id: 'l2m-8', kind: 'l2m', label: 'VLAN対応スイッチ 8ポート', short: 'VLAN SW 8p', ports: nums(8), price: 16000, size: 1, level: 8, prefix: 'MSW', desc: 'ポートごとにVLANを割り当てられるL2スイッチ。トランクポートで複数のVLANを1本にまとめて運べる。' },
  { id: 'l3-8', kind: 'l3', label: 'L3スイッチ 8ポート', short: 'L3 8p', ports: nums(8), price: 45000, size: 2, level: 8, prefix: 'L3SW', desc: 'VLANを分け、VLAN同士を中継(ルーティング)できるスイッチ。' },
  { id: 'fw', kind: 'fw', label: 'ファイアウォール', short: 'FW', ports: ['WAN', 'DMZ', 'LAN'], price: 60000, size: 2, level: 10, prefix: 'FW', desc: '外部・DMZ・内部の3つの面を持つ。許可した通信だけを通す(それ以外は遮断)。' },
  { id: 'l2m-24', kind: 'l2m', label: 'VLAN対応スイッチ 24ポート', short: 'VLAN SW 24p', ports: nums(24), price: 38000, size: 3, level: 11, prefix: 'MSW', desc: '24ポートのVLAN対応スイッチ。' },
  { id: 'l3-24', kind: 'l3', label: 'L3スイッチ 24ポート', short: 'L3 24p', ports: nums(24), price: 98000, size: 3, level: 12, prefix: 'L3SW', desc: '24ポートのL3スイッチ。' },
  { id: 'ap', kind: 'ap', label: '無線アクセスポイント', short: '無線AP', ports: ['eth0'], price: 12000, size: 1, level: 13, prefix: 'AP', desc: '無線LANの親機。SSIDと暗号化キーが合う端末を有線LANにつなぐ。' },

  { id: 'internet', kind: 'internet', label: 'インターネット回線', short: '回線', ports: ['ISP'], price: 0, size: 0, level: 1, prefix: '', desc: '契約済みのインターネット回線。' },
];
export const MODEL: Record<string, Model> = Object.fromEntries(MODELS.map(m => [m.id, m]));
export const CABLE_PRICE = 500;

export const isEndpoint = (k: Kind): boolean => k === 'pc' || k === 'printer' || k === 'phone' || k === 'camera' || k === 'pos';
/** 自分のIPアドレスを1つ持ち、ゲートウェイ経由で通信する機器 */
export const isHost = (k: Kind): boolean => isEndpoint(k) || k === 'server' || k === 'nas';
export const isGateway = (k: Kind): boolean => k === 'router' || k === 'fw';
export const isManaged = (k: Kind): boolean => k === 'l2m' || k === 'l3';
export const isRouting = (k: Kind): boolean => isGateway(k) || k === 'l3' || k === 'internet';

const hostCfg = (): HostCfg => ({ mode: 'static', ip: '', prefix: 24, gw: '', dns: '', proxy: '', wifi: { ssid: '', key: '' } });
const lanIf = (): LanIf => ({ ip: '', prefix: 24, dhcpOn: false, dhcpStart: '', dhcpEnd: '', dhcpDns: '' });

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
        mailOn: false,
      };
      return c;
    }
    case 'l2m':
      return { portMode: m.ports.map(() => 'access'), portVlan: m.ports.map(() => 1) } satisfies SwitchCfg;
    case 'l3':
      return { portMode: m.ports.map(() => 'access'), portVlan: m.ports.map(() => 1), svis: [], routes: [], rules: [] } satisfies L3Cfg;
    case 'router':
      return { wan: { mode: 'auto', ip: '', prefix: 30, gw: '' }, nat: true, lan: m.ports.slice(1).map(lanIf), routes: [], rules: [], forwards: [] } satisfies GwCfg;
    case 'fw':
      return { wan: { mode: 'auto', ip: '', prefix: 30, gw: '' }, nat: true, lan: m.ports.slice(1).map(lanIf), routes: [], rules: [], forwards: [] } satisfies GwCfg;
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

/** 机の上の状態(機器とケーブル) */
export interface World { devices: Device[]; cables: Cable[] }
