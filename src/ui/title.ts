// タイトル画面
import { TRIAL } from '../game/edition';
import type { App } from './app';
import { sfx } from './audio';
import { onAct, yen } from './dom';
import { openSettings } from './hub';

// ブラウザで開いているとき(デスクトップアプリではないとき)は、PC向けであることを知らせる
const WEB = !/Electron/.test(navigator.userAgent);

export function mountTitle(app: App, root: HTMLElement): () => void {
  const g = app.game, s = g.s;
  const has = app.hasSave() && (s.xp > 0 || s.tutorialSkipped || !!s.active);
  const item = (act: string, label: string, sub = '') => `<button class="menu-item" data-act="${act}"><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
  root.innerHTML = `
    <div class="title">
      <div class="title-shade"></div>
      <div class="sign">
        <svg class="sign-wire" viewBox="0 0 520 40" aria-hidden="true">
          <path d="M14 20 H506"/>
          <rect x="0" y="12" width="16" height="16" rx="4"/><rect x="504" y="12" width="16" height="16" rx="4"/>
          <circle class="pk" r="6"><animateMotion dur="2.6s" repeatCount="indefinite" path="M14 20 H506"/></circle>
        </svg>
        <h1>ネットワーク屋さん</h1>
        <p>社内ネットワークの構築と修理を請け負う仕事のゲーム</p>
        ${TRIAL ? '<div class="trial-note">お試し版 ・ Lv.5 まで遊べます</div>' : ''}
      </div>
      <nav class="menu">
        ${has ? item('continue', 'つづきから', `Lv.${g.level} ・ ${s.week}週目 ・ 資金 ${yen(s.money)}${s.active ? ' ・ 作業中の依頼あり' : ''}`) : ''}
        ${item('new', 'はじめから', has ? 'いまのセーブデータは消えます' : '研修から始めます')}
        ${item('settings', '設定')}
      </nav>
      <div class="title-foot">${TRIAL ? 'お試し版 ・ ' : ''}${WEB ? 'PCのブラウザ(マウスとキーボード)向けです ・ ' : ''}ver 0.2</div>
    </div>`;
  root.addEventListener('pointerover', e => { if ((e.target as HTMLElement).closest('.menu-item')) sfx('tick'); });
  onAct(root, act => {
    sfx('click');
    if (act === 'continue') app.show(s.active ? 'bench' : 'hub');
    if (act === 'settings') openSettings(app);
    if (act === 'new') {
      if (!has) { app.newGame(); app.show('hub'); return; }
      const m = app.modal(`<h2>はじめから</h2><p class="lead">いまのセーブデータを消して、研修から始めます。</p>
        <div class="modal-btns"><button class="btn" data-act="close">やめる</button><button class="btn danger" data-act="wipe">消して始める</button></div>`);
      onAct(m, x => { if (x === 'wipe') { app.newGame(); app.show('hub'); } });
    }
  });
  return () => {};
}
