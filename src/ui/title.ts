// タイトル画面
import type { App } from './app';
import { sfx } from './audio';
import { onAct } from './dom';
import { openSettings } from './hub';

export function mountTitle(app: App, root: HTMLElement): () => void {
  const has = app.hasSave() && (app.game.s.xp > 0 || app.game.s.tutorialSkipped || !!app.game.s.active);
  root.innerHTML = `
    <div class="title">
      <div class="title-box">
        <div class="logo"><small>NETWORK SHOP</small>ネットワーク<wbr>屋さん</div>
        <p class="tagline">つないで、設定して、納品する。<br>遊びながら身につくネットワーク構築ゲーム</p>
        <div class="title-btns">
          ${has ? '<button class="btn primary big" data-act="continue">つづきから</button>' : ''}
          <button class="btn ${has ? '' : 'primary'} big" data-act="new">はじめから</button>
          <button class="btn big" data-act="settings">設定</button>
        </div>
      </div>
      <div class="title-foot">ver 0.1</div>
    </div>`;
  onAct(root, act => {
    sfx('click');
    if (act === 'continue') app.show(app.game.s.active ? 'bench' : 'hub');
    if (act === 'settings') openSettings(app);
    if (act === 'new') {
      if (!has) { app.newGame(); app.show('hub'); return; }
      const m = app.modal(`<h2>はじめから</h2><p class="lead">いまのセーブデータを消して、最初から始めます。よろしいですか。</p>
        <div class="modal-btns"><button class="btn" data-act="close">やめる</button><button class="btn danger" data-act="wipe">消して始める</button></div>`);
      onAct(m, x => { if (x === 'wipe') { app.newGame(); app.show('hub'); } });
    }
  });
  return () => {};
}
