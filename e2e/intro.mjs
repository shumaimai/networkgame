// 研修のあとの「進め方の説明」と、仕入れに並ぶ「これから解放される機材」の確認: node e2e/intro.mjs (dev サーバー起動中)
import { chromium } from 'playwright-core';
const URL0 = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };
const txt = sel => page.locator(sel).first().innerText();
const has = async sel => (await page.locator(sel).count()) > 0;
const box = sel => page.locator(sel).first().boundingBox();
const inside = (a, b, pad = 14) => a && b && a.x >= b.x - pad && a.y >= b.y - pad && a.x + a.width <= b.x + b.width + pad && a.y + a.height <= b.y + b.height + pad;
const over = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

try {
  await page.goto(URL0);
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForSelector('.title');
  await page.click('[data-act="new"]');
  ok(!(await has('.intro')), '研修の途中では、進め方の説明は出ない');

  // ---- 研修をスキップした直後に出る ----
  await page.click('[data-act="skip"]'); await page.click('[data-act="do-skip"]');
  await page.waitForSelector('.intro');
  ok(/進め方の説明 1 \/ 8/.test(await txt('.intro-box')) && /依頼を選ぶ/.test(await txt('.intro-box h3')), '研修をスキップすると、進め方の説明が始まる');
  ok(!(await has('.week-banner')), '説明の間は、週の知らせを重ねない');
  const stage = await box('#stage');
  const targets = ['.cards', '.cards .card', '[data-act="week"]', '[data-act="go-shop"]', '[data-act="go-ware"]', '.lv', '[data-act="guide"]', '[data-act="settings"]'];
  for (let i = 0; i < targets.length; i++) {
    await page.waitForTimeout(320);
    const hole = await box('.intro-hole'), tb = await box(targets[i]), bx = await box('.intro-box');
    ok(inside(tb, hole), `説明${i + 1}: 囲みが、説明している部品(${targets[i]})に合っている`);
    ok(inside(bx, stage, 0) && (i === 0 || !over(bx, tb)), `説明${i + 1}: 説明の枠が画面の中にあり、囲んだ部品に重ならない`);
    if (i === 3) ok(/ここをクリックすると/.test(await txt('.intro-box')) && /解放されるレベル/.test(await txt('.intro-box')), '仕入れの説明に、押す場所と、これから増える機材のことが書いてある');
    if (i === 1) { await page.mouse.click(tb.x + 60, tb.y + 60); ok(!(await has('.modal')), '説明の間は、下の画面のボタンは押せない'); }
    if (i === 2) { await page.click('[data-act="intro-back"]'); ok(/2 \/ 8/.test(await txt('.intro-box')), '「戻る」で前の説明に戻る'); await page.click('[data-act="intro-next"]'); }
    if (i < targets.length - 1) await page.click('[data-act="intro-next"]');
  }
  await page.screenshot({ path: 'shots/i_last.png' });
  ok(/依頼を受けはじめる/.test(await txt('[data-act="intro-next"]')), '最後の説明のボタンは「依頼を受けはじめる」');
  await page.click('[data-act="intro-next"]');
  ok(!(await has('.intro')) && await page.evaluate(() => window.app.game.s.introSeen === true), '最後まで進むと説明が終わる');
  ok(await has('.week-banner'), '説明が終わると、週の知らせが出る');
  await page.click('.cards .card >> nth=0');
  ok(await has('.modal .offer'), '説明のあとは、依頼のカードを押せる');
  await page.click('.modal [data-act="close"]');
  await page.click('[data-act="go-shop"]'); await page.click('[data-act="go-hub"]');
  ok(!(await has('.intro')), '一度見た説明は、画面を行き来しても出ない');
  await page.reload(); await page.waitForSelector('.title'); await page.click('[data-act="continue"]');
  ok(!(await has('.intro')), '再読み込みしても出ない');

  // ---- 設定からもう一度見る。途中で終えられる ----
  await page.click('[data-act="settings"]');
  ok(/進め方の説明をもう一度見る/.test(await txt('.modal')), '設定に「進め方の説明をもう一度見る」がある');
  await page.click('.modal [data-act="intro-again"]');
  await page.waitForSelector('.intro');
  await page.click('[data-act="intro-next"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/i_card.png' });
  await page.click('[data-act="intro-end"]');
  ok(!(await has('.intro')), '「説明を終える」で、途中でも終えられる');

  // ---- 研修を3つとも終えた直後にも出る。進めているセーブには出ない ----
  await page.evaluate(() => { window.app.newGame(); window.app.show('hub'); });
  for (const id of ['t1', 't2', 't3']) {
    await page.evaluate(t => { const g = window.app.game; g.startTutorial(t); const a = g.s.active, j = g.activeJob, w = JSON.parse(JSON.stringify(j.solution)); if (j.kind === 'trouble') w.cables.forEach(c => { c.free = true; }); a.world = w; window.app.show('bench'); }, id);
    await page.click('[data-act="deliver"]'); await page.click('[data-act="hub"]');
    if (id !== 't3') ok(!(await has('.intro')), `研修 ${id} のあと(研修が残っている間)は出ない`);
  }
  await page.waitForSelector('.intro');
  ok(/依頼を選ぶ/.test(await txt('.intro-box h3')), '研修を3つとも終えると、進め方の説明が始まる');
  await page.click('[data-act="intro-end"]');
  await page.evaluate(() => { const g = window.app.game; g.s.introSeen = undefined; g.s.week = 9; g.refreshBoard(); g.s.weekSeen = 9; window.app.show('hub'); });
  ok(!(await has('.intro')), 'すでに週を進めているセーブ(この機能が入る前から遊んでいた場合)には、勝手に出ない');

  // ---- 仕入れ: これから解放される機材が全部並ぶ ----
  await page.evaluate(() => { const g = window.app.game; g.s.xp = 45 * 2 * 5; window.app.show('shop'); });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.shop-row.locked')].map(r => ({ name: r.querySelector('.s-name b').textContent, lock: r.querySelector('.s-lock').textContent, buy: !!r.querySelector('[data-act="buy"]') })));
  const lv = rows.map(r => Number(r.lock.match(/Lv\.(\d+) で解放/)?.[1]));
  ok(rows.length === 10 && rows.every(r => !r.buy) && lv.every(Boolean), `Lv.3 の仕入れに、まだ買えない機材が全部(10種類)灰色で並び、買うボタンはない (${rows.length}種類)`);
  ok(lv.join(',') === [...lv].sort((a, b) => a - b).join(',') && lv[0] === 4 && lv[lv.length - 1] === 19, `解放されるレベルの順に並ぶ (Lv.${lv.join('・')})`);
  ok(rows.some(r => /負荷分散装置/.test(r.name)) && rows.some(r => /L3スイッチ 24ポート/.test(r.name)) && rows.some(r => /業務用ルーター/.test(r.name)), '先のレベルの機材(L3スイッチ、負荷分散装置、業務用ルーターなど)の名前が見える');
  ok(await page.locator('.shop-row:not(.locked) [data-act="buy"]').count() === 4, '買える機材(4種類)は、これまでどおり買える');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/i_shop.png' });
  await page.evaluate(() => { const g = window.app.game; g.s.xp = 30000; window.app.show('shop'); });
  ok(!(await has('.shop-row.locked')), '最高レベルでは、灰色の行はない');
  ok(errors.length === 0, 'JSエラーなし: ' + errors.join(' | '));
} catch (e) { failed++; console.log('EXCEPTION', String(e).split('\n').slice(0, 6).join('\n')); await page.screenshot({ path: 'shots/_fail.png' }); }
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
await browser.close();
process.exit(failed ? 1 : 0);
