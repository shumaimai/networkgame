// 事務所: 受注ボード、研修、各画面への入口
import { Job } from '../core/job';
import { Game, LEVELS, MAX_LEVEL, Offer, xpFor } from '../game/state';
import { TUTORIALS, tutorialJob } from '../game/tutorial';
import type { App } from './app';
import { setVolume, sfx } from './audio';
import { portrait } from './bench';
import { openDict } from './dict';
import { esc, nl2br, onAct, stars, yen } from './dom';

export function statusBar(game: Game, here: string): string {
  const full = Math.floor(game.repStars), half = game.repStars - full >= 0.5;
  return `<header class="bar hubbar">
    <div class="brand">ネットワーク屋さん</div>
    <div class="lv"><b>Lv.${game.level}</b><span>${esc(game.levelInfo.title)}</span><div class="xpbar small"><i style="width:${Math.round(game.xpProgress * 100)}%"></i></div>
      <small>${game.level >= MAX_LEVEL ? '最高レベル' : `次まで ${xpFor(game.level + 1) - game.s.xp}`}</small></div>
    <div class="rep" title="評判が高いほど報酬が増えます">評判 <span class="repstars">${'★'.repeat(full)}${half ? '<i>★</i>' : ''}<u>${'★'.repeat(5 - full - (half ? 1 : 0))}</u></span></div>
    <div class="week">第${game.s.week}週</div>
    <div class="spacer"></div>
    <div class="money">資金 <b>${yen(game.s.money)}</b></div>
    <nav>
      <button class="btn ${here === 'hub' ? 'on' : ''}" data-act="go-hub">依頼</button>
      <button class="btn ${here === 'shop' ? 'on' : ''}" data-act="go-shop">仕入れ・倉庫</button>
      <button class="btn" data-act="dict">辞書</button>
      <button class="btn" data-act="history">実績</button>
      <button class="btn" data-act="settings">設定</button>
    </nav>
  </header>`;
}
/** ステータスバーのボタンを処理する。処理したら true */
export function barAct(app: App, act: string): boolean {
  switch (act) {
    case 'go-hub': sfx('click'); if (app.current !== 'hub') app.show('hub'); return true;
    case 'go-shop': sfx('click'); if (app.current !== 'shop') app.show('shop'); return true;
    case 'dict': sfx('open'); openDict(app); return true;
    case 'history': sfx('open'); openHistory(app); return true;
    case 'settings': sfx('open'); openSettings(app); return true;
  }
  return false;
}

const diffStars = (n: number) => `<span class="diff d${n}">${stars(n, 5)}</span>`;
const kindChip = (j: Job) => `<span class="chip ${j.kind}">${j.kind === 'build' ? '構築' : 'トラブル対応'}</span>`;

