import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/checks';
import { Builder, worldCost } from '../src/core/job';
import { clone } from '../src/core/model';
import { Game, MAX_LEVEL, newSave, xpFor } from '../src/game/state';
import { regularJob } from '../src/game/regular';
import { TUTORIALS, tutorialJob } from '../src/game/tutorial';

describe('チュートリアル', () => {
  for (const t of TUTORIALS) {
    it(`${t.id}: 模範解答は合格し、初期状態は不合格`, () => {
      const j = tutorialJob(t.id), checks = j.checks.map(c => c.check);
      expect(evaluate(j.solution, checks).map(r => r.reason ?? 'ok')).toEqual(checks.map(() => 'ok'));
      expect(evaluate(j.initial, checks).some(r => !r.ok)).toBe(true);
    });
  }
});

describe('ゲームの進行', () => {
  const play = (g: Game) => {
    const a = g.s.active!, job = g.activeJob!;
    a.world = clone(job.solution);
    if (job.kind === 'trouble') for (const c of a.world.cables) c.free = true;
    return g.deliver(evaluate(a.world, job.checks.map(c => c.check)))!;
  };
  it('チュートリアル3件でレベル3になり、ボードに依頼が並ぶ', () => {
    const g = new Game(newSave(1));
    for (const t of TUTORIALS) { expect(g.nextTutorial).toBe(t.id); g.startTutorial(t.id); const o = play(g); expect(o.stars).toBe(3); }
    expect(g.tutorialFinished).toBe(true);
    expect(g.level).toBe(3);
    expect(g.s.board.length).toBe(5);
    expect(g.s.money).toBe(30000 + 12000 + 42000 + 16000);
  });
  it('スキップしても同じレベルから始められる', () => {
    const g = new Game(newSave(2));
    g.skipTutorial();
    expect(g.level).toBe(3);
    expect(g.s.xp).toBeGreaterThanOrEqual(xpFor(3));
    expect(g.s.board.filter(o => o.kind === 'trouble').length).toBe(2);
  });
  it('受注→納品で前金と残金が入り、週が進む。ヘルプで報酬が減る', () => {
    const g = new Game(newSave(3));
    g.skipTutorial();
    const o = g.s.board[0], job = g.job(o), reward = g.rewardOf(job), before = g.s.money;
    g.accept(o, false);
    expect(g.s.money).toBeGreaterThan(before);
    g.useHelp('reasons');
    const out = play(g);
    expect(out.reward).toBe(reward - Math.round(reward * 0.2));
    expect(g.s.money).toBe(before + out.reward);
    expect(g.s.week).toBe(2);
    expect(g.s.active).toBeNull();
    expect(out.cost).toBe(worldCost(job.solution));
  });
  it('仕入れ: まとめ買い割引、倉庫の容量、在庫の利用と返却', () => {
    const g = new Game(newSave(4));
    g.skipTutorial();
    g.s.money = 500000;
    expect(g.buyStock('l2-8', 7)).toBe('倉庫のスロットが足りません');
    expect(g.setPlan('custom', 9000)).toBeNull();
    expect(g.capacity).toBe(100);
    const q = g.quote('l2-8', 5);
    expect(q.rate).toBe(0.1);
    expect(g.buyStock('l2-8', 5)).toBeNull();
    expect(g.stockQty('l2-8')).toBe(5);
    expect(g.setPlan('none')).toBeNull();
    g.accept(g.s.board[0], false);
    const d = g.useStock('l2-8');
    expect(typeof d).toBe('object');
    expect(g.stockQty('l2-8')).toBe(4);
    if (typeof d === 'object') { expect(d.cost).toBe(q.unit); g.returnDevice(d); }
    expect(g.stockQty('l2-8')).toBe(4 + 1);
    const m = g.s.money;
    g.abandon();
    expect(g.s.money).toBeLessThan(m);
    expect(g.s.rep).toBe(45);
  });
  it('週が変わると、前の週からの値動きが分かる', () => {
    const g = new Game(newSave(6));
    g.skipTutorial();
    expect(g.priceMoves()).toEqual({ down: [], up: [] });
    g.s.xp = xpFor(12);
    let seen = 0;
    for (let i = 0; i < 20; i++) {
      g.nextWeek();
      const m = g.priceMoves(3);
      for (const x of m.down) expect(x.now).toBeLessThan(x.before);
      for (const x of m.up) expect(x.now).toBeGreaterThan(x.before);
      expect(m.down.length).toBeLessThanOrEqual(3);
      seen += m.down.length + m.up.length;
    }
    expect(seen).toBeGreaterThan(10);
  });
  it('相場は 0.5〜2 倍の間で動く', () => {
    const g = new Game(newSave(5));
    g.skipTutorial();
    let lo = 9, hi = 0;
    for (let i = 0; i < 300; i++) { g.nextWeek(); for (const v of Object.values(g.s.market)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    expect(lo).toBeGreaterThanOrEqual(0.5); expect(hi).toBeLessThanOrEqual(2);
    expect(lo).toBeLessThan(0.7); expect(hi).toBeGreaterThan(1.5);
  });
});

describe('バランス', () => {
  it('定価で機材を買って納品し続けても資金が尽きず、最高レベルまで届く', () => {
    const g = new Game(newSave(77));
    g.skipTutorial();
    let jobs = 0, minMoney = g.s.money;
    while (g.level < MAX_LEVEL && jobs < 300) {
      // いちばん難しい構築の依頼を受け、模範解答の機材を定価で買ったことにする
      const o = g.s.board.filter(x => x.kind === 'build').pop()!, job = g.job(o);
      g.accept(o, false);
      g.s.money -= job.par;
      minMoney = Math.min(minMoney, g.s.money);
      g.s.active!.world = clone(job.solution);
      expect(g.deliver(evaluate(job.solution, job.checks.map(c => c.check)))).not.toBeNull();
      jobs++;
    }
    console.log(`Lv.${MAX_LEVEL} まで ${jobs}件 / 最少資金 ${minMoney} / 最終資金 ${g.s.money}`);
    expect(g.level).toBe(MAX_LEVEL);
    expect(minMoney).toBeGreaterThan(0);
    expect(jobs).toBeGreaterThan(30);
  });
});

describe('★の基準', () => {
  it('どの週の相場でも、模範解答どおりに買えば★3になる', () => {
    const g = new Game(newSave(9));
    g.skipTutorial();
    g.s.xp = 45 * 8 * 11;
    let n = 0;
    for (let w = 0; w < 150; w++) {
      g.nextWeek();
      for (const o of g.s.board) {
        const j = g.job(o);
        if (j.kind !== 'build') continue;
        expect(g.parNow(j), `${j.id} 第${g.s.week}週`).toBeLessThanOrEqual(g.starLimits(j)[0]);
        expect(g.rewardOf(j)).toBeGreaterThan(g.parNow(j));
        n++;
      }
    }
    expect(n).toBeGreaterThan(300);
  });
});

describe('常連の依頼', () => {
  const checksOf = (j: ReturnType<typeof regularJob>) => j.checks.map(c => c.check);
  it('研修1で納品した机の上が、そのまま最初の状態になる', () => {
    const g = new Game(newSave(11));
    g.startTutorial('t1');
    const w = clone(tutorialJob('t1').solution);
    // 模範解答と違う番号・違う位置で納品しても、そのまま残る
    w.devices.find(d => d.id === 'pc2')!.cfg.ip = '192.168.1.37';
    w.devices.find(d => d.id === 'pc1')!.x = 333;
    g.s.active!.world = w;
    expect(g.deliver(evaluate(w, tutorialJob('t1').checks.map(c => c.check)))).not.toBeNull();
    const j = regularJob(g.s.keep?.t1);
    expect(j.initial.devices.find(d => d.id === 'pc2')!.cfg.ip).toBe('192.168.1.37');
    expect(j.initial.devices.find(d => d.id === 'pc1')!.x).toBe(333);
    expect(j.initial.devices.every(d => d.own === 'supplied') && j.initial.cables.every(c => c.free)).toBe(true);
    expect(j.brief).toMatch(/前にPC2台をつないでもらった/);
    expect(evaluate(j.solution, checksOf(j)).every(r => r.ok)).toBe(true);
    expect(evaluate(j.initial, checksOf(j)).some(r => !r.ok)).toBe(true);
    // 5ポートのスイッチでは足りないので、模範解答はスイッチを1台足す
    expect(j.solution.devices.filter(d => d.kind === 'l2').length).toBe(2);
    expect(j.par).toBe(4000 + 5 * 500);
  });
  it('8ポートのスイッチで納品していたら、足さずにつなげる。スキップしたときは模範解答から始まる', () => {
    const b = new Builder(), p1 = b.add('pc', 'pc1', 'PC-1', 'supplied'), p2 = b.add('pc', 'pc2', 'PC-2', 'supplied'), sw = b.add('l2-8', 'b1', 'SW-1');
    b.plug(p1, sw); b.plug(p2, sw); p1.cfg.ip = '192.168.1.10'; p2.cfg.ip = '192.168.1.11';
    for (const d of b.devices) { d.x = 400; d.y = 400; }
    const j = regularJob(b.world());
    expect(j.solution.devices.filter(d => d.kind === 'l2').length).toBe(1);
    expect(j.par).toBe(4 * 500);
    expect(evaluate(j.solution, checksOf(j)).every(r => r.ok)).toBe(true);
    const s = regularJob(undefined);
    expect(s.brief).toMatch(/別の方に/);
    expect(evaluate(s.solution, checksOf(s)).every(r => r.ok)).toBe(true);
  });
  it('3週目からボードに出て、納品すると出なくなる。買い替えて1台にまとめても納品できる', () => {
    const g = new Game(newSave(12));
    g.skipTutorial();
    expect(g.s.board.some(o => o.special)).toBe(false);
    g.nextWeek(); g.nextWeek();
    const o = g.s.board.find(x => x.special)!;
    expect(o).toBeTruthy();
    g.nextWeek();
    expect(g.s.board.some(x => x.special)).toBe(true);
    const offer = g.s.board.find(x => x.special)!, j = g.job(offer);
    g.accept(offer, false);
    // 5ポートのスイッチを片付け、8ポートに替えて6台をつなぐ
    const b = new Builder(), sw = b.add('l2-8', 'b1', 'SW-1');
    for (const d of j.solution.devices.filter(x => x.kind === 'pc')) { const pc = b.add('pc', d.id, d.name, 'supplied'); pc.cfg = clone(d.cfg); b.plug(pc, sw); }
    const r = evaluate(b.world(), j.checks.map(c => c.check));
    expect(r.map(x => x.reason ?? 'ok')).toEqual(r.map(() => 'ok'));
    g.s.active!.world = b.world();
    const out = g.deliver(r)!;
    expect(out.stars).toBeGreaterThanOrEqual(2);
    expect(g.s.board.some(x => x.special)).toBe(false);
    g.nextWeek();
    expect(g.s.board.some(x => x.special)).toBe(false);
  });
  it('在庫を使って浮いた額と、次に買えるようになる機材が分かる', () => {
    const g = new Game(newSave(13));
    g.skipTutorial();
    g.s.market['l2-8'] = 0.5;
    expect(g.buyStock('l2-8', 1)).toBeNull();
    g.s.market['l2-8'] = 1;
    g.accept(g.s.board[0], false);
    const d = g.useStock('l2-8');
    if (typeof d === 'string') throw new Error(d);
    g.s.active!.world.devices.push(d);
    expect(g.stockSaving(g.s.active!.world)).toBe(7000 - 3500);
    expect(g.upcoming(2)).toEqual(['server', 'nas']);
  });
});
