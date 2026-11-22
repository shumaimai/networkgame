// 画面まわりの小さな共通部品
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const yen = (n: number): string => (n < 0 ? '-' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const stars = (n: number, max = 3): string => '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll(sel)] as T[];
// 1つのHTMLにまとめた版(お試し版)では、ページに埋め込んだ画像(window.__IMG)を使う
export const img = (name: string): string => (globalThis as any).__IMG?.[name] ?? `./img/${name}.webp`;
export const nl2br = (s: string): string => esc(s).replace(/\n/g, '<br>');

/** data-act を持つ要素のクリックをまとめて受ける */
export function onAct(root: HTMLElement, fn: (act: string, el: HTMLElement, e: MouseEvent) => void): void {
  root.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (el && root.contains(el) && !(el as HTMLButtonElement).disabled) fn(el.dataset.act!, el, e);
  });
}
