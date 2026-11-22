// 受注: 研修と、今週の依頼の一覧
import { Job, KIND_LABEL } from '../core/job';
import { MODEL } from '../core/model';
import { Game, LEVELS, MAX_LEVEL, Offer, PriceMove, STREAK_XP, streakMult, xpFor } from '../game/state';
import { TUTORIALS, tutorialJob } from '../game/tutorial';
import type { App } from './app';
import { setBgm, setVolume, sfx } from './audio';
import { portrait } from './bench';
import { esc, nl2br, onAct, stars, yen } from './dom';
import { guideChips, openGuide } from './guide';

const TABS: [string, string][] = [['hub', '受注'], ['shop', '仕入れ'], ['ware', '倉庫']];

export function statusBar(game: Game, here: string): string {
  const full = Math.floor(game.repStars), half = game.repStars - full >= 0.5;
  return `<header class="bar hubbar">
    <nav class="tabs">${TABS.map(([id, label]) => `<button class="tab ${here === id ? 'on' : ''}" data-act="go-${id}">${label}</button>`).join('')}</nav>
    <div class="lv"><b>Lv.${game.level}</b><span>${esc(game.levelInfo.title)}</span><div class="xpbar small"><i style="width:${Math.round(game.xpProgress * 100)}%"></i></div>
      <small>${game.level >= MAX_LEVEL ? '最高レベル' : `次まで ${xpFor(game.level + 1) - game.s.xp}`}</small></div>
    <div class="rep" title="評判が高いほど契約金が増えます">評判 <span class="repstars">${'★'.repeat(full)}${half ? '<i>★</i>' : ''}<u>${'★'.repeat(5 - full - (half ? 1 : 0))}</u></span></div>
    <div class="week">${game.s.week}週目</div>
    ${game.streak ? `<div class="streak" title="ハードモードで、納期に間に合った納品が続いている回数です。遅れるか、取り下げると0に戻ります。">ハード <b>${game.streak}</b>回連続<i>次は経験値 ×${streakMult(game.streak + 1)}</i></div>` : ''}
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

const moveChip = (x: PriceMove, cls: string) => `<span class="move ${cls}">${MODEL[x.model].short} <s>${yen(x.before)}</s> → <b>${yen(x.now)}</b></span>`;
// 今週の値動き(受注画面の見出しの下に出す1行)
function weekStrip(game: Game): string {
  const { down, up } = game.priceMoves(2);
  const moves = down.length || up.length
    ? `${down.length ? `<span class="mv-h down">値下がり</span>${down.map(x => moveChip(x, 'down')).join('')}` : ''}${up.length ? `<span class="mv-h up">値上がり</span>${up.map(x => moveChip(x, 'up')).join('')}` : ''}`
    : `<span class="mute">${game.s.week === 1 ? '機材の値段は、週が変わるたびに動きます。' : '今週は、機材の値段に大きな動きがありません。'}</span>`;
  return `<div class="week-strip"><b class="wk">〜 ${game.s.week}週目 〜</b><div class="moves">${moves}</div><small>値段は「仕入れ」で確かめられます</small></div>`;
}
/** 週が変わったあと、最初に受注画面を開いたときに出す知らせ。数秒で消え、下のボタンは押せる */
function weekBanner(app: App, root: HTMLElement): void {
  const game = app.game;
  if (!game.tutorialFinished || game.s.weekSeen === game.s.week) return;
  game.s.weekSeen = game.s.week;
  game.save();
  const { down, up } = game.priceMoves(3), fee = game.s.week > 1 ? game.s.lastFee ?? 0 : 0;
  const el = document.createElement('div');
  el.className = 'week-banner';
  el.innerHTML = `<div class="wb-in"><div class="wb-title">〜 ${game.s.week}週目 〜</div>
    <p>${game.s.week === 1 ? '依頼を1件納品すると、次の週になります。週が変わるたびに、依頼と機材の値段が入れ替わります。' : '週が変わり、依頼と機材の値段が入れ替わりました。'}</p>
    ${down.length || up.length ? `<div class="wb-moves">${down.map(x => moveChip(x, 'down')).join('')}${up.map(x => moveChip(x, 'up')).join('')}</div>` : ''}
    <small>${fee ? `倉庫代 ${yen(fee)} を支払いました。` : ''}安い週に仕入れて倉庫に置くと、あとの依頼で使えます。</small></div>`;
  root.querySelector('.hub')?.appendChild(el);
  setTimeout(() => el.remove(), 4600);
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
            <div class="card-learn"><small>この研修で扱うこと</small><ul>${t.learn.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="learn-guide"><img src="./img/p_guide.png" alt=""><span>画面の案内に沿って、${t.steps.length}ステップで進めます。</span></div></div>
            <div class="card-foot"><span>契約金 <b>${yen(tutorialJob(t.id).reward)}</b></span><span>経験値 <b>+${t.xp}</b></span></div></button>`;
        }).join('')}</div>`;
    } else {
      main += `<div class="board-head"><h2>受注</h2><p>今週の依頼です。1件納品すると次の週になり、依頼と機材の値段が入れ替わります。</p>
        <button class="btn" data-act="week">受けずに次の週へ${game.weeklyFee ? `(倉庫代 ${yen(game.weeklyFee)})` : ''}</button></div>
        ${weekStrip(game)}
        <div class="cards">${game.s.board.map(o => {
          const j = game.job(o);
          return `<button class="card" data-act="offer" data-id="${o.id}">
            <div class="card-top"><span>${kindChip(j)}${o.special ? ' <span class="chip regular">常連</span>' : ''}</span>${diffStars(j.difficulty.stars)}</div>
            <div class="card-client"><img src="${portrait(j.industry)}" alt=""><div><b>${esc(j.client)}</b><small>${esc(j.industry)}</small></div></div>
            <h3>${esc(j.title)}</h3>
            <p class="card-brief">${esc(j.brief)}</p>
            <p class="card-sum">${summary(j)}</p>
            <div class="tags">${j.tags.slice(0, 8).map(t => `<i>${esc(t)}</i>`).join('')}</div>
            <div class="card-checks"><small>検収テスト ${j.checks.length}項目</small><ul>${j.checks.map(c => `<li>${esc(c.label)}</li>`).join('')}</ul></div>
            <div class="card-facts"><div><span>難易度の点数</span><b>${j.difficulty.score}点</b></div><div><span>経験値</span><b>+${Math.round(j.xp * 0.8)}〜${Math.round(j.xp * 1.2)}</b></div><div><span>納期(ハードモード)</span><b>${j.minutes}分</b></div></div>
            <div class="card-foot"><span>契約金 <b>${yen(game.rewardOf(j))}</b></span>${j.kind !== 'trouble' ? `<span>新品でそろえた場合の目安: 機材費 ${yen(game.parNow(j))} ・ 利益 <i>${yen(game.rewardOf(j) - game.parNow(j))}</i></span>` : '<span>機材はほとんど要りません</span>'}</div></button>`;
        }).join('')}</div>`;
    }
    root.innerHTML = `<div class="hub">${statusBar(game, 'hub')}<div class="hub-main">${main}</div></div>`;
    weekBanner(app, root);
  }

  function openOffer(o: Offer): void {
    const j = game.job(o), reward = game.rewardOf(j), busy = !!game.s.active, [l3] = game.starLimits(j);
    let challenge = false;
    const chips = guideChips(game, [...j.tags, ...(j.kind === 'trouble' ? ['トラブル対応'] : [])]);
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
            ${chips ? `<h3>関連するガイド<small>読んでから受注できます</small></h3><div class="gchips">${chips}</div>` : ''}
            <h3>お金</h3>
            <div class="cost"><div><span>契約金</span><b>${yen(reward)}</b></div><div><span>前金(受注したときに受け取る)</span><b>${yen(Math.round(reward / 2 / 500) * 500)}</b></div>
              ${j.kind !== 'trouble' ? `<div><span>機材費の目安(今週の値段)</span><b>${yen(game.parNow(j))}</b></div><div><span>★3になる機材費</span><b>${yen(l3)} 以下</b></div>` : ''}<div><span>経験値</span><b>+${Math.round(j.xp * 0.8)}〜${Math.round(j.xp * 1.2)}</b></div></div>
          </div>
        </div>
        <div class="modal-btns">
          <label class="toggle challenge"><input type="checkbox" id="challenge"${challenge ? ' checked' : ''}><i></i><span><b>ハードモード<em>納期 ${j.minutes}分</em></b>間に合うと契約金 +30%、経験値 ×${streakMult(game.streak + 1)}${game.streak ? `(いま${game.streak}回連続)` : ''}。続けて間に合うほど倍率が上がります(最大 ×${STREAK_XP[STREAK_XP.length - 1]})。遅れるか取り下げると、連続は0に戻り、評判が下がります。オフなら時間の制限はありません。</span></label>
          ${busy ? '<span class="mute">作業中の依頼があります。納品するか取り下げると、次の依頼を受けられます。</span>' : ''}
          <button class="btn" data-act="close">閉じる</button><button class="btn primary big" data-act="accept"${busy ? ' disabled' : ''}>受注する</button></div>
      </div>`;
    const m = app.modal(body(), { wide: true });
    m.addEventListener('change', e => { if ((e.target as HTMLElement).id === 'challenge') { challenge = (e.target as HTMLInputElement).checked; sfx('tab'); } });
    onAct(m, (act, el) => {
      if (act === 'accept') { sfx('coin'); game.accept(o, challenge); app.closeModal(); app.show('bench'); }
      // ガイドを読み終えたら、この依頼の詳細に戻る
      if (act === 'guide-to') { sfx('open'); openGuide(app, el.dataset.id, () => openOffer(o)); }
    });
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
      case 'week': sfx('click'); game.nextWeek(); render(); break;
      case 'offer': sfx('open'); openOffer(game.s.board.find(o => o.id === el.dataset.id)!); break;
    }
  });
  render();
  return () => {};
}

