// ガイドの画面: 左に項目(キーワードで絞り込める)、右に説明と動く図解
import { build } from '../core/sim';
import { CATS, ENTRIES, ENTRY, Entry, TAG_GUIDE } from '../game/guide';
import { Game, MAX_LEVEL } from '../game/state';
import type { App } from './app';
import { sfx } from './audio';
import { Desk } from './desk';
import { $, esc, onAct } from './dom';

/** 依頼のタグから、いま読めるガイドの項目へ移るボタンを作る。まだ読んでいない項目には印を付ける */
export function guideChips(game: Game, tags: string[]): string {
  const ids = [...new Set(tags.map(t => TAG_GUIDE[t]).filter(id => id && ENTRY[id] && ENTRY[id].level <= game.level))];
  return ids.map(id => `<button class="gchip${game.s.seenDict.includes(id) ? '' : ' new'}" data-act="guide-to" data-id="${id}">${esc(ENTRY[id].title)}</button>`).join('');
}

/** id を指定すると、その項目を開く。onClose は、ガイドを閉じたあとに元の画面へ戻るために使う */
export function openGuide(app: App, id?: string, onClose?: () => void): void {
  const game = app.game, level = game.level;
  let cur: Entry = (id && ENTRY[id]?.level <= level && ENTRY[id]) || ENTRIES.find(e => e.level <= level && !game.s.seenDict.includes(e.id)) || ENTRIES[0];
  let desk: Desk | null = null, query = '';
  const m = app.modal(`<aside class="guide-nav"><h2>ガイド</h2>
      <input id="guide-q" placeholder="キーワードで探す 例 DNS" spellcheck="false" autocomplete="off"><div id="guide-list"></div></aside>
    <article class="guide-body"></article><button class="guide-x" data-act="close" title="閉じる(Esc キーでも閉じます)">×</button>`, { wide: true, cls: 'guide' });
  const text = (e: Entry) => [e.title, e.lead, ...e.body, ...(e.example ?? []), ...(e.setup ?? []), ...(e.trouble ?? []), ...(e.terms ?? []).flat()].join(' ').toLowerCase();

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
  function renderNav(): void {
    const q = query.trim().toLowerCase();
    const btn = (e: Entry) => `<button class="${e === cur ? 'on' : ''}${game.s.seenDict.includes(e.id) ? '' : ' new'}" data-act="entry" data-id="${e.id}">${esc(e.title)}</button>`;
    let h: string;
    if (q) {
      // 絞り込み: 題名に当たった項目を先に、本文だけに当たった項目をあとに並べる
      const hit = ENTRIES.filter(e => e.level <= level && text(e).includes(q));
      const first = hit.filter(e => e.title.toLowerCase().includes(q));
      h = hit.length ? `<h4>「${esc(query.trim())}」を含む項目 ${hit.length}件</h4>${[...first, ...hit.filter(e => !first.includes(e))].map(btn).join('')}` : '<p class="none">当てはまる項目がありません。</p>';
    } else {
      h = CATS.map(c => `<h4>${c}</h4>${ENTRIES.filter(e => e.cat === c).map(e => (e.level <= level ? btn(e) : `<button disabled>${e.level > MAX_LEVEL ? '製品版で読めます' : `Lv.${e.level} で読めます`}</button>`)).join('')}`).join('');
    }
    $('#guide-list', m).innerHTML = h;
  }
  function render(): void {
    desk?.destroy();
    desk = null;
    if (!game.s.seenDict.includes(cur.id)) { game.s.seenDict.push(cur.id); game.save(); }
    const art = $('.guide-body', m);
    art.innerHTML = `<small>${cur.cat}</small><h2>${esc(cur.title)}</h2>
        <p class="g-lead">${esc(cur.lead)}</p>
        ${cur.demo ? '<div class="demo"><svg class="desk" id="demo"></svg><div class="caption" id="caption"></div></div>' : ''}
        <div class="text">
          ${cur.example ? `<h3>具体例でたどる</h3><div class="g-example">${body(cur.example)}</div>` : ''}
          <h3>しくみ</h3>${body(cur.body)}
          ${cur.setup ? `<h3>設定のしかた</h3><ol>${cur.setup.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
          ${cur.trouble ? `<h3>つまずきやすい点</h3><ul class="warn">${cur.trouble.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          ${cur.terms ? `<h3>用語</h3><dl>${cur.terms.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        </div>
        <div class="modal-btns"><button class="btn primary" data-act="close">${onClose ? '戻る' : '閉じる'}</button></div>`;
    if (cur.demo) {
      const d = cur.demo(), net = build(d.world.devices, d.world.cables, { trace: true });
      $('#caption', m).textContent = d.caption;
      desk = new Desk($<SVGSVGElement>('#demo', m), { world: d.world, net, readOnly: true, view: d.view, link: () => false, removeCable: () => {}, onSelect: () => {}, onMoved: () => {}, log: () => {} });
      desk.render();
      d.play(net);
      void desk.playTrace(net.trace!, true);
    }
    art.scrollTop = 0;
    renderNav();
    $('#guide-list .on', m)?.scrollIntoView({ block: 'nearest' });
  }
  onAct(m, (act, el) => { if (act === 'entry') { sfx('tab'); cur = ENTRY[el.dataset.id!]; render(); } });
  $<HTMLInputElement>('#guide-q', m).addEventListener('input', e => { query = (e.target as HTMLInputElement).value; renderNav(); });
  app.onModalClose = () => { desk?.destroy(); onClose?.(); };
  render();
}
