// Lv.17 以降の依頼を、画面の操作と同じ経路(机に置く・つなぐ・片付ける)で組み立てて納品できるかの確認
// node e2e/adv.mjs (dev サーバー起動中)
// 模範解答の機器を1台ずつ買って置き、設定を写す。置いた機器のIDは模範解答と違うので、
// IDに頼った判定(DKIMの公開鍵、冗長化、応答するサーバーの確認など)が実際の手順でも通るかを見る
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => { window.__noIntro = true; });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };

// 題名かタグで探す依頼。種類ごとに1件ずつ解く
const WANT = [
  '2つの拠点を広域イーサネットでつなぐ', '新しい拠点をつなぐ', 'のプロキシに通す', 'プロキシ経由に切り替える', '3つの拠点をつなぐ', '3つ目の拠点を増やす',
  '拠点間VPNで2つの拠点をつなぐ', '新しい拠点を拠点間VPNでつなぐ', '広域イーサネットから拠点間VPNへ', 'ルーターと回線を二重にする', 'ルーターを2台に増やす',
  'クラウドの仮想サーバーを使う', '社内のサーバーをクラウドへ移す', 'L3スイッチを二重にする', 'を二重にした拠点間ネットワーク', '拠点で共有しているサーバーをクラウドへ移す',
  '2つの拠点とクラウドをつなぐ', 'Webとメールをクラウドで動かす', 'Webとメールをクラウドへ移す', 'クラウドサービスへ直接つなぐ',
  'リバースプロキシ', '送信ドメイン認証', 'プロキシの例外', '監視',
];

try {
  await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5173/'));
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForSelector('.title');
  await page.evaluate(() => { const g = window.app.game; g.skipTutorial(); g.s.xp = 30000; g.s.money = 5000000; g.refreshBoard(); });

  for (const want of WANT) {
    // 受注できる依頼が出る週まで進める
    const found = await page.evaluate(w => {
      const g = window.app.game;
      for (let i = 0; i < 1500; i++) {
        const o = g.s.board.find(x => x.kind === 'build' && (g.job(x).title.includes(w) || g.job(x).tags.includes(w)));
        if (o) { g.accept(o, false); window.app.show('bench'); const j = g.activeJob; return { title: j.title, kind: j.kind, tags: j.tags.join(' ') }; }
        g.s.week++; g.refreshBoard();
      }
      return null;
    }, want);
    ok(!!found, `「${want}」の依頼がボードに出る`);
    if (!found) continue;
    await page.waitForSelector('#desk');

    const res = await page.evaluate(() => {
      const b = window.__bench, g = window.app.game, sol = b.job.solution, map = {}, notes = [];
      const before = b.results.filter(r => r.ok).length;
      for (const d of sol.devices) {
        let cur = b.world.devices.find(x => x.id === d.id);
        if (!cur) {
          if (d.own === 'supplied') b.place('sup:' + d.id);
          else { if (!g.catalog.includes(d.model)) notes.push('買えない機材: ' + d.model); b.place('buy:' + d.model); }
          cur = b.world.devices[b.world.devices.length - 1];
          if (!cur || (d.own === 'supplied' ? cur.id !== d.id : cur.model !== d.model)) return { err: '置けない: ' + d.name };
        }
        map[d.id] = cur.id; cur.x = d.x; cur.y = d.y; cur.cfg = JSON.parse(JSON.stringify(d.cfg));
      }
      // 模範解答にない機器は机から片付け、配線を合わせる
      for (const d of [...b.world.devices]) if (!sol.devices.some(x => map[x.id] === d.id)) b.removeDevice(d.id);
      const key = c => [c.a.dev + ':' + c.a.port, c.b.dev + ':' + c.b.port].sort().join('|');
      const wires = sol.cables.map(c => ({ a: { dev: map[c.a.dev], port: c.a.port }, b: { dev: map[c.b.dev], port: c.b.port } }));
      for (const c of [...b.world.cables]) if (!wires.some(w => key(w) === key(c))) b.removeCable(c.id);
      for (const w of wires) if (!b.world.cables.some(c => key(c) === key(w)) && !b.link(w.a, w.b)) return { err: 'つなげない: ' + key(w) };
      b.changed();
      const ids = new Set(b.world.cables.map(c => c.id));
      if (ids.size !== b.world.cables.length) notes.push('ケーブルのIDが重複');
      const mail = b.world.devices.find(d => d.kind === 'server' && d.cfg.mailOn && d.cfg.dkimOn);
      if (mail) b.select(mail.id);
      return { before, total: b.results.length, mail: !!mail, notes, bought: b.world.devices.filter(d => d.own === 'bought').length };
    });
    if (res.err) { ok(false, `${found.title}: ${res.err}`); await page.evaluate(() => { window.app.game.abandon(); window.app.show('hub'); }); continue; }
    ok(res.notes.length === 0, `${found.title}: ${res.notes.join(' / ')}`);
    ok(res.before < res.total, `${found.title}: 受注した直後は不合格の検収テストがある (${res.before}/${res.total})`);

    // DKIMの公開鍵は置いたサーバーごとに違う。設定画面に出た値を、公開DNSのレコードに入れ直す
    if (res.mail) {
      const key = (await page.locator('#panel').innerText()).match(/公開鍵:\s*(\S+)/)?.[1];
      ok(!!key, `${found.title}: 設定画面にDKIMの公開鍵が出る`);
      await page.evaluate(k => { const b = window.__bench, z = b.world.devices.find(d => d.kind === 'internet').cfg.zone.find(r => /_domainkey/.test(r.name)); z.value = `v=DKIM1; k=rsa; p=${k}`; b.changed(); }, key);
    }
    const out = await page.evaluate(() => { const b = window.__bench; return { bad: b.job.checks.filter((_, i) => !b.results[i].ok).map((c, i) => c.label), reasons: b.results.filter(r => !r.ok).map(r => r.reason) }; });
    ok(out.bad.length === 0, `${found.title}(${found.kind}): 置き直した機器で全合格 → ${out.bad.join(' / ')} :: ${out.reasons.join(' / ')}`);
    if (out.bad.length) { await page.screenshot({ path: 'shots/_adv_fail.png' }); await page.evaluate(() => { window.app.game.abandon(); window.app.show('hub'); }); continue; }
    await page.click('[data-act="deliver"]');
    await page.waitForSelector('.result');
    ok(/★/.test(await page.locator('.r-stars').innerText()), `${found.title}: 納品できる`);
    const stars = await page.locator('.r-stars .on').count();
    ok(stars === 3, `${found.title}: 模範解答どおりなら★3 (${stars})`);
    await page.click('[data-act="hub"]');
    await page.waitForSelector('.hub');
  }
  ok(errors.length === 0, 'JSエラーなし: ' + errors.join(' | '));
} catch (e) { failed++; console.log('EXCEPTION', String(e).split('\n').slice(0, 6).join('\n')); await page.screenshot({ path: 'shots/_fail.png' }); }
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
await browser.close();
process.exit(failed ? 1 : 0);
