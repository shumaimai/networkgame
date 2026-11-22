// 画面確認用: node e2e/shot.mjs <名前> で shots/<名前>.png を作る
import { chromium } from 'playwright-core';
const name = process.argv[2] ?? 'title';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:5173/');
await page.waitForSelector('.title');
const S = {
  title: async () => {},
  hub: async () => { await page.click('[data-act="new"]'); },
  board: async () => { await page.click('[data-act="new"]'); await page.click('[data-act="skip"]'); await page.click('[data-act="do-skip"]'); },
  offer: async () => { await S.board(); await page.click('.card >> nth=2'); },
  t1: async () => { await page.click('[data-act="new"]'); await page.click('[data-act="tutorial"]'); },
  shop: async () => { await S.board(); await page.click('[data-act="go-shop"]'); },
  dict: async () => { await S.board(); await page.click('[data-act="dict"]'); await page.click('[data-id="router"]'); await page.waitForTimeout(700); },
  solved: async () => {
    await page.evaluate(() => { const g = window.app.game; g.skipTutorial(); g.s.xp = 4000; g.refreshBoard(); g.accept(g.s.board[4], true); const a = g.s.active; a.world = JSON.parse(JSON.stringify(g.activeJob.solution)); window.app.show('bench'); });
    await page.evaluate(() => { const b = window.__bench; const d = b.world.devices.find(x => x.kind === ('l3')) ?? b.world.devices.find(x => x.kind === 'l3') ?? b.world.devices[1]; b.select(d.id); });
  },
  adv: async () => {
    await page.evaluate(tag => { const g = window.app.game; g.skipTutorial(); g.s.xp = 13000; g.s.money = 900000;
      for (let i = 0; i < 400; i++) { g.s.week++; g.refreshBoard(); const o = g.s.board.find(o => o.kind === 'build' && g.job(o).tags.includes(tag)); if (o) { g.accept(o, false); break; } }
      const a = g.s.active; a.world = JSON.parse(JSON.stringify(g.activeJob.solution)); window.app.show('bench'); }, process.argv[3] ?? 'トランク');
    await page.evaluate(k => { const b = window.__bench; b.select((b.world.devices.find(x => x.kind === k) ?? b.world.devices[1]).id); }, process.argv[4] ?? 'l2m');
  },
  result: async () => { await S.solved(); await page.click('[data-act="deliver"]'); await page.waitForTimeout(1800); },
  help: async () => { await S.solved(); await page.click('[data-act="help"]'); for (const k of ['plan', 'answer']) await page.click(`[data-act="use-help"][data-k="${k}"]`); },
  trouble: async () => {
    await page.evaluate(() => { const g = window.app.game; g.skipTutorial(); g.s.xp = 2000; g.refreshBoard(); g.accept(g.s.board[3], false); window.app.show('bench'); });
    await page.evaluate(() => { const b = window.__bench; b.select(b.world.devices.find(x => x.kind === 'pc').id); });
  },
};
await S[name]();
await page.waitForTimeout(500);
await page.screenshot({ path: `shots/${name}.png` });
if (errors.length) console.log('ERRORS:', errors.join('\n'));
await browser.close();
