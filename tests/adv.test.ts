import { describe, expect, it } from 'vitest';
import { Check, evaluate } from '../src/core/checks';
import { parseIp } from '../src/core/ip';
import { Builder } from '../src/core/job';
import { Device, GwCfg, InetCfg, L3Cfg, ServerCfg, dkimKey, linkError } from '../src/core/model';
import { CLOUD_IP, browse, build, certCovers, connect, dkimResult, dmarcResult, lineIp, monitorResult, reach, tunnelsUp } from '../src/core/sim';

const ip = (s: string) => parseIp(s)!;
const host = (b: Builder, model: string, id: string, addr: string, gw = '', dns = '') => { const d = b.add(model, id, id, 'supplied'); Object.assign(d.cfg, { ip: addr, gw, dns }); return d; };
const gw = (d: Device) => d.cfg as GwCfg;

/** 拠点を1つ作る: ルーター + スイッチ + PC1台 */
function site(b: Builder, n: number, net: string) {
  const rt = b.add('router', 'rt' + n, 'RT-' + n), sw = b.add('l2-5', 'sw' + n, 'SW-' + n);
  gw(rt).lan[0].ip = `${net}.1`;
  b.link(rt, 1, sw, 0);
  const pc = host(b, 'pc', 'pc' + n, `${net}.10`, `${net}.1`, '8.8.8.8');
  b.plug(pc, sw);
  return { rt, sw, pc };
}

describe('回線の複数契約', () => {
  it('つないだ回線ごとに外側のアドレスが決まり、それぞれからインターネットに出られる', () => {
    const b = new Builder(), inet = b.add('internet-2', 'inet', 'inet', 'fixed');
    const s1 = site(b, 1, '192.168.1'), s2 = site(b, 2, '192.168.2');
    b.link(inet, 0, s1.rt, 0); b.link(inet, 1, s2.rt, 0);
    const n = build(b.devices, b.cables);
    expect(n.ifaces.find(i => i.dev === s1.rt && i.wan)!.ip).toBe(lineIp(0));
    expect(n.ifaces.find(i => i.dev === s2.rt && i.wan)!.ip).toBe(ip('203.0.113.6'));
    for (const s of [s1, s2]) expect(browse(n, s.pc, 'www.example.com').ok).toBe(true);
    // 2本目の回線の外側のアドレスに届いた通信は、2台目のルーターが受ける
    const sv = host(b, 'server', 'web', '192.168.2.80', '192.168.2.1');
    sv.cfg.webOn = true; b.plug(sv, s2.sw);
    gw(s2.rt).forwards.push({ svc: 'web', to: '192.168.2.80' });
    const r = connect(build(b.devices, b.cables), inet, ip('203.0.113.6'), 'web');
    expect(r.ok && r.end === sv).toBe(true);
    // 拠点1のPCから、拠点2の外側のアドレスへ(インターネットを横切る)
    expect(connect(build(b.devices, b.cables), s1.pc, ip('203.0.113.6'), 'web').ok).toBe(true);
  });
});

describe('広域イーサネット', () => {
  it('ルート設定があれば拠点同士が届き、支店は本店の回線からインターネットに出る', () => {
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), wan = b.add('wan', 'wan', 'wan', 'fixed');
    const hq = site(b, 1, '192.168.1'), br = site(b, 2, '192.168.2');
    b.link(inet, 0, hq.rt, 0); b.link(hq.rt, 2, wan, 0); b.link(br.rt, 2, wan, 1);
    Object.assign(gw(hq.rt).lan[1], { ip: '10.0.0.1', prefix: 29 });
    Object.assign(gw(br.rt).lan[1], { ip: '10.0.0.2', prefix: 29 });
    let n = build(b.devices, b.cables);
    expect(reach(n, hq.pc, ip('192.168.2.10')).ok).toBe(false);
    gw(hq.rt).routes.push({ dest: '192.168.2.0/24', via: '10.0.0.2' });
    gw(br.rt).routes.push({ dest: '0.0.0.0/0', via: '10.0.0.1' });
    n = build(b.devices, b.cables);
    expect(reach(n, hq.pc, ip('192.168.2.10')).ok).toBe(true);
    expect(reach(n, br.pc, ip('192.168.1.10')).ok).toBe(true);
    const w = browse(n, br.pc, 'www.example.com');
    expect(w.ok && w.hops.includes('RT-1')).toBe(true);
  });
});

