import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/checks';
import { worldCost } from '../src/core/job';
import { clone } from '../src/core/model';
import { Game, newSave, xpFor } from '../src/game/state';
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
    while (g.level < 16 && jobs < 200) {
      // いちばん難しい構築の依頼を受け、模範解答の機材を定価で買ったことにする
      const o = g.s.board.filter(x => x.kind === 'build').pop()!, job = g.job(o);
      g.accept(o, false);
      g.s.money -= job.par;
      minMoney = Math.min(minMoney, g.s.money);
      g.s.active!.world = clone(job.solution);
      expect(g.deliver(evaluate(job.solution, job.checks.map(c => c.check)))).not.toBeNull();
      jobs++;
    }
    console.log(`Lv.16 まで ${jobs}件 / 最少資金 ${minMoney} / 最終資金 ${g.s.money}`);
    expect(g.level).toBe(16);
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
