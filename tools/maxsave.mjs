// 最高レベルのセーブデータを作る: node tools/maxsave.mjs [app]
// saves/max-level.json に書き出す(設定の「セーブデータを読み込む」で読める)。app を付けると、デスクトップアプリのセーブにも入れる
// dev サーバー(npm run dev)を起動した状態で実行する
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/');
await page.waitForSelector('.title');
const save = await page.evaluate(() => {
  const app = window.app;
  app.newGame();
  const g = app.game;
  g.skipTutorial();
  g.s.xp = 45 * 23 * 26;      // Lv.24 になる経験値
  g.s.money = 1500000;
  g.s.weekSeen = undefined;
  g.refreshBoard();
  g.save();
  return JSON.stringify(g.s);
});
await browser.close();
await writeFile('saves/max-level.json', save);
const s = JSON.parse(save);
console.log(`saves/max-level.json を書きました(経験値 ${s.xp}、資金 ${s.money}、${s.week}週目、依頼 ${s.board.length}件)`);
if (process.argv[2] === 'app') {
  const exe = spawn('release/NetworkShop-win32-x64/NetworkShop.exe', ['--remote-debugging-port=9334'], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  let b;
  for (let i = 0; i < 40 && !b; i++) { await new Promise(r => setTimeout(r, 500)); b = await chromium.connectOverCDP('http://127.0.0.1:9334').catch(() => null); }
  const p = b.contexts()[0].pages()[0];
  await p.waitForSelector('.title', { timeout: 20000 });
  const old = await p.evaluate(() => localStorage.getItem('netshop-save'));
  if (old) await writeFile('saves/app-save-backup.json', old);
  await p.evaluate(v => { localStorage.setItem('netshop-save', v); }, save);
  await p.reload(); await p.waitForSelector('.title');
  console.log('アプリ: ' + (await p.locator('[data-act="continue"]').innerText()).replace(/\s+/g, ' ') + (old ? ' / 元のセーブは saves/app-save-backup.json に残しました' : ''));
  await b.close(); exe.kill();
}