describe('拠点間VPN', () => {
  const make = () => {
    const b = new Builder(), inet = b.add('internet-2', 'inet', 'inet', 'fixed');
    const hq = site(b, 1, '192.168.1'), br = site(b, 2, '192.168.2');
    b.link(inet, 0, hq.rt, 0); b.link(inet, 1, br.rt, 0);
    gw(hq.rt).tunnels.push({ peer: '203.0.113.6', key: 'k1', nets: '192.168.2.0/24' });
    gw(br.rt).tunnels.push({ peer: '203.0.113.2', key: 'k1', nets: '192.168.1.0/24' });
    return { b, hq, br };
  };
  it('両側の設定が合えば、プライベートアドレスのまま拠点同士が届く', () => {
    const { b, hq, br } = make(), n = build(b.devices, b.cables, { trace: true });
    const r = reach(n, hq.pc, ip('192.168.2.10'));
    expect(r.ok && r.end === br.pc && r.srcSeen === ip('192.168.1.10')).toBe(true);
    expect(r.path.length).toBeGreaterThan(3);
    expect(tunnelsUp(n).length).toBe(1);
    expect(browse(n, br.pc, 'www.example.com').ok).toBe(true);
  });
  it('キーの不一致、相手側の設定もれ、戻りのネットワークの書きもれは届かない', () => {
    let { b, hq, br } = make();
    gw(br.rt).tunnels[0].key = 'k2';
    let r = reach(build(b.devices, b.cables), hq.pc, ip('192.168.2.10'));
    expect(!r.ok && /事前共有キー/.test(r.reason)).toBe(true);
    ({ b, hq, br } = make());
    gw(br.rt).tunnels.length = 0;
    r = reach(build(b.devices, b.cables), hq.pc, ip('192.168.2.10'));
    expect(!r.ok && /設定がありません/.test(r.reason)).toBe(true);
    ({ b, hq, br } = make());
    gw(br.rt).tunnels[0].nets = '192.168.9.0/24';
    r = reach(build(b.devices, b.cables), hq.pc, ip('192.168.2.10'));
    expect(!r.ok && /戻り/.test(r.reason)).toBe(true);
  });
});

describe('クラウド', () => {
  it('仮想サーバーは拠点間VPNで社内から使え、インターネットからは転送した通信だけが届く', () => {
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), cl = b.add('cloud', 'cloud', 'クラウド', 'fixed');
    const of = site(b, 1, '192.168.1');
    b.link(inet, 0, of.rt, 0);
    const vs = host(b, 'vserver', 'vs', '10.20.0.10', '10.20.0.1', '8.8.8.8');
    Object.assign(vs.cfg, { fileOn: true, webOn: true });
    b.link(vs, 0, cl, 1);
    gw(cl).lan[0].ip = '10.20.0.1';
    gw(of.rt).tunnels.push({ peer: '198.51.100.10', key: 'c', nets: '10.20.0.0/24' });
    gw(cl).tunnels.push({ peer: '203.0.113.2', key: 'c', nets: '192.168.1.0/24' });
    let n = build(b.devices, b.cables);
    expect(n.ifaces.find(i => i.dev === cl && i.wan)!.ip).toBe(CLOUD_IP);
    // セキュリティグループに許可がなければ届かない
    let r = connect(n, of.pc, ip('10.20.0.10'), 'file');
    expect(!r.ok && /セキュリティグループ/.test(r.reason)).toBe(true);
    gw(cl).rules.push({ action: 'allow', src: '192.168.1.0/24', dst: '10.20.0.0/24', svc: 'any' });
    n = build(b.devices, b.cables);
    expect(connect(n, of.pc, ip('10.20.0.10'), 'file').ok).toBe(true);
    // 外からは、ポート転送したWebだけ
    expect(connect(n, inet, CLOUD_IP, 'web').ok).toBe(false);
    gw(cl).forwards.push({ svc: 'web', to: '10.20.0.10' });
    n = build(b.devices, b.cables);
    expect(connect(n, inet, CLOUD_IP, 'web').ok).toBe(true);
    expect(connect(n, inet, CLOUD_IP, 'file').ok).toBe(false);
    // 仮想サーバーから外へ出るにも許可が要る
    expect(reach(n, vs, ip('8.8.8.8')).ok).toBe(false);
    gw(cl).rules.push({ action: 'allow', src: '10.20.0.0/24', dst: 'any', svc: 'any' });
    expect(reach(build(b.devices, b.cables), vs, ip('8.8.8.8')).ok).toBe(true);
  });
  it('つなげる相手が決まっている', () => {
    const b = new Builder(), cl = b.add('cloud', 'cloud', 'c', 'fixed'), vs = b.add('vserver', 'vs', 'vs'), sw = b.add('l2-5', 'sw', 'sw'), pc = b.add('pc', 'pc', 'pc', 'supplied');
    expect(linkError(vs, 0, cl, 1)).toBeNull();
    expect(linkError(vs, 0, sw, 0)).not.toBeNull();
    expect(linkError(pc, 0, cl, 1)).not.toBeNull();
    expect(linkError(sw, 0, cl, 0)).not.toBeNull();
    expect(linkError(pc, 0, sw, 0)).toBeNull();
  });
});

