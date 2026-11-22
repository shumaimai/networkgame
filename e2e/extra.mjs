// ガイドへの近道、故障テスト、入力の補助、常連の依頼、仕入れの画面の確認: node e2e/extra.mjs (dev サーバー起動中)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };
const txt = sel => page.locator(sel).first().innerText();
const shot = name => page.screenshot({ path: `shots/x_${name}.png` });
// 題名かタグで依頼を探して受注し、模範解答を机に置く
const take = (want, solve = true) => page.evaluate(([w, solve]) => {
  const g = window.app.game;
  for (let i = 0; i < 1500; i++) {
    const o = g.s.board.find(x => x.kind === 'build' && !x.special && (g.job(x).title.includes(w) || g.job(x).tags.includes(w)));
    if (o) { g.accept(o, false); if (solve) g.s.active.world = JSON.parse(JSON.stringify(g.activeJob.solution)); window.app.show('bench'); return g.activeJob.title; }
    g.s.week++; g.refreshBoard();
  }
  return null;
}, [want, solve]);
const leave = () => page.evaluate(() => { window.app.game.abandon(); window.app.show('hub'); });

try {
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForSelector('.title');

  // ---- 常連の依頼: 研修1で自分が納品した机の上から始まる ----
  await page.evaluate(() => {
    const g = window.app.game;
    g.startTutorial('t1');
    const w = JSON.parse(JSON.stringify(g.activeJob.solution));
    w.devices.find(d => d.id === 'pc2').cfg.ip = '192.168.1.37';
    w.devices.find(d => d.id === 'pc1').x = 300;
    g.s.active.world = w;
    window.app.show('bench');
  });
  await page.click('[data-act="deliver"]'); await page.click('[data-act="hub"]');
  await page.evaluate(() => { const g = window.app.game; g.abandon(); g.skipTutorial(); g.s.weekSeen = 1; window.app.show('hub'); });
  ok(await page.locator('.chip.regular').count() === 0, '1週目には常連の依頼が出ない');
  await page.click('[data-act="go-shop"]'); await page.click('[data-act="go-hub"]'); await page.click('[data-act="go-ware"]'); await page.click('[data-act="go-hub"]');
  await page.click('[data-act="week"]');
  ok(await page.evaluate(() => window.app.game.s.week) === 2, '画面を行き来したあとでも、「次の週へ」は1回で1週だけ進む');
  await page.click('[data-act="week"]');
  ok(await page.locator('.chip.regular').count() === 1 && /田中税理士事務所/.test(await txt('.cards .card')), '3週目に田中税理士事務所の依頼が出る');
  ok(/見込み利益/.test(await txt('.cards .card .card-foot')), '依頼のカードに見込み利益が出る');
  await page.waitForTimeout(4800);
  await shot('board');
  await page.click('.cards .card >> nth=0');
  ok(/前にPC2台をつないでもらった/.test(await txt('.modal')), '依頼文が、前の納品を受けた内容になっている');
  ok(await page.locator('.modal .gchip').count() > 0, '依頼の詳細に、関連するガイドへのボタンが出る');
  await page.click('.modal .gchip >> nth=0');
  ok(/L2スイッチ/.test(await txt('.guide-body h2')), 'ボタンから、その項目のガイドが開く');
  await page.click('.guide-body [data-act="close"]');
  ok(/PCを4台増やす/.test(await txt('.modal h2')), 'ガイドを閉じると依頼の詳細に戻る');
  await page.click('[data-act="accept"]');
  const init = await page.evaluate(() => { const b = window.__bench; return { ip: b.world.devices.find(d => d.id === 'pc2').cfg.ip, x: b.world.devices.find(d => d.id === 'pc1').x, n: b.world.devices.length, cables: b.world.cables.length, pass: b.results.filter(r => r.ok).length }; });
  ok(init.ip === '192.168.1.37' && init.x === 300 && init.n === 3 && init.cables === 2, `机の上は、研修1で納品したときのまま ${JSON.stringify(init)}`);
  ok(await page.locator('[data-pal^="sup:rpc"]').count() === 4, '新しいPC 4台がパレットにある');
  // 5ポートのスイッチを片付け、8ポートに買い替えて1台にまとめる
  await page.evaluate(() => { const b = window.__bench; b.removeDevice(b.world.devices.find(d => d.kind === 'l2').id); });
  ok(await page.locator('[data-pal^="sup:"]').count() === 5, '片付けたお客様のスイッチはパレットに戻る');
  await page.click('[data-pal="buy:l2-8"]');
  for (const id of ['rpc1', 'rpc2', 'rpc3', 'rpc4']) await page.click(`[data-pal="sup:${id}"]`);
  await page.evaluate(() => { const b = window.__bench, sw = b.world.devices.find(d => d.model === 'l2-8'); b.world.devices.filter(d => d.kind === 'pc').forEach((d, i) => b.link({ dev: d.id, port: 0 }, { dev: sw.id, port: i })); });
  // 新しいPCは「設定を写す」で入力する
  await page.evaluate(() => window.__bench.select('rpc1'));
  ok(/の設定を写す/.test(await txt('#panel .assist')), '未設定の端末に「設定を写す」ボタンが出る');
  for (const id of ['rpc1', 'rpc2', 'rpc3', 'rpc4']) { await page.evaluate(x => window.__bench.select(x), id); await page.click('[data-act="copy-cfg"]'); }
  const ips = await page.evaluate(() => window.__bench.world.devices.filter(d => d.kind === 'pc').map(d => d.cfg.ip));
  ok(new Set(ips).size === 6 && ips.every(x => /^192\.168\.1\.\d+$/.test(x)), `写したIPアドレスは重ならない ${ips.join(' ')}`);
  ok((await txt('#pass')).replace(/\s/g, '') === '4/4', '8ポートに買い替えて1台にまとめても全合格');
  await shot('regular');
  await page.click('[data-act="deliver"]');
  ok(/納品完了/.test(await txt('.modal')), '常連の依頼を納品できる');
  await page.click('[data-act="hub"]');
  ok(await page.locator('.chip.regular').count() === 0, '納品したあとは出ない');

  // ---- 前の依頼の画面の処理が残っていないこと(残っていると、前の依頼で買った機材がもう一度返金される) ----
  await page.evaluate(() => { const g = window.app.game; g.s.money = 500000; g.accept(g.s.board.find(o => o.kind === 'build' && !o.special), false); window.app.show('bench'); });
  await page.click('[data-pal="buy:l2-5"]');
  await page.evaluate(() => { const g = window.app.game, a = g.s.active; a.world = JSON.parse(JSON.stringify(g.activeJob.solution)); window.app.show('bench'); });
  await page.evaluate(() => { const b = window.__bench; b.select(b.world.devices.find(d => d.own === 'bought').id); });
  await page.click('[data-act="deliver"]'); await page.click('[data-act="hub"]');
  await page.evaluate(() => { const g = window.app.game; g.accept(g.s.board.find(o => o.kind === 'build' && !o.special), false); window.app.show('bench'); });
  await page.click('[data-pal="buy:l2-5"]');
  const m0 = await page.evaluate(() => window.app.game.s.money);
  await page.click('[data-act="remove"]');
  const back = (await page.evaluate(() => window.app.game.s.money)) - m0, price = await page.evaluate(() => window.app.game.price('l2-5'));
  ok(back === price, `返品で戻るのは、いま返した1台分だけ (${back} / ${price})`);
  await leave();

  // ---- 仕入れ: まだ買えない機材、在庫の値段 ----
  await page.click('[data-act="go-shop"]');
  ok(await page.locator('.shop-row.locked').count() === 3 && /Lv\.4 で買えるようになります/.test(await txt('.shop-row.locked')), '仕入れに、次に買えるようになる機材が出る');
  await page.waitForTimeout(500);
  await shot('shop');
  await page.evaluate(() => { const g = window.app.game; g.s.money = 3000000; g.s.xp = 30000; g.s.market['router'] = 0.6; g.setPlan('m'); g.buyStock('router', 2); g.s.market['router'] = 1.1; g.refreshBoard(); });

  // ---- 設定パネルの「?」からガイドへ、ガイドの絞り込み ----
  ok(!!(await take('ルーターと回線を二重にする')), '冗長ゲートウェイの依頼を受注');
  await page.evaluate(() => { const b = window.__bench; b.changed(); b.select(b.world.devices.find(d => d.kind === 'router').id); });
  ok(await page.locator('#panel h3 .q').count() >= 5, '設定欄の見出しに「?」が並ぶ');
  await page.click('#panel h3:has-text("拠点間VPN") .q');
  ok(/拠点間VPN/.test(await txt('.guide-body h2')), '拠点間VPNの「?」で、その項目が開く');
  await page.fill('#guide-q', 'vrrp');
  ok(/VRRP/.test(await txt('#guide-list')) && await page.locator('#guide-list button').count() < 12, 'キーワードで項目を絞り込める');
  await page.waitForTimeout(500);
  await shot('guide_search');
  await page.fill('#guide-q', 'zzzz');
  ok(/当てはまる項目がありません/.test(await txt('#guide-list')), '当たらないときは、その旨が出る');
  await page.keyboard.press('Escape');
  ok(await page.locator('#b-guides .gchip').count() >= 2, '作業画面の左に、関連するガイドへのボタンが出る');

  // ---- 故障テスト: ルーター-1を止めると、ルーター-2を通る ----
  const hop = async () => { await page.evaluate(() => { const b = window.__bench; b.select(b.world.devices.find(d => d.kind === 'pc').id); }); await page.fill('#diag-target', '8.8.8.8'); await page.click('[data-diag="tracert"]'); return (await txt('#console')).split('tracert 8.8.8.8').pop(); };
  ok(/ルーター-1/.test(await hop()), 'ふだんはルーター-1を通る');
  await page.evaluate(() => { const b = window.__bench; b.select(b.world.devices.find(d => d.name.endsWith('ルーター-1')).id); });
  await page.click('[data-act="toggle-off"]');
  ok(await page.locator('#desk .dev.off').count() === 1 && /故障テスト中/.test(await txt('#offnote')), '止めた機器に「停止中」と出て、上に知らせが出る');
  const after = await hop();
  ok(/ルーター-2/.test(after) && !/ルーター-1/.test(after) && /到達しました/.test(after), 'ルーター-1を止めると、ルーター-2を通って届く');
  ok(await page.locator('[data-act="deliver"]').isDisabled(), '止めたままでは納品できない');
  await page.waitForTimeout(600);
  await shot('offtest');
  await page.click('[data-act="all-on"]');
  ok(await page.locator('#desk .dev.off').count() === 0 && !(await page.locator('[data-act="deliver"]').isDisabled()), '「すべて動かす」で元に戻り、納品できる: off=' + await page.locator('#desk .dev.off').count() + ' pass=' + await txt('#pass') + ' ' + await page.evaluate(() => window.__bench.job.checks.filter((_, i) => !window.__bench.results[i].ok).map(c => c.label).join(' / ')));
  // 在庫の値段
  ok(/仕入れ値 ¥12,000/.test(await txt('[data-pal="stk:router"]')) && /新品より ¥10,000 安い/.test(await txt('[data-pal="stk:router"]')), '在庫の欄に、仕入れ値と新品との差が出る: ' + await txt('[data-pal="stk:router"]'));
  await page.click('[data-pal="stk:router"]');
  ok(/在庫を使って浮いた額/.test(await txt('#b-cost')) && /¥10,000/.test(await txt('#b-cost .save')), '在庫を使うと、浮いた額が出る');
  await leave();

  // ---- 仕様書の値とDKIMのレコードをコピーする ----
  ok(!!(await take('送信ドメイン認証', false)), '送信ドメイン認証の依頼を受注');
  const cp = page.locator('.spec .cp').first(), want = await cp.innerText();
  await cp.click();
  ok(await page.evaluate(() => navigator.clipboard.readText()) === want, `仕様書の値をクリックするとコピーされる (${want})`);
  ok(await page.locator('.spec .cp').count() >= 6, '仕様書のアドレスや名前がコピーできる形になっている');
  await page.click('[data-pal="buy:server"]');
  await page.click('label.toggle:has([data-bind="mailOn"])'); await page.click('label.toggle:has([data-bind="dkimOn"])');
  await page.click('#panel code.cp >> nth=1');
  const rec = await page.evaluate(() => navigator.clipboard.readText());
  ok(/^v=DKIM1; k=rsa; p=MIGf/.test(rec), `DKIMのレコードの値をコピーできる (${rec})`);
  await page.evaluate(() => window.__bench.select('inet'));
  await page.click('[data-act="add"][data-key="zone"]');
  await page.selectOption('[data-bind="zone.0.type"]', 'TXT');
  await page.click('[data-bind="zone.0.value"]'); await page.keyboard.press('Control+V');
  ok(await page.evaluate(() => window.__bench.world.devices.find(d => d.id === 'inet').cfg.zone[0].value) === rec, 'コピーした値を入力欄に貼り付けられる');
  await shot('copy');
  await leave();

  // ---- 設定: BGM ----
  await page.click('[data-act="settings"]');
  await page.fill('#bgm', '0');
  ok(await page.evaluate(() => window.app.game.s.settings.bgm) === 0, '設定でBGMの大きさを変えられる');
  ok(errors.length === 0, 'JSエラーなし: ' + errors.join(' | '));
} catch (e) { failed++; console.log('EXCEPTION', String(e).split('\n').slice(0, 6).join('\n')); await page.screenshot({ path: 'shots/_fail.png' }); }
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
await browser.close();
process.exit(failed ? 1 : 0);
