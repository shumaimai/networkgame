// 英語・韓国語の画面の確認: node e2e/lang.mjs (dev サーバー起動中)
// - タイトルと設定から言語を切り替えられる。ブラウザの言語が英語・韓国語なら最初からその言語になる
// - どの画面にも日本語の文字(ひらがな・カタカナ・漢字)が残っていない
// - 研修1を配線から納品まで進められる。依頼の受注、設定パネルの「?」からのガイド、診断ツール、納品後の振り返り、プレイグラウンドも動く
// - 囲みの説明やボタンが画面の外にはみ出さない
import { chromium } from 'playwright-core';

const URL0 = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };
// 言語選択ボタン自身のラベル(「日本語」)を除いた、画面の文字に日本語が残っていないか
const JA = /[ぁ-んァ-ヶ一-龠々〆]/;
const strayJa = page => page.evaluate(re => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('.langs').forEach(el => el.remove());
  const s = (clone.innerText || '').replace(/Language \/ 言語 \/ 언어/g, '');
  const m = s.match(new RegExp('.{0,12}' + re + '.{0,12}'));
  return m ? m[0].replace(/\s+/g, ' ') : '';
}, JA.source);

try {
  // ---- 1. ブラウザの言語での初期表示と、タイトルでの切り替え ----
  {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1920, height: 1080 } });
    const p = await ctx.newPage();
    await p.goto(URL0); await p.waitForSelector('.title');
    ok(await p.evaluate(() => document.documentElement.lang) === 'en' && /Network Shop/.test(await p.locator('.sign h1').innerText()), '英語のブラウザでは、最初から英語で開く');
    await p.click('.langs [data-l="ko"]'); await p.waitForSelector('.title');
    ok(await p.evaluate(() => document.documentElement.lang) === 'ko' && /네트워크 가게/.test(await p.locator('.sign h1').innerText()), 'タイトルで韓国語に切り替えられる');
    await p.click('.langs [data-l="ja"]'); await p.waitForSelector('.title');
    ok(await p.evaluate(() => document.documentElement.lang) === 'ja' && /ネットワーク屋さん/.test(await p.locator('.sign h1').innerText()), 'タイトルで日本語に戻せる');
    await ctx.close();
  }

  // ---- 2. 英語と韓国語のそれぞれで、一通りの画面を動かして確かめる ----
  for (const [l, loc, expectTitle, expectDeliver] of [
    ['en', 'en-US', 'Network Shop', 'Deliver'],
    ['ko', 'ko-KR', '네트워크 가게', '납품'],
  ]) {
    const ctx = await browser.newContext({ locale: loc, viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const clean = async where => { const hit = await strayJa(page); ok(!hit, `[${l}] ${where}: 日本語が残っていない (${hit})`); };

    await page.goto(URL0); await page.waitForSelector('.title');
    ok((await page.title()) === expectTitle, `[${l}] ページのタイトルが翻訳されている`);
    await clean('タイトル');
    await page.screenshot({ path: `shots/lang_${l}_title.png` });

    // 研修1を実際の画面操作で納品まで進める
    await page.click('[data-act="new"]');
    await clean('研修の一覧');
    await page.click('[data-act="tutorial"][data-id="t1"]');
    await page.waitForSelector('.bench');
    await clean('研修1 作業画面');
    await page.click('[data-pal="sup:pc1"]');
    await page.click('[data-pal="sup:pc2"]');
    await page.click('[data-pal="buy:l2-5"]');
    const port = async ref => {
      const b = await page.locator(`[data-port="${ref}"]`).boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    };
    const devClick = async id => {
      const b = await page.locator(`[data-dev="${id}"] image`).boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    };
    const swId = await page.evaluate(() => window.__bench.world.devices.find(d => d.kind === 'l2').id);
    await port('pc1:0'); await port(`${swId}:0`);
    await port('pc2:0'); await port(`${swId}:1`);
    await devClick('pc1');
    await page.fill('[data-bind="ip"]', '192.168.1.10');
    await devClick('pc2');
    await page.fill('[data-bind="ip"]', '192.168.1.11');
    // 設定欄の「?」からガイドが開ける(見出しの逆引きが翻訳後でも効く)
    await page.click('#panel h3 .q >> nth=0');
    await page.waitForSelector('.modal.guide');
    await clean('設定欄から開いたガイド');
    await page.click('.modal [data-act="close"]');
    // ping → 納品
    await devClick('pc1');
    await page.fill('#diag-target', '192.168.1.11');
    await page.click('[data-diag="ping"]');
    await page.waitForTimeout(300);
    await clean('ping 実行後');
    ok((await page.locator('[data-act="deliver"]').innerText()).includes(expectDeliver), `[${l}] 納品ボタンの文言`);
    await page.click('[data-act="deliver"]');
    await page.waitForSelector('.modal .result');
    await clean('研修1 納品結果');
    await page.click('[data-act="hub"]');

    // 研修をスキップ → 進め方の説明が画面の中に収まり、日本語が残らない
    await page.click('[data-act="skip"]'); await page.click('[data-act="do-skip"]');
    await page.waitForSelector('.intro');
    const stage = await page.locator('#stage').boundingBox();
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(260);
      const bx = await page.locator('.intro-box').boundingBox();
      ok(bx.x >= stage.x && bx.y >= stage.y && bx.x + bx.width <= stage.x + stage.width && bx.y + bx.height <= stage.y + stage.height, `[${l}] 進め方の説明 ${i + 1}/8 が画面の中に収まる`);
      if (i === 0) await clean('進め方の説明');
      await page.click('[data-act="intro-next"]');
    }
    await clean('受注の画面');
    await page.screenshot({ path: `shots/lang_${l}_hub.png` });

    // 仕入れ・倉庫・実績・設定・プレイグラウンド
    await page.click('[data-act="go-shop"]');
    ok(await page.locator('.shop-row.locked').count() >= 10, `[${l}] 仕入れに未解放の機材が灰色で並ぶ`);
    await clean('仕入れ');
    await page.screenshot({ path: `shots/lang_${l}_shop.png` });
    await page.click('[data-act="go-ware"]');
    await clean('倉庫');
    await page.click('[data-act="go-hub"]');
    await page.click('[data-act="history"]'); await clean('実績'); await page.click('.modal [data-act="close"]');
    await page.click('[data-act="settings"]'); await clean('設定');
    await page.click('[data-act="play"]');
    await page.waitForSelector('.bench');
    await clean('プレイグラウンド');
    await page.click('[data-act="back"]');

    // 最高レベルにして、全50項目のガイドと、高レベルのトラブル対応・振り返りを確かめる
    await page.evaluate(() => { const g = window.app.game; g.s.xp = 30000; g.refreshBoard(); window.app.show('hub'); });
    await clean('Lv.24 受注の画面');
    await page.click('.cards .card >> nth=0');
    await page.waitForSelector('.modal .offer');
    await clean('Lv.24 依頼の詳細');
    await page.screenshot({ path: `shots/lang_${l}_offer.png` });
    // 依頼のタグからガイドが開ける
    if ((await page.locator('.modal .offer [data-act="guide-to"]').count()) > 0) {
      await page.click('.modal .offer [data-act="guide-to"] >> nth=0');
      await page.waitForSelector('.modal.guide');
      await clean('タグから開いたガイド');
      await page.click('.guide-x');
      await page.waitForSelector('.modal .offer');
      await page.click('.modal [data-act="close"]');
    } else {
      await page.click('.modal [data-act="close"]');
    }
    await page.click('[data-act="guide"]');
    await page.waitForSelector('.modal.guide');
    // ガイド全50項目を順に開いて、日本語が残っていないか確かめる(図解の中の文字も見る)
    const guideLeak = await page.evaluate(re => {
      const btns = [...document.querySelectorAll('#guide-list [data-act="entry"]')];
      if (btns.length < 50) return `項目数が足りない: ${btns.length}`;
      for (const el of btns) {
        el.click();
        const body = (document.querySelector('.guide-body')?.innerText || '') + ' ' + (document.querySelector('#demo')?.textContent || '');
        const m = body.match(new RegExp('.{0,15}' + re + '.{0,15}'));
        if (m) return `${el.getAttribute('data-id')}: ${m[0].replace(/\s+/g, ' ')}`;
      }
      return '';
    }, JA.source);
    ok(!guideLeak, `[${l}] ガイド全50項目に日本語が残っていない (${guideLeak})`);
    await page.screenshot({ path: `shots/lang_${l}_guide.png` });
    await page.click('.guide-x');

    // トラブル対応を1件受注し、模範解答で納品して、振り返り(原因・見つけ方)まで確かめる
    await page.evaluate(() => {
      const g = window.app.game;
      let tr = g.s.board.find(o => o.kind === 'trouble');
      if (!tr) { tr = { id: 'trtest', seed: 77777, level: 24, kind: 'trouble', ease: 0.6 }; g.s.board.push(tr); }
      g.accept(tr, false);
      window.app.show('bench');
    });
    await page.waitForTimeout(350);
    await clean('Lv.24 トラブル対応 作業画面');
    await page.screenshot({ path: `shots/lang_${l}_bench.png` });
    await page.evaluate(() => {
      const g = window.app.game, a = g.s.active, j = g.activeJob;
      const w = JSON.parse(JSON.stringify(j.solution));
      w.cables.forEach(c => { c.free = true; });
      for (const d of w.devices) if (d.own === 'bought') { d.own = 'supplied'; d.cost = 0; }
      a.world = w;
      window.app.show('bench');
    });
    await page.click('[data-act="deliver"]');
    await page.waitForSelector('.modal .result');
    await page.waitForTimeout(350);
    await clean('Lv.24 トラブル対応 納品結果と振り返り');
    await page.screenshot({ path: `shots/lang_${l}_result.png` });

    ok(errors.length === 0, `[${l}] JSエラーなし: ` + errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  failed++;
  console.log('EXCEPTION', String(e).split('\n').slice(0, 8).join('\n'));
}
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
await browser.close();
process.exit(failed ? 1 : 0);