describe('ゲートウェイの冗長化', () => {
  const make = () => {
    const b = new Builder(), inet = b.add('internet-2', 'inet', 'inet', 'fixed'), sw = b.add('l2-8', 'sw', 'sw');
    const r1 = b.add('router', 'r1', 'RT-1'), r2 = b.add('router', 'r2', 'RT-2');
    b.link(inet, 0, r1, 0); b.link(inet, 1, r2, 0); b.link(r1, 1, sw, 0); b.link(r2, 1, sw, 1);
    Object.assign(gw(r1).lan[0], { ip: '192.168.1.1', vip: '192.168.1.254', prio: 110 });
    Object.assign(gw(r2).lan[0], { ip: '192.168.1.2', vip: '192.168.1.254', prio: 100 });
    const pc = host(b, 'pc', 'pc', '192.168.1.10', '192.168.1.254', '8.8.8.8');
    b.plug(pc, sw);
    const checks: Check[] = [{ t: 'failover', kinds: ['router'], what: 'ルーター', checks: [{ t: 'flow', from: ['pc'], to: { ext: 'www.example.com' }, svc: 'web', expect: 'ok' }] }];
    return { b, r1, r2, pc, checks };
  };
  it('優先度の高いルーターが仮想IPアドレスを受け持ち、止まるともう1台が引き継ぐ', () => {
    const { b, r1, r2, pc, checks } = make();
    let n = build(b.devices, b.cables);
    expect(n.vrrp[0].master).toBe('r1');
    let r = reach(n, pc, ip('8.8.8.8'));
    expect(r.ok && r.hops.includes('RT-1')).toBe(true);
    expect(evaluate(b.world(), checks)[0].ok).toBe(true);
    n = build(b.devices.filter(d => d !== r1), b.cables.filter(c => c.a.dev !== 'r1' && c.b.dev !== 'r1'));
    r = reach(n, pc, ip('8.8.8.8'));
    expect(r.ok && r.hops.includes('RT-2')).toBe(true);
    // 仮想IPアドレスがそろっていないと、引き継げない
    gw(r2).lan[0].vip = '';
    expect(evaluate(b.world(), checks)[0].ok).toBe(false);
  });
  it('DHCPは2台で範囲を分けて配り、ゲートウェイには仮想IPアドレスを配る', () => {
    const { b, r1, r2, pc, checks } = make();
    Object.assign(gw(r1).lan[0], { dhcpOn: true, dhcpStart: '192.168.1.100', dhcpEnd: '192.168.1.119', dhcpDns: '8.8.8.8' });
    Object.assign(gw(r2).lan[0], { dhcpOn: true, dhcpStart: '192.168.1.120', dhcpEnd: '192.168.1.139', dhcpDns: '8.8.8.8' });
    pc.cfg.mode = 'dhcp';
    const n = build(b.devices, b.cables), e = n.eff.get('pc')!;
    expect(e.ip != null && e.gw === ip('192.168.1.254')).toBe(true);
    expect(evaluate(b.world(), checks)[0].ok).toBe(true);
  });
  it('L3スイッチ2台でも組める', () => {
    const b = new Builder(), a = b.add('l3-8', 'a', 'L3-1'), z = b.add('l3-8', 'z', 'L3-2'), m = b.add('l2m-8', 'm', 'm', 'supplied');
    for (const [d, last] of [[a, 252], [z, 253]] as [Device, number][]) {
      const c = d.cfg as L3Cfg;
      c.portMode[0] = 'trunk';
      c.svis.push({ vlan: 10, ip: `192.168.10.${last}`, prefix: 24, relay: '', vip: '192.168.10.254', prio: last === 252 ? 120 : 100 }, { vlan: 20, ip: `192.168.20.${last}`, prefix: 24, relay: '', vip: '192.168.20.254', prio: last === 252 ? 120 : 100 });
    }
    m.cfg.portMode[6] = 'trunk'; m.cfg.portMode[7] = 'trunk';
    b.link(m, 6, a, 0); b.link(m, 7, z, 0);
    const p1 = host(b, 'pc', 'p1', '192.168.10.11', '192.168.10.254'), p2 = host(b, 'pc', 'p2', '192.168.20.11', '192.168.20.254');
    m.cfg.portVlan[0] = 10; m.cfg.portVlan[1] = 20;
    b.link(p1, 0, m, 0); b.link(p2, 0, m, 1);
    const checks: Check[] = [{ t: 'failover', kinds: ['l3'], what: 'L3スイッチ', checks: [{ t: 'flow', from: ['p1'], to: { dev: 'p2' }, svc: 'ping', expect: 'ok' }] }];
    expect(evaluate(b.world(), checks).map(r => r.reason ?? 'ok')).toEqual(['ok']);
  });
});

