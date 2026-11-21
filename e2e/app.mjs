// パッケージしたデスクトップアプリが起動してタイトル画面を出すかを確かめる: node e2e/app.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
const exe = spawn('release/NetworkShop-win32-x64/NetworkShop.exe', ['--remote-debugging-port=9333'], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
let out = 'APP NG';
try {
  let browser;
  for (let i = 0; i < 40 && !browser; i++) { await new Promise(r => setTimeout(r, 500)); browser = await chromium.connectOverCDP('http://127.0.0.1:9333').catch(() => null); }
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector('.title', { timeout: 20000 });
  const bg = await page.evaluate(() => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); i.src = './img/bg_title.jpg'; }));
  await page.click('[data-act="new"]');
  const head = await page.locator('.board-head h2').innerText();
  out = bg === 1920 && head === '研修' ? 'APP OK' : `APP NG bg=${bg} head=${head}`;
  await browser.close();
} catch (e) { out = 'APP NG ' + String(e).split('\n')[0]; }
exe.kill();
console.log(out);
process.exit(0);
