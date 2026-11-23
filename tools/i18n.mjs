// 翻訳の点検: node tools/i18n.mjs <stats|todo [数]|check>
//   stats  翻訳の単位の数と、翻訳が済んだ数
//   todo   まだ翻訳していないものを shots/i18n-todo.tsv に書く(ID、ファイル、日本語)
//   check  翻訳の中の {0} などの差し込みと、行頭の印(・ 例:)が、日本語と合っているかを確かめる。合わなければ失敗で終わる
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { transform } from './i18n-plugin.mjs';

const slash = p => p.split('\\').join('/');

export async function collect() {
  const keys = new Map(), where = new Map();
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'i18n') await walk(p); continue; }
      if (!p.endsWith('.ts')) continue;
      const k = new Map();
      await transform(await readFile(p, 'utf8'), slash(p), k);
      for (const [h, s] of k) { keys.set(h, s); if (!where.has(h)) where.set(h, slash(p).replace('src/', '')); }
    }
  };
  await walk('src');
  const tr = new Map();
  for (const f of (await readdir('src/i18n/tr')).filter(x => x.endsWith('.json')).sort()) {
    for (const [h, v] of Object.entries(JSON.parse(await readFile(join('src/i18n/tr', f), 'utf8')))) tr.set(h, v);
  }
  return { keys, where, tr };
}
const ph = s => (s.match(/\{\d+\}/g) ?? []).sort().join('');
export function problems({ keys, tr }) {
  const out = [];
  for (const [h, v] of tr) {
    const ja = keys.get(h);
    if (ja == null) { out.push(`${h}: ソースにない翻訳(文章が変わったか、消えた)`); continue; }
    for (const [i, name] of [[0, '英語'], [1, '韓国語']]) {
      const t = v?.[i];
      if (typeof t !== 'string' || !t) { out.push(`${h}: ${name}がない: ${ja.slice(0, 40)}`); continue; }
      if ([...new Set(t.match(/\{\d+\}/g) ?? [])].some(x => !ja.includes(x))) out.push(`${h}: ${name}に、日本語にない差し込みがある: ${t.slice(0, 60)}`);
      if ([...new Set(ja.match(/\{\d+\}/g) ?? [])].some(x => !t.includes(x))) out.push(`${h}: ${name}で、差し込みが抜けている(${ph(ja)}): ${t.slice(0, 60)}`);
      // 行の数と、行頭の印(箇条書きの「・」、「例:」)は、日本語と同じにする(ガイドの画面が、行ごとに印を見て組み立てる)
      const NL = String.fromCharCode(10), jl = ja.split(NL), tl = t.split(NL);
      if (jl.length !== tl.length) { out.push(`${h}: ${name}の行の数が日本語と違う(${jl.length} と ${tl.length}): ${t.slice(0, 40)}`); continue; }
      const mk = x => (x.startsWith('例:') ? '例:' : x.startsWith('・') && !x.startsWith('・ ') ? '・' : '');
      jl.forEach((x, k) => { if (mk(x) !== mk(tl[k])) out.push(`${h}: ${name}の${k + 1}行目の行頭の印が日本語と違う: ${tl[k].slice(0, 40)}`); });
      if ((ja.match(/<[a-z]+/g) ?? []).length !== (t.match(/<[a-z]+/g) ?? []).length) out.push(`${h}: ${name}のタグの数が日本語と違う: ${t.slice(0, 60)}`);
    }
  }
  return out;
}

if (process.argv[1]?.endsWith('i18n.mjs')) {
  const c = await collect(), cmd = process.argv[2] ?? 'stats';
  const todo = [...c.keys].filter(([h]) => !c.tr.has(h));
  if (cmd === 'todo') {
    await mkdir('shots', { recursive: true });
    const n = Number(process.argv[3]) || todo.length;
    await writeFile('shots/i18n-todo.tsv', todo.slice(0, n).map(([h, s]) => `${h}\t${c.where.get(h)}\t${s.split('\n').join('\\n')}`).join('\n') + '\n');
  }
  const bad = problems(c);
  if (cmd === 'check') {
    for (const [h, s] of todo.slice(0, 20)) console.log(`${h}: 未翻訳 (${c.where.get(h)}): ${s.slice(0, 50)}`);
    for (const b of bad.slice(0, 40)) console.log(b);
  }
  console.log(`翻訳の単位 ${c.keys.size}個(${[...c.keys.values()].reduce((t, s) => t + s.length, 0)}字) / 翻訳済み ${c.keys.size - todo.length}個 / 残り ${todo.length}個 / 問題 ${bad.length}件`);
  if (cmd === 'check' && (bad.length || todo.length)) process.exit(1);
}
