// 翻訳のしくみ(ビルド時): ソースの中の日本語の文字列を見つけて、翻訳の表を引く呼び出しに書き換える
//   '納品する'                    → __t("納品する", "id")
//   `${a} を机に置きました。`     → __tt(["", " を机に置きました。"], "id", a)   表のキーは "{0} を机に置きました。"
//   '<h3>お金</h3>'               → ('<h3>' + __t("お金", "id") + '</h3>')      HTMLのタグは外に出し、文章だけを翻訳の単位にする
//   { ルーター: 'router' }        → { [__t("ルーター", "id")]: 'router' }
// 文の途中に入る <b> <code> などは、文章の一部として翻訳の単位に含める。属性の値(title="…" など)も翻訳の単位にする
// 正規表現の中の日本語は書き換えない。表示の文字で判定している処理は、言語に関係なく動くように別に作る(AGENTS.md)
import { parseAst, transformWithOxc } from 'vite';

// 「、」「。」や日本語の括弧も入れる(join('、') や `【${a}】${b}「${c}」` を、言語ごとの表記に替えるため)
export const JA = /[ぁ-んァ-ヶ一-龠々〆、。「」【】]/;
/** 文字列のID(FNV-1a の32ビット、16進8桁) */
export const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
const INLINE = new Set(['b', 'code', 'i', 'em', 'strong', 'br', 'u', 's']);
const q = s => JSON.stringify(s);
const tplEsc = s => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

// items: 文字列({s})と式({e: 式のソース})の並び。HTMLのタグの外の文章と属性の値を「翻訳の単位(chunk)」に、それ以外を「そのまま(raw)」に分ける
function split(items) {
  const out = [];
  let mode = 'text', quote = '', cur = { k: 'chunk', items: [] };
  const add = ch => { const l = cur.items[cur.items.length - 1]; if (l && 's' in l) l.s += ch; else cur.items.push({ s: ch }); };
  const flush = next => {
    if (cur.items.length) {
      if (cur.k === 'chunk' && cur.items.some(x => 's' in x && JA.test(x.s))) {
        // 両端の空白と改行は、翻訳の単位に入れない
        const a = cur.items[0], z = cur.items[cur.items.length - 1];
        let pre = '', post = '';
        if ('s' in a) { pre = a.s.match(/^\s*/)[0]; a.s = a.s.slice(pre.length); }
        if ('s' in z) { post = z.s.match(/\s*$/)[0]; z.s = z.s.slice(0, z.s.length - post.length); }
        if (pre) out.push({ k: 'raw', items: [{ s: pre }] });
        out.push({ k: 'chunk', items: cur.items.filter(x => !('s' in x) || x.s) });
        if (post) out.push({ k: 'raw', items: [{ s: post }] });
      } else out.push({ k: 'raw', items: cur.items });
    }
    cur = { k: next, items: [] };
  };
  for (const it of items) {
    if ('e' in it) { cur.items.push(it); continue; }
    const s = it.s;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (mode === 'text') {
        const m = ch === '<' ? /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(s.slice(i, i + 24)) : null;
        if (m && INLINE.has(m[1].toLowerCase())) { mode = 'itag'; add(ch); }
        else if (m) { flush('raw'); mode = 'tag'; add(ch); }
        else add(ch);
      } else if (mode === 'itag') { add(ch); if (ch === '>') mode = 'text'; }
      else if (mode === 'tag') {
        add(ch);
        if (ch === '>') { flush('chunk'); mode = 'text'; }
        else if (ch === '=' && (s[i + 1] === '"' || s[i + 1] === "'")) { quote = s[++i]; add(quote); flush('chunk'); mode = 'attr'; }
      } else if (ch === quote) { flush('raw'); mode = 'tag'; add(ch); }
      else add(ch);
    }
  }
  flush('raw');
  return out;
}

/** code を書き換える。keys には、見つけた翻訳の単位(ID → 日本語)を足す */
export async function transform(code, id, keys = new Map()) {
  if (!JA.test(code)) return null;
  const js = (await transformWithOxc(code, id, { sourcemap: false })).code;
  const ast = parseAst(js);
  const call = items => {
    const strs = [''], vals = [];
    for (const x of items) { if ('s' in x) strs[strs.length - 1] += x.s; else { vals.push(x.e); strs.push(''); } }
    const key = strs.reduce((t, s, i) => t + (i ? `{${i - 1}}` : '') + s, ''), h = hash(key);
    if (keys.has(h) && keys.get(h) !== key) throw new Error(`翻訳のIDが重なりました: ${key} / ${keys.get(h)}`);
    keys.set(h, key);
    return vals.length ? `__tt([${strs.map(q).join(',')}],"${h}",${vals.join(',')})` : `__t(${q(key)},"${h}")`;
  };
  const isTpl = n => n.type === 'TemplateLiteral' && n.quasis.some(x => JA.test(x.value.cooked ?? ''));
  const isStr = n => n.type === 'Literal' && typeof n.value === 'string' && JA.test(n.value);
  // 書き換える節を置き換えた、node のソースを返す
  const render = node => {
    const reps = [];
    const walk = (n, parent, pkey) => {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration') return;
      const propKey = parent?.type === 'Property' && pkey === 'key' && !parent.computed;
      if (propKey && ((n.type === 'Identifier' && JA.test(n.name)) || isStr(n))) { reps.push([n.start, n.end, `[${call([{ s: n.type === 'Identifier' ? n.name : n.value }])}]`]); return; }
      if (isStr(n)) {
        const parts = split([{ s: n.value }]).map(p => (p.k === 'chunk' ? call(p.items) : q(p.items.map(x => x.s).join('')))).filter(x => x !== '""');
        reps.push([n.start, n.end, parts.length > 1 ? `(${parts.join(' + ')})` : parts[0]]);
        return;
      }
      if (isTpl(n)) {
        const items = [];
        n.quasis.forEach((x, i) => { items.push({ s: x.value.cooked }); if (n.expressions[i]) items.push({ e: render(n.expressions[i]) }); });
        const body = split(items).map(p => (p.k === 'chunk' ? '${' + call(p.items) + '}' : p.items.map(x => ('s' in x ? tplEsc(x.s) : '${' + x.e + '}')).join(''))).join('');
        reps.push([n.start, n.end, '`' + body + '`']);
        return;
      }
      for (const k in n) {
        const v = n[k];
        if (Array.isArray(v)) for (const c of v) walk(c, n, k); else if (v && typeof v === 'object') walk(v, n, k);
      }
    };
    walk(node, null, '');
    let out = '', pos = node.start;
    for (const [a, b, t] of reps.sort((x, y) => x[0] - y[0])) { out += js.slice(pos, a) + t; pos = b; }
    return out + js.slice(pos, node.end);
  };
  return render(ast);
}

/** vite のプラグイン。runtime: __t と __tt を出しているファイル(絶対パス) */
export function i18n(runtime) {
  const rt = runtime.replace(/\\/g, '/');
  return {
    name: 'netshop-i18n',
    enforce: 'pre',
    async transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/');
      if (!/\/src\/.*\.ts$/.test(file) || file.includes('/src/i18n/')) return null;
      const out = await transform(code, file);
      return out == null ? null : { code: `import { __t, __tt } from ${q(rt)};\n${out}`, map: null };
    },
  };
}
