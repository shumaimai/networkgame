// 倉庫: 契約(スロットの数)と在庫
import { MODEL } from '../core/model';
import { CUSTOM_RATE, PLANS, PlanId } from '../game/state';
import type { App } from './app';
import { sfx } from './audio';
import { esc, img, onAct, yen } from './dom';
import { barAct, statusBar } from './hub';

export function mountWare(app: App, root: HTMLElement): () => void {
  const game = app.game;
  let customFee = game.s.plan === 'custom' ? game.s.planFee : 9000;

  function render(): void {
    const used = game.stockUsed, cap = game.capacity;
    const cells = Array.from({ length: Math.min(cap, 150) }, (_, i) => `<i class="${i < used ? 'on' : ''}"></i>`).join('');
    const stock = Object.entries(game.s.stock).map(([m, it]) => `<div class="stock-row"><img src="${img(MODEL[m].kind)}" alt="">
      <div><b>${esc(MODEL[m].label)}</b><small>${it.qty}台 ・ ${MODEL[m].size * it.qty}スロット ・ 仕入れ値の平均 ${yen(it.cost / it.qty)}</small></div>
      <button class="btn small" data-act="sell" data-m="${m}">1台売る ${yen(game.sellPrice(m))}</button></div>`).join('');
    const plan = (id: Exclude<PlanId, 'custom'>) => `<button class="plan ${game.s.plan === id ? 'on' : ''}" data-act="plan" data-id="${id}"><b>${PLANS[id].label}</b><span>${PLANS[id].cap}スロット</span><span>${PLANS[id].fee ? yen(PLANS[id].fee) + ' / 週' : '無料'}</span></button>`;
    root.innerHTML = `<div class="hub">${statusBar(game, 'ware')}
      <div class="page ware-page">
        <section>
          <div class="board-head"><h2>倉庫</h2><p>仕入れた機材を置く場所です。倉庫代は週の変わり目に支払います。</p></div>
          <h3>契約</h3>
          <div class="plans">${plan('none')}${plan('s')}${plan('m')}${plan('l')}</div>
          <div class="plan custom ${game.s.plan === 'custom' ? 'on' : ''}"><b>金額を決めて借りる</b>
            <div class="custom-row"><input type="number" id="custom-fee" min="1000" step="500" value="${customFee}"><span>円 / 週 で <b id="custom-cap">${Math.floor(customFee / CUSTOM_RATE)}</b> スロット</span><button class="btn small" data-act="plan" data-id="custom">この金額で借りる</button></div>
            <small>1スロットあたり ${CUSTOM_RATE}円。定額の倉庫より割高ですが、スロットをいくらでも増やせます。</small></div>
        </section>
        <section>
          <h3>スロット<small>${used} / ${cap} を使用中</small></h3>
          <div class="slots">${cells}${cap > 150 ? `<span>ほか ${cap - 150}</span>` : ''}</div>
          <h3>在庫</h3><div class="stock">${stock || '<p class="mute">在庫はありません。「仕入れ」で機材を買うと、ここに入ります。</p>'}</div>
        </section>
      </div></div>`;
  }

  onAct(root, (act, el) => {
    if (barAct(app, act)) return;
    if (act === 'sell') { game.sellStock(el.dataset.m!, 1); sfx('coin'); render(); }
    if (act === 'plan') {
      const err = game.setPlan(el.dataset.id as PlanId, customFee);
      if (err) { app.toast(err, 'ng'); sfx('ng'); } else { sfx('ok'); app.toast('倉庫の契約を変えました。'); }
      render();
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
