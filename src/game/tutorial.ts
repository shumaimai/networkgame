// チュートリアル: 手作りの依頼3件と、一手ずつの案内
import { Check, CheckResult, describe } from '../core/checks';
import { Builder, Job, JobCheck, worldCost } from '../core/job';
import { Device, World, clone } from '../core/model';

export interface StepCtx { world: World; results: CheckResult[]; diag: Set<string> }
export interface Step {
  text: string;
  /** 光らせる画面の部品(CSSセレクタ) */
  target?: string;
  done: (c: StepCtx) => boolean;
}
export interface Tutorial { id: string; title: string; summary: string; xp: number; steps: Step[] }

const has = (c: StepCtx, id: string) => c.world.devices.some(d => d.id === id);
const kind = (c: StepCtx, k: string) => c.world.devices.find(d => d.kind === k);
const linked = (c: StepCtx, a: string | undefined, b: string | undefined, pa?: number) =>
  !!a && !!b && c.world.cables.some(x => (x.a.dev === a && x.b.dev === b && (pa === undefined || x.a.port === pa)) || (x.b.dev === a && x.a.dev === b && (pa === undefined || x.b.port === pa)));
const cfg = (c: StepCtx, id: string) => c.world.devices.find(d => d.id === id)?.cfg ?? {};
const never = () => false;

export const TUTORIALS: Tutorial[] = [
  {
    id: 't1', title: 'はじめての配線', summary: 'PC2台をL2スイッチでつなぎ、IPアドレスを設定します。', xp: 180,
    steps: [
      { text: '最初の仕事は、PC2台を通信できるようにすることです。右の「お客様の機器」から PC-1 を机の上にドラッグしてください。', target: '[data-pal="sup:pc1"]', done: c => has(c, 'pc1') },
      { text: '同じように PC-2 も机に置きます。', target: '[data-pal="sup:pc2"]', done: c => has(c, 'pc2') },
      { text: 'PC同士をつなぐには L2スイッチ を使います。「購入」の L2スイッチ 5ポート を机に置いてください。代金は資金から引かれます。', target: '[data-pal="buy:l2-5"]', done: c => !!kind(c, 'l2') },
      { text: 'LANケーブルでつなぎます。PC-1 の上にある小さな四角(ポート)をクリックし、続けてスイッチのポートをクリックしてください。', target: '[data-port="pc1:0"]', done: c => linked(c, 'pc1', kind(c, 'l2')?.id) },
      { text: 'PC-2 も同じようにスイッチへつなぎます。', target: '[data-port="pc2:0"]', done: c => linked(c, 'pc2', kind(c, 'l2')?.id) },
      { text: '配線だけでは通信できません。機器には住所にあたる IPアドレス が要ります。PC-1 をクリックし、右下の設定でIPアドレスに 192.168.1.10 と入力してください。', target: '[data-dev="pc1"]', done: c => cfg(c, 'pc1').ip === '192.168.1.10' },
      { text: '次は PC-2 です。クリックして、IPアドレスに 192.168.1.11 と入力します。同じネットワークの機器は、先頭の 192.168.1 までをそろえます。', target: '[data-dev="pc2"]', done: c => cfg(c, 'pc2').ip === '192.168.1.11' },
      { text: '届くか確かめましょう。PC-1 を選び、診断ツールの宛先に 192.168.1.11 と入れて「ping」を押します。通信がケーブルの上を流れます。', target: '[data-diag="ping"]', done: c => c.diag.has('ping:ok') },
      { text: '左の検収テストがすべて合格になりました。「納品する」を押すと、契約金の残りを受け取れます。', target: '[data-act="deliver"]', done: never },
    ],
  },
  {
    id: 't2', title: 'インターネットにつなぐ', summary: 'ルーターを使って、事務所のPCをインターネットにつなぎます。', xp: 270,
    steps: [
      { text: '今度はインターネットにつなぎます。机の奥の雲が、契約済みの回線です。まず PC-1、PC-2、プリンタ を机に置いてください。', target: '#palette', done: c => ['pc1', 'pc2', 'prn'].every(x => has(c, x)) },
      { text: 'L2スイッチ と ルーター を購入して机に置きます。ルーターは、社内のネットワークとインターネットをつなぐ機器です。', target: '[data-pal="buy:router"]', done: c => !!kind(c, 'l2') && !!kind(c, 'router') },
      { text: 'ルーターの WAN ポート(上側)を、回線の雲のポートにつなぎます。WAN は外側、LAN は内側という意味です。', target: '[data-dev="inet"]', done: c => linked(c, kind(c, 'router')?.id, 'inet', 0) },
      { text: 'ルーターの LAN1 をスイッチへ。PCとプリンタもスイッチへつなぎます。', done: c => linked(c, kind(c, 'router')?.id, kind(c, 'l2')?.id, 1) && ['pc1', 'pc2', 'prn'].every(x => linked(c, x, kind(c, 'l2')?.id)) },
      { text: 'ルーターをクリックして、LAN1 のIPアドレスに 192.168.10.1 と入力します。社内の機器は、外へ送るデータをこのアドレスに渡します。このアドレスをゲートウェイと呼びます。', done: c => kind(c, 'router')?.cfg.lan[0].ip === '192.168.10.1' },
      { text: 'PCとプリンタに 192.168.10.x のIPアドレスを付けます(例: 192.168.10.11)。さらにPCの「ゲートウェイ」に 192.168.10.1 を入れると、外への通信をルーターに任せられます。', done: c => c.results[2]?.ok === true },
      { text: 'Webサイトを名前で開くには、名前をIPアドレスに変えてくれる DNS が要ります。PCの「DNSサーバー」に 8.8.8.8 を入力してください。', done: c => c.results[3]?.ok === true },
      { text: '検収テストがすべて合格です。「納品する」を押しましょう。機材費を抑えるほど評価(★)が上がります。', target: '[data-act="deliver"]', done: never },
    ],
  },
  {
    id: 't3', title: '故障を直す', summary: '動かなくなったネットワークの原因を、診断ツールで探して直します。', xp: 60,
    steps: [
      { text: '最後はトラブル対応です。すでに組まれたネットワークのどこかが壊れています。まず左の検収テストで、不合格の項目を確かめてください。配線から見ていきます。プリンタのケーブルが抜けているので、スイッチにつなぎ直しましょう。', target: '[data-dev="prn"]', done: c => linked(c, 'prn', 'sw') },
      { text: '印刷は直りました。次に PC-2 を選び、診断ツールで 8.8.8.8 に「tracert」を打ってみてください。通信がどこまで進んだかが分かります。', target: '[data-diag="tracert"]', done: c => [...c.diag].some(x => x.startsWith('tracert')) },
      { text: 'PC-2 はルーターにたどり着けていません。PC-2 の「ゲートウェイ」が、ルーターのLAN1のIPアドレス(192.168.1.1)と違っています。直してください。', target: '[data-dev="pc2"]', done: c => c.results.every(r => r.ok) },
      { text: '直りました。行き詰まったら、上の「ヘルプ」で手がかりを見られます。ヘルプを使うと契約金が減ります。機器や用語の説明は「ガイド」にあります。では納品しましょう。', target: '[data-act="deliver"]', done: never },
    ],
  },
];

