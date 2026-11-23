// 翻訳のしくみ(実行時): 日本語の文字列を、選んでいる言語の文字列に置き換える
// ソースには日本語をそのまま書く。ビルド時に tools/i18n-plugin.mjs が、日本語の文字列を __t / __tt の呼び出しに書き換える
// 翻訳は tr/*.json に「ID: [英語, 韓国語]」の形で置く(IDは `node tools/i18n.mjs todo` が出す)
export type Lang = 'ja' | 'en' | 'ko';
export const LANGS: [Lang, string][] = [['ja', '日本語'], ['en', 'English'], ['ko', '한국어']];
const KEY = 'netshop-lang';

const packs = import.meta.glob('./tr/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, [string, string]>>;
const table = new Map<string, [string, string]>();
for (const p of Object.values(packs)) for (const [id, v] of Object.entries(p)) table.set(id, v);

function detect(): Lang {
  // テスト(ブラウザの外)では日本語にする。環境変数 NETSHOP_LANG で、ほかの言語でもテストを回せる
  if (typeof document === 'undefined') { const e = (globalThis as any).process?.env?.NETSHOP_LANG; return e === 'en' || e === 'ko' ? e : 'ja'; }
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'ja' || s === 'en' || s === 'ko') return s;
  } catch { /* 保存できない環境では、ブラウザの言語で決める */ }
  const n = (navigator.language || 'ja').toLowerCase();
  return n.startsWith('ja') ? 'ja' : n.startsWith('ko') ? 'ko' : 'en';
}
let current: Lang = detect();
// 0 より大きい間は、日本語のまま返す(依頼の生成で、文章に頼った判定を日本語で行うために使う)
let raw = 0;
if (typeof document !== 'undefined') {
  document.documentElement.lang = current;
  const trial = import.meta.env?.VITE_TRIAL === '1';
  document.title = current === 'en' ? `Network Shop${trial ? ' (Trial)' : ''}` : current === 'ko' ? `네트워크 가게${trial ? ' 체험판' : ''}` : `ネットワーク屋さん${trial ? ' お試し版' : ''}`;
}

export const lang = (): Lang => current;
/** 言語を変える。画面の文章は読み込みのときに決まるものがあるので、ページを読み込み直す */
export function setLang(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* 保存できなくても、この回だけは切り替える */ }
  current = l;
  if (typeof location !== 'undefined') location.reload();
}
/** fn の中では、翻訳せずに日本語のまま返す */
export function withJa<T>(fn: () => T): T {
  raw++;
  try { return fn(); } finally { raw--; }
}
const pick = (id: string): string | undefined => (current === 'ja' || raw ? undefined : table.get(id)?.[current === 'en' ? 0 : 1] || undefined);

// 翻訳した文字列 → 元の日本語。文章の中身で判定する処理(不具合の見つけ方、依頼の題名の決め方)が、どの言語でも日本語で判定できるようにする
const rev = new Map<string, string>();
const keep = (out: string, src: string): string => { if (out !== src) { if (rev.size > 300000) rev.clear(); rev.set(out, src); } return out; };
/** 画面に出す文字列から、元の日本語を引く(日本語のときと、翻訳で作った文字列でないときは、そのまま返す) */
export const ja = (s: string): string => rev.get(s) ?? s;

/** 名前をつなげる(「総務」+「PC-1」、「みどり」+「商事」)。日本語ではそのままつなげ、ほかの言語では間を空ける */
export function join(a: string, b: string): string {
  if (current === 'ja' || raw || !a || !b) return a + b;
  return keep(a + ' ' + b, ja(a) + ja(b));
}

export function __t(s: string, id: string): string { const t = pick(id); return t == null ? s : keep(t, s); }
export function __tt(strs: string[], id: string, ...vals: unknown[]): string {
  const t = pick(id);
  if (t == null) return strs.reduce((out, s, i) => out + String(vals[i - 1]) + s);
  const src = strs.reduce((out, s, i) => out + ja(String(vals[i - 1])) + s);
  return keep(t.replace(/\{(\d+)\}/g, (_, n) => String(vals[Number(n)])), src);
}