describe('公開サーバーまわり', () => {
  const make = () => {
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), fw = b.add('fw', 'fw', 'FW'), sw = b.add('l2-5', 'sw', 'sw');
    b.link(inet, 0, fw, 0); b.link(fw, 1, sw, 0);
    gw(fw).lan[0].ip = '172.16.1.1';
    const rp = host(b, 'server', 'rp', '172.16.1.80', '172.16.1.1'), w1 = host(b, 'server', 'w1', '172.16.1.81', '172.16.1.1'), w2 = host(b, 'server', 'w2', '172.16.1.82', '172.16.1.1');
    for (const d of [rp, w1, w2]) b.plug(d, sw);
    w1.cfg.webOn = true; w2.cfg.webOn = true;
    Object.assign(rp.cfg, { rpOn: true, rpRules: [{ host: 'www.aoba.example.jp', to: '172.16.1.81' }, { host: 'shop.aoba.example.jp', to: '172.16.1.82' }], cert: '*.aoba.example.jp' });
    gw(fw).forwards.push({ svc: 'web', to: '172.16.1.80' });
    const z = inet.cfg as InetCfg;
    z.domain = 'aoba.example.jp';
    z.zone.push({ type: 'A', name: 'www', value: '203.0.113.2' }, { type: 'A', name: 'shop', value: '203.0.113.2' });
    return { b, inet, rp, w1, w2 };
  };
  it('リバースプロキシは名前で転送先を選び、証明書はリバースプロキシが見せる', () => {
    const { b, rp } = make();
    const checks: Check[] = [
      { t: 'flow', from: ['inet'], to: { name: 'www.aoba.example.jp' }, svc: 'web', expect: 'ok', https: true, by: 'w1' },
      { t: 'flow', from: ['inet'], to: { name: 'shop.aoba.example.jp' }, svc: 'web', expect: 'ok', https: true, by: 'w2' },
    ];
    expect(evaluate(b.world(), checks).map(r => r.reason ?? 'ok')).toEqual(['ok', 'ok']);
    (rp.cfg as ServerCfg).rpRules[1].to = '172.16.1.81';
    expect(evaluate(b.world(), checks).map(r => r.ok)).toEqual([true, false]);
    (rp.cfg as ServerCfg).rpRules[1].to = '172.16.1.82';
    rp.cfg.cert = 'www.aoba.example.jp';
    expect(evaluate(b.world(), checks).map(r => r.ok)).toEqual([true, false]);
    // 名前なし(IPアドレス)では、転送先を選べない
    expect(connect(build(b.devices, b.cables), b.devices[0], ip('203.0.113.2'), 'web').ok).toBe(false);
  });
  it('ワイルドカード証明書は、直下の名前にだけ当てはまる', () => {
    expect(certCovers('*.aoba.example.jp', 'www.aoba.example.jp')).toBe(true);
    expect(certCovers('*.aoba.example.jp', 'aoba.example.jp')).toBe(false);
    expect(certCovers('*.aoba.example.jp', 'a.b.aoba.example.jp')).toBe(false);
    expect(certCovers('www.aoba.example.jp, shop.aoba.example.jp', 'shop.aoba.example.jp')).toBe(true);
  });
  it('DKIMは公開鍵のレコード、DMARCは p= の値を見る', () => {
    const { b, inet, rp } = make(), z = inet.cfg as InetCfg;
    Object.assign(rp.cfg, { mailOn: true, dkimOn: true, dkimSel: 's1' });
    let n = build(b.devices, b.cables);
    expect(dkimResult(n).ok).toBe(false);
    expect(dmarcResult(n).ok).toBe(false);
    z.zone.push({ type: 'TXT', name: 's1._domainkey', value: `v=DKIM1; k=rsa; p=${dkimKey(rp)}` }, { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none' });
    n = build(b.devices, b.cables);
    expect(dkimResult(n).ok).toBe(true);
    expect(dmarcResult(n).ok).toBe(false);
    z.zone[z.zone.length - 1].value = 'v=DMARC1; p=reject';
    z.zone[z.zone.length - 2].value = 'v=DKIM1; k=rsa; p=MIGfWRONG';
    n = build(b.devices, b.cables);
    expect(dkimResult(n).ok).toBe(false);
    expect(dmarcResult(n).ok).toBe(true);
  });
});

describe('社内のサービス', () => {
  it('プロキシを使わない宛先は直接つなぎ、ほかはプロキシを通る', () => {
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), s = site(b, 1, '192.168.1');
    b.link(inet, 0, s.rt, 0);
    const sv = host(b, 'server', 'sv', '192.168.1.53', '192.168.1.1', '8.8.8.8');
    sv.cfg.proxyOn = true; b.plug(sv, s.sw);
    Object.assign(s.pc.cfg, { proxy: '192.168.1.53:8080', noProxy: 'saas.example.com' });
    const n = build(b.devices, b.cables);
    const a = browse(n, s.pc, 'www.example.com'), c = browse(n, s.pc, 'saas.example.com');
    expect(a.ok && a.via).toBe('proxy');
    expect(c.ok && c.via).toBe('direct');
    const checks: Check[] = [{ t: 'flow', from: ['pc1'], to: { ext: 'saas.example.com' }, svc: 'web', expect: 'ok', via: 'direct' }];
    expect(evaluate(b.world(), checks)[0].ok).toBe(true);
    s.pc.cfg.noProxy = '';
    expect(evaluate(b.world(), checks)[0].ok).toBe(false);
  });
  it('監視サーバーは、機器すべてのアドレスが監視先に入っていて応答があれば合格', () => {
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), s = site(b, 1, '192.168.1');
    b.link(inet, 0, s.rt, 0);
    const sv = host(b, 'server', 'sv', '192.168.1.53', '192.168.1.1'), nas = host(b, 'nas', 'nas', '192.168.1.60', '192.168.1.1');
    b.plug(sv, s.sw); b.plug(nas, s.sw);
    Object.assign(sv.cfg, { monOn: true, monTargets: '192.168.1.1' });
    expect(monitorResult(build(b.devices, b.cables)).ok).toBe(false);
    sv.cfg.monTargets = '192.168.1.1, 192.168.1.60';
    expect(monitorResult(build(b.devices, b.cables)).ok).toBe(true);
    b.cables.pop();
    expect(monitorResult(build(b.devices, b.cables)).ok).toBe(false);
  });
});