export function mountHub(app: App, root: HTMLElement): () => void {
  const game = app.game;
  if (game.tutorialFinished && !game.s.board.length) { game.refreshBoard(); game.save(); }

  function render(): void {
    const active = game.s.active, aj = game.activeJob;
    let main = '';
    if (active && aj) {
      main += `<div class="resume"><img src="${portrait(aj.industry)}" alt=""><div><small>作業中の依頼</small><b>${esc(aj.client)}「${esc(aj.title)}」</b></div>
        <button class="btn primary big" data-act="resume">作業に戻る</button></div>`;
    }
    if (!game.tutorialFinished) {
      const next = game.nextTutorial;
      main += `<div class="board-head"><h2>研修</h2><p>まずは3つの研修で、仕事の流れを覚えましょう。終わると、依頼を自由に選べるようになります。</p>
        <button class="btn" data-act="skip">研修をスキップ</button></div>
        <div class="cards tut">${TUTORIALS.map((t, i) => {
          const done = game.s.tutorialDone.includes(t.id), open = t.id === next;
          return `<button class="card ${done ? 'done' : open ? '' : 'locked'}" ${open && !active ? `data-act="tutorial" data-id="${t.id}"` : 'disabled'}>
            <div class="card-top"><span class="chip tutorial">研修 ${i + 1}</span>${done ? '<span class="chip ok">修了</span>' : ''}</div>
            <h3>${esc(t.title)}</h3><p>${esc(t.summary)}</p>
            <div class="card-foot"><span>報酬 <b>${yen(tutorialJob(t.id).reward)}</b></span><span>経験値 <b>+${t.xp}</b></span></div></button>`;
        }).join('')}</div>`;
    } else {
      main += `<div class="board-head"><h2>受注ボード</h2><p>受けたい依頼を選んでください。依頼を1件終えると1週間が過ぎ、ボードと機材の相場が変わります。</p>
        <button class="btn" data-act="week">次の週へ進む${game.weeklyFee ? `(倉庫代 ${yen(game.weeklyFee)})` : ''}</button></div>
        <div class="cards">${game.s.board.map(o => {
          const j = game.job(o);
          return `<button class="card" data-act="offer" data-id="${o.id}">
            <div class="card-top">${kindChip(j)}${diffStars(j.difficulty.stars)}</div>
            <div class="card-client"><img src="${portrait(j.industry)}" alt=""><div><b>${esc(j.client)}</b><small>${esc(j.industry)}</small></div></div>
            <h3>${esc(j.title)}</h3>
            <div class="tags">${j.tags.slice(0, 6).map(t => `<i>${esc(t)}</i>`).join('')}</div>
            <div class="card-foot"><span>報酬 <b>${yen(game.rewardOf(j))}</b></span>${j.kind === 'build' ? `<span>機材の目安 ${yen(j.par)}</span>` : '<span>機材はほぼ不要</span>'}</div></button>`;
        }).join('')}</div>`;
    }
    root.innerHTML = `<div class="hub">${statusBar(game, 'hub')}<div class="hub-main">${main}</div></div>`;
  }

  function openOffer(o: Offer): void {
    const j = game.job(o), reward = game.rewardOf(j), busy = !!game.s.active;
    let challenge = false;
    const body = () => `
      <div class="offer">
        <div class="offer-head"><img src="${portrait(j.industry)}" alt=""><div>${kindChip(j)}<h2>${esc(j.title)}</h2><small>${esc(j.client)}(${esc(j.industry)})・${esc(j.person)}</small></div></div>
        <div class="brief">${esc(j.brief)}</div>
        <div class="offer-cols">
          <div><h3>仕様書</h3><table class="spec">${j.spec.map(s => `<tr><th>${esc(s.head)}</th><td>${nl2br(s.body)}</td></tr>`).join('')}</table>
            <h3>検収テスト<small>${j.checks.length}項目すべて合格で納品</small></h3><ul class="plain small">${j.checks.slice(0, 7).map(c => `<li>${esc(c.label)}</li>`).join('')}${j.checks.length > 7 ? `<li>ほか ${j.checks.length - 7} 項目</li>` : ''}</ul></div>
          <div><h3>難易度 ${diffStars(j.difficulty.stars)}<small>${j.difficulty.score}点</small></h3>
            <table class="factors">${j.difficulty.factors.map(f => `<tr><td>${esc(f.label)}</td><td>+${f.pts}</td></tr>`).join('')}</table>
            <small class="mute">点数の合計で★が決まります(★1: 〜8 / ★2: 〜17 / ★3: 〜29 / ★4: 〜44 / ★5: 45〜)</small>
            <h3>報酬</h3>
            <div class="cost"><div><span>契約金</span><b>${yen(reward)}</b></div><div><span>うち前金(受注時)</span><b>${yen(Math.round(reward / 2 / 500) * 500)}</b></div>
              ${j.kind === 'build' ? `<div><span>機材費の目安(定価)</span><b>${yen(j.par)}</b></div>` : ''}<div><span>経験値</span><b>+${Math.round(j.xp * 0.8)}〜${Math.round(j.xp * 1.2)}</b></div></div>
            <label class="toggle challenge"><input type="checkbox" id="challenge"${challenge ? ' checked' : ''}><i></i><span><b>チャレンジモード</b>納期 ${j.minutes}分。間に合えば報酬 +30%・経験値 +20%。遅れると評判が下がります。</span></label>
          </div>
        </div>
        <div class="modal-btns">${busy ? '<span class="mute">作業中の依頼があります。先に納品するか、取り下げてください。</span>' : ''}
          <button class="btn" data-act="close">閉じる</button><button class="btn primary big" data-act="accept"${busy ? ' disabled' : ''}>受注する</button></div>
      </div>`;
    const m = app.modal(body(), { wide: true });
    m.addEventListener('change', e => { if ((e.target as HTMLElement).id === 'challenge') { challenge = (e.target as HTMLInputElement).checked; sfx('tab'); } });
    onAct(m, act => { if (act === 'accept') { sfx('coin'); game.accept(o, challenge); app.closeModal(); app.show('bench'); } });
  }

  onAct(root, (act, el) => {
    if (barAct(app, act)) return;
    switch (act) {
      case 'resume': sfx('click'); app.show('bench'); break;
      case 'tutorial': sfx('click'); game.startTutorial(el.dataset.id!); app.show('bench'); break;
      case 'skip': {
        const m = app.modal(`<h2>研修をスキップ</h2><p class="lead">研修を飛ばして、依頼を受けはじめます。研修で学ぶ内容(スイッチ、IPアドレス、ルーター、診断ツール)は、辞書でいつでも読めます。</p>
          <div class="modal-btns"><button class="btn" data-act="close">やめる</button><button class="btn primary" data-act="do-skip">スキップする</button></div>`);
        onAct(m, x => { if (x === 'do-skip') { if (game.s.active) game.abandon(); game.skipTutorial(); app.closeModal(); render(); } });
        break;
      }
      case 'week': sfx('click'); game.nextWeek(); app.toast(`第${game.s.week}週になりました。依頼と相場が変わりました。`); render(); break;
      case 'offer': sfx('open'); openOffer(game.s.board.find(o => o.id === el.dataset.id)!); break;
    }
  });
  render();
  return () => {};
}