const names = (b: Builder) => { const m = new Map(b.devices.map(d => [d.id, d.name])); return (id: string) => m.get(id) ?? id; };
const mkChecks = (b: Builder, list: [Check, string?][]): JobCheck[] => list.map(([check, who]) => ({ check, label: describe(check, names(b), who) }));
const pos = (d: Device, x: number, y: number) => { d.x = x; d.y = y; };

function base(id: string, b: Builder, checks: JobCheck[], o: Partial<Job>): Job {
  const t = TUTORIALS.find(x => x.id === id)!;
  const solution = b.world();
  return {
    id, seed: 0, kind: 'build', tutorial: id, client: '', industry: '事務所', person: '所長', title: t.title, brief: '', spec: [], tags: ['チュートリアル'],
    supplied: b.devices.filter(d => d.own === 'supplied').map(d => ({ id: d.id, model: d.model, name: d.name })),
    checks, initial: { devices: b.devices.filter(d => d.own === 'fixed').map(d => clone(d)), cables: [] }, solution, par: worldCost(solution),
    difficulty: { stars: 1, score: 5, factors: [{ label: 'チュートリアル', pts: 5 }] }, reward: 10000, xp: t.xp, minutes: 10, hints: [], faults: [], ...o,
  };
}

const cache = new Map<string, Job>();
export function tutorialJob(id: string): Job {
  let j = cache.get(id);
  if (!j) { j = make(id); cache.set(id, j); }
  return j;
}

