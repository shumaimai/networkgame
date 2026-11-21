'use strict';
// 機器カタログと、机の上の状態を作る関数(画面に依存しない)
const SWITCH_PORTS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const TYPES = {
  pc: { label: 'PC', ports: ['eth0'], host: true, desc: 'お客様のPC。IP・ゲートウェイ・DNS・プロキシを設定する。' },
  printer: { label: 'プリンタ', ports: ['eth0'], host: true, desc: 'お客様のネットワークプリンタ。' },
  server: { label: 'サーバー', ports: ['eth0'], host: true, price: 25000, prefix: 'Server', desc: 'DNSサービスやプロキシサービスを立てられるサーバー機。1台で両方動かせる。' },
  l2: { label: 'L2スイッチ', ports: SWITCH_PORTS, price: 8000, prefix: 'L2SW', desc: '8ポート。つないだ機器を同じネットワークにまとめる。設定不要。' },
  l3: { label: 'L3スイッチ', ports: SWITCH_PORTS, price: 45000, prefix: 'L3SW', desc: '8ポート。ポートごとにVLANを分け、VLAN間をルーティングできる。' },
  router: { label: 'ルーター', ports: ['WAN', 'LAN1', 'LAN2'], price: 20000, prefix: 'Router', desc: 'WAN×1 / LAN×2。インターネット接続(NAT)とファイアウォール。' },
  internet: { label: 'インターネット回線', ports: ['ISP'] },
};
const CABLE_PRICE = 500;

function defaultCfg(type) {
  switch (type) {
    case 'pc': return { ip: '', prefix: 24, gw: '', dns: '', proxy: '' };
    case 'printer': return { ip: '', prefix: 24, gw: '' };
    case 'server': return { ip: '', prefix: 24, gw: '', dns: '', dnsOn: false, records: [], forwarder: '', proxyOn: false, proxyPort: 8080, proxyAllow: '' };
    case 'l3': return { portVlan: SWITCH_PORTS.map(() => 1), svis: [], routes: [], deny: [] };
    case 'router': return { lan: [{ ip: '', prefix: 24 }, { ip: '', prefix: 24 }], routes: [], deny: [], fwMode: 'all', fwAllow: '' };
    default: return {};
  }
}

// own: 'fixed'(据え付けの設備) / 'supplied'(お客様の機器) / 'bought'(購入品)
function makeDevice(type, id, name, x, y, own) {
  return { id, type, name, x, y, own, ports: TYPES[type].ports.slice(), cfg: defaultCfg(type) };
}

// 案件定義の supplied から、お客様の機器を作る(既設の設定があれば反映)
function deviceFromDef(def, x, y) {
  const d = makeDevice(def.type, def.id, def.name, x, y, 'supplied');
  if (def.cfg) Object.assign(d.cfg, JSON.parse(JSON.stringify(def.cfg)));
  return d;
}

// 案件開始時の机の上。at を持つ機器と cables は既設(トラブル対応の依頼で使う)
function initialState(level, W, H) {
  const devices = [];
  if (level.internet) devices.push(makeDevice('internet', 'inet', 'インターネット', Math.round(W / 2), 70, 'fixed'));
  for (const def of level.supplied) {
    if (def.at) devices.push(deviceFromDef(def, Math.round(def.at[0] * W), Math.round(def.at[1] * H)));
  }
  const cables = (level.cables || []).map(([a, pa, b, pb], i) => ({ id: 'c' + (i + 1), a: { dev: a, port: pa }, b: { dev: b, port: pb }, free: true }));
  return { devices, cables, seq: cables.length + 1, shelf: {}, spare: 0 };
}

// 機材費。お客様のケーブル(free)は数えない
const equipmentCost = (devices, cables) =>
  devices.reduce((s, d) => s + (d.own === 'bought' ? TYPES[d.type].price : 0), 0) + cables.filter(c => !c.free).length * CABLE_PRICE;
