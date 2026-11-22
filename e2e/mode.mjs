// プレイグラウンドと、ハードモードの連続成功の確認: node e2e/mode.mjs (dev サーバー起動中)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => { window.__noIntro = true; });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };
const txt = sel => page.locator(sel).first().innerText();
const has = async sel => (await page.locator(sel).count()) > 0;
const st = () => page.evaluate(() => { const g = window.app.game; return { money: g.s.money, xp: g.s.xp, level: g.level, streak: g.s.streak ?? 0, active: !!g.s.active, play: g.s.play?.world.devices.length ?? 0, screen: window.app.current }; });
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

  // ---- タイトルの設定から、プレイグラウンドを開く(Lv.1、資金は最初のまま) ----
  await page.click('[data-act="settings"]');
  ok(/プレイグラウンド/.test(await txt('.modal')) && await has('.modal [data-act="play"]'), '設定にプレイグラウンドの入口がある');
  await page.click('.modal [data-act="play"]');
  let s = await st();
  ok(s.screen === 'play' && /プレイグラウンド/.test(await txt('.bar-title')) && /お金はかかりません/.test(await txt('#b-money')), 'プレイグラウンドが開く');
  ok(!(await page.locator('[data-act="deliver"]').isVisible()) && !(await page.locator('[data-act="help"]').isVisible()), '納品とヘルプのボタンは出ない');
  for (const m of ['pc', 'printer', 'phone', 'camera', 'pos', 'home', 'l2-5', 'router', 'router-4', 'server', 'nas', 'l2m-24', 'l3-24', 'fw', 'ap', 'lb', 'internet', 'internet-2', 'internet-3', 'wan', 'cloud', 'vserver']) {
    if (!(await has(`[data-pal="buy:${m}"]`))) ok(false, `プレイグラウンドの一覧に ${m} がない`);
  }
  ok(s.level === 1 && await has('[data-pal="buy:l3-24"]') && await has('[data-pal="buy:cloud"]'), 'Lv.1 でも、どの機器も一覧に出る');
  const money0 = s.money;
  for (const m of ['internet-2', 'router', 'router', 'l2m-24', 'l3-24', 'fw', 'lb', 'server', 'pc', 'pc', 'printer', 'cloud', 'vserver', 'wan', 'home', 'ap']) await page.click(`[data-pal="buy:${m}"]`);
  s = await st();
  ok(s.play === 16 && s.money === money0, `16台置いても資金は変わらない (${s.play}台 / 資金 ${s.money})`);
  ok(/机の上にあります/.test(await txt('[data-pal="buy:internet"]')) && /机の上にあります/.test(await txt('[data-pal="buy:cloud"]')), '回線とクラウドは、1つ置くと「机の上にあります」と出る');
  const n0 = s.play;
  await page.click('[data-pal="buy:internet-3"]');
  ok((await st()).play === n0 && /1つだけ/.test(await txt('#console')), '回線の2つめは置けず、理由がコンソールに出る');
  const over = await page.evaluate(() => { const ds = window.__bench.world.devices; return ds.filter((d, i) => ds.some((o, j) => j > i && Math.abs(o.x - d.x) < 110 && Math.abs(o.y - d.y) < 100)).map(d => d.name); });
  ok(over.length === 0, 'クリックで置いた機器は、互いに重ならない: ' + over.join(' '));
  await page.screenshot({ path: 'shots/m_play.png' });

  // ---- 組んで、通信を確かめる ----
  const ids = await page.evaluate(() => {
    const b = window.__bench, f = (k, n = 0) => b.world.devices.filter(d => d.kind === k)[n];
    const inet = f('internet'), rt = f('router'), sw = f('l2m'), pc = f('pc'), prn = f('printer');
    b.link({ dev: inet.id, port: 0 }, { dev: rt.id, port: 0 });
    b.link({ dev: rt.id, port: 1 }, { dev: sw.id, port: 0 });
    b.link({ dev: pc.id, port: 0 }, { dev: sw.id, port: 1 });
    b.link({ dev: prn.id, port: 0 }, { dev: sw.id, port: 2 });
    b.select(rt.id);
    return { rt: rt.id, pc: pc.id, cables: b.world.cables.length };
  });
  ok(ids.cables === 4 && (await st()).money === money0, 'ケーブルも無料でつなげる');
  ok(await has('#panel [data-bind="lan.1.ip"]') && /スタティックルート/.test(await txt('#panel')) && /拠点間VPN/.test(await txt('#panel')) && /故障テスト/.test(await txt('#panel')), 'Lv.1 でも、設定欄は全部出る(LAN2、ルート、拠点間VPN、故障テスト)');
  ok(!/購入品/.test(await txt('#panel .sub')) && /机から片付ける/.test(await txt('#panel [data-act="remove"]')), '値段や返品の表示は出ない');
  await page.fill('[data-bind="lan.0.ip"]', '192.168.1.1');
  await page.evaluate(id => window.__bench.select(id), ids.pc);
  await page.fill('[data-bind="ip"]', '192.168.1.10'); await page.fill('[data-bind="gw"]', '192.168.1.1'); await page.fill('[data-bind="dns"]', '8.8.8.8');
  await page.fill('#diag-target', 'www.example.com'); await page.click('[data-diag="web"]');
  ok(/www\.example\.com/.test(await txt('#console')) && /開けました|表示/.test((await txt('#console')).split('www.example.com').pop()), 'プレイグラウンドで組んだネットワークで、Webサイトを開ける: ' + (await txt('#console')).split('\n').slice(-2).join(' / '));
  await page.click('[data-diag="ping"]');
  ok(/応答あり/.test(await txt('#console')), 'ping も通る');

  // ---- 戻る・開き直す・片付ける ----
  await page.click('[data-act="back"]');
  ok((await st()).screen === 'title', 'タイトルから開いたときは、タイトルへ戻る');
  await page.click('[data-act="new"]');
  await page.evaluate(() => { const g = window.app.game; g.skipTutorial(); g.s.weekSeen = 99999; window.app.show('hub'); });
  ok((await st()).play === 0, '「はじめから」にすると、プレイグラウンドの机も空になる');
  await page.click('[data-act="settings"]'); await page.click('.modal [data-act="play"]');
  for (const m of ['l2-8', 'pc', 'pc']) await page.click(`[data-pal="buy:${m}"]`);
  await page.click('[data-act="back"]');
  ok((await st()).screen === 'hub', '受注の画面から開いたときは、受注の画面へ戻る');

  // 依頼の作業中に開いても、依頼は変わらない
  await page.evaluate(() => { const g = window.app.game; g.accept(g.s.board.find(o => o.kind === 'build'), false); window.app.show('bench'); });
  await page.click('[data-pal="buy:l2-5"]');
  const job0 = await page.evaluate(() => JSON.stringify(window.app.game.s.active)), m1 = (await st()).money;
  await page.click('[data-act="menu"]'); await page.click('.modal [data-act="settings"]'); await page.click('.modal [data-act="play"]');
  s = await st();
  ok(s.screen === 'play' && s.play === 3, `作業画面のメニューからも開ける。前に置いた機器が残っている (${s.play}台)`);
  await page.click('[data-pal="buy:l3-24"]'); await page.click('[data-pal="buy:fw"]');
  await page.click('[data-act="menu"]'); await page.click('.modal [data-act="settings"]');
  ok(await page.locator('.modal [data-act="play"]').isDisabled(), 'プレイグラウンドの中では、開くボタンは押せない');
  await page.click('.modal [data-act="close"]');
  await page.click('[data-act="back"]');
  s = await st();
  const job1 = await page.evaluate(() => { const a = JSON.parse(JSON.stringify(window.app.game.s.active)); return JSON.stringify(a); });
  const same = (a, b) => { const x = JSON.parse(a), y = JSON.parse(b); x.elapsed = y.elapsed = 0; return JSON.stringify(x) === JSON.stringify(y); };
  ok(s.screen === 'bench' && s.active && s.money === m1 && same(job0, job1), '作業中の依頼へ戻り、依頼の机の上と資金は変わっていない');
  ok(await page.locator('[data-act="deliver"]').isVisible() && /資金/.test(await txt('#b-money')), '依頼の作業画面は、ふだんどおりに出る');
  await page.click('[data-pal="buy:l2-5"]');
  ok((await st()).money < m1, '依頼の作業画面では、機材にお金がかかる');
  await page.click('[data-act="menu"]'); await page.click('.modal [data-act="abandon"]');
  await page.click('[data-act="settings"]'); await page.click('.modal [data-act="play"]');
  await page.click('[data-act="play-clear"]'); await page.click('.modal [data-act="do-clear"]');
  ok((await st()).play === 0 && await page.locator('#desk .dev').count() === 0, '「机の上を全部片付ける」で空になる');
  await page.click('[data-act="back"]');

  // ---- ハードモードの連続成功 ----
  await page.evaluate(() => { const g = window.app.game; g.s.xp = 4000; g.s.rep = 60; g.refreshBoard(); window.app.show('hub'); });
  const hard = async (late = false) => {
    await page.click('.cards .card >> nth=0');
    const note = await txt('.modal .toggle.challenge');
    await page.click('.toggle.challenge'); await page.click('[data-act="accept"]');
    await solve();
    if (late) await page.evaluate(() => { const g = window.app.game; g.s.active.elapsed = g.activeJob.minutes * 60000 + 5000; });
    const xp0 = (await st()).xp, base = await page.evaluate(() => window.app.game.activeJob.xp);
    await page.click('[data-act="deliver"]');
    const meta = await txt('.r-meta'), stars = await page.locator('.r-stars .on').count();
    const got = (await st()).xp - xp0;
    await page.click('[data-act="hub"]');
    await page.evaluate(() => { window.app.game.s.weekSeen = 99999; });
    return { note, meta, got, want: m => Math.round(base * (0.6 + 0.2 * stars) * m) };
  };
  let r = await hard();
  ok(/ハードモード/.test(r.note) && /×1\.5/.test(r.note) && /0に戻り/.test(r.note), '受注の画面に、ハードモードの説明と次の倍率が出る: ' + r.note.slice(0, 60));
  ok(/1回連続/.test(r.meta) && /×1\.5/.test(r.meta) && r.got === r.want(1.5), `1回目: 経験値 ×1.5 (${r.got} / ${r.want(1.5)})`);
  ok(/1/.test(await txt('.streak')) && /×2/.test(await txt('.streak')), '受注の画面の上に、連続の回数と次の倍率が出る: ' + await txt('.streak'));
  r = await hard();
  ok(/×2/.test(r.note) && /2回連続/.test(r.meta) && r.got === r.want(2), `2回目: 経験値 ×2 (${r.got} / ${r.want(2)})`);
  r = await hard();
  ok(/3回連続/.test(r.meta) && /×3/.test(r.meta) && r.got === r.want(3), `3回目: 経験値 ×3 (${r.got} / ${r.want(3)})`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/m_hub.png', clip: { x: 0, y: 0, width: 1920, height: 300 } });
  // 検収テストや難易度の内訳が多い依頼でも、「受注する」が画面の中に収まる
  const fit = await page.evaluate(() => {
    const g = window.app.game, out = [];
    for (const lv of [9, 16, 24]) { g.s.xp = 45 * (lv - 1) * (lv + 2); for (let w = 0; w < 6; w++) { g.s.week++; g.refreshBoard(); out.push(...g.s.board.map(o => ({ id: o.id, lv }))); } }
    return out.length;
  });
  let cut = 0, seen = 0;
  for (let w = 0; w < 4; w++) {
    await page.evaluate(() => { const g = window.app.game; g.s.week++; g.s.weekSeen = 99999; g.refreshBoard(); window.app.show('hub'); });
    for (let i = 0; i < 5; i++) {
      await page.click(`.cards .card >> nth=${i}`);
      const m = await page.evaluate(() => { const e = document.querySelector('.modal').getBoundingClientRect(), b = document.querySelector('.modal [data-act="accept"]').getBoundingClientRect(), t = document.querySelector('.modal .toggle.challenge').getBoundingClientRect(); return b.bottom <= e.bottom + 1 && b.top >= e.top && e.bottom <= window.innerHeight + 1 && t.bottom <= e.bottom + 1 && t.top >= e.top ? 0 : 2; });
      seen++; if (m > 1) cut++;
      if (w === 0 && i === 4) { await page.waitForTimeout(400); await page.screenshot({ path: 'shots/m_offer.png' }); }
      await page.click('.modal [data-act="close"]');
    }
  }
  ok(cut === 0 && fit > 0, `Lv.24 の依頼の詳細でも、「受注する」とハードモードの切り替えがいつも見えている (${seen}件中 ${cut}件で隠れた)`);
  await page.evaluate(() => { const g = window.app.game; g.s.xp = 4000; g.s.weekSeen = 99999; g.refreshBoard(); window.app.show('hub'); });
  await page.click('.cards .card >> nth=0'); await page.waitForTimeout(200);
  await page.click('.modal [data-act="close"]');
  // 時間制限なしの依頼: 倍率は付かず、連続は変わらない
  await page.click('.cards .card >> nth=0'); await page.click('[data-act="accept"]');
  ok(!(await page.locator('#timer').isVisible()), 'ハードモードをオフにすると、納期の時計は出ない');
  await solve();
  const xpE = (await st()).xp, baseE = await page.evaluate(() => window.app.game.activeJob.xp);
  await page.click('[data-act="deliver"]');
  const starsE = await page.locator('.r-stars .on').count(), metaE = await txt('.r-meta');
  ok((await st()).xp - xpE === Math.round(baseE * (0.6 + 0.2 * starsE)) && !/連続/.test(metaE) && (await st()).streak === 3, '時間制限なしの納品では、倍率が付かず、連続も変わらない');
  await page.click('[data-act="hub"]'); await page.evaluate(() => { window.app.game.s.weekSeen = 99999; });
  // 遅れると0に戻る
  r = await hard(true);
  ok(/間に合わず/.test(r.meta) && /連続成功\(3回\)が止まりました/.test(r.meta) && r.got === r.want(1) && (await st()).streak === 0, `納期に遅れると、倍率が付かず、連続が0に戻る (${r.meta.replace(/\s+/g, ' ')})`);
  ok(!(await has('.streak')), '連続が0のときは、受注の画面の上に出ない');

  // ---- ハードモードの時計は、作業画面を離れている間も進む ----
  await page.click('.cards .card >> nth=0'); await page.click('.toggle.challenge'); await page.click('[data-act="accept"]');
  ok(/納期まで/.test(await txt('#timer')), 'ハードモードでは、納期の時計が出る');
  const e0 = await page.evaluate(() => window.app.game.s.active.elapsed);
  await page.click('[data-act="back"]');
  await page.click('[data-act="settings"]'); await page.click('.modal [data-act="play"]');
  await page.waitForTimeout(3200);
  await page.click('[data-act="back"]');
  await page.click('[data-act="resume"]');
  const e1 = await page.evaluate(() => window.app.game.s.active.elapsed);
  ok(e1 - e0 >= 3000 && e1 - e0 < 9000, `受注の画面やプレイグラウンドにいる間も、納期の時計は進む (+${e1 - e0}ms)`);
  ok(errors.length === 0, 'JSエラーなし: ' + errors.join(' | '));
} catch (e) { failed++; console.log('EXCEPTION', String(e).split('\n').slice(0, 6).join('\n')); await page.screenshot({ path: 'shots/_fail.png' }); }
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
await browser.close();
process.exit(failed ? 1 : 0);
