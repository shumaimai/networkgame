// 設定パネルの入力が機器の設定に反映されるかの確認: node e2e/panel.mjs (dev サーバー起動中)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1600, height: 900 } });
await page.addInitScript(() => { window.__noIntro = true; });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };
const cfg = kind => page.evaluate(k => window.__bench.world.devices.find(d => d.kind === k).cfg, kind);
const buy = async model => { await page.click(`[data-pal="buy:${model}"]`); };
try {
  await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5173/'));
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForSelector('.title');
  await page.evaluate(() => { const g = window.app.game; g.skipTutorial(); g.s.xp = 9000; g.s.money = 900000; g.refreshBoard(); g.accept(g.s.board.find(o => o.kind === 'build'), false); window.app.show('bench'); });

  await buy('router');
  await page.fill('[data-bind="lan.0.ip"]', '192.168.1.1');
  await page.selectOption('[data-bind="lan.0.prefix"]', '26');
  await page.click('label.toggle:has([data-bind="lan.0.dhcpOn"])');
  await page.fill('[data-bind="lan.0.dhcpStart"]', '192.168.1.10');
  await page.fill('[data-bind="lan.0.dhcpEnd"]', '192.168.1.20');
  await page.click('[data-act="add"][data-key="rules"]'); await page.click('[data-act="add"][data-key="rules"]');
  await page.selectOption('[data-bind="rules.1.action"]', 'allow');
  await page.selectOption('[data-bind="rules.1.svc"]', 'web');
  await page.fill('[data-bind="rules.1.src"]', '192.168.1.53');
  await page.click('[data-act="up"][data-i="1"]');
  await page.click('[data-act="add"][data-key="forwards"]');
  await page.fill('[data-bind="forwards.0.to"]', '192.168.1.80');
  await page.click('[data-act="add"][data-key="routes"]');
  await page.fill('[data-bind="routes.0.dest"]', '10.0.0.0/8'); await page.fill('[data-bind="routes.0.via"]', '192.168.1.2');
  await page.click('label.toggle:has([data-bind="nat"])');
  let c = await cfg('router');
  ok(c.lan[0].ip === '192.168.1.1' && c.lan[0].prefix === 26 && c.lan[0].dhcpOn && c.lan[0].dhcpStart === '192.168.1.10' && c.lan[0].dhcpEnd === '192.168.1.20', 'ルーター: LANとDHCP ' + JSON.stringify(c.lan[0]));
  ok(c.rules.length === 2 && c.rules[0].action === 'allow' && c.rules[0].svc === 'web' && c.rules[0].src === '192.168.1.53' && c.rules[1].action === 'deny', 'ルーター: ルールの追加・編集・並べ替え ' + JSON.stringify(c.rules));
  ok(c.forwards[0].to === '192.168.1.80' && c.routes[0].dest === '10.0.0.0/8' && c.nat === false, 'ルーター: 転送・ルート・NAT');
  ok(/192\.168\.1\.1\/26 DHCP/.test(await page.locator('#desk .k-router').textContent()), '机の上の表示が更新される');

  await buy('server');
  await page.fill('[data-bind="ip"]', '192.168.1.53');
  for (const k of ['dnsOn', 'dhcpOn', 'proxyOn', 'webOn', 'fileOn', 'mailOn']) await page.click(`label.toggle:has([data-bind="${k}"])`);
  await page.click('[data-act="add"][data-key="records"]');
  await page.fill('[data-bind="records.0.name"]', 'printer.test.local'); await page.fill('[data-bind="records.0.ip"]', '192.168.1.200');
  await page.fill('[data-bind="forwarder"]', '8.8.8.8');
  await page.click('[data-act="add"][data-key="pools"]');
  await page.fill('[data-bind="pools.0.start"]', '192.168.1.100'); await page.fill('[data-bind="pools.0.end"]', '192.168.1.110'); await page.fill('[data-bind="pools.0.gw"]', '192.168.1.1');
  await page.fill('[data-bind="proxyPort"]', '3128'); await page.fill('[data-bind="fileAllow"]', '192.168.1.0/24');
  c = await cfg('server');
  ok(c.dnsOn && c.dhcpOn && c.proxyOn && c.webOn && c.fileOn && c.mailOn, 'サーバー: サービスのオン');
  ok(c.records[0].name === 'printer.test.local' && c.forwarder === '8.8.8.8' && c.pools[0].end === '192.168.1.110' && c.pools[0].gw === '192.168.1.1' && c.proxyPort === 3128 && c.fileAllow === '192.168.1.0/24', 'サーバー: 各サービスの設定 ' + JSON.stringify(c.pools));
  ok(/DNS・DHCP・プロキシ・Web・共有・メール/.test(await page.locator('#desk .k-server').textContent()), '机の上にサービスが表示される');

  await buy('l3-8');
  await page.fill('[data-bind="portVlan.0"]', '10');
  await page.click('.vp:nth-child(8) label');
  await page.click('[data-act="add"][data-key="svis"]');
  await page.fill('[data-bind="svis.0.vlan"]', '10'); await page.fill('[data-bind="svis.0.ip"]', '192.168.10.254'); await page.fill('[data-bind="svis.0.relay"]', '192.168.1.53');
  c = await cfg('l3');
  ok(c.portVlan[0] === 10 && c.portMode[7] === 'trunk' && c.svis[0].ip === '192.168.10.254' && c.svis[0].relay === '192.168.1.53', 'L3: VLAN・トランク・VLANインターフェース ' + JSON.stringify(c.svis));
  ok(await page.locator('[data-bind="portVlan.7"]').isDisabled(), 'トランクのポートはVLAN番号を入力できない');
  // VLANインターフェースのVLAN番号の上下のボタン
  await page.click('.row.svi .stp [data-d="1"]'); await page.click('.row.svi .stp [data-d="1"]');
  ok((await cfg('l3')).svis[0].vlan === 12 && await page.inputValue('[data-bind="svis.0.vlan"]') === '12', 'VLANインターフェース: ▲ を2回押すと、VLAN番号が 10 → 12 になる');
  await page.click('.row.svi .stp [data-d="-1"]'); await page.click('.row.svi .stp [data-d="-1"]');
  ok((await cfg('l3')).svis[0].vlan === 10 && (await cfg('l3')).svis[0].ip === '192.168.10.254', 'VLANインターフェース: ▼ で戻り、ほかの欄はそのまま');
  const sb = await page.locator('.row.svi .numstep').boundingBox(), ib = await page.locator('[data-bind="svis.0.ip"]').boundingBox();
  ok(sb.x + sb.width <= ib.x + 1 && sb.height < 40, 'VLAN番号の欄とボタンが、IPアドレスの欄に重ならない');
  // VLAN番号の上下のボタン
  await page.click('.vp:nth-child(2) [data-d="1"]'); await page.click('.vp:nth-child(2) [data-d="1"]'); await page.click('.vp:nth-child(2) [data-d="1"]');
  ok((await cfg('l3')).portVlan[1] === 4 && await page.inputValue('[data-bind="portVlan.1"]') === '4', '▲ を3回押すと、VLAN番号が 1 → 4 になる');
  await page.click('.vp:nth-child(2) [data-d="-1"]');
  ok((await cfg('l3')).portVlan[1] === 3, '▼ で1減る');
  for (let i = 0; i < 5; i++) await page.click('.vp:nth-child(2) [data-d="-1"]');
  ok((await cfg('l3')).portVlan[1] === 1, '1 より小さくはならない');
  ok(await page.locator('.vp:nth-child(8) [data-d="1"]').isDisabled(), 'トランクのポートは、上下のボタンも押せない');
  // 設定パネルのポートの欄と、机の上のポートを、互いに強調する
  const l3id = await page.evaluate(() => window.__bench.world.devices.find(d => d.kind === 'l3').id);
  await page.hover('.vp:nth-child(3)');
  ok(await page.locator(`#desk [data-port="${l3id}:2"].hl`).count() === 1 && await page.locator('#desk .port.hl').count() === 1, '設定パネルでポート3の欄にカーソルを乗せると、机の上のポート3が強調される');
  await page.hover('.vp:nth-child(6) [data-d="1"]');
  ok(await page.locator(`#desk [data-port="${l3id}:5"].hl`).count() === 1 && await page.locator('#desk .port.hl').count() === 1, '別のポートの欄に移ると、強調も移る');
  await page.click('.vp:nth-child(6) [data-d="1"]');
  ok(await page.locator(`#desk [data-port="${l3id}:5"].hl`).count() === 1, 'ボタンを押して机が描き直されても、強調は残る');
  await page.hover('#panel h2');
  ok(await page.locator('#desk .port.hl').count() === 0, 'ポートの欄から外れると、強調が消える');
  await page.hover(`#desk [data-port="${l3id}:4"]`);
  ok(await page.locator('#panel .vp.hl').count() === 1 && await page.locator('#panel .vp:nth-child(5).hl').count() === 1, '机の上のポート5にカーソルを乗せると、設定パネルのポート5の欄が強調される');
  { const b = await page.locator('.desk-wrap').boundingBox(); await page.mouse.move(b.x + 30, b.y + 30); }
  ok(await page.locator('#panel .hl').count() === 0, '机の上のポートから外れると、強調が消える');
  const rid = await page.evaluate(() => window.__bench.world.devices.find(d => d.kind === 'router').id);
  await page.evaluate(id => window.__bench.select(id), rid);
  await page.hover('#panel .psec[data-port-hl="1"] h3');
  ok(await page.locator(`#desk [data-port="${rid}:1"].hl`).count() === 1, 'ルーターの LAN1 の欄にカーソルを乗せると、机の上の LAN1 のポートが強調される');
  await page.hover(`#desk [data-port="${rid}:0"]`);
  ok(await page.locator('#panel .psec[data-port-hl="0"].hl').count() === 1, '机の上のWANポートにカーソルを乗せると、設定パネルのWANの欄が強調される');

  await buy('fw');
  await page.selectOption('[data-bind="wan.mode"]', 'static');
  await page.fill('[data-bind="wan.ip"]', '10.0.0.2'); await page.fill('[data-bind="wan.gw"]', '10.0.0.1');
  c = await cfg('fw');
  ok(c.wan.mode === 'static' && c.wan.ip === '10.0.0.2' && c.wan.gw === '10.0.0.1', 'FW: WANの手動設定');

  await buy('ap');
  await page.fill('[data-bind="ssid"]', 'office'); await page.fill('[data-bind="key"]', 'secret');
  c = await cfg('ap');
  ok(c.ssid === 'office' && c.key === 'secret', 'AP: SSIDとキー');
  const pc = await page.evaluate(() => window.__bench.job.supplied.find(s => s.model === 'pc').id);
  await page.click(`[data-pal="sup:${pc}"]`);
  await page.selectOption('[data-bind="mode"]', 'dhcp');
  ok(/アドレスを取得できていません/.test(await page.locator('#panel').innerText()), 'PC: DHCPにすると取得状況が出る');
  await page.fill('[data-bind="wifi.ssid"]', 'office'); await page.fill('[data-bind="wifi.key"]', 'secret');
  ok(await page.locator('#desk .wifi').count() === 1, 'PC: 無線の線が出る');
  await page.fill('[data-bind="proxy"]', 'abc');
  ok(await page.locator('[data-bind="proxy"].bad').count() === 1, '不正な入力は赤くなる');
  ok(errors.length === 0, 'JSエラーなし: ' + errors.join(' | '));
} catch (e) { failed++; console.log('EXCEPTION', String(e).split('\n').slice(0, 5).join('\n')); await page.screenshot({ path: 'shots/_fail.png' }); }
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
await browser.close();
process.exit(failed ? 1 : 0);
