// パッケージしたデスクトップアプリが起動してタイトル画面を出すかを確かめる: node e2e/app.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
// セーブは一時フォルダに置く。遊んでいるセーブ(%APPDATA%/NetworkShop)には触らない
const userData = await mkdtemp(join(tmpdir(), 'netshop-test-'));
const exe = spawn('release/NetworkShop-win32-x64/NetworkShop.exe', ['--remote-debugging-port=9333'], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NETSHOP_USER_DATA: userData } });
let out = 'APP NG';
try {
  let browser;
  for (let i = 0; i < 40 && !browser; i++) { await new Promise(r => setTimeout(r, 500)); browser = await chromium.connectOverCDP('http://127.0.0.1:9333').catch(() => null); }
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector('.title', { timeout: 20000 });
  const bg = await page.evaluate(() => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); i.src = './img/bg_shop.webp'; }));
  await page.click('[data-act="new"]');
  const head = await page.locator('.board-head h2').innerText();
  out = bg === 1920 && head === '研修' ? 'APP OK' : `APP NG bg=${bg} head=${head}`;
  await browser.close();
} catch (e) { out = 'APP NG ' + String(e).split('\n')[0]; }
exe.kill();
await new Promise(r => setTimeout(r, 800));
await rm(userData, { recursive: true, force: true }).catch(() => {});
console.log(out);
process.exit(0);
