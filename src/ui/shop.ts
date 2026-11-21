// 仕入れと倉庫
import { MODEL } from '../core/model';
import { BULK, CUSTOM_RATE, PLANS, PlanId } from '../game/state';
import type { App } from './app';
import { sfx } from './audio';
import { esc, img, onAct, yen } from './dom';
import { barAct, statusBar } from './hub';

export function mountShop(app: App, root: HTMLElement): () => void {
  const game = app.game;
  const qty: Record<string, number> = {};
  let customFee = game.s.plan === 'custom' ? game.s.planFee : 9000;

  function render(): void {
    const used = game.stockUsed, cap = game.capacity;
    const rows = game.catalog.map(m => {
      const M = MODEL[m], n = qty[m] ?? 1, q = game.quote(m, n), mult = game.mult(m), pct = Math.round((mult - 1) * 100);
      const fits = used + M.size * n <= cap;
      return `<div class="shop-row">
        <img src="${img(M.kind)}" alt=""><div class="s-name"><b>${esc(M.label)}</b><small>${esc(M.desc)}</small></div>
        <div class="s-price"><b>${yen(game.price(m))}</b><small class="${pct < -4 ? 'down' : pct > 4 ? 'up' : ''}">定価 ${yen(M.price)} ${pct === 0 ? '' : `(${pct > 0 ? '+' : ''}${pct}%)`}</small></div>
        <div class="s-size">広さ ${M.size}</div>
        <div class="stepper"><button data-act="dec" data-m="${m}">−</button><span>${n}</span><button data-act="inc" data-m="${m}">＋</button></div>
        <div class="s-total"><b>${yen(q.total)}</b><small>${q.rate ? `まとめ買い −${Math.round(q.rate * 100)}%` : '&nbsp;'}</small></div>
        <button class="btn primary" data-act="buy" data-m="${m}"${q.total > game.s.money || !fits ? ' disabled' : ''} title="${fits ? '' : '倉庫に入りきりません'}">仕入れる</button>
      </div>`;
    }).join('');
    const stock = Object.entries(game.s.stock).map(([m, it]) => `<div class="stock-row"><img src="${img(MODEL[m].kind)}" alt=""><div><b>${esc(MODEL[m].label)}</b><small>${it.qty}台 ・ 仕入れ値の平均 ${yen(it.cost / it.qty)}</small></div>
      <button class="btn small" data-act="sell" data-m="${m}">1台売る ${yen(game.sellPrice(m))}</button></div>`).join('');
    const plan = (id: Exclude<PlanId, 'custom'>) => `<button class="plan ${game.s.plan === id ? 'on' : ''}" data-act="plan" data-id="${id}"><b>${PLANS[id].label}</b><span>広さ ${PLANS[id].cap}</span><span>${PLANS[id].fee ? yen(PLANS[id].fee) + '/週' : '無料'}</span></button>`;
    root.innerHTML = `<div class="hub shop">${statusBar(game, 'shop')}
      <div class="shop-main">
        <section class="shop-list"><div class="board-head"><h2>仕入れ</h2><p>相場は週ごとに定価の0.5〜2倍の間で動きます。安いときにまとめて仕入れて倉庫に置けば、依頼の機材費を抑えられます。</p></div>
          <div class="bulk">まとめ買い割引: ${BULK.slice().reverse().map(([n, r]) => `<span>${n}台〜 <b>−${Math.round(r * 100)}%</b></span>`).join('')}</div>
          <div class="shop-rows">${rows}</div></section>
        <section class="ware"><h2>倉庫</h2>
          <div class="capbar"><i style="width:${cap ? Math.min(100, (used / cap) * 100) : 0}%"></i><span>使用中 ${used} / ${cap}</span></div>
          <div class="plans">${plan('none')}${plan('s')}${plan('m')}${plan('l')}</div>
          <div class="plan custom ${game.s.plan === 'custom' ? 'on' : ''}"><b>金額を決めて借りる</b>
            <div class="custom-row"><input type="number" id="custom-fee" min="1000" step="500" value="${customFee}"><span>円/週 → 広さ <b id="custom-cap">${Math.floor(customFee / CUSTOM_RATE)}</b></span><button class="btn small" data-act="plan" data-id="custom">この条件で借りる</button></div>
            <small>定額の倉庫より割高ですが、いくらでも広くできます。</small></div>
          <h3>在庫</h3><div class="stock">${stock || '<p class="mute">在庫はありません。仕入れた機材は、依頼の作業画面で「倉庫の在庫」から使えます。</p>'}</div>
        </section>
      </div></div>`;
  }

  onAct(root, (act, el) => {
    if (barAct(app, act)) return;
    const m = el.dataset.m ?? '';
    switch (act) {
      case 'inc': qty[m] = Math.min(99, (qty[m] ?? 1) + 1); sfx('tick'); render(); break;
      case 'dec': qty[m] = Math.max(1, (qty[m] ?? 1) - 1); sfx('tick'); render(); break;
      case 'buy': {
        const err = game.buyStock(m, qty[m] ?? 1);
        if (err) { app.toast(err, 'ng'); sfx('ng'); } else { app.toast(`${MODEL[m].label} を ${qty[m] ?? 1}台 仕入れました。`); sfx('coin'); qty[m] = 1; }
        render();
        break;
      }
      case 'sell': game.sellStock(m, 1); sfx('coin'); render(); break;
      case 'plan': {
        const id = el.dataset.id as PlanId;
        const err = game.setPlan(id, customFee);
        if (err) { app.toast(err, 'ng'); sfx('ng'); } else { sfx('ok'); app.toast('倉庫の契約を変更しました。倉庫代は週の変わり目に支払います。'); }
        render();
        break;
      }
    }
  });
  root.addEventListener('input', e => {
    const el = e.target as HTMLInputElement;
    if (el.id !== 'custom-fee') return;
    customFee = Math.max(0, Math.round(Number(el.value) || 0));
    root.querySelector('#custom-cap')!.textContent = String(Math.floor(customFee / CUSTOM_RATE));
  });
  render();
  return () => {};
}
