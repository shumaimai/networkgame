import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/checks';
import { parseIp } from '../src/core/ip';
import { Builder } from '../src/core/job';
import { GwCfg, L3Cfg } from '../src/core/model';
import { WAN_IP, arpTable, browse, build, connect, reach, resolve } from '../src/core/sim';

const ip = (s: string) => parseIp(s)!;
const host = (b: Builder, model: string, id: string, addr: string, gw = '', dns = '') => { const d = b.add(model, id, id, 'supplied'); Object.assign(d.cfg, { ip: addr, gw, dns }); return d; };

describe('シミュレータ', () => {
  it('同じネットワークは届き、別のネットワークやIP重複は届かない', () => {
    const b = new Builder(), sw = b.add('l2-5', 'sw', 'sw');
    const a = host(b, 'pc', 'a', '192.168.1.10'), c = host(b, 'pc', 'c', '192.168.1.11'), d = host(b, 'pc', 'd', '192.168.2.10');
    for (const h of [a, c, d]) b.plug(h, sw);
    let n = build(b.devices, b.cables);
    expect(reach(n, a, ip('192.168.1.11')).ok).toBe(true);
    expect(reach(n, a, ip('192.168.2.10')).ok).toBe(false);
    d.cfg.ip = '192.168.1.11';
    n = build(b.devices, b.cables);
    const r = reach(n, a, ip('192.168.1.11'));
    expect(!r.ok && /重複/.test(r.reason)).toBe(true);
    expect(arpTable(n, a).filter(e => e.dup).length).toBe(2);
  });

  it('VLAN: 同じVLANだけが届き、トランクは両側がトランクのときだけ運べる', () => {
    const b = new Builder(), s1 = b.add('l2m-8', 's1', 's1'), s2 = b.add('l2m-8', 's2', 's2');
    const a = host(b, 'pc', 'a', '10.0.0.1'), c = host(b, 'pc', 'c', '10.0.0.2'), d = host(b, 'pc', 'd', '10.0.0.3');
    b.link(a, 0, s1, 0); b.link(c, 0, s2, 0); b.link(d, 0, s2, 1); b.link(s1, 7, s2, 7);
    s1.cfg.portVlan[0] = 10; s2.cfg.portVlan[0] = 10; s2.cfg.portVlan[1] = 20;
    const ok = () => { const n = build(b.devices, b.cables); return [reach(n, a, ip('10.0.0.2')).ok, reach(n, a, ip('10.0.0.3')).ok]; };
    expect(ok()).toEqual([false, false]);          // スイッチ間はVLAN1のアクセスポート
    s1.cfg.portMode[7] = 'trunk'; s2.cfg.portMode[7] = 'trunk';
    expect(ok()).toEqual([true, false]);
    s2.cfg.portMode[7] = 'access';
    expect(ok()).toEqual([false, false]);          // 片側だけトランク
  });

  it('DHCP: ルーター、サーバー、L3スイッチのリレー、範囲切れ', () => {
    const b = new Builder(), rt = b.add('router', 'rt', 'rt'), sw = b.add('l2-8', 'sw', 'sw');
    const pcs = [1, 2, 3].map(i => { const d = b.add('pc', 'p' + i, 'p' + i, 'supplied'); d.cfg.mode = 'dhcp'; b.plug(d, sw); return d; });
    b.link(rt, 1, sw, 7);
    Object.assign((rt.cfg as GwCfg).lan[0], { ip: '192.168.1.1', dhcpOn: true, dhcpStart: '192.168.1.100', dhcpEnd: '192.168.1.101', dhcpDns: '8.8.8.8' });
    let n = build(b.devices, b.cables);
    expect(pcs.map(p => n.eff.get(p.id)!.ip)).toEqual([ip('192.168.1.100'), ip('192.168.1.101'), null]);
    expect(n.eff.get('p3')!.note).toMatch(/空きアドレス/);
    expect(n.eff.get('p1')!.gw).toBe(ip('192.168.1.1'));
    expect(reach(n, pcs[0], ip('192.168.1.101')).ok).toBe(true);

    const c = new Builder(), l3 = c.add('l3-8', 'l3', 'l3'), sv = host(c, 'server', 'sv', '10.0.100.53', '10.0.100.254');
    const p = c.add('pc', 'p', 'p', 'supplied'); p.cfg.mode = 'dhcp';
    c.link(p, 0, l3, 0); c.link(sv, 0, l3, 1);
    const lc = l3.cfg as L3Cfg;
    lc.portVlan[0] = 10; lc.portVlan[1] = 100;
    lc.svis.push({ vlan: 10, ip: '10.0.10.254', prefix: 24, relay: '' }, { vlan: 100, ip: '10.0.100.254', prefix: 24, relay: '' });
    Object.assign(sv.cfg, { dhcpOn: true, pools: [{ start: '10.0.10.100', end: '10.0.10.120', prefix: 24, gw: '10.0.10.254', dns: '' }] });
    expect(build(c.devices, c.cables).eff.get('p')!.ip).toBeNull();
    lc.svis[0].relay = '10.0.100.53';
    n = build(c.devices, c.cables);
    expect(n.eff.get('p')!.ip).toBe(ip('10.0.10.100'));
    expect(reach(n, p, ip('10.0.100.53')).ok).toBe(true);
  });

  it('ファイアウォール: 許可したものだけ通り、ポート転送で外から公開サーバーに届く', () => {
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), fw = b.add('fw', 'fw', 'fw');
    const web = host(b, 'server', 'web', '172.16.1.80', '172.16.1.1'), pc = host(b, 'pc', 'pc', '192.168.1.10', '192.168.1.1', '8.8.8.8');
    b.link(inet, 0, fw, 0); b.link(web, 0, fw, 1); b.link(pc, 0, fw, 2);
    const c = fw.cfg as GwCfg;
    c.lan[0].ip = '172.16.1.1'; c.lan[1].ip = '192.168.1.1'; web.cfg.webOn = true;
    const net = () => build(b.devices, b.cables);
    expect(reach(net(), pc, ip('8.8.8.8')).ok).toBe(false);                 // 暗黙の拒否
    c.rules.push({ action: 'allow', src: '192.168.1.0/24', dst: 'any', svc: 'any' });
    expect(browse(net(), pc, 'www.example.com').ok).toBe(true);
    expect(connect(net(), pc, '172.16.1.80', 'web').ok).toBe(true);
    expect(reach(net(), web, ip('192.168.1.10')).ok).toBe(false);           // DMZ → 社内は不可
    expect(connect(net(), inet, WAN_IP, 'web').ok).toBe(false);             // 転送なし
    c.forwards.push({ svc: 'web', to: '172.16.1.80' });
    expect(connect(net(), inet, WAN_IP, 'web').ok).toBe(true);
    expect(connect(net(), inet, WAN_IP, 'file').ok).toBe(false);
    web.cfg.gw = '';
    const r = connect(net(), inet, WAN_IP, 'web');
    expect(!r.ok && /戻り/.test(r.reason)).toBe(true);
    c.nat = false; web.cfg.gw = '172.16.1.1';
    const q = reach(net(), pc, ip('8.8.8.8'));
    expect(!q.ok && /NAT/.test(q.reason)).toBe(true);
  });

  it('フィルターは上から順に評価する', () => {
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), rt = b.add('router', 'rt', 'rt'), sw = b.add('l2-5', 'sw', 'sw');
    const pc = host(b, 'pc', 'pc', '192.168.1.10', '192.168.1.1', '8.8.8.8');
    b.link(inet, 0, rt, 0); b.link(rt, 1, sw, 0); b.plug(pc, sw);
    const c = rt.cfg as GwCfg;
    c.lan[0].ip = '192.168.1.1';
    c.rules.push({ action: 'allow', src: '192.168.1.10', dst: 'any', svc: 'web' }, { action: 'deny', src: 'any', dst: 'any', svc: 'web' });
    expect(browse(build(b.devices, b.cables), pc, 'www.example.com').ok).toBe(true);
    c.rules.reverse();
    expect(browse(build(b.devices, b.cables), pc, 'www.example.com').ok).toBe(false);
    expect(reach(build(b.devices, b.cables), pc, ip('8.8.8.8')).ok).toBe(true);   // ping は対象外
    expect(resolve(build(b.devices, b.cables), pc, 'www.example.com').ok).toBe(true);
  });

  it('無線: SSIDとキーが合えばつながる。ループ: L2スイッチが輪に入ると止まる', () => {
    const b = new Builder(), sw = b.add('l2-5', 'sw', 'sw'), ap = b.add('ap', 'ap', 'ap');
    const a = host(b, 'pc', 'a', '10.0.0.1'), n1 = host(b, 'pc', 'n', '10.0.0.2');
    b.plug(a, sw); b.plug(ap, sw);
    Object.assign(ap.cfg, { ssid: 'office', key: 'secret' });
    n1.cfg.wifi = { ssid: 'office', key: 'wrong' };
    expect(reach(build(b.devices, b.cables), a, ip('10.0.0.2')).ok).toBe(false);
    n1.cfg.wifi.key = 'secret';
    const net = build(b.devices, b.cables);
    expect(reach(net, a, ip('10.0.0.2')).ok).toBe(true);
    expect(net.eff.get('n')!.ap).toBe('ap');
    expect(evaluate(b.world(), [{ t: 'wifi', devs: ['n'] }])[0].ok).toBe(true);

    const c = new Builder(), s1 = c.add('l2-5', 's1', 's1'), s2 = c.add('l2-5', 's2', 's2');
    const x = host(c, 'pc', 'x', '10.0.0.1'), y = host(c, 'pc', 'y', '10.0.0.2');
    c.plug(x, s1); c.plug(y, s2); c.link(s1, 3, s2, 3);
    const flow = [{ t: 'flow' as const, from: ['x'], to: { dev: 'y' }, svc: 'ping' as const, expect: 'ok' as const }];
    expect(evaluate(c.world(), flow)[0].ok).toBe(true);
    expect(evaluate(c.world(), [{ t: 'redundant', checks: flow }])[0].ok).toBe(false);   // 1本切れると止まる
    c.link(s1, 4, s2, 4);
    const r = evaluate(c.world(), flow)[0];
    expect(!r.ok && /ループ/.test(r.reason!)).toBe(true);
  });
});

