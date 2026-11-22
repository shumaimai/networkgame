// 受注: 研修と、今週の依頼の一覧
import { Job, KIND_LABEL } from '../core/job';
import { Game, LEVELS, MAX_LEVEL, Offer, xpFor } from '../game/state';
import { TUTORIALS, tutorialJob } from '../game/tutorial';
import type { App } from './app';
import { setVolume, sfx } from './audio';
import { portrait } from './bench';
import { esc, nl2br, onAct, stars, yen } from './dom';
import { openGuide } from './guide';

const TABS: [string, string][] = [['hub', '受注'], ['shop', '仕入れ'], ['ware', '倉庫']];

export function statusBar(game: Game, here: string): string {
  const full = Math.floor(game.repStars), half = game.repStars - full >= 0.5;
  return `<header class="bar hubbar">
    <nav class="tabs">${TABS.map(([id, label]) => `<button class="tab ${here === id ? 'on' : ''}" data-act="go-${id}">${label}</button>`).join('')}</nav>
    <div class="lv"><b>Lv.${game.level}</b><span>${esc(game.levelInfo.title)}</span><div class="xpbar small"><i style="width:${Math.round(game.xpProgress * 100)}%"></i></div>
      <small>${game.level >= MAX_LEVEL ? '最高レベル' : `次まで ${xpFor(game.level + 1) - game.s.xp}`}</small></div>
    <div class="rep" title="評判が高いほど契約金が増えます">評判 <span class="repstars">${'★'.repeat(full)}${half ? '<i>★</i>' : ''}<u>${'★'.repeat(5 - full - (half ? 1 : 0))}</u></span></div>
    <div class="week">第${game.s.week}週</div>
    <div class="spacer"></div>
    <div class="money">資金 <b>${yen(game.s.money)}</b></div>
    <nav>
      <button class="btn" data-act="guide">ガイド</button>
      <button class="btn" data-act="history">実績</button>
      <button class="btn" data-act="settings">設定</button>
    </nav>
  </header>`;
}
/** 上のバーのボタンを処理する。処理したら true */
export function barAct(app: App, act: string): boolean {
  switch (act) {
    case 'go-hub': case 'go-shop': case 'go-ware': {
      const id = act.slice(3) as 'hub' | 'shop' | 'ware';
      sfx('tab');
      if (app.current !== id) app.show(id);
      return true;
    }
    case 'guide': sfx('open'); openGuide(app); return true;
    case 'history': sfx('open'); openHistory(app); return true;
    case 'settings': sfx('open'); openSettings(app); return true;
  }
  return false;
}

const diffStars = (n: number) => `<span class="diff d${n}">${stars(n, 5)}</span>`;
const kindChip = (j: Job) => `<span class="chip ${j.kind}">${KIND_LABEL[j.kind]}</span>`;

