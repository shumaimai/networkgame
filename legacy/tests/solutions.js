'use strict';
// 各依頼の模範解答。構築は空の机から、トラブル対応は既設の状態から始める
// a = { put(id) お客様の機器を机に置く, buy(type) -> id, link(devA, portA, devB, portB),
//       unplug(dev, port) ケーブルを外す, cfg(id) -> 設定 }
// ルーターのポート: 0=WAN, 1=LAN1, 2=LAN2
const SOLUTIONS = {
  l1(a) {
    ['pc1', 'pc2', 'prn1'].forEach(id => a.put(id));
    const sw = a.buy('l2');
    ['pc1', 'pc2', 'prn1'].forEach((id, i) => a.link(id, 0, sw, i));
    a.cfg('pc1').ip = '192.168.1.10';
    a.cfg('pc2').ip = '192.168.1.11';
    a.cfg('prn1').ip = '192.168.1.200';
  },
  l2(a) {
    ['pc1', 'pc2', 'prn1'].forEach(id => a.put(id));
    const sw = a.buy('l2'), rt = a.buy('router');
    a.link('inet', 0, rt, 0);
    a.link(rt, 1, sw, 0);
    ['pc1', 'pc2', 'prn1'].forEach((id, i) => a.link(id, 0, sw, i + 1));
    a.cfg(rt).lan[0].ip = '192.168.10.1';
    Object.assign(a.cfg('pc1'), { ip: '192.168.10.10', gw: '192.168.10.1', dns: '8.8.8.8' });
    Object.assign(a.cfg('pc2'), { ip: '192.168.10.11', gw: '192.168.10.1', dns: '8.8.8.8' });
    Object.assign(a.cfg('prn1'), { ip: '192.168.10.200' });
  },
  // 不具合: プリンタのケーブルが抜けている / 受付PCのIPが別ネットワーク
  t1(a) {
    a.link('prn1', 0, 'sw', 2);
    a.cfg('pc2').ip = '192.168.1.12';
  },
  // 不具合: 回線がLAN2に挿さっている / PC-2のDNS打ち間違い / 園長PCのゲートウェイ違い
  t2(a) {
    a.unplug('inet', 0);
    a.link('inet', 0, 'rt', 0);
    a.cfg('pc2').dns = '8.8.8.8';
    a.cfg('pc3').gw = '192.168.1.1';
  },
  l3(a) {
    ['pc1', 'pc2', 'prn1'].forEach(id => a.put(id));
    const sw = a.buy('l2'), rt = a.buy('router'), srv = a.buy('server');
    a.link('inet', 0, rt, 0);
    a.link(rt, 1, sw, 0);
    ['pc1', 'pc2', 'prn1', srv].forEach((id, i) => a.link(id, 0, sw, i + 1));
    a.cfg(rt).lan[0].ip = '192.168.1.1';
    Object.assign(a.cfg('pc1'), { ip: '192.168.1.10', gw: '192.168.1.1', dns: '192.168.1.53' });
    Object.assign(a.cfg('pc2'), { ip: '192.168.1.11', gw: '192.168.1.1', dns: '192.168.1.53' });
    Object.assign(a.cfg('prn1'), { ip: '192.168.1.200' });
    Object.assign(a.cfg(srv), { ip: '192.168.1.53', gw: '192.168.1.1', dnsOn: true, forwarder: '8.8.8.8', records: [{ name: 'printer.midori.local', ip: '192.168.1.200' }] });
  },
  // サーバー1台でDNSとプロキシを兼ねる
  l4(a) {
    ['pc1', 'pc2', 'pc3', 'prn1'].forEach(id => a.put(id));
    const sw = a.buy('l2'), rt = a.buy('router'), srv = a.buy('server');
    a.link('inet', 0, rt, 0);
    a.link(rt, 1, sw, 0);
    ['pc1', 'pc2', 'pc3', 'prn1', srv].forEach((id, i) => a.link(id, 0, sw, i + 1));
    Object.assign(a.cfg(rt), { fwMode: 'list', fwAllow: '192.168.1.53' });
    a.cfg(rt).lan[0].ip = '192.168.1.1';
    ['pc1', 'pc2', 'pc3'].forEach((id, i) => Object.assign(a.cfg(id), {
      ip: '192.168.1.' + (10 + i), gw: '192.168.1.1', dns: '192.168.1.53',
      proxy: i === 2 ? 'proxy.hokuto.local:8080' : '192.168.1.53:8080',
    }));
    Object.assign(a.cfg('prn1'), { ip: '192.168.1.200' });
    Object.assign(a.cfg(srv), {
      ip: '192.168.1.53', gw: '192.168.1.1', dnsOn: true, forwarder: '8.8.8.8', proxyOn: true,
      records: [{ name: 'printer.hokuto.local', ip: '192.168.1.200' }, { name: 'proxy.hokuto.local', ip: '192.168.1.53' }],
    });
  },
  // L3スイッチ: 営業=VLAN10, 開発=VLAN20, ルーター間=VLAN99。サーバーはルーターのLAN2に直結
  l5(a) {
    const hosts = ['s1', 's2', 's3', 'sprn', 'd1', 'd2', 'dprn'];
    hosts.forEach(id => a.put(id));
    const l3 = a.buy('l3'), rt = a.buy('router'), srv = a.buy('server');
    a.link('inet', 0, rt, 0);
    hosts.forEach((id, i) => a.link(id, 0, l3, i));
    a.link(l3, 7, rt, 1);
    a.link(srv, 0, rt, 2);
    const c = a.cfg(l3);
    c.portVlan.splice(0, 8, 10, 10, 10, 10, 20, 20, 20, 99);
    c.svis.push({ vlan: 10, ip: '192.168.10.254', prefix: 24 }, { vlan: 20, ip: '192.168.20.254', prefix: 24 }, { vlan: 99, ip: '10.0.0.2', prefix: 30 });
    c.routes.push({ dest: '0.0.0.0/0', via: '10.0.0.1' });
    const r = a.cfg(rt);
    r.lan[0] = { ip: '10.0.0.1', prefix: 30 };
    r.lan[1] = { ip: '192.168.100.1', prefix: 24 };
    r.routes.push({ dest: '192.168.10.0/24', via: '10.0.0.2' }, { dest: '192.168.20.0/24', via: '10.0.0.2' });
    ['s1', 's2', 's3'].forEach((id, i) => Object.assign(a.cfg(id), { ip: '192.168.10.' + (11 + i), gw: '192.168.10.254', dns: '192.168.100.53' }));
    ['d1', 'd2'].forEach((id, i) => Object.assign(a.cfg(id), { ip: '192.168.20.' + (11 + i), gw: '192.168.20.254', dns: '192.168.100.53' }));
    Object.assign(a.cfg('sprn'), { ip: '192.168.10.200', gw: '192.168.10.254' });
    Object.assign(a.cfg('dprn'), { ip: '192.168.20.200', gw: '192.168.20.254' });
    Object.assign(a.cfg(srv), {
      ip: '192.168.100.53', gw: '192.168.100.1', dnsOn: true, forwarder: '8.8.8.8',
      records: [{ name: 'prn-eigyo.aoba.local', ip: '192.168.10.200' }, { name: 'prn-kaihatsu.aoba.local', ip: '192.168.20.200' }],
    });
  },
  // 不具合: ルーターの戻りルートのネクストホップ違い / 営業PC-2のポートVLAN違い / DNSレコードが古い
  t3(a) {
    a.cfg('rt').routes[1].via = '10.0.0.2';
    a.cfg('l3').portVlan[4] = 20;
    a.cfg('srv').records[0].ip = '192.168.10.200';
  },
  // L3スイッチ: 事務=VLAN10, ゲスト=VLAN50, サーバー+ルーター=VLAN100。サーバー1台でDNSとプロキシを兼ねる
  l6(a) {
    const hosts = ['o1', 'o2', 'oprn', 'g1', 'g2'];
    hosts.forEach(id => a.put(id));
    const l3 = a.buy('l3'), rt = a.buy('router'), srv = a.buy('server');
    a.link('inet', 0, rt, 0);
    hosts.concat(srv).forEach((id, i) => a.link(id, 0, l3, i));
    a.link(l3, 7, rt, 1);
    const c = a.cfg(l3);
    c.portVlan.splice(0, 8, 10, 10, 10, 50, 50, 100, 1, 100);
    c.svis.push({ vlan: 10, ip: '192.168.10.254', prefix: 24 }, { vlan: 50, ip: '192.168.50.254', prefix: 24 }, { vlan: 100, ip: '192.168.100.254', prefix: 24 });
    c.routes.push({ dest: '0.0.0.0/0', via: '192.168.100.1' });
    c.deny.push({ src: '192.168.50.0/24', dst: '192.168.10.0/24' });
    const r = a.cfg(rt);
    r.lan[0] = { ip: '192.168.100.1', prefix: 24 };
    r.routes.push({ dest: '192.168.10.0/24', via: '192.168.100.254' }, { dest: '192.168.50.0/24', via: '192.168.100.254' });
    Object.assign(r, { fwMode: 'list', fwAllow: '192.168.100.53, 192.168.50.0/24' });
    ['o1', 'o2'].forEach((id, i) => Object.assign(a.cfg(id), { ip: '192.168.10.' + (11 + i), gw: '192.168.10.254', dns: '192.168.100.53', proxy: '192.168.100.53:8080' }));
    Object.assign(a.cfg('oprn'), { ip: '192.168.10.200', gw: '192.168.10.254' });
    Object.assign(a.cfg('g1'), { ip: '192.168.50.11', gw: '192.168.50.254', dns: '8.8.8.8' });
    Object.assign(a.cfg('g2'), { ip: '192.168.50.12', gw: '192.168.50.254', dns: '192.168.100.53' });
    Object.assign(a.cfg(srv), {
      ip: '192.168.100.53', gw: '192.168.100.254', dnsOn: true, forwarder: '8.8.8.8',
      records: [{ name: 'printer.shirakaba.local', ip: '192.168.10.200' }],
      proxyOn: true, proxyAllow: '192.168.10.0/24',
    });
  },
};
