// 辞書の画面: 左に項目、右に説明と動く図解
import { build } from '../core/sim';
import { CATS, ENTRIES, ENTRY, Entry } from '../game/dict';
import type { App } from './app';
import { sfx } from './audio';
import { Desk } from './desk';
import { $, esc, onAct } from './dom';

export function openDict(app: App, id?: string): void {
  const game = app.game, level = game.level;
  let cur: Entry = (id && ENTRY[id]) || ENTRIES.find(e => e.level <= level && !game.s.seenDict.includes(e.id)) || ENTRIES[0];
  let desk: Desk | null = null;
  const m = app.modal('', { wide: true, cls: 'dict' });

  const para = (p: string) => p.startsWith('・') ? `<li>${esc(p.slice(1))}</li>` : p.startsWith('例:') ? `<p class="ex"><b>例</b>${esc(p.slice(2))}</p>` : `<p>${esc(p)}</p>`;
  function body(e: Entry): string {
    let h = '', list = false;
    for (const p of e.body) {
      const li = p.startsWith('・');
      if (li && !list) h += '<ul>';
      if (!li && list) h += '</ul>';
      list = li;
      h += para(p);
    }
    return h + (list ? '</ul>' : '');
  }
  function render(): void {
    desk?.destroy();
    desk = null;
    if (!game.s.seenDict.includes(cur.id)) { game.s.seenDict.push(cur.id); game.save(); }
    m.innerHTML = `
      <aside class="dict-nav"><h2>辞書</h2>${CATS.map(c => `<h4>${c}</h4>${ENTRIES.filter(e => e.cat === c).map(e => e.level <= level
        ? `<button class="${e === cur ? 'on' : ''}${game.s.seenDict.includes(e.id) ? '' : ' new'}" data-act="entry" data-id="${e.id}">${esc(e.title)}</button>`
        : `<button disabled>Lv.${e.level} で解放</button>`).join('')}`).join('')}</aside>
      <article class="dict-body"><small>${cur.cat}</small><h2>${esc(cur.title)}</h2>
        ${cur.demo ? '<div class="demo"><svg class="desk" id="demo"></svg><div class="caption" id="caption"></div></div>' : ''}
        <div class="text">${body(cur)}</div>
        <div class="modal-btns"><button class="btn primary" data-act="close">閉じる</button></div></article>`;
    if (cur.demo) {
      const d = cur.demo(), net = build(d.world.devices, d.world.cables, { trace: true });
      $('#caption', m).textContent = d.caption;
      desk = new Desk($<SVGSVGElement>('#demo', m), { world: d.world, net, readOnly: true, view: d.view, link: () => false, removeCable: () => {}, onSelect: () => {}, onMoved: () => {}, log: () => {} });
      desk.render();
      d.play(net);
      void desk.playTrace(net.trace!, true);
    }
  }
  onAct(m, (act, el) => { if (act === 'entry') { sfx('tab'); cur = ENTRY[el.dataset.id!]; render(); } });
  app.onModalClose = () => desk?.destroy();
  render();
}