describe('ガイドの図解', () => {
  it('どの図解も、通信が最後まで届く', async () => {
    const { ENTRIES } = await import('../src/game/guide');
    for (const e of ENTRIES) {
      if (!e.demo) continue;
      const d = e.demo(), n = build(d.world.devices, d.world.cables, { trace: true });
      d.play(n);
      expect(n.trace!.length, e.id).toBeGreaterThan(0);
      if (!['filter', 'guest', 'loop', 'fw'].includes(e.id)) expect(n.trace!.filter(t => !t.ok).map(t => `${e.id}: ${t.label}`)).toEqual([]);
    }
  });
});

describe('ガイドの具体例に書いた動き', () => {
  it('トランク: 片側だけトランクにすると、階をまたぐ通信がどのVLANでもできない', () => {
    const b = new Builder(), s1 = b.add('l2m-8', 's1', 's1'), s2 = b.add('l2m-8', 's2', 's2');
    const a1 = host(b, 'pc', 'a1', '192.168.10.11'), a2 = host(b, 'pc', 'a2', '192.168.10.12'), c1 = host(b, 'pc', 'c1', '192.168.20.11'), c2 = host(b, 'pc', 'c2', '192.168.20.12');
    b.link(a1, 0, s1, 0); b.link(c1, 0, s1, 1); b.link(a2, 0, s2, 0); b.link(c2, 0, s2, 1); b.link(s1, 7, s2, 7);
    for (const sw of [s1, s2]) { sw.cfg.portVlan[0] = 10; sw.cfg.portVlan[1] = 20; sw.cfg.portMode[7] = 'trunk'; }
    let n = build(b.devices, b.cables);
    expect(reach(n, a1, ip('192.168.10.12')).ok && reach(n, c1, ip('192.168.20.12')).ok).toBe(true);
    expect(reach(n, a1, ip('192.168.20.12')).ok).toBe(false);
    s2.cfg.portMode[7] = 'access'; s2.cfg.portVlan[7] = 10;
    n = build(b.devices, b.cables);
    expect(reach(n, a1, ip('192.168.10.12')).ok || reach(n, c1, ip('192.168.20.12')).ok).toBe(false);
  });
  it('ゲスト: 拒否ルールがあっても、社内から始めた通信の返事は戻る', () => {
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), rt = b.add('router', 'rt', 'RT'), s1 = b.add('l2-5', 's1', 's1'), s2 = b.add('l2-5', 's2', 's2');
    b.link(inet, 0, rt, 0); b.link(rt, 1, s1, 0); b.link(rt, 2, s2, 0);
    gw(rt).lan[0].ip = '192.168.10.1'; gw(rt).lan[1].ip = '192.168.20.1';
    const pc = host(b, 'pc', 'pc', '192.168.10.11', '192.168.10.1'), guest = host(b, 'pc', 'guest', '192.168.20.11', '192.168.20.1', '8.8.8.8');
    b.plug(pc, s1); b.plug(guest, s2);
    expect(reach(build(b.devices, b.cables), guest, ip('192.168.10.11')).ok).toBe(true);
    gw(rt).rules.push({ action: 'deny', src: '192.168.20.0/24', dst: '192.168.10.0/24', svc: 'any' });
    const n = build(b.devices, b.cables);
    expect(reach(n, guest, ip('192.168.10.11')).ok).toBe(false);
    expect(reach(n, pc, ip('192.168.20.11')).ok).toBe(true);
    expect(browse(n, guest, 'www.example.com').ok).toBe(true);
  });
  it('NAS: 「利用を許可」には、ネットワークと1台のIPアドレスを並べて書ける', () => {
    const b = new Builder(), rt = b.add('router', 'rt', 'RT'), s1 = b.add('l2-5', 's1', 's1'), s2 = b.add('l2-5', 's2', 's2');
    b.link(rt, 1, s1, 0); b.link(rt, 2, s2, 0);
    gw(rt).lan[0].ip = '192.168.10.1'; gw(rt).lan[1].ip = '192.168.20.1';
    const nas = host(b, 'nas', 'nas', '192.168.10.60', '192.168.10.1'), pc = host(b, 'pc', 'pc', '192.168.10.11', '192.168.10.1');
    const far = host(b, 'pc', 'far', '192.168.20.11', '192.168.20.1'), cam = host(b, 'camera', 'cam', '192.168.20.31', '192.168.20.1');
    b.plug(nas, s1); b.plug(pc, s1); b.plug(far, s2); b.plug(cam, s2);
    nas.cfg.fileAllow = '192.168.10.0/24, 192.168.20.31';
    const n = build(b.devices, b.cables), f = (d: Device) => connect(n, d, ip('192.168.10.60'), 'file').ok;
    expect([f(pc), f(far), f(cam)]).toEqual([true, false, true]);
    expect(reach(n, far, ip('192.168.10.60')).ok).toBe(true);
  });
  it('診断: 回線が抜けていると tracert はルーターで止まり、NATがオフなら tracert は届くが ping は失敗する', async () => {
    const { traceroute } = await import('../src/core/sim');
    const b = new Builder(), inet = b.add('internet', 'inet', 'inet', 'fixed'), s = site(b, 1, '192.168.10');
    let n = build(b.devices, b.cables);
    const t = traceroute(n, s.pc, ip('8.8.8.8'));
    expect(t.ok).toBe(false);
    expect(t.hops).toEqual(['pc1', 'RT-1']);
    b.link(inet, 0, s.rt, 0);
    gw(s.rt).nat = false;
    n = build(b.devices, b.cables);
    expect(traceroute(n, s.pc, ip('8.8.8.8')).ok).toBe(true);
    const r = reach(n, s.pc, ip('8.8.8.8'));
    expect(!r.ok && /戻り/.test(r.reason)).toBe(true);
  });
  it('DHCPの二重化: 2台のルーターの範囲から交互に配られ、1台が止まっても残りで配れる', () => {
    const b = new Builder(), sw = b.add('l2-8', 'sw', 'sw'), r1 = b.add('router', 'r1', 'RT-1'), r2 = b.add('router', 'r2', 'RT-2');
    b.link(r1, 1, sw, 0); b.link(r2, 1, sw, 1);
    Object.assign(gw(r1).lan[0], { ip: '192.168.10.1', dhcpOn: true, dhcpStart: '192.168.10.100', dhcpEnd: '192.168.10.124' });
    Object.assign(gw(r2).lan[0], { ip: '192.168.10.2', dhcpOn: true, dhcpStart: '192.168.10.125', dhcpEnd: '192.168.10.129' });
    const pcs = [1, 2, 3].map(i => { const d = b.add('pc', 'p' + i, 'p' + i, 'supplied'); d.cfg.mode = 'dhcp'; b.plug(d, sw); return d; });
    let n = build(b.devices, b.cables);
    expect(pcs.map(d => n.eff.get(d.id)!.ip)).toEqual([ip('192.168.10.100'), ip('192.168.10.125'), ip('192.168.10.101')]);
    n = build(b.devices.filter(d => d !== r1), b.cables.filter(c => c.a.dev !== 'r1' && c.b.dev !== 'r1'));
    expect(pcs.every(d => n.eff.get(d.id)!.ip != null)).toBe(true);
  });
});

