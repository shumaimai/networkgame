// 画面の通しテスト。先に `npm run dev` を起動しておく: node e2e/run.mjs
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };
const txt = sel => page.locator(sel).first().innerText();
const center = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const deskAt = (x, y) => page.evaluate(([x, y]) => { const m = document.querySelector('#desk').getScreenCTM(); return { x: m.a * x + m.e, y: m.d * y + m.f }; }, [x, y]);
const dragTile = async (key, x, y) => {
  const a = await center(`[data-pal="${key}"]`), b = await deskAt(x, y);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(a.x - 30, a.y + 20, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
};
const clickPort = async ref => { const c = await center(`[data-port="${ref}"]`); await page.mouse.click(c.x, c.y); };
const coach = () => txt('#coach small');
const pass = async () => (await txt('#pass')).replace(/\s/g, '');
const state = () => page.evaluate(() => { const g = window.app.game; return { money: g.s.money, xp: g.s.xp, level: g.level, week: g.s.week, active: !!g.s.active, done: g.s.tutorialDone, board: g.s.board.length, rep: g.s.rep }; });
// 模範解答を机の上に流し込む
const solve = () => page.evaluate(() => {
  const g = window.app.game, a = g.s.active, j = g.activeJob, w = JSON.parse(JSON.stringify(j.solution));
  if (j.kind === 'trouble') w.cables.forEach(c => { c.free = true; });
  a.world.devices.splice(0, 999, ...w.devices); a.world.cables.splice(0, 999, ...w.cables);
  window.__bench.changed();
});

try {
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.title');
  ok(await page.locator('[data-act="continue"]').count() === 0, 'セーブがなければ「つづきから」は出ない');
  await page.click('[data-act="new"]');
  ok((await txt('.board-head h2')) === '研修', '最初は研修が並ぶ');
  ok(await page.locator('.card:not([disabled])').count() === 1, '研修は1つめだけ選べる');

  // ---- 研修1を実際の操作で進める ----
  await page.click('[data-act="tutorial"]');
  ok(/ステップ 1 \/ 9/.test(await coach()), '研修1 ステップ1');
  ok(await page.locator('#ring:not(.hidden)').count() === 1, '案内の枠が出る');
  await dragTile('sup:pc1', 500, 620);
  ok(/ステップ 2/.test(await coach()), 'PC-1を置くとステップ2: ' + await coach());
  await page.click('[data-pal="sup:pc2"]');
  await dragTile('buy:l2-5', 700, 380);
  ok(/ステップ 4/.test(await coach()), 'スイッチを買うとステップ4: ' + await coach());
  const swId = await page.evaluate(() => window.__bench.world.devices.find(d => d.kind === 'l2').id);
  await clickPort('pc1:0'); await clickPort(`${swId}:0`);
  await clickPort('pc2:0'); await clickPort(`${swId}:1`);
  ok(/ステップ 6/.test(await coach()), '配線するとステップ6: ' + await coach());
  const c1 = await center('[data-dev="pc1"] image'); await page.mouse.click(c1.x, c1.y);
  await page.fill('[data-bind="ip"]', '192.168.1.10');
  const c2 = await center('[data-dev="pc2"] image'); await page.mouse.click(c2.x, c2.y);
  await page.fill('[data-bind="ip"]', '192.168.1.11');
  ok(/ステップ 8/.test(await coach()), 'IPを入れるとステップ8: ' + await coach());
  ok((await pass()) === '2/2', '検収テスト 2/2');
  await page.mouse.click(c1.x, c1.y);
  await page.fill('#diag-target', '192.168.1.11');
  await page.click('[data-diag="ping"]');
  ok(/応答あり/.test(await txt('#console')), 'pingが通る');
  ok(/ステップ 9/.test(await coach()), 'pingでステップ9');
  await page.click('[data-diag="arp"]'); await page.click('[data-diag="ipconfig"]');
  ok(/192\.168\.1\.11\s+00-00-5E/.test(await txt('#console')), 'arp表が出る');
  await page.click('[data-act="deliver"]');
  ok(/納品完了/.test(await txt('.modal')) && /レベルアップ/.test(await txt('.modal')), '納品結果とレベルアップ');
  ok(await page.locator('.r-stars .on').count() === 3, '★3');
  let s = await state();
  ok(s.level === 2 && s.money === 30000 + 12000 - 4000 - 1000 && !s.active, `研修1後の資金とレベル ${JSON.stringify(s)}`);
  await page.click('[data-act="hub"]');

  // ---- 研修2: ヘルプと辞書を開き、模範解答で納品 ----
  await page.click('[data-act="tutorial"]');
  await page.click('[data-act="help"]');
  await page.click('[data-act="use-help"][data-k="plan"]');
  ok(/ルーターのWAN/.test(await txt('.modal')), 'ヘルプ「方針」が出る');
  await page.click('.modal [data-act="close"]');
  await page.click('[data-act="dict"]');
  await page.click('.dict-nav [data-id="l2"]');
  await page.waitForTimeout(400);
  ok(await page.locator('#demo .dev').count() === 3, '辞書の図解に機器が出る');
  ok(await page.locator('#demo .packet').count() === 1, '辞書の図解でパケットが流れる');
  await page.keyboard.press('Escape');
  await solve();
  await page.click('[data-act="deliver"]'); await page.click('[data-act="hub"]');

  // ---- 研修3: 既設のネットワークを直す ----
  await page.click('[data-act="tutorial"]');
  ok(await page.locator('#desk .dev').count() === 6 && await page.locator('#desk .cable').count() === 4, '研修3は既設の機器とケーブルから始まる');
  await clickPort('prn:0'); await clickPort('sw:3');
  const p2 = await center('[data-dev="pc2"] image'); await page.mouse.click(p2.x, p2.y);
  await page.fill('#diag-target', '8.8.8.8'); await page.click('[data-diag="tracert"]');
  ok(/止まりました/.test(await txt('#console')), 'tracertで止まった場所が出る');
  await page.waitForTimeout(900);
  ok(await page.locator('#desk .failmark').count() === 1, '止まった機器に×印');
  await page.fill('[data-bind="gw"]', '192.168.1.1');
  await page.click('[data-act="deliver"]');
  s = await state();
  ok(s.level === 3 && s.done.length === 3 && s.board === 5, `研修を終えるとレベル3でボードが開く ${JSON.stringify(s)}`);
  await page.click('[data-act="hub"]');
  ok((await txt('.board-head h2')) === '受注ボード' && await page.locator('.card').count() === 5, '受注ボードに5件');

  // ---- 受注(チャレンジ)→ 作業 → 中断 → 再開 → 納品 ----
  const money0 = (await state()).money;
  await page.click('.card >> nth=0');
  ok(/難易度/.test(await txt('.modal')) && /検収テスト/.test(await txt('.modal')), '依頼の詳細に難易度の内訳と検収テスト');
  await page.click('.toggle.challenge');
  await page.click('[data-act="accept"]');
  ok(/納期まで/.test(await txt('#timer')), 'チャレンジモードでタイマーが出る');
  ok((await state()).money > money0, '前金が入る');
  ok(await page.locator('.checks small').count() === 0, '通常の依頼では不合格の理由が出ない');
  await page.click('[data-act="help"]'); await page.click('[data-act="use-help"][data-k="reasons"]'); await page.click('.modal [data-act="close"]');
  ok(await page.locator('.checks small').count() > 0, 'ヘルプ「原因」で理由が出る');
  await page.click('[data-act="back"]');
  ok(/作業中の依頼/.test(await txt('.resume')), '事務所に作業中の依頼が出る');
  await page.click('[data-act="resume"]');
  await solve();
  await page.click('[data-act="deliver"]');
  ok(/ヘルプの利用/.test(await txt('.modal')) && /納期ボーナス/.test(await txt('.modal')), '結果にヘルプの減額と納期ボーナス');
  await page.click('[data-act="hub"]');
  s = await state();
  ok(s.week === 2 && s.rep > 50, `納品で週が進み評判が上がる ${JSON.stringify(s)}`);

  // ---- 仕入れと倉庫 ----
  await page.click('[data-act="go-shop"]');
  await page.evaluate(() => { window.app.game.s.money = 200000; });
  await page.click('[data-act="plan"][data-id="s"]');
  for (let i = 0; i < 2; i++) await page.click('[data-act="inc"][data-m="l2-8"]');
  ok(/まとめ買い −5%/.test(await txt('.shop-row:nth-child(2)')), '3台でまとめ買い割引');
  await page.click('[data-act="buy"][data-m="l2-8"]');
  ok(/3台/.test(await txt('.stock')), '在庫に入る');
  await page.click('[data-act="go-hub"]');
  await page.click('.card >> nth=2'); await page.click('[data-act="accept"]');
  ok(await page.locator('[data-pal="stk:l2-8"]').count() === 1, '作業画面のパレットに在庫が出る');
  await page.click('[data-pal="stk:l2-8"]');
  ok(/残り 2/.test(await txt('[data-pal="stk:l2-8"]')), '在庫を机に出すと残りが減る');
  await page.click('[data-act="menu"]'); await page.click('[data-act="abandon"]');
  ok(!(await state()).active && await page.evaluate(() => window.app.game.stockQty('l2-8')) === 3, '取り下げると在庫が戻る');

  // ---- 高レベルの依頼を画面に出しても崩れない ----
  for (const lv of [6, 9, 12]) {
    for (const i of [1, 4]) {
      await page.evaluate(([lv, i]) => { const g = window.app.game; g.s.xp = 30 * (lv - 1) * (lv + 2); g.s.week += 1; g.refreshBoard(); g.accept(g.s.board[i], false); window.app.show('bench'); }, [lv, i]);
      await solve();
      const ids = await page.evaluate(() => window.__bench.world.devices.map(d => d.id));
      for (const id of ids) { await page.evaluate(x => window.__bench.select(x), id); ok(await page.locator('#panel h2').count() === 1, `Lv${lv} パネル ${id}`); }
      const p = (await pass()).split('/');
      ok(p[0] === p[1], `Lv${lv}-${i} 模範解答で全テスト合格 ${p.join('/')}`);
      await page.screenshot({ path: `shots/lv${lv}-${i}.png` });
      await page.click('[data-act="deliver"]'); await page.click('[data-act="hub"]');
    }
  }
  ok((await state()).level >= 12, 'レベル12以上');
  await page.click('[data-act="history"]');
  ok(/納品した依頼/.test(await txt('.modal')), '実績が開く');
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('.title');
  ok(await page.locator('[data-act="continue"]').count() === 1, '再読み込み後は「つづきから」が出る');
  ok(errors.length === 0, 'JSエラーなし: ' + errors.join(' | '));
} catch (e) {
  failed++;
  console.log('EXCEPTION', String(e).split('\n').slice(0, 6).join('\n'));
  await page.screenshot({ path: 'shots/_fail.png' });
}
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
await browser.close();
process.exit(failed ? 1 : 0);
