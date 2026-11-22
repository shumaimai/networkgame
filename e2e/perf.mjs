// 読み込みの量と、描画の速さを測る: node e2e/perf.mjs
// 公開用のビルドを測るときは、npm run build のあと npx vite preview --port 4173 --strictPort --host 127.0.0.1 を立てて、
// GAME_URL=http://127.0.0.1:4173/ node e2e/perf.mjs
import { chromium } from 'playwright-core';
import { gzipSync } from 'node:zlib';
const URL0 = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => { window.__noIntro = true; });
// 種類ごとに、取ってきた数と大きさ(そのまま / gzip で縮めたとき)を数える
const got = [];
page.on('response', async r => {
  const u = r.url();
  if (u.startsWith('data:')) return;
  try { const b = await r.body(); got.push({ u, n: b.length, z: /\.(js|css|html|svg)$|\/$/.test(u.split('?')[0]) ? gzipSync(b).length : b.length }); } catch { /* 取り消された読み込み */ }
});
const kind = u => (/\.woff2?$/.test(u) ? 'フォント' : /\.(png|jpg|webp|svg)$/.test(u) ? '画像' : /\.css$/.test(u) ? 'CSS' : /\.js$/.test(u) ? 'プログラム' : 'HTML');
let mark = 0;
const report = label => {
  const part = got.slice(mark); mark = got.length;
  const by = {};
  for (const x of part) { const k = kind(x.u); (by[k] ??= { c: 0, n: 0, z: 0 }); by[k].c++; by[k].n += x.n; by[k].z += x.z; }
  const kb = n => `${Math.round(n / 1024)}KB`;
  const tot = part.reduce((t, x) => t + x.z, 0);
  console.log(`${label}: ${part.length}個 ${kb(tot)}(転送の目安) | ` + Object.entries(by).map(([k, v]) => `${k} ${v.c}個 ${kb(v.z)}${v.z !== v.n ? `(元 ${kb(v.n)})` : ''}`).join(' / '));
};
// 何かを続けて動かしている間の、1コマあたりの時間(ミリ秒)
const frames = async (label, fn) => {
  await page.evaluate(() => { window.__ft = []; let last = performance.now(); const tick = t => { window.__ft.push(t - last); last = t; if (window.__ft.length < 2000) window.__raf = requestAnimationFrame(tick); }; window.__raf = requestAnimationFrame(tick); });
  await fn();
  const ft = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__ft.slice(2); });
  ft.sort((a, b) => a - b);
  const avg = ft.reduce((t, x) => t + x, 0) / ft.length, p95 = ft[Math.floor(ft.length * 0.95)] ?? 0;
  console.log(`${label}: 平均 ${avg.toFixed(1)}ms(${Math.round(1000 / avg)}コマ/秒) / 遅いほうの5% ${p95.toFixed(0)}ms / 最悪 ${ft[ft.length - 1]?.toFixed(0)}ms / ${ft.length}コマ`);
};

const t0 = Date.now();
await page.goto(URL0); await page.waitForSelector('.title');
await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(800);
console.log(`タイトルが出るまで ${Date.now() - t0}ms`);
report('タイトル');
await page.evaluate(() => { const g = window.app.game; g.skipTutorial(); g.s.xp = 30000; g.s.money = 3000000; g.s.weekSeen = 99999; g.refreshBoard(); window.app.show('hub'); });
await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1200);
report('受注の画面(Lv.24)');
const t1 = Date.now();
await page.evaluate(() => { const g = window.app.game; for (let i = 0; i < 400; i++) { const o = g.s.board.find(x => x.kind === 'build' && g.job(x).solution.devices.length >= 24); if (o) { g.accept(o, false); break; } g.s.week++; g.refreshBoard(); } g.s.active.world = JSON.parse(JSON.stringify(g.activeJob.solution)); window.app.show('bench'); });
await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1200);
report('作業画面(Lv.24)');
const info = await page.evaluate(() => ({ dev: window.__bench.world.devices.length, cables: window.__bench.world.cables.length, nodes: document.querySelectorAll('#desk *').length, title: window.app.game.activeJob.title }));
console.log(`依頼「${info.title}」: 機器 ${info.dev}台、ケーブル ${info.cables}本、机の上の要素 ${info.nodes}個`);
await page.click('[data-act="guide"]'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1000); await page.keyboard.press('Escape');
report('ガイドを開く');
console.log(`ここまでの合計: ${got.length}個 ${Math.round(got.reduce((t, x) => t + x.z, 0) / 1024)}KB`);

// ---- 描画の速さ ----
const box = await page.locator('#desk').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const empty = await page.evaluate(() => { const r = document.querySelector('#desk').getBoundingClientRect(); for (let y = r.top + 40; y < r.bottom - 40; y += 17) for (let x = r.left + 40; x < r.right - 40; x += 23) if (document.elementFromPoint(x, y)?.classList.contains('mat')) return { x, y }; return null; });
await frames('何もしていないとき', () => page.waitForTimeout(1500));
await frames('机をつかんで動かす', async () => { await page.mouse.move(empty.x, empty.y); await page.mouse.down(); for (let i = 0; i < 60; i++) { await page.mouse.move(empty.x + Math.sin(i / 6) * 150, empty.y + Math.cos(i / 6) * 80); await page.waitForTimeout(16); } await page.mouse.up(); });
await frames('ホイールで拡大・縮小', async () => { await page.mouse.move(cx, cy); for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, i < 20 ? -100 : 100); await page.waitForTimeout(25); } });
await page.click('#viewctl [data-act="view-reset"]');
const d = await page.evaluate(() => window.__bench.world.devices.find(x => x.kind === 'l3' || x.kind === 'l2m' || x.kind === 'l2').id);
const db = await page.locator(`[data-dev="${d}"] image`).boundingBox();
await frames('機器をドラッグする', async () => { const x = db.x + db.width / 2, y = db.y + db.height / 2; await page.mouse.move(x, y); await page.mouse.down(); for (let i = 0; i < 60; i++) { await page.mouse.move(x + Math.sin(i / 6) * 120, y + Math.cos(i / 6) * 60); await page.waitForTimeout(16); } await page.mouse.up(); });
const tr = await page.evaluate(() => { const b = window.__bench; const t = performance.now(); for (let i = 0; i < 10; i++) b.changed(); return (performance.now() - t) / 10; });
console.log(`設定を1つ変えたときの処理(通信の計算・検収テスト・描き直し): ${tr.toFixed(1)}ms`);
await browser.close();
