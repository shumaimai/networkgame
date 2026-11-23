// お試し版(trial/index.html)の確認: npm run trial のあとで node e2e/trial.mjs
// ファイルを直接開いた場合(file://)と、Webサーバーに置いた場合の両方で、1つのHTMLだけで動くことを確かめる
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const FILE = 'trial/index.html';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };
// Webサーバー: index.html だけを返す。ほかのファイルを取りに来たら記録する
const asked = [];
const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(FILE)); }
  else { asked.push(req.url); res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

try {
  const size = (await stat(FILE)).size;
  ok(size < 5 * 1024 * 1024, `ファイルは 5MB より小さい (${(size / 1024 / 1024).toFixed(2)} MB)`);
  for (const [label, url] of [['ファイルを直接開く', pathToFileURL(FILE).href], ['Webサーバーに置く', `http://127.0.0.1:${port}/`]]) {
    const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1920, height: 1080 } });
    await page.addInitScript(() => { window.__noIntro = true; });
    const errors = [], reqs = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { if (!r.url().startsWith('data:') && r.url() !== url) reqs.push(r.url()); });
    const txt = sel => page.locator(sel).first().innerText();
    await page.goto(url);
    await page.waitForSelector('.title');
    ok(/お試し版/.test(await txt('.trial-note')) && /Lv\.5 まで/.test(await txt('.trial-note')), `${label}: タイトルに「お試し版・Lv.5 まで」と出る`);
    ok((await page.title()) === 'ネットワーク屋さん お試し版', `${label}: ページの題名`);
    await page.evaluate(() => document.fonts.ready);
    // 画面にまだ出ていない文字(総務、経理など)のフォントも、埋め込んだ分から読み込める
    const fonts = await page.evaluate(async () => {
      const n = async (font, text) => (await document.fonts.load(font, text)).length;
      return { sans: await n('500 20px "Zen Maru Gothic"', 'ネットワーク屋さん総務経理'), bold: await n('900 20px "Zen Maru Gothic"', '受注'), body: await n('700 20px "Zen Maru Gothic"', '検収'), mono: await n('400 15px "JetBrains Mono"', '192.168.1.10') };
    });
    ok(fonts.sans > 0 && fonts.bold > 0 && fonts.body > 0 && fonts.mono > 0, `${label}: フォントが読み込まれている ${JSON.stringify(fonts)}`);
    ok(/data:image\/webp/.test(await page.evaluate(() => getComputedStyle(document.querySelector('.title')).backgroundImage)), `${label}: タイトルの背景が埋め込みの画像`);

    // 研修1を、画面の操作で最後まで進める
    await page.click('[data-act="new"]');
    await page.click('[data-act="tutorial"]');
    await page.click('[data-pal="sup:pc1"]'); await page.click('[data-pal="sup:pc2"]'); await page.click('[data-pal="buy:l2-5"]');
    const broken = await page.evaluate(() => [...document.querySelectorAll('img')].filter(i => !i.complete || !i.naturalWidth).length + [...document.querySelectorAll('#desk image')].filter(i => !/^data:image\/webp/.test(i.getAttribute('href'))).length);
    ok(broken === 0 && await page.locator('#desk image').count() === 3, `${label}: 机の上とパレットの絵が全部出る`);
    const sw = await page.evaluate(() => window.__bench.world.devices.find(d => d.kind === 'l2').id);
    for (const [a, b] of [['pc1:0', `${sw}:0`], ['pc2:0', `${sw}:1`]]) { await page.click(`[data-port="${a}"]`); await page.click(`[data-port="${b}"]`); }
    await page.evaluate(() => window.__bench.select('pc1')); await page.fill('[data-bind="ip"]', '192.168.1.10');
    await page.evaluate(() => window.__bench.select('pc2')); await page.fill('[data-bind="ip"]', '192.168.1.11');
    await page.evaluate(() => window.__bench.select('pc1')); await page.fill('#diag-target', '192.168.1.11'); await page.click('[data-diag="ping"]');
    ok(/応答あり/.test(await txt('#console')) && await page.locator('#desk .packet').count() >= 0, `${label}: 配線して ping が通る`);
    await page.click('[data-act="deliver"]');
    ok(/納品完了/.test(await txt('.modal')), `${label}: 研修1を納品できる`);
    await page.click('[data-act="hub"]');

    // レベルの上限
    const cap = await page.evaluate(() => {
      const g = window.app.game;
      g.skipTutorial(); g.s.xp = 999999; g.s.money = 500000; g.s.weekSeen = 99999; g.refreshBoard(); window.app.show('hub');
      return { level: g.level, catalog: g.catalog, jobs: g.s.board.map(o => g.job(o)).map(j => ({ level: Math.max(0, ...j.solution.devices.map(d => 0)), tags: j.tags, kinds: [...new Set(j.solution.devices.map(d => d.kind))] })) };
    });
    ok(cap.level === 5 && /お試し版はここまで/.test(await txt('.lv')) && await page.locator('.trial-tag').count() === 1, `${label}: 経験値がいくら増えても Lv.5 で止まる`);
    ok(cap.catalog.join(',') === 'l2-5,l2-8,l2-16,router,server' , `${label}: 買える機材は Lv.5 までのもの (${cap.catalog.join(',')})`);
    const kinds = new Set(cap.jobs.flatMap(j => j.kinds));
    ok(cap.jobs.length === 5 && [...kinds].every(k => ['pc', 'printer', 'phone', 'camera', 'pos', 'l2', 'router', 'server', 'internet'].includes(k)), `${label}: 並ぶ依頼に、Lv.5 より先の機器が出ない (${[...kinds].join(',')})`);
    await page.click('[data-act="go-shop"]');
    ok(await page.locator('.shop-row.locked').count() === 0, `${label}: 仕入れに、製品版でしか買えない機材の予告を出さない`);
    await page.click('[data-act="guide"]');
    const nav = await txt('.guide-nav');
    ok(/製品版で読めます/.test(nav) && !/Lv\.\d+ で読めます/.test(nav), `${label}: ガイドの先の項目は「製品版で読めます」と出る`);
    await page.click('.guide-x');
    await page.click('[data-act="history"]');
    ok(!/次のレベル/.test(await txt('.modal')), `${label}: 実績に「次のレベル」を出さない`);
    await page.keyboard.press('Escape');
    // プレイグラウンド
    await page.click('[data-act="settings"]'); await page.click('.modal [data-act="play"]');
    const pal = await page.evaluate(() => [...document.querySelectorAll('#palette [data-pal]')].map(e => e.dataset.pal.slice(4)));
    ok(pal.join(',') === 'pc,printer,phone,camera,pos,l2-5,l2-8,l2-16,router,server,internet', `${label}: プレイグラウンドの機器も Lv.5 まで (${pal.join(',')})`);
    await page.click('[data-act="back"]');
    // Lv.5 に着いたときの知らせ
    await page.evaluate(() => { const g = window.app.game; g.s.xp = 45 * 4 * 7 - 10; g.refreshBoard(); g.accept(g.s.board[4], true); const a = g.s.active, j = g.activeJob; a.world = JSON.parse(JSON.stringify(j.solution)); if (j.kind === 'trouble') a.world.cables.forEach(c => { c.free = true; }); window.app.show('bench'); });
    const lv0 = await page.evaluate(() => window.app.game.level);
    await page.click('[data-act="deliver"]');
    const lv1 = await page.evaluate(() => window.app.game.level);
    ok(lv0 === 4 && lv1 === 5 && /お試し版で上がるレベルは Lv\.5 まで/.test(await txt('.trial-end')), `${label}: Lv.5 に着くと、お試し版の範囲と製品版の内容を知らせる (Lv.${lv0} → Lv.${lv1})`);
    await page.click('[data-act="hub"]');
    // セーブ
    const keys = await page.evaluate(() => Object.keys(localStorage));
    ok(keys.includes('netshop-trial-save') && !keys.includes('netshop-save'), `${label}: セーブは、製品版とは別の場所に入る (${keys.join(',')})`);
    await page.reload(); await page.waitForSelector('.title');
    ok(/Lv\.5/.test(await txt('[data-act="continue"]')), `${label}: 再読み込みしても、つづきから遊べる`);
    ok(reqs.length === 0, `${label}: HTMLのほかに、何も読みに行かない: ${reqs.slice(0, 3).join(' ')}`);
    ok(errors.length === 0, `${label}: JSエラーなし: ${errors.join(' | ')}`);
    if (label.startsWith('Web')) { await page.click('[data-act="continue"]'); await page.waitForTimeout(5200); await page.screenshot({ path: 'shots/trial_hub.png' }); }
    else await page.screenshot({ path: 'shots/trial_title.png' });
    await page.close();
  }
  ok(asked.filter(u => u !== '/favicon.ico').length === 0, 'Webサーバーに、index.html のほかのファイルを取りに来ない: ' + asked.join(' '));
} catch (e) { failed++; console.log('EXCEPTION', String(e).split('\n').slice(0, 6).join('\n')); }
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
server.close();
await browser.close();
process.exit(failed ? 1 : 0);