export function openHistory(app: App): void {
  const g = app.game, h = g.s.history;
  const t = g.totals, next = LEVELS[g.level];
  const m = app.modal(`<h2>実績</h2>
    <div class="stats"><div><small>納品した依頼</small><b>${t.n}件</b></div><div><small>利益の合計</small><b>${yen(t.profit)}</b></div><div><small>★3の納品</small><b>${t.star3}件</b></div><div><small>レベル</small><b>${g.level}</b></div></div>
    ${next ? `<h3>次のレベル(Lv.${next.level})で増えるもの</h3><div class="unlocks"><div>${next.unlocks.map(esc).join(' / ')}</div></div>` : ''}
    <h3>これまでに増えたもの</h3><div class="unlocks">${LEVELS.filter(l => l.level <= g.level).map(l => `<div><b>Lv.${l.level}</b>${l.unlocks.map(esc).join(' / ')}</div>`).join('')}</div>
    <h3>最近の納品</h3>
    ${h.length ? `<table class="hist">${h.slice(0, 12).map(x => `<tr><td>${x.week}週目</td><td>${esc(x.client)}</td><td>${esc(x.title)}</td><td class="st">${stars(x.stars)}</td><td class="${x.profit < 0 ? 'neg' : ''}">${yen(x.profit)}</td></tr>`).join('')}</table>` : '<p class="mute">納品した依頼はまだありません。</p>'}
    <div class="modal-btns"><button class="btn" data-act="export-log"${g.s.log?.length ? '' : ' disabled'} title="依頼ごとの時間、使ったヘルプ、取り下げた依頼などを、表計算ソフトで開ける形で保存します">プレイの記録を書き出す(${g.s.log?.length ?? 0}件)</button><button class="btn primary" data-act="close">閉じる</button></div>`, { wide: true });
  onAct(m, act => {
    if (act !== 'export-log') return;
    // 先頭の印(BOM)は、表計算ソフトで文字化けしないようにするため
    const url = URL.createObjectURL(new Blob(['\ufeff' + g.logCsv()], { type: 'text/csv' })), link = document.createElement('a');
    link.href = url; link.download = `networkshop-log-week${g.s.week}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    app.toast('プレイの記録を書き出しました。');
  });
}

export function openSettings(app: App): void {
  const s = app.game.s.settings;
  const m = app.modal(`<h2>設定</h2>
    <label class="f range"><span>効果音の大きさ</span><input type="range" id="vol" min="0" max="1" step="0.05" value="${s.sfx}"></label>
    <label class="f range"><span>BGMの大きさ</span><input type="range" id="bgm" min="0" max="1" step="0.05" value="${s.bgm}"></label>
    <label class="f"><span>画面</span><button class="btn" data-act="fullscreen">全画面にする / 戻す</button></label>
    <h3>プレイグラウンド</h3>
    <p class="set-note">お金も依頼もない机です。作中に出てくる機器をどれでも、何台でも置いて、自由に組んで試せます。進行中の依頼、資金、レベルには影響しません。</p>
    <button class="btn primary" data-act="play"${app.current === 'play' ? ' disabled' : ''}>${app.current === 'play' ? 'プレイグラウンドを開いています' : 'プレイグラウンドを開く'}</button>
    <h3>セーブデータ</h3>
    <div class="save-btns"><button class="btn" data-act="save-out">セーブデータを書き出す</button><button class="btn" data-act="save-in">セーブデータを読み込む</button><input type="file" id="save-file" accept=".json,application/json" hidden></div>
    <button class="btn danger" data-act="wipe">セーブデータを消して最初から始める</button>
    <div class="modal-btns"><button class="btn" data-act="title">タイトルへ</button><button class="btn primary" data-act="close">閉じる</button></div>`);
  m.addEventListener('input', e => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'vol') { s.sfx = Number(el.value); setVolume(s.sfx); app.game.save(); sfx('ok'); }
    if (el.id === 'bgm') { s.bgm = Number(el.value); setBgm(s.bgm); app.game.save(); }
  });
  // セーブデータの読み込み: いまのセーブは上書きされる
  m.querySelector<HTMLInputElement>('#save-file')!.addEventListener('change', async e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.v !== 2 || typeof data.money !== 'number' || typeof data.xp !== 'number') throw new Error('形式が違います');
      app.setSave(data); app.game.save();
      app.closeModal(); app.show('hub');
      app.toast(`セーブデータを読み込みました(Lv.${app.game.level})。`);
    } catch { app.toast('このファイルは、セーブデータとして読み込めません。', 'ng'); sfx('ng'); }
  });
  onAct(m, (act, el) => {
    if (act === 'fullscreen') { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); }
    if (act === 'title') { app.closeModal(); app.show('title'); }
    if (act === 'play') { app.closeModal(); app.openPlay(); }
    if (act === 'save-out') {
      const url = URL.createObjectURL(new Blob([JSON.stringify(app.game.s)], { type: 'application/json' })), link = document.createElement('a');
      link.href = url; link.download = `networkshop-save-lv${app.game.level}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (act === 'save-in') m.querySelector<HTMLInputElement>('#save-file')!.click();
    if (act === 'wipe') {
      if (el.dataset.armed) { app.newGame(); app.closeModal(); app.show('title'); }
      else { el.dataset.armed = '1'; el.textContent = 'もう一度押すと消します'; }
    }
  });
}
