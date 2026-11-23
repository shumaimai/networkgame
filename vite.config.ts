import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
// @ts-expect-error 型のない .mjs
import { i18n } from './tools/i18n-plugin.mjs';

export default defineConfig({
  base: './',
  // 日本語の文字列を、翻訳の表を引く呼び出しに書き換える(src/i18n/runtime.ts)
  plugins: [i18n(fileURLToPath(new URL('./src/i18n/runtime.ts', import.meta.url)))],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  test: { include: ['tests/**/*.test.ts'] },
});
