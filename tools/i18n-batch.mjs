// 翻訳の作業用: node tools/i18n-batch.mjs <ファイル名の一部> [最大数] で、まだ翻訳していないものを「ID 日本語」の形で出す
import { collect } from './i18n.mjs';
const c = await collect(), pat = process.argv[2] ?? '', max = Number(process.argv[3]) || 80;
const todo = [...c.keys].filter(([h]) => !c.tr.has(h) && c.where.get(h).includes(pat));
for (const [h, s] of todo.slice(0, max)) console.log(`${h} ${s.split('\n').join('\n')}`);
console.error(`-- ${Math.min(max, todo.length)} / 残り ${todo.length}`);
