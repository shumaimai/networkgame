// 常連のお客様からの依頼: 前に納品したネットワークを、そのまま机に出して増設する
// いまは研修1の田中税理士事務所だけ。納品したときの机の上(機器の位置、配線、設定)を保存しておき、それを最初の状態にする
import { Check, describe, evaluate } from '../core/checks';
import { inCidr, ipStr, parseCidr, parseIp } from '../core/ip';
import { CABLE_PRICE, MODEL, World, clone, fillCfg, makeDevice } from '../core/model';
import { Job, JobCheck, worldCost } from '../core/job';
import { tutorialJob } from './tutorial';

const NET = '192.168.1.0/24', ADD = 4;

/** 増設の模範解答を、渡された机の上から組み立てる。空きポートが足りなければL2スイッチを1台足す。組めなければ null */
function extend(base: World): World | null {
  const w = clone(base), cidr = parseCidr(NET)!;
  const used = (dev: string, port: number) => w.cables.some(c => (c.a.dev === dev && c.a.port === port) || (c.b.dev === dev && c.b.port === port));
  const freePort = (): { dev: string; port: number } | null => {
    for (const d of w.devices) if (d.kind === 'l2') for (let i = 0; i < d.ports.length; i++) if (!used(d.id, i)) return { dev: d.id, port: i };
    return null;
  };
  const freeCount = () => w.devices.filter(d => d.kind === 'l2').reduce((t, d) => t + d.ports.filter((_, i) => !used(d.id, i)).length, 0);
  let n = 0;
  const cable = (a: { dev: string; port: number }, b: { dev: string; port: number }) => { w.cables.push({ id: `rx${++n}`, a, b }); };
  if (freeCount() < ADD) {
    const up = freePort();
    if (!up) return null;
    const sw = makeDevice('l2-5', 'rsw', 'SW-増設', 'bought', 0, 0, MODEL['l2-5'].price);
    const near = w.devices.find(d => d.id === up.dev)!;
    sw.x = Math.min(1250, near.x + 330); sw.y = near.y;
    w.devices.push(sw);
    cable(up, { dev: sw.id, port: 0 });
  }
  const taken = new Set(w.devices.map(d => parseIp(d.cfg?.ip)).filter(x => x != null));
  let next = parseIp('192.168.1.21')!;
  for (let i = 0; i < ADD; i++) {
    const pc = makeDevice('pc', `rpc${i + 1}`, `PC-${i + 3}`, 'supplied', 200 + i * 300, 150);
    while (taken.has(next) || !inCidr(next, cidr)) next++;
    pc.cfg.ip = ipStr(next); taken.add(next);
    const p = freePort();
    if (!p) return null;
    w.devices.push(pc);
    cable({ dev: pc.id, port: 0 }, p);
  }
  return w;
}

/** kept: 研修1を納品したときの机の上。研修をスキップしたときは、研修1の模範解答を「前に納品されたもの」として使う */
export function regularJob(kept: World | undefined): Job {
  const t1 = tutorialJob('t1');
  const checksFor = (names: (id: string) => string): JobCheck[] => {
    const list: [Check, string?][] = [
      [{ t: 'addr', devs: ['pc1', 'pc2', 'rpc1', 'rpc2', 'rpc3', 'rpc4'], cidr: NET }, 'PC 6台'],
      [{ t: 'flow', from: ['pc1'], to: { dev: 'pc2' }, svc: 'ping', expect: 'ok' }],
      [{ t: 'flow', from: ['rpc1', 'rpc2', 'rpc3', 'rpc4'], to: { dev: 'pc1' }, svc: 'ping', expect: 'ok' }, '新しいPC 4台'],
      [{ t: 'flow', from: ['rpc1'], to: { dev: 'rpc4' }, svc: 'ping', expect: 'ok' }],
    ];
    return list.map(([check, who]) => ({ check, label: describe(check, names, who) }));
  };
  const build = (src: World, own: boolean): Job | null => {
    const initial = clone(src);
    for (const d of initial.devices) { fillCfg(d); delete d.off; if (d.own !== 'fixed') { d.own = 'supplied'; d.cost = 0; } }
    for (const c of initial.cables) c.free = true;
    if (!['pc1', 'pc2'].every(id => initial.devices.some(d => d.id === id))) return null;
    const solution = extend(initial);
    if (!solution) return null;
    const name = new Map(solution.devices.map(d => [d.id, d.name])), names = (id: string) => name.get(id) ?? id;
    const checks = checksFor(names), raw = checks.map(c => c.check);
    if (evaluate(solution, raw, names).some(r => !r.ok) || evaluate(initial, raw, names).every(r => r.ok)) return null;
    const par = worldCost(solution), score = 7;
    return {
      id: 'regular-tanaka', seed: 0, kind: 'migrate', client: '田中税理士事務所', industry: '事務所', person: '所長', title: 'PCを4台増やす',
      brief: `${own ? '前にPC2台をつないでもらった田中です。おかげで仕事がはかどって、' : '以前、別の方にPC2台をつないでもらった田中です。'}職員が増えたので、PCをあと4台つなぎたいんです。いまの配線はそのまま使ってもらっても、組み直してもらってもかまいません。全部のPCでやり取りできるようにしてください。`,
      spec: [{ head: 'アドレス', body: NET }, { head: '変更内容', body: `PCを4台増やす(PC-3〜PC-6。お客様が用意してある)\nいまある機器とケーブルは、そのまま使っても、片付けて別の機材に替えてもよい` }],
      tags: ['LAN', '増設'], zones: [],
      supplied: solution.devices.filter(d => d.id.startsWith('rpc')).map(d => ({ id: d.id, model: d.model, name: d.name })),
      checks, initial, solution, par,
      difficulty: { stars: 1, score, factors: [{ label: '機器の数(端末6台)', pts: 4 }, { label: '動いているネットワークへの増設', pts: 3 }] },
      reward: Math.round((par * 1.12 + 5000 + score * 800) / 500) * 500, xp: 20 + score * 6, minutes: 8,
      hints: [
        'いまあるスイッチの空きポートを数えます。PC4台ぶんに足りなければ、ポートを増やします。',
        `ポートを増やす方法は2つあります。L2スイッチをもう1台買い、いまのスイッチとケーブルでつなぐ方法と、ポートの多いスイッチに買い替えて1台にまとめる方法です。1台足すほうは、スイッチどうしをつなぐためにポートを1つずつ使い、ケーブルも1本(${CABLE_PRICE}円)要ります。`,
        '新しいPCには、192.168.1.x で、ほかの機器と重ならないIPアドレスを付けます。',
      ],
      faults: [],
    };
  };
  return (kept && build(kept, true)) || build(t1.solution, false)!;
}