export function openHistory(app: App): void {
  const g = app.game, h = g.s.history;
  const total = h.reduce((t, x) => t + x.profit, 0);
  app.modal(`<h2>実績</h2>
    <div class="stats"><div><small>納品した依頼</small><b>${h.length}件</b></div><div><small>利益の合計</small><b>${yen(total)}</b></div><div><small>★3の納品</small><b>${h.filter(x => x.stars === 3).length}件</b></div><div><small>レベル</small><b>${g.level}</b></div></div>
    <h3>これまでに解放した内容</h3><div class="unlocks">${LEVELS.filter(l => l.level <= g.level).map(l => `<div><b>Lv.${l.level}</b>${l.unlocks.map(esc).join(' / ')}</div>`).join('')}</div>
    <h3>最近の納品</h3>
    ${h.length ? `<table class="hist">${h.slice(0, 12).map(x => `<tr><td>第${x.week}週</td><td>${esc(x.client)}</td><td>${esc(x.title)}</td><td class="st">${stars(x.stars)}</td><td class="${x.profit < 0 ? 'neg' : ''}">${yen(x.profit)}</td></tr>`).join('')}</table>` : '<p class="mute">まだ納品した依頼がありません。</p>'}
    <div class="modal-btns"><button class="btn primary" data-act="close">閉じる</button></div>`, { wide: true });
}

export function openSettings(app: App): void {
  const s = app.game.s.settings;
  const m = app.modal(`<h2>設定</h2>
    <label class="f range"><span>効果音の大きさ</span><input type="range" id="vol" min="0" max="1" step="0.05" value="${s.sfx}"></label>
    <label class="f"><span>表示</span><button class="btn" data-act="fullscreen">全画面の切り替え</button></label>
    <h3>セーブデータ</h3>
    <button class="btn danger" data-act="wipe">セーブデータを消して最初から</button>
    <div class="modal-btns"><button class="btn" data-act="title">タイトルへ</button><button class="btn primary" data-act="close">閉じる</button></div>`);
  m.addEventListener('input', e => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'vol') { s.sfx = Number(el.value); setVolume(s.sfx); app.game.save(); sfx('ok'); }
  });
  onAct(m, (act, el) => {
    if (act === 'fullscreen') { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); }
    if (act === 'title') { app.closeModal(); app.show('title'); }
    if (act === 'wipe') {
      if (el.dataset.armed) { app.newGame(); app.closeModal(); app.show('title'); }
      else { el.dataset.armed = '1'; el.textContent = 'もう一度押すと消去します'; }
    }
  });
}