describe('故障テスト', () => {
  it('止めた機器は机にないものとして扱われ、予備のルーターに切り替わる。止めたままでは冗長化のテストに通らない', () => {
    const b = new Builder(), inet = b.add('internet-2', 'inet', 'inet', 'fixed'), sw = b.add('l2-8', 'sw', 'sw');
    const r1 = b.add('router', 'r1', 'RT-1'), r2 = b.add('router', 'r2', 'RT-2');
    b.link(inet, 0, r1, 0); b.link(inet, 1, r2, 0); b.link(r1, 1, sw, 0); b.link(r2, 1, sw, 1);
    Object.assign(gw(r1).lan[0], { ip: '192.168.1.1', vip: '192.168.1.254', prio: 110 });
    Object.assign(gw(r2).lan[0], { ip: '192.168.1.2', vip: '192.168.1.254', prio: 100 });
    const pc = host(b, 'pc', 'pc', '192.168.1.10', '192.168.1.254', '8.8.8.8');
    b.plug(pc, sw);
    const checks: Check[] = [{ t: 'flow', from: ['pc'], to: { ext: 'www.example.com' }, svc: 'web', expect: 'ok' }, { t: 'failover', kinds: ['router'], what: 'ルーター', checks: [{ t: 'flow', from: ['pc'], to: { ext: '8.8.8.8' }, svc: 'ping', expect: 'ok' }] }];
    expect(evaluate(b.world(), checks).map(r => r.ok)).toEqual([true, true]);
    r1.off = true;
    const n = build(b.devices, b.cables), r = reach(n, pc, ip('8.8.8.8'));
    expect(r.ok && r.hops.includes('RT-2') && !r.hops.includes('RT-1')).toBe(true);
    expect(n.vrrp[0].master).toBe('r2');
    expect(evaluate(b.world(), checks).map(x => x.ok)).toEqual([true, false]);
    sw.off = true;
    expect(reach(build(b.devices, b.cables), pc, ip('8.8.8.8')).ok).toBe(false);
  });
});
