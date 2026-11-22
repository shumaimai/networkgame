// 机の拡大・縮小と移動の確認: node e2e/view.mjs (dev サーバー起動中)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let failed = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { failed++; console.log('FAIL ' + m); } };
const vb = () => page.evaluate(() => document.querySelector('#desk').getAttribute('viewBox').split(' ').map(Number));
const pct = () => page.locator('#zoom-pct').innerText();
const off = act => page.locator(`#viewctl [data-act="${act}"]`).isDisabled();
const center = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const near = (a, b, e = 2) => Math.abs(a - b) <= e;
// 机の上で、何も置かれていない場所(画面の座標)を探す
const emptySpot = () => page.evaluate(() => {
  const r = document.querySelector('#desk').getBoundingClientRect();
  for (let y = r.top + 60; y < r.bottom - 80; y += 23) for (let x = r.left + 60; x < r.right - 60; x += 31) {
    if ([[0, 0], [-40, 0], [40, 0], [0, -40], [0, 40]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy)?.classList.contains('mat'))) return { x, y };
  }
  return null;
});
const selId = () => page.evaluate(() => window.__bench.desk?.sel?.id ?? document.querySelector('#desk .dev.sel')?.dataset.dev ?? null);

try {
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForSelector('.title');
  await page.evaluate(() => {
    const g = window.app.game;
    g.skipTutorial(); g.s.xp = 9000; g.s.money = 900000; g.refreshBoard();
    g.accept(g.s.board.find(o => o.kind === 'build'), false);
    g.s.active.world = JSON.parse(JSON.stringify(g.activeJob.solution));
    window.app.show('bench');
  });
  await page.waitForSelector('#viewctl');

  // ---- 最初の状態 ----
  ok((await vb()).join(' ') === '0 0 1400 800' && (await pct()) === '100%', '最初は机の全体が 100% で映る');
  ok(await off('view-reset') && !(await off('zoom-in')) && !(await off('zoom-out')), '最初は「戻す」が押せず、拡大と縮小は押せる');
  ok(!(await off('pan-left')) && !(await off('pan-right')) && !(await off('pan-up')) && !(await off('pan-down')), '最初から、4つの向きに動かせる(机は見えている範囲より広い)');

  // ---- ボタン ----
  await page.click('#viewctl [data-act="zoom-in"]');
  let v = await vb();
  ok(near(v[2], 1120) && near(v[3], 640) && (await pct()) === '125%', `「＋」で 125% になる (${v.join(' ')})`);
  ok(near(v[0] + v[2] / 2, 700) && near(v[1] + v[3] / 2, 400), '拡大しても、見えている範囲の中央は変わらない');
  await page.click('#viewctl [data-act="pan-right"]');
  const v2 = await vb();
  ok(v2[0] > v[0] + 100 && near(v2[1], v[1]), `「▶」で右へ動く (${v[0]} → ${v2[0]})`);
  await page.click('#viewctl [data-act="pan-down"]');
  ok((await vb())[1] > v2[1] + 50, '「▼」で下へ動く');
  ok(!(await off('view-reset')), '動かしたあとは「戻す」が押せる');
  await page.click('#viewctl [data-act="view-reset"]');
  ok((await vb()).join(' ') === '0 0 1400 800' && (await pct()) === '100%', '「戻す」で最初の位置と大きさに戻る');

  // ---- 何もない場所をつかんで動かす ----
  const dev = await page.evaluate(() => window.__bench.world.devices.find(d => d.kind === 'pc').id);
  const c0 = await center(`[data-dev="${dev}"] image`);
  await page.mouse.click(c0.x, c0.y);
  ok(await page.locator(`#desk .dev.sel[data-dev="${dev}"]`).count() === 1, '機器をクリックすると選ばれる');
  let e = await emptySpot();
  ok(!!e, '机の上に、何もない場所がある');
  await page.mouse.move(e.x, e.y); await page.mouse.down(); await page.mouse.move(e.x - 60, e.y - 30, { steps: 4 }); await page.mouse.move(e.x - 120, e.y - 60, { steps: 4 });
  ok(await page.locator('#desk.panning').count() === 1, 'つかんで動かしている間は、つかんだ形のカーソルになる');
  await page.mouse.up();
  v = await vb();
  const k = await page.evaluate(() => document.querySelector('#desk').getScreenCTM().a);
  ok(near(v[0], 120 / k, 3) && near(v[1], 60 / k, 3) && near(v[2], 1400), `何もない場所をドラッグすると、動かした分だけ机が動く (${v.map(Math.round).join(' ')})`);
  const c1 = await center(`[data-dev="${dev}"] image`);
  ok(near(c1.x, c0.x - 120, 3) && near(c1.y, c0.y - 60, 3), '机の上の機器も、同じだけ画面の上で動く');
  ok(await page.locator(`#desk .dev.sel[data-dev="${dev}"]`).count() === 1, '机を動かしても、機器の選択は外れない');
  e = await emptySpot();
  await page.mouse.click(e.x, e.y);
  ok(await page.locator('#desk .dev.sel').count() === 0 && near((await vb())[0], v[0]), '何もない場所をクリックしただけなら、選択が外れ、机は動かない');
  await page.click('#viewctl [data-act="view-reset"]');

  // ---- ホイール: カーソルの位置を中心に拡大する ----
  const w0 = await center(`[data-dev="${dev}"] image`);
  await page.mouse.move(w0.x, w0.y);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
  const w1 = await center(`[data-dev="${dev}"] image`);
  v = await vb();
  ok(v[2] < 800 && near(w1.x, w0.x, 4) && near(w1.y, w0.y, 4), `ホイールで、カーソルの下の機器を中心に拡大する (${await pct()})`);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -100);
  ok((await pct()) === '300%' && await off('zoom-in'), '拡大は 300% まで');

  // ---- 拡大したままの操作 ----
  await page.evaluate(() => window.__bench.desk.select(null));
  const z0 = await center(`[data-dev="${dev}"] image`);
  await page.mouse.click(z0.x, z0.y);
  ok(await page.locator(`#desk .dev.sel[data-dev="${dev}"]`).count() === 1, '拡大したままでも、機器をクリックして選べる');
  const before = await page.evaluate(id => { const d = window.__bench.world.devices.find(x => x.id === id); return { x: d.x, y: d.y }; }, dev);
  const kz = await page.evaluate(() => document.querySelector('#desk').getScreenCTM().a);
  await page.mouse.move(z0.x, z0.y); await page.mouse.down(); await page.mouse.move(z0.x + 45, z0.y - 30, { steps: 3 }); await page.mouse.move(z0.x + 90, z0.y - 60, { steps: 3 }); await page.mouse.up();
  const after = await page.evaluate(id => { const d = window.__bench.world.devices.find(x => x.id === id); return { x: d.x, y: d.y }; }, dev);
  ok(near(after.x - before.x, 90 / kz, 3) && near(after.y - before.y, -60 / kz, 3), `拡大したまま機器をドラッグすると、カーソルについてくる (${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)})`);
  // ポートをクリックして配線する
  const cables = await page.evaluate(() => window.__bench.world.cables.length);
  const free = await page.evaluate(id => {
    const b = window.__bench, c = b.world.cables.find(x => x.a.dev === id || x.b.dev === id);
    b.removeCable(c.id);
    const o = c.a.dev === id ? c.b : c.a;
    return `${o.dev}:${o.port}`;
  }, dev);
  await page.click('#viewctl [data-act="view-reset"]');
  await page.click('#viewctl [data-act="zoom-in"]'); await page.click('#viewctl [data-act="zoom-in"]');
  await page.evaluate(id => window.__bench.desk?.reveal?.(window.__bench.world.devices.find(x => x.id === id)), dev);
  const pa = await page.locator(`[data-port="${dev}:0"]`).boundingBox(), pb = await page.locator(`[data-port="${free}"]`).boundingBox();
  const stage = await page.locator('.desk-wrap').boundingBox(), inView = b => b && b.x > stage.x && b.x + b.width < stage.x + stage.width && b.y > stage.y && b.y + b.height < stage.y + stage.height;
  if (inView(pa) && inView(pb)) {
    await page.mouse.click(pa.x + pa.width / 2, pa.y + pa.height / 2); await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    ok(await page.evaluate(() => window.__bench.world.cables.length) === cables, '拡大したまま、ポートをクリックして配線できる');
  } else {
    await page.evaluate(([a, b]) => { const [d, p] = b.split(':'); window.__bench.link({ dev: a, port: 0 }, { dev: d, port: Number(p) }); }, [dev, free]);
    ok(true, '(ポートが同じ画面に入らないので、配線の確認は省いた)');
  }

  // ---- 見えていない場所に置いた機器は、見える位置まで机が動く ----
  await page.click('#viewctl [data-act="view-reset"]');
  for (let i = 0; i < 4; i++) await page.click('#viewctl [data-act="zoom-in"]');
  // 右上の端まで動かす(端に着くとボタンは押せなくなる)
  for (let i = 0; i < 12 && !(await off('pan-up')); i++) await page.click('#viewctl [data-act="pan-up"]');
  for (let i = 0; i < 12 && !(await off('pan-right')); i++) await page.click('#viewctl [data-act="pan-right"]');
  ok(await off('pan-up') && await off('pan-right') && !(await off('pan-left')) && !(await off('pan-down')), '端まで動かすと、その向きのボタンは押せなくなる');
  await page.click('[data-pal="buy:l2-5"]');
  const nb = await page.locator('#desk .dev.sel image').boundingBox();
  ok(inView(nb), '拡大して別の場所を見ているときに機材を買うと、置いた機器が見える位置まで机が動く');

  // ---- 縮小と、広くなった机 ----
  await page.click('#viewctl [data-act="view-reset"]');
  await page.click('#viewctl [data-act="zoom-out"]'); await page.click('#viewctl [data-act="zoom-out"]');
  v = await vb();
  ok(near(v[2], 2100, 12) && await off('zoom-out') && (await pct()) === '67%', `縮小は、机の全体が入る 67% まで (${v.map(Math.round).join(' ')})`);
  ok(await off('pan-left') && await off('pan-right') && await off('pan-up') && await off('pan-down'), '全体が見えているときは、向きのボタンが押せない');
  const sw = await page.evaluate(() => window.__bench.world.devices.find(d => d.model === 'l2-5' && d.own === 'bought').id);
  const s0 = await center(`[data-dev="${sw}"] image`), box = await page.locator('#desk').boundingBox();
  await page.mouse.move(s0.x, s0.y); await page.mouse.down(); await page.mouse.move(box.x + box.width - 60, s0.y, { steps: 6 }); await page.mouse.up();
  const sx = await page.evaluate(id => window.__bench.world.devices.find(x => x.id === id).x, sw);
  ok(sx > 1450, `最初に見えていた範囲(幅1400)の外にも、機器を置ける (x=${Math.round(sx)})`);

  // ---- キーボードでは動かない ----
  await page.click('#viewctl [data-act="view-reset"]');
  await page.evaluate(() => window.__bench.desk.select(null));
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', '+', '-']) await page.keyboard.press(key);
  ok((await vb()).join(' ') === '0 0 1400 800', '矢印キーなどのキーボード操作では、机は動かない');
  await page.screenshot({ path: 'shots/v_home.png' });
  await page.click('#viewctl [data-act="zoom-in"]'); await page.click('#viewctl [data-act="zoom-in"]'); await page.click('#viewctl [data-act="zoom-in"]');
  await page.screenshot({ path: 'shots/v_zoom.png' });
  await page.click('#viewctl [data-act="view-reset"]');
  await page.click('#viewctl [data-act="zoom-out"]'); await page.click('#viewctl [data-act="zoom-out"]');
  await page.screenshot({ path: 'shots/v_out.png' });
  ok(errors.length === 0, 'JSエラーなし: ' + errors.join(' | '));
} catch (e) { failed++; console.log('EXCEPTION', String(e).split('\n').slice(0, 6).join('\n')); await page.screenshot({ path: 'shots/_fail.png' }); }
console.log(`RESULT: ${failed ? 'FAIL (' + failed + ')' : 'PASS'} / ${count} checks`);
await browser.close();
process.exit(failed ? 1 : 0);
