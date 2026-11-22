import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/checks';
import { generate } from '../src/core/gen';
import { clone, isEndpoint } from '../src/core/model';
import { build } from '../src/core/sim';
import { MAX_LEVEL } from '../src/game/state';
import { copyKeys, copySource } from '../src/ui/panel';

describe('設定を写すボタン', () => {
  it('どのレベルの模範解答でも、端末1台の設定を消してボタンで写し直すと、検収テストに通る', { timeout: 120000 }, () => {
    let devices = 0, offered = 0;
    const bad: string[] = [];
    for (let level = 3; level <= MAX_LEVEL; level++) for (let seed = 1; seed <= 12; seed++) {
      const job = generate(seed * 7 + level * 1000, level, { kind: 'build', ease: seed % 2 ? 1 : undefined }), checks = job.checks.map(c => c.check);
      for (const t of job.solution.devices) {
        if (!isEndpoint(t.kind) || t.cfg.mode === 'dhcp') continue;
        devices++;
        const w = clone(job.solution), d = w.devices.find(x => x.id === t.id)!;
        // IPアドレスだけ入れた状態にする
        Object.assign(d.cfg, { prefix: 24, gw: '', dns: '', proxy: '', noProxy: '' });
        const from = copySource(d, { devices: w.devices, net: build(w.devices, w.cables) });
        if (!from) continue;
        offered++;
        for (const k of copyKeys(d, from)) d.cfg[k] = from.cfg[k];
        if (evaluate(w, checks).some(r => !r.ok)) bad.push(`L${level} ${job.id} ${t.name} ← ${from.name}`);
      }
    }
    console.log(`端末 ${devices}台 / ボタンが出た ${offered}台 / 不合格になった ${bad.length}台`);
    expect(bad.slice(0, 8)).toEqual([]);
    expect(offered).toBeGreaterThan(devices * 0.4);
  });
});
