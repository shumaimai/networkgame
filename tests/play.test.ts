// AIに遊ばせて見つかった不具合の再発を防ぐテスト
import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/gen';
import { worldDiff } from '../src/core/genlib';
import { MAX_LEVEL } from '../src/game/state';
import { tutorialJob } from '../src/game/tutorial';
import { GATE, Gate, usedFeatures } from '../src/ui/panel';

describe('トラブル対応の不具合', () => {
  it('不具合どうしが同じ場所に重ならない。依頼文の「1つではありません」は、不具合が2つ以上のときだけ出る', { timeout: 120000 }, () => {
    let jobs = 0, wan = 0, single = 0, spf = 0;
    for (let level = 2; level <= MAX_LEVEL; level++) for (let seed = 1; seed <= 40; seed++) {
      const j = generate(seed * 13 + level * 500, level, { kind: 'trouble', ease: (seed % 5) / 4 });
      jobs++;
      // 不具合1つにつき、机の上の少なくとも1か所が模範解答と違う
      expect(worldDiff(j.solution, j.initial), `${j.id} ${j.faults.join(' / ')}`).toBeGreaterThanOrEqual(j.faults.length);
      // 回線の挿し間違いを入れた依頼では、そのケーブルが机の上に残っている(あとから「抜けている」で消されていない)
      if (j.faults.some(f => /回線が .* ポートに挿さっている/.test(f))) {
        wan++;
        const c = j.initial.cables.find(x => x.a.dev === 'inet' || x.b.dev === 'inet');
        expect(c, `${j.id} ${j.faults.join(' / ')}`).toBeTruthy();
        expect((c!.a.dev === 'inet' ? c!.b : c!.a).port).toBeGreaterThan(0);
      }
      // SPFの不具合の説明に出る「正しい値」は、SPFのレコードになっている(DKIMやDMARCのレコードを書き換えていない)
      for (const f of j.faults) if (/SPFレコード/.test(f)) { spf++; expect(f, j.id).toMatch(/(正しくは|元は) v=spf1 /); }
      const many = j.brief.includes('困っていることは1つではありません。');
      expect(many, `${j.id} 不具合${j.faults.length}か所`).toBe(j.faults.length > 1);
      if (j.faults.length === 1) single++;
    }
    expect(jobs).toBeGreaterThan(800);
    expect(wan).toBeGreaterThan(20);
    expect(single).toBeGreaterThan(20);
    expect(spf).toBeGreaterThan(10);
  });
});

describe('設定欄を出すレベル', () => {
  it('どのレベルの依頼でも、模範解答に要る設定欄はそのレベルで出ている', { timeout: 120000 }, () => {
    const first: Partial<Record<Gate, number>> = {}, early: string[] = [];
    const see = (level: number, id: string, devices: { kind: string; cfg: any; name: string }[]) => {
      for (const d of devices) for (const k of usedFeatures(d as any)) {
        first[k] = Math.min(first[k] ?? 99, level);
        if (level < GATE[k]) early.push(`Lv.${level} ${id} ${d.name}: ${k}(Lv.${GATE[k]} から)`);
      }
    };
    see(1, 't1', tutorialJob('t1').solution.devices);
    see(2, 't2', tutorialJob('t2').solution.devices);
    for (let level = 1; level <= MAX_LEVEL; level++) for (let seed = 1; seed <= 60; seed++) {
      for (const kind of ['build', 'trouble'] as const) {
        if (kind === 'trouble' && level < 2) continue;
        const j = generate(seed * 11 + level * 700, level, { kind, ease: (seed % 5) / 4 });
        see(level, j.id, j.solution.devices);
      }
    }
    expect(early.slice(0, 10)).toEqual([]);
    // どの設定も、どこかのレベルの依頼で実際に使われている(使われ方を見落としていない)
    expect((Object.keys(GATE) as Gate[]).map(k => `${k}:${first[k] ?? '使われていない'}`).join(' ')).toBe((Object.keys(GATE) as Gate[]).map(k => `${k}:${first[k] ?? GATE[k]}`).join(' '));
    expect(first.gateway).toBe(2);
    // 研修1(Lv.1)では、ゲートウェイもプロキシも使わない
    expect([...tutorialJob('t1').solution.devices.flatMap(d => [...usedFeatures(d)])]).toEqual([]);
  });
});

describe('生成される配置', () => {
  it('どの機器も、最初に見えている机の範囲に、名前の文字まで収まる', { timeout: 120000 }, () => {
    let top = 999, bottom = 0;
    for (let level = 2; level <= MAX_LEVEL; level++) for (let seed = 1; seed <= 30; seed++) {
      const j = generate(seed * 17 + level * 300, level, { kind: 'build', ease: (seed % 5) / 4 });
      for (const d of j.solution.devices) {
        const host = ['pc', 'printer', 'phone', 'camera', 'pos', 'server', 'nas', 'lb', 'home'].includes(d.kind);
        // 絵の上の端は 66(インターネットは 64)、端末の名前とIPアドレスは絵の下(92)まで出る
        const t = d.y - (d.kind === 'internet' ? 64 : 66), b = d.y + (host ? 92 : 46);
        top = Math.min(top, t); bottom = Math.max(bottom, b);
        expect(t, `${j.id} ${d.name} y=${d.y}`).toBeGreaterThanOrEqual(0);
        expect(b, `${j.id} ${d.name} y=${d.y}`).toBeLessThanOrEqual(800);
      }
    }
    expect(top).toBeLessThan(40);
    expect(bottom).toBeGreaterThan(700);
  });
});