// 依頼カードに出す規模
function summary(j: Job): string {
  const ds = j.solution.devices, n = (k: string) => ds.filter(d => d.kind === k).length;
  const parts = [`PC ${n('pc')}台`, n('printer') ? 'プリンタ' : '', n('phone') ? '電話' : '', n('pos') ? 'レジ' : '', n('camera') ? 'カメラ' : ''].filter(Boolean);
  const nets = j.spec.find(s => s.head === 'アドレス')?.body.split(String.fromCharCode(10)).length ?? 1;
  return `${parts.join('・')}${nets > 1 ? ` / ネットワーク ${nets}つ` : ''}${j.kind === 'trouble' ? ` / 不具合 ${j.faults.length}か所` : ''}`;
}

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
      main += `<div class="board-head"><h2>研修</h2><p>研修は3つあります。全部終えると、依頼を選んで受けられるようになります。</p>
        <button class="btn" data-act="skip">研修をスキップ</button></div>
        <div class="cards tut">${TUTORIALS.map((t, i) => {
          const done = game.s.tutorialDone.includes(t.id), open = t.id === next;
          return `<button class="card ${done ? 'done' : open ? '' : 'locked'}" ${open && !active ? `data-act="tutorial" data-id="${t.id}"` : 'disabled'}>
            <div class="card-top"><span class="chip tutorial">研修 ${i + 1}</span>${done ? '<span class="chip ok">修了</span>' : ''}</div>
            <h3>${esc(t.title)}</h3><p>${esc(t.summary)}</p>
            <div class="card-foot"><span>契約金 <b>${yen(tutorialJob(t.id).reward)}</b></span><span>経験値 <b>+${t.xp}</b></span></div></button>`;
        }).join('')}</div>`;
    } else {
      main += `<div class="board-head"><h2>受注</h2><p>今週の依頼です。1件納品すると次の週になり、依頼と機材の値段が入れ替わります。</p>
        <button class="btn" data-act="week">受けずに次の週へ${game.weeklyFee ? `(倉庫代 ${yen(game.weeklyFee)})` : ''}</button></div>
        <div class="cards">${game.s.board.map(o => {
          const j = game.job(o);
          return `<button class="card" data-act="offer" data-id="${o.id}">
            <div class="card-top">${kindChip(j)}${diffStars(j.difficulty.stars)}</div>
            <div class="card-client"><img src="${portrait(j.industry)}" alt=""><div><b>${esc(j.client)}</b><small>${esc(j.industry)}</small></div></div>
            <h3>${esc(j.title)}</h3>
            <p class="card-sum">${summary(j)}</p>
            <div class="tags">${j.tags.slice(0, 8).map(t => `<i>${esc(t)}</i>`).join('')}</div>
            <div class="card-foot"><span>契約金 <b>${yen(game.rewardOf(j))}</b></span>${j.kind !== 'trouble' ? `<span>機材費の目安 ${yen(game.parNow(j))}</span>` : '<span>機材はほとんど要りません</span>'}</div></button>`;
        }).join('')}</div>`;
    }
    root.innerHTML = `<div class="hub">${statusBar(game, 'hub')}<div class="hub-main">${main}</div></div>`;
  }

  function openOffer(o: Offer): void {
    const j = game.job(o), reward = game.rewardOf(j), busy = !!game.s.active, [l3] = game.starLimits(j);
    let challenge = false;
    const body = () => `
      <div class="offer">
        <div class="offer-head"><img src="${portrait(j.industry)}" alt=""><div>${kindChip(j)}<h2>${esc(j.title)}</h2><small>${esc(j.client)}(${esc(j.industry)})・${esc(j.person)}</small></div></div>
        <div class="brief">${esc(j.brief)}</div>
        <div class="offer-cols">
          <div><h3>仕様書</h3><table class="spec">${j.spec.map(s => `<tr><th>${esc(s.head)}</th><td>${nl2br(s.body)}</td></tr>`).join('')}</table>
            <h3>検収テスト<small>${j.checks.length}項目。すべて合格すると納品できます</small></h3><ul class="plain small">${j.checks.slice(0, 7).map(c => `<li>${esc(c.label)}</li>`).join('')}${j.checks.length > 7 ? `<li>ほか ${j.checks.length - 7}項目</li>` : ''}</ul></div>
          <div><h3>難易度 ${diffStars(j.difficulty.stars)}<small>${j.difficulty.score}点</small></h3>
            <table class="factors">${j.difficulty.factors.map(f => `<tr><td>${esc(f.label)}</td><td>+${f.pts}</td></tr>`).join('')}</table>
            <small class="mute">合計が8点までは★1、17点まで★2、29点まで★3、44点まで★4、45点以上は★5です。</small>
            <h3>お金</h3>
            <div class="cost"><div><span>契約金</span><b>${yen(reward)}</b></div><div><span>前金(受注したときに受け取る)</span><b>${yen(Math.round(reward / 2 / 500) * 500)}</b></div>
              ${j.kind !== 'trouble' ? `<div><span>機材費の目安(今週の値段)</span><b>${yen(game.parNow(j))}</b></div><div><span>★3になる機材費</span><b>${yen(l3)} 以下</b></div>` : ''}<div><span>経験値</span><b>+${Math.round(j.xp * 0.8)}〜${Math.round(j.xp * 1.2)}</b></div></div>
            <label class="toggle challenge"><input type="checkbox" id="challenge"${challenge ? ' checked' : ''}><i></i><span><b>チャレンジモード</b>納期は${j.minutes}分です。間に合うと契約金が30%、経験値が20%増えます。遅れると評判が下がります。</span></label>
          </div>
        </div>
        <div class="modal-btns">${busy ? '<span class="mute">作業中の依頼があります。納品するか取り下げると、次の依頼を受けられます。</span>' : ''}
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
        const m = app.modal(`<h2>研修をスキップ</h2><p class="lead">研修を受けずに、依頼を受けはじめます。研修で扱う内容(スイッチ、IPアドレス、ルーター、診断ツール)は、ガイドで読めます。</p>
          <div class="modal-btns"><button class="btn" data-act="close">やめる</button><button class="btn primary" data-act="do-skip">スキップする</button></div>`);
        onAct(m, x => { if (x === 'do-skip') { if (game.s.active) game.abandon(); game.skipTutorial(); app.closeModal(); render(); } });
        break;
      }
      case 'week': sfx('click'); game.nextWeek(); app.toast(`第${game.s.week}週になりました。`); render(); break;
      case 'offer': sfx('open'); openOffer(game.s.board.find(o => o.id === el.dataset.id)!); break;
    }
  });
  render();
  return () => {};
}

export function openHistory(app: App): void {
  const g = app.game, h = g.s.history;
  const total = h.reduce((t, x) => t + x.profit, 0), next = LEVELS[g.level];
  app.modal(`<h2>実績</h2>
    <div class="stats"><div><small>納品した依頼</small><b>${h.length}件</b></div><div><small>利益の合計</small><b>${yen(total)}</b></div><div><small>★3の納品</small><b>${h.filter(x => x.stars === 3).length}件</b></div><div><small>レベル</small><b>${g.level}</b></div></div>
    ${next ? `<h3>次のレベル(Lv.${next.level})で増えるもの</h3><div class="unlocks"><div>${next.unlocks.map(esc).join(' / ')}</div></div>` : ''}
    <h3>これまでに増えたもの</h3><div class="unlocks">${LEVELS.filter(l => l.level <= g.level).map(l => `<div><b>Lv.${l.level}</b>${l.unlocks.map(esc).join(' / ')}</div>`).join('')}</div>
    <h3>最近の納品</h3>
    ${h.length ? `<table class="hist">${h.slice(0, 12).map(x => `<tr><td>第${x.week}週</td><td>${esc(x.client)}</td><td>${esc(x.title)}</td><td class="st">${stars(x.stars)}</td><td class="${x.profit < 0 ? 'neg' : ''}">${yen(x.profit)}</td></tr>`).join('')}</table>` : '<p class="mute">納品した依頼はまだありません。</p>'}
    <div class="modal-btns"><button class="btn primary" data-act="close">閉じる</button></div>`, { wide: true });
}

export function openSettings(app: App): void {
  const s = app.game.s.settings;
  const m = app.modal(`<h2>設定</h2>
    <label class="f range"><span>効果音の大きさ</span><input type="range" id="vol" min="0" max="1" step="0.05" value="${s.sfx}"></label>
    <label class="f"><span>画面</span><button class="btn" data-act="fullscreen">全画面にする / 戻す</button></label>
    <h3>セーブデータ</h3>
    <button class="btn danger" data-act="wipe">セーブデータを消して最初から始める</button>
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
      else { el.dataset.armed = '1'; el.textContent = 'もう一度押すと消します'; }
    }
  });
}