describe('公開DNS・メール・負荷分散', () => {
  const make = () => {
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), fw = b.add('fw', 'fw', 'fw'), sw = b.add('l2-5', 'sw', 'sw');
    const sv = host(b, 'server', 'sv', '192.168.1.53', '192.168.1.1'), w1 = host(b, 'server', 'w1', '172.16.1.81', '172.16.1.1'), w2 = host(b, 'server', 'w2', '172.16.1.82', '172.16.1.1');
    const lb = host(b, 'lb', 'lb', '172.16.1.80', '172.16.1.1');
    b.link(inet, 0, fw, 0); b.link(fw, 1, sw, 0); b.link(sv, 0, fw, 2);
    for (const d of [w1, w2, lb]) b.plug(d, sw);
    const c = fw.cfg as GwCfg;
    c.lan[0].ip = '172.16.1.1'; c.lan[1].ip = '192.168.1.1';
    c.rules.push({ action: 'allow', src: '192.168.1.0/24', dst: 'any', svc: 'any' });
    c.forwards.push({ svc: 'web', to: '172.16.1.80' }, { svc: 'mail', to: '192.168.1.53' });
    Object.assign(sv.cfg, { mailOn: true, dnsOn: true, forwarder: '8.8.8.8' });
    for (const w of [w1, w2]) Object.assign(w.cfg, { webOn: true, cert: 'www.test.example.jp' });
    lb.cfg.backends = '172.16.1.81, 172.16.1.82';
    inet.cfg.domain = 'test.example.jp';
    inet.cfg.zone = [{ type: 'A', name: 'www', value: '203.0.113.2' }, { type: 'A', name: 'mail', value: '203.0.113.2' }, { type: 'MX', name: '@', value: 'mail' }, { type: 'TXT', name: '@', value: 'v=spf1 ip4:203.0.113.2 -all' }];
    return { b, inet, w1, sv };
  };
  const web = { t: 'flow' as const, from: ['inet'], to: { name: 'www.test.example.jp' }, svc: 'web' as const, expect: 'ok' as const, https: true };
  const run = (b: Builder) => evaluate(b.world(), [web, { t: 'mailIn', domain: 'test.example.jp' }, { t: 'mailOut' }, { t: 'lb', min: 2 }]).map(r => r.ok);

  it('正しい構成は、Web・受信・送信・振り分けのすべてが通る', () => {
    expect(run(make().b)).toEqual([true, true, true, true]);
  });
  it('Aレコード、証明書、MX、SPF、振り分け先の間違いをそれぞれ見つける', () => {
    let m = make(); m.inet.cfg.zone[0].value = '203.0.113.9';
    expect(run(m.b)).toEqual([false, true, true, true]);
    m = make(); m.w1.cfg.cert = 'web.test.example.jp';
    expect(run(m.b)).toEqual([false, true, true, true]);
    m = make(); m.inet.cfg.zone.splice(2, 1);
    expect(run(m.b)).toEqual([true, false, true, true]);
    m = make(); m.inet.cfg.zone[3].value = 'v=spf1 ip4:203.0.113.9 -all';
    expect(run(m.b)).toEqual([true, true, false, true]);
    m = make(); m.inet.cfg.zone[3].value = 'v=spf1 +all';
    expect(run(m.b)).toEqual([true, true, false, true]);
    m = make(); m.inet.cfg.zone[3].value = 'v=spf1 mx -all';
    expect(run(m.b)).toEqual([true, true, true, true]);
    m = make(); m.w1.cfg.webOn = false;
    expect(run(m.b)).toEqual([true, true, true, false]);   // 1台止まっても、Webは残りの1台で応答する
  });
});
