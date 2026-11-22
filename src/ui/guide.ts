// ガイドの画面: 左に項目、右に説明と動く図解
import { build } from '../core/sim';
import { CATS, ENTRIES, ENTRY, Entry } from '../game/guide';
import type { App } from './app';
import { sfx } from './audio';
import { Desk } from './desk';
import { $, esc, onAct } from './dom';

export function openGuide(app: App, id?: string): void {
  const game = app.game, level = game.level;
  let cur: Entry = (id && ENTRY[id]) || ENTRIES.find(e => e.level <= level && !game.s.seenDict.includes(e.id)) || ENTRIES[0];
  let desk: Desk | null = null;
  const m = app.modal('', { wide: true, cls: 'guide' });

  function body(lines: string[]): string {
    let h = '', list = false;
    for (const p of lines) {
      const li = p.startsWith('・');
      if (li && !list) h += '<ul>';
      if (!li && list) h += '</ul>';
      list = li;
      h += li ? `<li>${esc(p.slice(1))}</li>` : p.startsWith('例:') ? `<p class="ex"><b>例</b>${esc(p.slice(2))}</p>` : `<p>${esc(p)}</p>`;
    }
    return h + (list ? '</ul>' : '');
  }
  function render(): void {
    desk?.destroy();
    desk = null;
    if (!game.s.seenDict.includes(cur.id)) { game.s.seenDict.push(cur.id); game.save(); }
    m.innerHTML = `
      <aside class="guide-nav"><h2>ガイド</h2>${CATS.map(c => `<h4>${c}</h4>${ENTRIES.filter(e => e.cat === c).map(e => e.level <= level
        ? `<button class="${e === cur ? 'on' : ''}${game.s.seenDict.includes(e.id) ? '' : ' new'}" data-act="entry" data-id="${e.id}">${esc(e.title)}</button>`
        : `<button disabled>Lv.${e.level} で読めます</button>`).join('')}`).join('')}</aside>
      <article class="guide-body"><small>${cur.cat}</small><h2>${esc(cur.title)}</h2>
        <p class="g-lead">${esc(cur.lead)}</p>
        ${cur.demo ? '<div class="demo"><svg class="desk" id="demo"></svg><div class="caption" id="caption"></div></div>' : ''}
        <div class="text">
          ${cur.example ? `<h3>具体例でたどる</h3><div class="g-example">${body(cur.example)}</div>` : ''}
          <h3>しくみ</h3>${body(cur.body)}
          ${cur.setup ? `<h3>設定のしかた</h3><ol>${cur.setup.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
          ${cur.trouble ? `<h3>つまずきやすい点</h3><ul class="warn">${cur.trouble.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          ${cur.terms ? `<h3>用語</h3><dl>${cur.terms.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        </div>
        <div class="modal-btns"><button class="btn primary" data-act="close">閉じる</button></div></article>`;
    if (cur.demo) {
      const d = cur.demo(), net = build(d.world.devices, d.world.cables, { trace: true });
      $('#caption', m).textContent = d.caption;
      desk = new Desk($<SVGSVGElement>('#demo', m), { world: d.world, net, readOnly: true, view: d.view, link: () => false, removeCable: () => {}, onSelect: () => {}, onMoved: () => {}, log: () => {} });
      desk.render();
      d.play(net);
      void desk.playTrace(net.trace!, true);
    }
    m.querySelector('.guide-body')!.scrollTop = 0;
  }
  onAct(m, (act, el) => { if (act === 'entry') { sfx('tab'); cur = ENTRY[el.dataset.id!]; render(); } });
  app.onModalClose = () => desk?.destroy();
  render();
}