function make(id: string): Job {
  const b = new Builder();
  if (id === 't1') {
    const p1 = b.add('pc', 'pc1', 'PC-1', 'supplied'), p2 = b.add('pc', 'pc2', 'PC-2', 'supplied'), sw = b.add('l2-5', 'sw', 'スイッチ');
    b.plug(p1, sw); b.plug(p2, sw);
    p1.cfg.ip = '192.168.1.10'; p2.cfg.ip = '192.168.1.11';
    pos(p1, 520, 620); pos(p2, 880, 620); pos(sw, 700, 380);
    return base(id, b, mkChecks(b, [
      [{ t: 'addr', devs: ['pc1', 'pc2'], cidr: '192.168.1.0/24' }, 'PC-1・PC-2'],
      [{ t: 'flow', from: ['pc1'], to: { dev: 'pc2' }, svc: 'ping', expect: 'ok' }],
    ]), {
      client: '田中税理士事務所', reward: 12000,
      brief: 'PCを2台買ったんだけど、つなぎ方がわからなくてね。2台でやり取りできるようにしてほしい。アドレスは 192.168.1.0/24 でお願いします。',
      spec: [{ head: 'アドレス', body: '192.168.1.0/24' }],
      hints: ['L2スイッチを1台買い、PC2台をつなぎます。', 'PCに 192.168.1.10 と 192.168.1.11 のように、同じネットワークのIPアドレスを付けます。'],
    });
  }
  const inet = b.add('internet', 'inet', 'インターネット', 'fixed');
  const p1 = b.add('pc', 'pc1', 'PC-1', 'supplied'), p2 = b.add('pc', 'pc2', 'PC-2', 'supplied'), prn = b.add('printer', 'prn', 'プリンタ', 'supplied');
  const t3 = id === 't3', net = t3 ? '192.168.1' : '192.168.10';
  const rt = b.add('router', 'rt', 'ルーター', t3 ? 'supplied' : 'bought'), sw = b.add('l2-5', 'sw', 'スイッチ', t3 ? 'supplied' : 'bought');
  b.link(inet, 0, rt, 0); b.link(rt, 1, sw, 0);
  for (const h of [p1, p2, prn]) b.plug(h, sw);
  rt.cfg.lan[0].ip = `${net}.1`;
  Object.assign(p1.cfg, { ip: `${net}.11`, gw: `${net}.1`, dns: '8.8.8.8' });
  Object.assign(p2.cfg, { ip: `${net}.12`, gw: `${net}.1`, dns: '8.8.8.8' });
  Object.assign(prn.cfg, { ip: `${net}.200` });
  pos(inet, 700, 80); pos(rt, 700, 220); pos(sw, 700, 400); pos(p1, 460, 640); pos(p2, 700, 640); pos(prn, 940, 640);
  const checks = mkChecks(b, [
    [{ t: 'addr', devs: ['pc1', 'pc2', 'prn'], cidr: `${net}.0/24` }, '全機器'],
    [{ t: 'flow', from: ['pc1', 'pc2'], to: { dev: 'prn' }, svc: 'print', expect: 'ok' }],
    [{ t: 'flow', from: ['pc1', 'pc2'], to: { ext: '8.8.8.8' }, svc: 'ping', expect: 'ok' }],
    [{ t: 'flow', from: ['pc1', 'pc2'], to: { ext: 'www.example.com' }, svc: 'web', expect: 'ok' }],
  ]);
  if (!t3) {
    return base(id, b, checks, {
      client: 'カフェ・ポラリス', industry: '飲食店', person: '店長', reward: 42000,
      brief: '事務所のPC2台とプリンタをインターネットにつなぎたいんです。回線は契約済みで、机の奥に口が来ています。アドレスは 192.168.10.0/24、DNSは 8.8.8.8 を使うように言われています。',
      spec: [{ head: 'アドレス', body: '192.168.10.0/24' }, { head: 'インターネット', body: '回線は契約済み。公開DNSは 8.8.8.8' }],
      hints: ['ルーターのWANを回線へ、LAN1をL2スイッチへつなぎます。', 'ルーターのLAN1に 192.168.10.1 を設定し、PCのゲートウェイを 192.168.10.1、DNSを 8.8.8.8 にします。'],
    });
  }
  const j = base(id, b, checks, {
    kind: 'trouble', client: 'さくら歯科', industry: 'クリニック', person: '院長', reward: 16000, par: 0, supplied: [],
    brief: '昨日、院内の模様替えをしてから調子が悪いんです。印刷ができなくなって、受付のPCはインターネットにもつながりません。アドレスは 192.168.1.0/24 です。',
    spec: [{ head: 'アドレス', body: '192.168.1.0/24' }, { head: 'インターネット', body: 'ルーターのLAN1は 192.168.1.1。公開DNSは 8.8.8.8' }],
    hints: ['プリンタのケーブルが抜けています。', 'PC-2 のゲートウェイが、ルーターのLAN1のIPアドレスと違っています。'],
    faults: ['プリンタ のケーブルが抜けている', 'PC-2 のデフォルトゲートウェイが違う(192.168.1.254)。正しくは 192.168.1.1'],
  });
  const broken = clone(j.solution);
  for (const c of broken.cables) c.free = true;
  broken.cables = broken.cables.filter(c => c.a.dev !== 'prn' && c.b.dev !== 'prn');
  broken.devices.find(d => d.id === 'pc2')!.cfg.gw = '192.168.1.254';
  j.initial = broken;
  return j;
}
