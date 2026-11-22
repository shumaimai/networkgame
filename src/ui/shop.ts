// 仕入れ: 今週の相場で機材を買い、倉庫に入れる
import { MODEL } from '../core/model';
import { BULK } from '../game/state';
import type { App } from './app';
import { sfx } from './audio';
import { esc, img, onAct, yen } from './dom';
import { barAct, statusBar } from './hub';

export function mountShop(app: App, root: HTMLElement): () => void {
  const game = app.game;
  const qty: Record<string, number> = {};

  function render(): void {
    const used = game.stockUsed, cap = game.capacity;
    const rows = game.catalog.map(m => {
      const M = MODEL[m], n = qty[m] ?? 1, q = game.quote(m, n), pct = Math.round((game.mult(m) - 1) * 100);
      const fits = used + M.size * n <= cap, own = game.stockQty(m);
      return `<div class="shop-row">
        <img src="${img(M.kind)}" alt=""><div class="s-name"><b>${esc(M.label)}</b><small>${esc(M.desc)}</small></div>
        <div class="s-price"><b>${yen(game.price(m))}</b><small class="${pct < -4 ? 'down' : pct > 4 ? 'up' : ''}">定価 ${yen(M.price)}${pct === 0 ? '' : ` (${pct > 0 ? '+' : ''}${pct}%)`}</small></div>
        <div class="s-size">${M.size}スロット${own ? `<small>在庫 ${own}台</small>` : ''}</div>
        <div class="stepper"><button data-act="dec" data-m="${m}">−</button><span>${n}</span><button data-act="inc" data-m="${m}">＋</button></div>
        <div class="s-total"><b>${yen(q.total)}</b><small>${q.rate ? `まとめ買い −${Math.round(q.rate * 100)}%` : '&nbsp;'}</small></div>
        <button class="btn primary" data-act="buy" data-m="${m}"${q.total > game.s.money || !fits ? ' disabled' : ''}>${fits ? '仕入れる' : 'スロット不足'}</button>
      </div>`;
    }).join('');
    // これから買えるようになる機材を全部、灰色で出す(どこまで進めると何が増えるかが分かる)
    const soon = game.upcoming().map(m => {
      const M = MODEL[m];
      return `<div class="shop-row locked"><img src="${img(M.kind)}" alt=""><div class="s-name"><b>${esc(M.label)}</b><small>${esc(M.desc)}</small></div>
        <div class="s-price"><b>定価 ${yen(M.price)}</b></div><div class="s-size">${M.size}スロット</div><div class="s-lock">Lv.${M.level} で解放</div></div>`;
    }).join('');
    root.innerHTML = `<div class="hub">${statusBar(game, 'shop')}
      <div class="page">
        <div class="board-head"><h2>仕入れ</h2><p>値段は週ごとに変わります。仕入れた機材は倉庫に入り、依頼の作業で使えます。</p>
          <div class="slotbox">倉庫 <b>${used} / ${cap}</b> スロット<button class="btn small" data-act="go-ware">倉庫へ</button></div></div>
        <div class="bulk">まとめ買い ${BULK.slice().reverse().map(([n, r]) => `<span>${n}台以上 <b>−${Math.round(r * 100)}%</b></span>`).join('')}</div>
        <div class="shop-rows">${rows}${soon}</div>
      </div></div>`;
  }

  onAct(root, (act, el) => {
    if (barAct(app, act)) return;
    const m = el.dataset.m ?? '';
    switch (act) {
      case 'inc': qty[m] = Math.min(99, (qty[m] ?? 1) + 1); sfx('tick'); render(); break;
      case 'dec': qty[m] = Math.max(1, (qty[m] ?? 1) - 1); sfx('tick'); render(); break;
      case 'buy': {
        const n = qty[m] ?? 1, err = game.buyStock(m, n);
        if (err) { app.toast(err, 'ng'); sfx('ng'); } else { app.toast(`${MODEL[m].label} を${n}台仕入れました。`); sfx('coin'); qty[m] = 1; }
        render();
        break;
      }
    }
  });
  render();
  return () => {};
}
