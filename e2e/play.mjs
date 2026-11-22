// AIに遊ばせて見つかった点の確認: node e2e/play.mjs (dev サーバー起動中)
// 研修の案内の位置、習う前の設定欄、案内の枠、ポートの重なり、設定パネルの状態表示、購入欄の開閉、納品結果の収まり
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => { window.__noIntro = true; });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };
const txt = sel => page.locator(sel).first().innerText();
const box = sel => page.locator(sel).first().boundingBox();
const has = async sel => (await page.locator(sel).count()) > 0;
const over = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const sel = id => page.evaluate(x => window.__bench.select(x), id);
// 模範解答を机の上に置く
const solve = () => page.evaluate(() => {
  const g = window.app.game, a = g.s.active, j = g.activeJob, w = JSON.parse(JSON.stringify(j.solution));
  if (j.kind === 'trouble') w.cables.forEach(c => { c.free = true; });
  a.world.devices.splice(0, 999, ...w.devices); a.world.cables.splice(0, 999, ...w.cables);
  window.__bench.changed();
});

try {
  await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5173/'));
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForSelector('.title');
  await page.click('[data-act="new"]');

  // ---- 研修1(Lv.1) ----
  await page.click('[data-act="tutorial"]');
  await solve();
  const desk = await box('.desk-wrap'), coach = await box('#coach');
  ok(coach.y >= desk.y + desk.height - 2, `案内は机の下にあり、机の上の機器を隠さない (机の下端 ${Math.round(desk.y + desk.height)} / 案内の上端 ${Math.round(coach.y)})`);
  for (const id of ['pc1', 'pc2']) ok(!over(await box(`[data-dev="${id}"]`), coach), `案内が ${id} に重ならない`);
  await sel('pc2');
  ok(await has('#panel [data-bind="ip"]') && !(await has('#panel [data-bind="gw"]')) && !(await has('#panel [data-bind="dns"]')) && !/Webプロキシ/.test(await txt('#panel')), 'Lv.1 のPCの設定には、ゲートウェイ・DNS・プロキシの欄が出ない');
  ok(/ステップ 8/.test(await txt('#coach small')), '研修1 ステップ8');
  ok(over(await box('#ring'), await box('[data-dev="pc1"]')) && !over(await box('#ring'), await box('[data-diag="ping"]')), 'PC-2 を選んでいる間、案内の枠は PC-1 を指す');
  await sel('pc1');
  ok(over(await box('#ring'), await box('[data-diag="ping"]')), 'PC-1 を選ぶと、案内の枠は ping のボタンに移る');
  await page.fill('#diag-target', '192.168.1.11'); await page.click('[data-diag="ping"]');
  await page.click('[data-act="deliver"]');
  ok(!(await has('#ring:not(.hidden)')), '納品の結果を出している間、案内の枠は出ない');
  await page.click('[data-act="hub"]');

  // ---- 研修2(Lv.2) ----
  await page.click('[data-act="tutorial"]');
  await page.click('[data-pal="buy:router"]');
  let p = await txt('#panel');
  ok(await has('#panel [data-bind="lan.0.ip"]') && !(await has('#panel [data-bind="lan.1.ip"]')) && !(await has('#panel [data-bind="lan.0.dhcpOn"]')), 'Lv.2 のルーターの設定には、LAN2 とDHCPの欄が出ない');
  ok(!/スタティックルート/.test(p) && !/フィルター/.test(p) && !/ポート転送/.test(p), 'Lv.2 のルーターの設定には、ルート・フィルター・ポート転送の欄が出ない');
  ok(await has('#panel [data-bind="nat"]'), 'NATの欄は出る');
  // 回線の真下に置いても、ポート同士が重ならない位置にずれる
  const gap = await page.evaluate(() => {
    const b = window.__bench, rt = b.world.devices.find(d => d.kind === 'router'), inet = b.world.devices.find(d => d.kind === 'internet');
    b.removeDevice(rt.id);
    b.place('buy:router', { x: inet.x, y: inet.y + 120 });
    const r2 = b.world.devices.find(d => d.kind === 'router');
    return { dy: (r2.y - 60) - (inet.y + 60), x: r2.x - inet.x };
  });
  ok(gap.x === 0 && Math.abs(gap.dy) >= 20, `回線の真下にルーターを置くと、ポートが重ならない位置にずれる (ポートの間隔 ${gap.dy})`);
  const wan = await box('[data-port="inet:0"]'), rwan = await box(`[data-port="${await page.evaluate(() => window.__bench.world.devices.find(d => d.kind === 'router').id)}:0"]`);
  ok(!over(wan, rwan), '回線のポートとルーターのWANポートを、別々にクリックできる');
  // LAN2 にケーブルをつなぐと、LAN2 の欄が出る
  await page.click('[data-pal="buy:l2-5"]');
  await page.evaluate(() => { const b = window.__bench, rt = b.world.devices.find(d => d.kind === 'router'), sw = b.world.devices.find(d => d.kind === 'l2'); b.link({ dev: rt.id, port: 2 }, { dev: sw.id, port: 0 }); b.select(rt.id); });
  ok(await has('#panel [data-bind="lan.1.ip"]'), 'LAN2 にケーブルをつなぐと、LAN2 の欄が出る');
  await sel('pc1').catch(() => {});
  await page.click('[data-pal="sup:pc1"]');
  ok(await has('#panel [data-bind="gw"]') && await has('#panel [data-bind="dns"]') && !/Webプロキシ/.test(await txt('#panel')), 'Lv.2 のPCの設定には、ゲートウェイとDNSの欄が出る(プロキシは出ない)');
  // ガイドの右上の閉じるボタン
  await page.click('[data-act="guide"]');
  ok(await has('.modal.guide .guide-x'), 'ガイドの右上に閉じるボタンがある');
  await page.click('.guide-x');
  ok(!(await has('.modal.guide')), '閉じるボタンでガイドが閉じる');

  // ---- 最高レベル ----
  await page.evaluate(() => { const g = window.app.game; g.abandon(); g.skipTutorial(); g.s.xp = 30000; g.s.money = 3000000; g.s.weekSeen = 99999; g.refreshBoard(); window.app.show('hub'); });
  const take = (kind, test) => page.evaluate(([kind, src]) => {
    const g = window.app.game, f = new Function('j', 'return ' + src);
    for (let i = 0; i < 2500; i++) {
      const o = g.s.board.find(x => x.kind === kind && !x.special && f(g.job(x)));
      if (o) { g.accept(o, false); window.app.show('bench'); return g.activeJob.title; }
      g.s.week++; g.refreshBoard();
    }
    return null;
  }, [kind, test]);
  const leave = () => page.evaluate(() => { window.app.game.abandon(); window.app.show('hub'); });

  // 設定パネルの状態の表示が、入力したその場で変わる(拠点間VPN)
  ok(!!(await take('build', "j.title.includes('拠点間VPNで2つの拠点をつなぐ')")), '拠点間VPNの依頼を受注');
  await solve();
  const rt = await page.evaluate(() => window.__bench.world.devices.find(d => d.cfg.tunnels?.length).id);
  await sel(rt);
  ok(/接続中/.test(await txt('#panel .tun .pool-h')) && !(await page.locator('#panel .tun .why').first().isVisible()), '正しい設定では「接続中」と出る');
  const key = await page.inputValue('[data-bind="tunnels.0.key"]');
  await page.fill('[data-bind="tunnels.0.key"]', key + 'x');
  ok(/未接続/.test(await txt('#panel .tun .pool-h')) && (await txt('#panel .tun .why')).length > 5, 'キーを変えると、機器を選び直さなくても「未接続」と理由が出る: ' + await txt('#panel .tun .why'));
  ok(await page.evaluate(() => document.activeElement?.dataset?.bind) === 'tunnels.0.key', '入力中の欄は、そのまま入力を続けられる');
  await page.fill('[data-bind="tunnels.0.key"]', key);
  ok(/接続中/.test(await txt('#panel .tun .pool-h')) && !(await page.locator('#panel .tun .why').first().isVisible()), 'キーを戻すと、その場で「接続中」に戻り、理由が消える');
  ok(/購入/.test(await txt('#palette')) && await has('#palette [data-pal^="buy:"]'), '構築の依頼では、購入の一覧が開いている');
  await page.click('[data-act="toggle-buy"]');
  ok(!(await has('#palette [data-pal^="buy:"]')) && /開く/.test(await txt('#palette')), '購入の一覧を閉じられる');
  await leave();

  // 設定を写したときのコンソールの文
  ok(!!(await take('build', "j.solution.devices.filter(d => d.kind === 'pc' && d.cfg.mode !== 'dhcp' && d.cfg.gw).length >= 2 && !j.zones?.length")), '手動設定のPCが2台以上ある構築の依頼を受注');
  await solve();
  const pair = await page.evaluate(() => {
    const b = window.__bench, pcs = b.world.devices.filter(d => d.kind === 'pc' && d.cfg.mode !== 'dhcp' && d.cfg.gw);
    for (const d of pcs) { const o = pcs.find(x => x !== d && x.cfg.gw === d.cfg.gw); if (o) { const keep = d.cfg.gw; d.cfg.gw = ''; b.changed(); b.select(d.id); return { name: d.name, keep }; } }
    return null;
  });
  if (await has('#panel [data-act="copy-cfg"]')) {
    await page.click('[data-act="copy-cfg"]');
    const line = (await txt('#console')).split('\n').filter(x => /写しました/.test(x)).pop() ?? '';
    ok(/ のゲートウェイを .+ に写しました。IPアドレスは写していません。/.test(line), 'コンソールに、写した項目の名前が出る: ' + line);
  } else ok(false, '「設定を写す」ボタンが出ない: ' + JSON.stringify(pair));
  await leave();

  // トラブル対応: 購入の一覧は閉じている。「設定を写す」は出ない。4か所の不具合の振り返りが収まる
  ok(!!(await take('trouble', 'j.faults.length === 4')), '不具合が4か所のトラブル対応を受注');
  ok(!(await has('#palette [data-pal^="buy:"]')) && /開く/.test(await txt('#palette')), 'トラブル対応では、購入の一覧が閉じている');
  await page.click('[data-act="toggle-buy"]');
  ok(await has('#palette [data-pal^="buy:"]'), '開くと購入できる');
  const ids = await page.evaluate(() => window.__bench.world.devices.filter(d => ['pc', 'printer', 'phone', 'camera', 'pos'].includes(d.kind)).map(d => d.id));
  let assist = 0;
  for (const id of ids) { await sel(id); if (await has('#panel .assist')) assist++; }
  ok(assist === 0, `トラブル対応では「設定を写す」ボタンが出ない (端末 ${ids.length}台)`);
  await solve();
  await page.click('[data-act="deliver"]');
  await page.waitForTimeout(1700);
  const rv = await page.evaluate(() => { const e = document.querySelector('.r-review'); return { rows: e.querySelectorAll(':scope > div').length, fit: e.scrollHeight <= e.clientHeight + 1 }; });
  const stage = await box('#stage'), btn = await box('.result [data-act="hub"]'), modal = await box('.modal');
  ok(rv.rows >= 5 && rv.fit, `振り返りの欄に、4件の原因と診断の行が切れずに収まる (${rv.rows}行)`);
  ok(btn.y + btn.height <= stage.y + stage.height && modal.y >= stage.y, '「受注へ戻る」が画面の中にある');
  await page.screenshot({ path: 'shots/p_result.png' });
  await page.click('[data-act="hub"]');
  ok(errors.length === 0, 'JSエラーなし: ' + errors.join(' | '));
} catch (e) { failed++; console.log('EXCEPTION', String(e).split('\n').slice(0, 6).join('\n')); await page.screenshot({ path: 'shots/_fail.png' }); }
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
await browser.close();
process.exit(failed ? 1 : 0);
