import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/checks';
import { generate } from '../src/core/gen';

describe('依頼の自動生成', () => {
  for (const kind of ['build', 'trouble'] as const) {
    it(`${kind}: どのレベルでも生成でき、正解は全テストを通り、初期状態は通らない`, () => {
      const tags: Record<string, number> = {}, stars: Record<number, number> = {};
      let n = 0;
      for (let level = kind === 'build' ? 1 : 2; level <= 14; level++) {
        for (let seed = 1; seed <= 120; seed++) {
          // 半分は、そのレベルでいちばん難しい内容(ease=1)にする
          const job = generate(seed * 7 + level * 1000, level, { kind, ease: seed % 2 ? 1 : undefined });
          const checks = job.checks.map(c => c.check);
          expect(evaluate(job.solution, checks).every(r => r.ok), `${job.id} L${level} 正解`).toBe(true);
          expect(evaluate(job.initial, checks).some(r => !r.ok), `${job.id} L${level} 初期状態`).toBe(true);
          expect(job.checks.length).toBeGreaterThan(1);
          if (kind === 'trouble') expect(job.faults.length).toBeGreaterThan(0);
          else expect(job.par).toBeGreaterThan(0);
          expect(job.reward).toBeGreaterThan(job.par);
          for (const d of [...job.solution.devices]) { expect(d.x, `${job.id} ${d.name} x`).toBeGreaterThan(30); expect(d.y).toBeGreaterThan(30); }
          const ds = job.solution.devices;
          for (let i = 0; i < ds.length; i++) for (let k = i + 1; k < ds.length; k++) {
            expect(Math.abs(ds[i].x - ds[k].x) >= 70 || Math.abs(ds[i].y - ds[k].y) >= 100, `${job.id} L${level} ${ds[i].name} と ${ds[k].name} が重なる`).toBe(true);
          }
          for (const t of job.tags) tags[t] = (tags[t] ?? 0) + 1;
          stars[job.difficulty.stars] = (stars[job.difficulty.stars] ?? 0) + 1;
          n++;
        }
      }
      console.log(kind, n, 'jobs', JSON.stringify(tags), JSON.stringify(stars));
    });
  }
  it('同じシードからは同じ依頼ができる', () => {
    expect(JSON.stringify(generate(42, 9))).toBe(JSON.stringify(generate(42, 9)));
  });
});
