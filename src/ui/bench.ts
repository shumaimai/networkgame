// 作業画面: 机の上でネットワークを組み、検収テストを通して納品する
import { CheckResult, evaluate } from '../core/checks';
import { ipStr, parseIp } from '../core/ip';
import { Job, KIND_LABEL, worldCost } from '../core/job';
import { CABLE_PRICE, Device, GwCfg, L3Cfg, MODEL, PortRef, ServerCfg, SVC, SwitchCfg, defaultCfg, dkimKey, fillCfg, isGateway, isHost, linkError, makeDevice } from '../core/model';
import { Net, arpTable, browse, build, reach, resolve, traceroute } from '../core/sim';
import { ReviewItem, review } from '../game/review';
import { Active, Game, HELP_COST, HelpUse, Outcome } from '../game/state';
import { Step, StepCtx, TUTORIALS } from '../game/tutorial';
import type { App } from './app';
import { sfx } from './audio';
import { Desk, Sel } from './desk';
import { guideChips, openGuide } from './guide';
import { $, esc, img, onAct, stars, yen } from './dom';
import { COPY_LABEL, PanelCtx, ROW_TEMPLATE, VALID, cablePanel, copyKeys, copySource, devicePanel, setPath } from './panel';

const PORTRAIT: Record<string, string> = { 会計事務所: 'p_office', 不動産店: 'p_shop', 保育園: 'p_school', 図書館: 'p_design', 事務所: 'p_office', 設計事務所: 'p_design', 店舗: 'p_shop', クリニック: 'p_clinic', 学習塾: 'p_school', 宿泊施設: 'p_hotel', 飲食店: 'p_cafe', 工場: 'p_factory' };
export const portrait = (industry: string): string => img(PORTRAIT[industry] ?? 'p_office');
const THANKS: Record<number, string> = { 3: '「完璧です!またお願いします。」', 2: '「助かりました。ありがとう。」', 1: '「動いてはいますが、少し高くつきましたね。」' };
const HELP_INFO: Record<keyof HelpUse, [string, string]> = {
  plan: ['方針を聞く', 'どんな機材を使い、どう組むかの考え方を教わります。'],
  reasons: ['原因を調べてもらう', '不合格の検収テストごとに、どこで何が起きているかを表示します。'],
  answer: ['答えを見る', '模範解答の構成と設定をすべて見ます。評価(★)も1つ下がります。'],
};
const fmtTime = (ms: number): string => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// 仕様書の中のIPアドレス、ネットワーク、名前、キーを、クリックでコピーできるようにする
const COPY_RE = /(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?|\*?[a-z0-9_-]+(?:\.[a-z0-9_-]+)+|(?<=(?:キー|SSID): )[\w-]+)/g;
// 「192.168.10.0/24」は、アドレスの部分と /24 の部分を分ける。アドレスをクリックすると /24 を除いてコピーし(IPアドレスの欄にそのまま貼れる)、/24 をクリックすると全体をコピーする
const copyable = (html: string): string => html.replace(COPY_RE, v => {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(\/\d{1,2})$/.exec(v);
  return m ? `<span class="cp" data-act="copy" data-v="${m[1]}">${m[1]}</span><span class="cp pre" data-act="copy" data-v="${v}" title="${v} をコピー">${m[2]}</span>` : `<span class="cp" data-act="copy" data-v="${v}">${v}</span>`;
});
// 仕様書の1項目: 改行ごとに段落にする(折り返した行と、次の行を見分けられるようにする)
const specLines = (body: string, copy: boolean): string => body.split('\n').map(l => `<p class="sl">${copy ? copyable(esc(l)) : esc(l)}</p>`).join('');

export function mountBench(app: App, root: HTMLElement): () => void {
  const game: Game = app.game, a: Active = game.s.active!, job: Job = game.activeJob!;
  const world = a.world;
  const tut = job.tutorial ? TUTORIALS.find(t => t.id === job.tutorial)! : null;
  for (const d of world.devices) fillCfg(d);
  let net: Net = build(world.devices, world.cables);
  // 机に置けるお客様の機器。最初から机の上にあるものも、片付けたあとで置き直せる
  const suppliedAll = [...job.supplied, ...job.initial.devices.filter(d => d.own === 'supplied' && !job.supplied.some(x => x.id === d.id)).map(d => ({ id: d.id, model: d.model, name: d.name }))];
  let results: CheckResult[] = [];
  let diagTarget = '', stepIdx = 0, hintStep = -1, hintLevel = 0, pal: { key: string; label: string; kind: string; x0: number; y0: number; moved: boolean } | null = null;
  const diagDone = new Set<string>();
  let firstNg = -2;
  const nameOf = (id: string) => world.devices.find(d => d.id === id)?.name ?? job.supplied.find(s => s.id === id)?.name ?? job.solution.devices.find(d => d.id === id)?.name ?? id;

  root.innerHTML = `
    <div class="bench">
      <header class="bar">
        <button class="btn ghost" data-act="back">◀ 受注へ</button>
        <div class="bar-title"><span class="chip ${job.kind}">${KIND_LABEL[job.kind]}</span><b>${esc(job.client)}</b><span>${esc(job.title)}</span></div>
        <div class="spacer"></div>
        <div id="timer" class="timer hidden"></div>
        <div id="b-money" class="money"></div>
        <button class="btn" data-act="guide">ガイド</button>
        <button class="btn" data-act="help">ヘルプ</button>
        <button class="btn" data-act="menu">…</button>
        <button class="btn primary big" data-act="deliver" disabled>納品する</button>
      </header>
      <aside class="col left">
        <div class="client"><img src="${portrait(job.industry)}" alt=""><div><b>${esc(job.client)}</b><small>${esc(job.industry)}・${esc(job.person)}</small></div></div>
        <div class="brief">${esc(job.brief)}</div>
        ${job.spec.length ? `<h3>仕様書</h3>${tut ? '' : '<p class="spec-hint">アドレスや名前は、クリックでコピーできます。/24 は付きません。</p>'}<div class="spec stack">${job.spec.map(s => `<section><h4>${esc(s.head)}</h4>${specLines(s.body, !tut)}</section>`).join('')}</div>` : ''}
        ${tut ? '' : '<div id="b-guides"></div>'}
        <h3>お金</h3><div id="b-cost" class="cost"></div>
      </aside>
      <section class="center">
        <div class="desk-wrap"><svg id="desk" class="desk"></svg><div id="offnote" class="offnote hidden"></div>
        </div>
        <div id="viewctl" class="viewctl" title="机の空いた場所をドラッグすると動かせます。マウスのホイールでも拡大・縮小できます。">
          <small>空いた場所をドラッグで移動</small>
          <button data-act="pan-left" title="左へ動かす">◀</button><button data-act="pan-up" title="上へ動かす">▲</button><button data-act="pan-down" title="下へ動かす">▼</button><button data-act="pan-right" title="右へ動かす">▶</button>
          <i></i>
          <button data-act="zoom-out" title="縮小">－</button><span id="zoom-pct">100%</span><button data-act="zoom-in" title="拡大">＋</button>
          <button class="wide" data-act="view-reset" title="最初の位置と大きさに戻す">戻す</button>
        </div>
        <div id="coach" class="coach hidden"></div>
        <div class="under">
          <div class="pane"><h3>検収テスト <span id="pass"></span></h3><ul id="checks" class="checks"></ul></div>
          <div class="pane"><h3>コンソール</h3><div id="console" class="console"></div></div>
        </div>
      </section>
      <aside class="col right">
        <div id="palette" class="palette"></div>
        <div id="panel" class="panel"></div>
      </aside>
    </div>
    <div id="ghost" class="drag-ghost hidden"></div><div id="ring" class="ring hidden"></div>`;

  const consoleEl = $('#console', root), panel = $('#panel', root), paletteEl = $('#palette', root), ghost = $('#ghost', root);
  function log(msg: string, cls = ''): void {
    const div = document.createElement('div');
    div.className = 'line ' + cls;
    div.textContent = msg;
    consoleEl.appendChild(div);
    while (consoleEl.children.length > 300) consoleEl.firstChild!.remove();
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  const cableAt = (d: string, p: number) => world.cables.find(c => (c.a.dev === d && c.a.port === p) || (c.b.dev === d && c.b.port === p));
  const dev = (id: string) => world.devices.find(d => d.id === id);

  function link(pa: PortRef, pb: PortRef): boolean {
    const da = dev(pa.dev), db = dev(pb.dev);
    if (!da || !db) return false;
    if (pa.dev === pb.dev) { log('同じ機器のポート同士はつなげません。', 'ng'); sfx('ng'); return false; }
    if (cableAt(pa.dev, pa.port) || cableAt(pb.dev, pb.port)) { log('そのポートは使用中です。', 'ng'); sfx('ng'); return false; }
    const err = linkError(da, pa.port, db, pb.port);
    if (err) { log(err, 'ng'); sfx('ng'); return false; }
    const free = a.spare > 0;
    if (!free && !game.payCable()) { log('資金が足りません(LANケーブル)。', 'ng'); sfx('ng'); return false; }
    if (free) a.spare--;
    // 既設のケーブルと番号が重ならないようにする
    let id = 'c' + a.seq++;
    while (world.cables.some(c => c.id === id)) id = 'c' + a.seq++;
    world.cables.push({ id, a: { ...pa }, b: { ...pb }, free: free || undefined });
    log(`配線: ${da.name} [${da.ports[pa.port]}] ⇔ ${db.name} [${db.ports[pb.port]}]${free ? '(お客様のケーブル)' : ''}`);
    sfx('plug');
    changed();
    return true;
  }
  function removeCable(id: string): void {
    const i = world.cables.findIndex(c => c.id === id);
    if (i < 0) return;
    const c = world.cables.splice(i, 1)[0];
    if (c.free) a.spare++; else game.refundCable();
    if (desk.sel?.kind === 'cable' && desk.sel.id === id) desk.sel = null;
    sfx('unplug');
    changed();
    renderPanel();
  }

  const desk = new Desk($<SVGSVGElement>('#desk', root), {
    get world() { return world; },
    get net() { return net; },
    emptyHint: ['右の機材をここにドラッグして、机の上に並べましょう', '並べたら、ポート(小さな四角)同士をクリックしてLANケーブルでつなぎます'],
    zones: job.zones,
    link, removeCable, log,
    onSelect: () => { renderPanel(); updateCoach(); },
    onMoved: () => game.save(),
    onPortHover: ref => hlPanel(ref && desk.sel?.kind === 'dev' && desk.sel.id === ref.dev ? ref.port : null),
    onView: () => { updateView(); if (tut) placeRing(ringTarget(tut.steps[stepIdx])); },
  });

  // パレットから机へ。key: sup:<機器id> / buy:<型番> / stk:<型番>
  function place(key: string, pos?: { x: number; y: number }): void {
    const [kind, ref] = key.split(':');
    let d: Device;
    if (kind === 'sup') {
      const def = suppliedAll.find(x => x.id === ref);
      if (!def || dev(ref)) return;
      d = makeDevice(def.model, def.id, def.name, 'supplied');
      if (a.shelf[ref]) { d.cfg = a.shelf[ref]; delete a.shelf[ref]; }
      log(`${d.name} を机に置きました。`);
    } else {
      const r = kind === 'buy' ? game.buyDevice(ref) : game.useStock(ref);
      if (typeof r === 'string') { log(r, 'ng'); sfx('ng'); return; }
      d = r;
      log(kind === 'buy' ? `${d.name}(${MODEL[ref].label})を購入しました。${yen(d.cost)}` : `${d.name}(${MODEL[ref].label})を倉庫から出しました。`);
    }
    Object.assign(d, pos ?? desk.autoSpot(d));
    desk.clampPos(d);
    desk.separate(d);
    world.devices.push(d);
    sfx('place');
    desk.sel = { kind: 'dev', id: d.id };
    changed();
    renderPanel();
    desk.reveal(d);
  }
  function removeDevice(id: string): void {
    const d = dev(id);
    if (!d || d.own === 'fixed') return;
    for (const c of world.cables.filter(x => x.a.dev === id || x.b.dev === id)) { if (c.free) a.spare++; else game.refundCable(); }
    world.cables = world.cables.filter(x => x.a.dev !== id && x.b.dev !== id);
    world.devices.splice(world.devices.indexOf(d), 1);
    if (d.own === 'supplied') { a.shelf[id] = d.cfg; log(`${d.name} を机から片付けました。設定は残っています。`); }
    else { game.returnDevice(d); log(d.own === 'bought' ? `${d.name} を返品しました。${yen(d.cost)} 返金` : `${d.name} を倉庫に戻しました。`); }
    desk.sel = null;
    sfx('unplug');
    changed();
    renderPanel();
  }

  // ---------- 表示 ----------
  function changed(): void {
    net = build(world.devices, world.cables);
    const before = results;
    results = evaluate(world, job.checks.map(c => c.check), nameOf);
    if (before.length && results.some((r, i) => r.ok && !before[i].ok)) sfx('pass');
    game.save();
    desk.render();
    renderChecks();
    renderPalette();
    renderMoney();
    updateCoach();
    syncLive();
  }
  // 右下の、表示を動かすボタン: 動かせない向きと、これ以上変えられない拡大率は押せなくする
  function updateView(): void {
    const v = desk.viewInfo(), set = (act: string, on: boolean) => { $<HTMLButtonElement>(`#viewctl [data-act="${act}"]`, root).disabled = !on; };
    set('pan-left', v.left); set('pan-right', v.right); set('pan-up', v.up); set('pan-down', v.down);
    set('zoom-in', v.canIn); set('zoom-out', v.canOut); set('view-reset', !v.home);
    $('#zoom-pct', root).textContent = `${Math.round(v.zoom * 100)}%`;
  }
  function renderChecks(): void {
    const showWhy = a.help.reasons || !!tut;
    const list = $('#checks', root);
    list.innerHTML = job.checks.map((c, i) => {
      const r = results[i];
      return `<li class="${r.ok ? 'ok' : r.hold ? 'hold' : 'ng'}"><span class="badge">${r.ok ? '合格' : r.hold ? '保留' : '不合格'}</span><div>${esc(c.label)}${!r.ok && (showWhy || r.hold) ? `<small>${esc(r.reason)}</small>` : ''}</div></li>`;
    }).join('');
    // 並び順は変えない。最初の不合格の項目が入れ替わったときだけ、その項目が見える位置まで送る
    const first = results.findIndex(r => !r.ok && !r.hold);
    if (first !== firstNg) { firstNg = first; (list.children[first] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }); }
    const n = results.filter(r => r.ok).length, all = n === results.length;
    const stopped = world.devices.filter(d => d.off);
    $('#pass', root).textContent = `${n} / ${results.length}`;
    $('#pass', root).classList.toggle('all', all);
    $<HTMLButtonElement>('[data-act="deliver"]', root).disabled = !all || stopped.length > 0;
    const note = $('#offnote', root);
    note.classList.toggle('hidden', !stopped.length);
    note.innerHTML = stopped.length ? `<b>故障テスト中</b><span>${stopped.map(d => esc(d.name)).join('、')} を止めています。検収テストは、止めた状態での結果です。</span><button class="btn small" data-act="all-on">すべて動かす</button>` : '';
  }
  // 依頼のタグに合うガイドへのボタン。まだ読んでいない項目には印が付く
  function renderGuides(): void {
    const box = root.querySelector('#b-guides');
    if (!box) return;
    const chips = guideChips(game, [...job.tags, ...(job.kind === 'trouble' ? ['トラブル対応'] : [])]);
    box.innerHTML = chips ? `<h3>関連するガイド</h3><div class="gchips">${chips}</div>` : '';
  }
  function renderMoney(): void {
    const cost = worldCost(world), reward = game.rewardOf(job), pen = Math.round(reward * game.helpPenalty), diff = game.stockDiff(world);
    $('#b-money', root).innerHTML = `資金 <b>${yen(game.s.money)}</b>`;
    const [l3] = game.starLimits(job);
    $('#b-cost', root).innerHTML = `
      <div><span>契約金</span><b>${yen(reward)}</b></div>
      ${pen ? `<div class="neg"><span>ヘルプの利用</span><b>${yen(-pen)}</b></div>` : ''}
      <div><span>機材費</span><b>${yen(-cost)}</b></div>
      ${world.devices.some(d => d.own === 'stock') ? `<div class="save ${diff < 0 ? 'up' : ''}" title="在庫品の仕入れ値と、今週の新品の値段の差です。倉庫代は入っていません。"><span>うち在庫品: 今週の新品との差</span><b>${diff === 0 ? '同じ' : `${yen(Math.abs(diff))} ${diff > 0 ? '安い' : '高い'}`}</b></div>` : ''}
      <div class="total"><span>見込み利益</span><b class="${reward - pen - cost < 0 ? 'neg' : ''}">${yen(reward - pen - cost)}</b></div>
      <small>機材費 ${yen(l3)} 以下で ★3${a.challenge ? ` / 納期 ${job.minutes}分` : ''}</small>`;
  }
  const tile = (key: string, kind: string, name: string, sub: string, cls = '') =>
    `<div class="tile ${cls}" data-pal="${key}" data-kind="${kind}" data-label="${esc(name)}"><img src="${img(kind)}" alt="" draggable="false"><div><b>${esc(name)}</b><span>${sub}</span></div></div>`;
  // 在庫の仕入れ値と、今週の新品の値段を並べる。在庫のほうが安ければ、その差を出す
  function stockNote(m: string): string {
    const it = game.s.stock[m], unit = Math.round(it.cost / it.qty), now = game.price(m);
    return `仕入れ値 ${yen(unit)}<br>${unit < now ? `<i class="down">新品より ${yen(now - unit)} 安い</i>` : unit > now ? `<i class="up">新品より ${yen(unit - now)} 高い</i>` : '新品と同じ値段'}`;
  }
  // 「購入」の一覧は閉じられる。トラブル対応では機材をほとんど買わないので、最初は閉じておく
  let buyOpen = job.kind !== 'trouble';
  function renderPalette(): void {
    const waiting = suppliedAll.filter(x => !dev(x.id));
    const stock = Object.keys(game.s.stock);
    let h = '';
    if (job.supplied.length || waiting.length) {
      h += `<h3>お客様の機器<small>机に置く</small></h3>` + (waiting.length
        ? `<div class="tiles">${waiting.map(x => tile('sup:' + x.id, MODEL[x.model].kind, x.name, MODEL[x.model].short)).join('')}</div>`
        : '<div class="done">すべて机に置いてあります。</div>');
    }
    if (stock.length) h += `<h3>倉庫の在庫<small>仕入れ済み</small></h3><div class="tiles">${stock.map(m => tile('stk:' + m, MODEL[m].kind, `${MODEL[m].short} ×${game.stockQty(m)}`, stockNote(m), 'stk')).join('')}</div>`;
    h += `<h3>購入<small>${buyOpen ? '今週の価格' : `${game.catalog.length}種類`}</small><button class="fold" data-act="toggle-buy">${buyOpen ? '閉じる' : '開く'}</button></h3>`;
    if (buyOpen) h += `<div class="tiles">${game.catalog.map(m => {
      const p = game.price(m), mult = game.mult(m);
      return tile('buy:' + m, MODEL[m].kind, MODEL[m].short, `<i class="${mult < 0.95 ? 'down' : mult > 1.05 ? 'up' : ''}">${yen(p)}</i>`, game.s.money < p ? 'poor' : '');
    }).join('')}</div>`;
    h += `<div class="note"><b>LANケーブル</b> ${yen(CABLE_PRICE)}/本${a.spare ? ` ・ <b>お客様のケーブル</b> 残り${a.spare}本(無料)` : ''}</div>`;
    paletteEl.innerHTML = h;
  }
  // 「設定を写す」は、DHCPを習う Lv.3 から出す。それまでは、1台ずつ手で入れることが学ぶ内容になっている
  // トラブル対応では出さない(ボタンに出る項目名で、不具合の場所が分かってしまうため)
  const panelCtx = (): PanelCtx => ({ net, diagTarget, cables: world.cables, devices: world.devices, level: game.level, assist: !tut && game.level >= 3 && job.kind !== 'trouble' });
  let panelDev = '';
  /** 設定パネルの中の「いまの状態」の表示(接続中・未接続、受け取ったアドレスなど)だけを、入力欄はそのままに更新する */
  function syncLive(): void {
    const d = desk.sel?.kind === 'dev' ? dev(desk.sel.id) : null;
    if (!d || d.id !== panelDev) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = devicePanel(d, panelCtx());
    const cur = panel.querySelectorAll<HTMLElement>('[data-live]'), next = tmp.querySelectorAll<HTMLElement>('[data-live]');
    if (cur.length !== next.length) return;
    cur.forEach((el, i) => { if (el.innerHTML !== next[i].innerHTML) el.innerHTML = next[i].innerHTML; if (el.className !== next[i].className) el.className = next[i].className; });
  }
  // 机の上のポートにカーソルが乗ったら、設定パネルの同じポートの欄を強調する
  function hlPanel(port: number | null): void {
    panel.querySelectorAll('.hl').forEach(e => e.classList.remove('hl'));
    if (port == null) return;
    const els = panel.querySelectorAll<HTMLElement>(`[data-port-hl="${port}"]`);
    els.forEach(e => e.classList.add('hl'));
    els[0]?.scrollIntoView({ block: 'nearest' });
  }
  function renderPanel(): void {
    panelDev = '';
    desk.highlightPort(null);
    const s: Sel = desk.sel;
    if (!s) { panel.innerHTML = '<div class="empty">机の上の機器やケーブルをクリックすると、ここに設定が出ます。<br><br>ケーブルを外す: ケーブルを選んで Delete キー、または右クリック。</div>'; return; }
    if (s.kind === 'cable') {
      const c = world.cables.find(x => x.id === s.id);
      panel.innerHTML = c ? cablePanel(c, world.devices) : '';
      return;
    }
    const d = dev(s.id);
    if (!d) { panel.innerHTML = ''; return; }
    const top = panel.scrollTop;
    panel.innerHTML = devicePanel(d, panelCtx());
    panelDev = d.id;
    panel.querySelectorAll<HTMLInputElement>('[data-v]').forEach(validate);
    panel.scrollTop = top;
  }
  function validate(el: HTMLInputElement): void {
    const v = el.value.trim(), fn = VALID[el.dataset.v ?? ''];
    el.classList.toggle('bad', !!v && !!fn && !fn(v));
  }

  // ---------- 診断ツール ----------
  // 使った回数を依頼ごとに残す(納品後の振り返りに出す)
  const count = (kind: string) => { const m = (a.diag ??= {}); m[kind] = (m[kind] ?? 0) + 1; game.save(); };
  function diag(kind: string): void {
    const d = desk.sel?.kind === 'dev' ? dev(desk.sel.id) : null;
    if (!d || d.off) return;
    const target = diagTarget.trim(), tag = `${d.name}> ${kind}${kind === 'ipconfig' || kind === 'arp' ? '' : ' ' + target}`;
    if (kind === 'ipconfig') {
      const e = net.eff.get(d.id)!;
      log(tag, 'cmd');
      log(`   MACアドレス ${d.mac}\n   IPアドレス  ${e.ip != null ? ipStr(e.ip) + ' /' + e.prefix : '(なし)'}${e.dhcp ? (e.ip != null ? `  ※${e.lease} から自動取得` : `  ※取得できず: ${e.note}`) : ''}\n   ゲートウェイ ${e.gw != null ? ipStr(e.gw) : '(なし)'}\n   DNSサーバー ${e.dns != null ? ipStr(e.dns) : '(なし)'}`);
      diagDone.add('ipconfig'); count('ipconfig'); updateCoach();
      return;
    }
    if (kind === 'arp') {
      const t = arpTable(net, d);
      log(tag, 'cmd');
      log(t.length ? t.map(x => `   ${x.ip.padEnd(16)} ${x.mac}${x.dup ? '  ← 同じIPアドレスの機器が複数あります' : ''}`).join('\n') : '   同じネットワークに、ほかの機器が見つかりません。');
      diagDone.add('arp'); count('arp'); updateCoach();
      return;
    }
    if (!target) { log('診断の宛先を入力してください。', 'ng'); return; }
    const tnet = build(world.devices, world.cables, { trace: true });
    let ok = false, text = '';
    const toIp = (): number | null => {
      const ip = parseIp(target);
      if (ip != null) return ip;
      const n = resolve(tnet, d, target);
      if (!n.ok) { text = `失敗: ${n.reason}`; return null; }
      return n.ip;
    };
    if (kind === 'nslookup') {
      const r = resolve(tnet, d, target);
      ok = r.ok; text = r.ok ? ipStr(r.ip) : `失敗: ${r.reason}`;
    } else if (kind === 'web') {
      const r = browse(tnet, d, target);
      ok = r.ok; text = r.ok ? `表示できました(${r.via === 'proxy' ? 'プロキシ経由' : '直接接続'})` : `失敗: ${r.reason}`;
    } else if (kind === 'tracert') {
      const ip = toIp();
      if (ip != null) {
        const r = traceroute(tnet, d, ip);
        ok = r.ok; text = r.hops.map((x, i) => `\n   ${i}  ${x}`).join('') + (r.ok ? '\n   到達しました' : `\n   ここで止まりました: ${r.reason}`);
        reach(tnet, d, ip, { label: 'tracert' });
      }
    } else {
      const ip = toIp();
      if (ip != null) {
        const r = reach(tnet, d, ip, { label: 'ping' });
        ok = r.ok; text = r.ok ? `応答あり(${r.hops.join(' → ')})` : `失敗: ${r.reason}`;
      }
    }
    log(tag, 'cmd');
    if (tnet.trace!.length > 1) for (const t of tnet.trace!) log(`   ${t.label}: ${t.hops.join(' → ')}${t.ok ? '' : ' ✕'}`, 'step');
    log(`   ${text}`, ok ? 'ok' : 'ng');
    sfx(ok ? 'ok' : 'ng');
    // 研修の案内は、どの機器で試して、どうなったかを見る
    for (const k of [kind, `${kind}:${ok ? 'ok' : 'ng'}`, `${kind}:${ok ? 'ok' : 'ng'}@${d.id}`]) diagDone.add(k);
    count(kind);
    void desk.playTrace(tnet.trace!);
    updateCoach();
  }

  // ---------- チュートリアルの案内 ----------
  const coach = $('#coach', root), ring = $('#ring', root);
  function updateCoach(): void {
    if (!tut) return;
    const ctx = stepCtx();
    while (stepIdx < tut.steps.length - 1 && tut.steps[stepIdx].done(ctx)) { stepIdx++; sfx('ok'); }
    const step: Step = tut.steps[stepIdx];
    coach.classList.remove('hidden');
    const hints = step.hints ?? [], shown = hintStep === stepIdx ? Math.min(hintLevel, hints.length) : 0, note = step.note?.(ctx);
    coach.innerHTML = `<img src="${img('p_guide')}" alt=""><div><small>研修 ${TUTORIALS.indexOf(tut) + 1} / ${TUTORIALS.length}「${esc(tut.title)}」 ステップ ${stepIdx + 1} / ${tut.steps.length}</small><p>${esc(step.text)}</p>
      ${note ? `<p class="coach-note">${esc(note)}</p>` : ''}
      ${hints.slice(0, shown).map(x => `<p class="coach-hint">${esc(x)}</p>`).join('')}
      ${shown < hints.length ? `<button class="btn small" data-act="coach-hint">${shown ? 'もう少し詳しく' : 'ヒント'}</button>` : ''}</div>`;
    placeRing(ringTarget(step));
  }
  // 最後のヒントまで見せたときだけ、答えの場所を光らせる
  const stepCtx = (): StepCtx => ({ world, results, diag: diagDone, sel: desk.sel?.kind === 'dev' ? desk.sel.id : null });
  const ringTarget = (st: Step): string | undefined => {
    const t = typeof st.target === 'function' ? st.target(stepCtx()) : st.target;
    return hintStep === stepIdx && st.hints && hintLevel >= st.hints.length ? st.hintTarget ?? t : t;
  };
  let delivered = false;
  function placeRing(sel?: string): void {
    const el = sel && !delivered ? root.querySelector(sel) : null;
    if (!el) { ring.classList.add('hidden'); return; }
    const r = el.getBoundingClientRect(), s = app.stageRect(), k = app.scale, pad = 8;
    Object.assign(ring.style, { left: `${(r.left - s.left) / k - pad}px`, top: `${(r.top - s.top) / k - pad}px`, width: `${r.width / k + pad * 2}px`, height: `${r.height / k + pad * 2}px` });
    ring.classList.remove('hidden');
  }

  // ---------- ヘルプ ----------
  function cfgLines(d: Device): string[] {
    const c = d.cfg, out: string[] = [];
    if (isHost(d.kind)) {
      out.push(c.mode === 'dhcp' ? 'アドレス: 自動取得(DHCP)' : `IP ${c.ip} /${c.prefix}${c.gw ? ` ・ GW ${c.gw}` : ''}${c.dns ? ` ・ DNS ${c.dns}` : ''}`);
      if (c.proxy) out.push(`プロキシ ${c.proxy}`);
      const s = c as ServerCfg;
      if (s.dnsOn) out.push(`DNS: ${s.records.map(r => `${r.name} → ${r.ip}`).join('、') || 'レコードなし'} ・ フォワーダー ${s.forwarder}`);
      if (s.dhcpOn) for (const p of s.pools) out.push(`DHCP: ${p.start}〜${p.end} /${p.prefix} ・ GW ${p.gw || 'なし'} ・ DNS ${p.dns || 'なし'}`);
      if (s.proxyOn) out.push(`プロキシ: ポート ${s.proxyPort}${s.proxyAllow ? ` ・ 許可 ${s.proxyAllow}` : ''}`);
      if (c.noProxy) out.push(`プロキシを使わない宛先 ${c.noProxy}`);
      if (d.kind === 'lb') out.push(`振り分け先 ${c.backends}${c.cert ? ` ・ 証明書 ${c.cert}` : ''}`);
      if (s.webOn) out.push(`Webサービス: オン${s.cert ? ` ・ 証明書 ${s.cert}` : ''}`);
      if (s.rpOn) out.push(`リバースプロキシ: ${s.rpRules.map(r => `${r.host} → ${r.to}`).join('、')} ・ 証明書 ${s.cert}`);
      if (s.mailOn) out.push(`メールサービス: オン${s.dkimOn ? ` ・ DKIM セレクター ${s.dkimSel}(公開鍵は、置いたサーバーの設定画面に出る値を使う。この模範解答では ${dkimKey(d)})` : ''}`);
      if (s.monOn) out.push(`監視: ${s.monTargets}`);
      if (s.fileOn) out.push(`ファイル共有: オン${s.fileAllow ? ` ・ 許可 ${s.fileAllow}` : ''}`);
    } else if (isGateway(d.kind)) {
      const g = c as GwCfg;
      if (!g.nat) out.push('NAT: オフ');
      for (const t of g.tunnels ?? []) out.push(`拠点間VPN: 相手 ${t.peer} ・ キー ${t.key} ・ 相手側のネットワーク ${t.nets}`);
      if (g.vpn?.on) out.push(`リモートアクセスVPN: キー ${g.vpn.key} ・ 配るアドレス ${g.vpn.ip}`);
      g.lan.forEach((l, i) => { if (l.ip) out.push(`${d.kind === 'cloud' ? 'vNET' : d.ports[i + 1]}: ${l.ip} /${l.prefix}${l.vip ? ` ・ 仮想IP ${l.vip}(優先度 ${l.prio})` : ''}${l.dhcpOn ? ` ・ DHCP ${l.dhcpStart}〜${l.dhcpEnd}(DNS ${l.dhcpDns || 'なし'})` : ''}`); });
      for (const f of g.forwards) out.push(`ポート転送: ${SVC[f.svc].label} → ${f.to}`);
    } else if (d.kind === 'l3' || d.kind === 'l2m') {
      const s = c as SwitchCfg;
      out.push('ポートのVLAN: ' + s.portVlan.map((v, i) => `${i + 1}=${s.portMode[i] === 'trunk' ? 'T' : v}`).join(' '));
      if (d.kind === 'l3') for (const v of (c as L3Cfg).svis) out.push(`VLAN${v.vlan}: ${v.ip} /${v.prefix}${v.vip ? ` ・ 仮想IP ${v.vip}(優先度 ${v.prio})` : ''}${v.relay ? ` ・ DHCPリレー ${v.relay}` : ''}`);
    } else if (d.kind === 'internet') {
      for (const z of (c.zone ?? []) as { type: string; name: string; value: string }[]) out.push(`公開DNS: ${z.type} ${z.name} → ${z.value}`);
    } else if (d.kind === 'ap') {
      out.push(`SSID ${c.ssid} ・ 暗号化キー ${c.key}`);
    }
    for (const r of (c.routes ?? []) as { dest: string; via: string }[]) out.push(`ルート: ${r.dest} → ${r.via}`);
    (c.rules ?? []).forEach((r: any, i: number) => out.push(`ルール${i + 1}: ${r.action === 'allow' ? '許可' : '拒否'} ${r.src} → ${r.dst}(${r.svc === 'any' ? 'すべて' : SVC[r.svc as keyof typeof SVC].label})`));
    return out;
  }
  function answerHtml(): string {
    if (job.kind === 'trouble') return `<h3>仕込まれていた不具合</h3><ul class="plain">${job.faults.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`;
    const s = job.solution, n = (id: string) => s.devices.find(d => d.id === id)!;
    return `<h3>模範解答の機器と設定</h3><div class="answer">${s.devices.filter(d => d.kind !== 'wan' && (d.kind !== 'internet' || d.cfg.zone?.length)).map(d => `<div><b>${esc(d.name)}</b> <small>${MODEL[d.model].label}</small><br>${cfgLines(d).map(esc).join('<br>') || '設定なし'}</div>`).join('')}</div>
      <h3>配線</h3><div class="answer wires">${s.cables.map(c => `<span>${esc(n(c.a.dev).name)} [${n(c.a.dev).ports[c.a.port]}] ⇔ ${esc(n(c.b.dev).name)} [${n(c.b.dev).ports[c.b.port]}]</span>`).join('')}</div>`;
  }
  function openHelp(): void {
    const reward = game.rewardOf(job);
    const card = (k: keyof HelpUse) => {
      const used = a.help[k], [title, desc] = HELP_INFO[k];
      return `<div class="help-card${used ? ' used' : ''}"><div><b>${title}</b><p>${desc}</p></div>
        ${used ? '<span class="chip">利用中</span>' : `<button class="btn" data-act="use-help" data-k="${k}">契約金 ${yen(-Math.round(reward * HELP_COST[k]))} で使う</button>`}</div>`;
    };
    const body = () => `<h2>ヘルプ</h2><p class="lead">手がかりを3段階で見られます。使うと、この依頼の契約金が減ります。${tut ? '(研修中は無料です)' : ''}</p>
      ${card('plan')}${a.help.plan ? `<ul class="plain hint">${job.hints.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${card('reasons')}${a.help.reasons ? '<p class="hint">検収テストの不合格の項目に、原因を表示しています。</p>' : ''}
      ${card('answer')}${a.help.answer ? answerHtml() : ''}
      <div class="modal-btns"><button class="btn" data-act="open-guide">ガイドを開く(無料)</button><button class="btn primary" data-act="close">閉じる</button></div>`;
    const m = app.modal(body(), { wide: true });
    onAct(m, (act, el) => {
      if (act === 'use-help') { game.useHelp(el.dataset.k as keyof HelpUse); sfx('open'); m.innerHTML = body(); renderChecks(); renderMoney(); }
      if (act === 'open-guide') { app.closeModal(); openGuide(app); }
    });
  }

  // ---------- 納品 ----------
  function deliver(): void {
    if (world.devices.some(d => d.off)) { log('故障テストで止めている機器があります。動かしてから納品します。', 'ng'); sfx('ng'); return; }
    results = evaluate(world, job.checks.map(c => c.check), nameOf);
    const [limit3] = game.starLimits(job), par0 = a.par ?? job.par;
    const out = game.deliver(results);
    if (!out) { log('まだ合格していない検収テストがあります。', 'ng'); sfx('ng'); return; }
    clearInterval(timer);
    desk.stopAnim();
    // 納品の結果を出している間は、案内の枠を消す
    delivered = true;
    ring.classList.add('hidden');
    const notes = review(job, world, par0, a.diag, { stars: out.stars, limit3, answerUsed: a.help.answer });
    // 納品したあとは、模範解答を無料で見られる
    showResult(app, job, out, notes, tut || job.kind === 'trouble' ? '' : answerHtml());
  }

  // ---------- 入力 ----------
  onAct(root, (act, el) => {
    switch (act) {
      case 'back': sfx('click'); app.show('hub'); break;
      case 'zoom-in': desk.zoomStep(1); sfx('tick'); break;
      case 'zoom-out': desk.zoomStep(-1); sfx('tick'); break;
      case 'view-reset': desk.resetView(); sfx('tick'); break;
      case 'pan-left': desk.panBy(-0.3, 0); sfx('tick'); break;
      case 'pan-right': desk.panBy(0.3, 0); sfx('tick'); break;
      case 'pan-up': desk.panBy(0, -0.3); sfx('tick'); break;
      case 'pan-down': desk.panBy(0, 0.3); sfx('tick'); break;
      case 'step': {
        // 上下のボタン: 数字の欄を1ずつ変える(入力したときと同じ処理に流す)
        const inp = panel.querySelector<HTMLInputElement>(`[data-bind="${el.dataset.for}"]`);
        if (!inp || inp.disabled) break;
        const v = Math.max(Number(inp.min) || 1, Math.min(Number(inp.max) || 4094, (parseInt(inp.value, 10) || 0) + Number(el.dataset.d)));
        if (String(v) === inp.value) break;
        inp.value = String(v);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        sfx('tick');
        break;
      }
      case 'toggle-buy': buyOpen = !buyOpen; sfx('tab'); renderPalette(); break;
      case 'coach-hint': hintLevel = hintStep === stepIdx ? hintLevel + 1 : 1; hintStep = stepIdx; sfx('open'); updateCoach(); break;
      case 'guide': sfx('open'); openGuide(app); break;
      case 'guide-to': sfx('open'); openGuide(app, el.dataset.id, renderGuides); break;
      case 'help': sfx('open'); openHelp(); break;
      case 'deliver': deliver(); break;
      case 'menu': {
        const m = app.modal(`<h2>メニュー</h2>
          <button class="btn wide" data-act="restart">最初からやり直す(購入した機材は返金)</button>
          ${tut ? '<button class="btn wide" data-act="skip">研修をスキップして、依頼を受けはじめる</button>' : '<button class="btn danger wide" data-act="abandon">この依頼を取り下げる(前金を返し、評判が下がる)</button>'}
          <div class="modal-btns"><button class="btn primary" data-act="close">閉じる</button></div>`);
        onAct(m, x => {
          if (x === 'restart') { game.restart(); app.closeModal(); app.show('bench'); }
          if (x === 'abandon') { game.abandon(job.checks.filter((_, i) => results[i] && !results[i].ok).map(c => c.label)); app.closeModal(); app.show('hub'); }
          if (x === 'skip') { game.abandon(); game.skipTutorial(); app.closeModal(); app.show('hub'); }
        });
        break;
      }
      case 'toggle-off': {
        const d = desk.sel?.kind === 'dev' ? dev(desk.sel.id) : null;
        if (!d) break;
        if (d.off) delete d.off; else d.off = true;
        log(d.off ? `故障テスト: ${d.name} を止めました。` : `${d.name} を動かしました。`);
        sfx(d.off ? 'unplug' : 'plug');
        changed(); renderPanel();
        break;
      }
      case 'all-on': for (const d of world.devices) delete d.off; log('止めていた機器をすべて動かしました。'); sfx('plug'); changed(); renderPanel(); break;
      case 'copy-cfg': {
        const d = desk.sel?.kind === 'dev' ? dev(desk.sel.id) : null, from = d ? copySource(d, { devices: world.devices, net }) : null;
        if (!d || !from) break;
        // IPアドレスは機器ごとに違う番号が要るので写さない(同じ番号の機器を増やさないため)
        const names = copyKeys(d, from, true).map(k => COPY_LABEL[k]).join('・');
        for (const k of copyKeys(d, from)) d.cfg[k] = from.cfg[k];
        log(`${from.name} の${names}を ${d.name} に写しました。IPアドレスは写していません。`);
        sfx('ok');
        changed(); renderPanel();
        panel.querySelector<HTMLInputElement>('[data-bind="ip"]')?.focus();
        break;
      }
      case 'copy': {
        const v = el.dataset.v ?? el.textContent ?? '';
        const done = () => app.toast(`コピーしました: ${v.length > 40 ? v.slice(0, 40) + '…' : v}`);
        // 入力欄に貼り付けられるよう、クリップボードに入れる
        navigator.clipboard?.writeText(v).then(done).catch(() => {
          const t = document.createElement('textarea');
          t.value = v; document.body.appendChild(t); t.select();
          try { document.execCommand('copy'); done(); } catch { /* コピーできない環境では何もしない */ }
          t.remove();
        });
        sfx('tick');
        break;
      }
      case 'unplug': if (desk.sel?.kind === 'cable') removeCable(desk.sel.id); break;
      case 'remove': {
        const d = desk.sel?.kind === 'dev' ? dev(desk.sel.id) : null;
        if (!d) break;
        // 設定を入れた購入品・在庫品は、返すと設定が消える。1回目は確かめるだけにする
        const edited = d.own !== 'supplied' && JSON.stringify(d.cfg) !== JSON.stringify(defaultCfg(MODEL[d.model]));
        if (edited && !el.dataset.armed) { el.dataset.armed = '1'; el.classList.add('danger'); el.textContent = `入力した設定が消えます。もう一度押すと${d.own === 'bought' ? '返品します' : '倉庫に戻します'}`; sfx('ng'); break; }
        removeDevice(d.id);
        break;
      }
      case 'diag': diag(el.dataset.diag!); break;
      case 'add': case 'del': case 'up': {
        if (desk.sel?.kind !== 'dev') break;
        const cfg = dev(desk.sel.id)!.cfg, list = (cfg[el.dataset.key!] ??= []) as any[], i = Number(el.dataset.i);
        if (act === 'add') list.push(ROW_TEMPLATE[el.dataset.key!]());
        if (act === 'del') list.splice(i, 1);
        if (act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        sfx('tab');
        changed();
        renderPanel();
        break;
      }
    }
  });
  panel.addEventListener('input', e => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'diag-target') { diagTarget = el.value; return; }
    if (!el.dataset.bind || desk.sel?.kind !== 'dev') return;
    const d = dev(desk.sel.id)!;
    const v = 'trunk' in el.dataset ? (el.checked ? 'trunk' : 'access') : el.type === 'checkbox' ? el.checked : 'num' in el.dataset ? (parseInt(el.value, 10) || 0) : el.value.trim();
    setPath(d.cfg, el.dataset.bind, v);
    validate(el);
    changed();
    if ('rerender' in el.dataset) { sfx('tab'); renderPanel(); }
  });
  // 設定パネルでポートごとの欄にカーソルが乗ったら、机の上の同じポートを強調する
  let hlKey = '';
  panel.addEventListener('pointerover', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-port-hl]'), key = el && desk.sel?.kind === 'dev' ? `${desk.sel.id}:${el.dataset.portHl}` : '';
    if (key === hlKey) return;
    hlKey = key;
    desk.highlightPort(el && desk.sel?.kind === 'dev' ? { dev: desk.sel.id, port: Number(el.dataset.portHl) } : null);
  });
  panel.addEventListener('pointerleave', () => { hlKey = ''; desk.highlightPort(null); });
  panel.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target as HTMLElement).id === 'diag-target') diag('ping'); });

  // パレットの機材をつまむ
  paletteEl.addEventListener('pointerdown', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-pal]');
    if (!t || e.button !== 0) return;
    pal = { key: t.dataset.pal!, kind: t.dataset.kind!, label: t.dataset.label!, x0: e.clientX, y0: e.clientY, moved: false };
    e.preventDefault();
  });
  const onMove = (e: PointerEvent) => {
    if (!pal) return;
    if (!pal.moved && Math.hypot(e.clientX - pal.x0, e.clientY - pal.y0) > 6) {
      pal.moved = true;
      ghost.innerHTML = `<img src="${img(pal.kind)}" alt=""><span>${esc(pal.label)}</span>`;
      ghost.classList.remove('hidden');
    }
    if (pal.moved) { const s = app.stageRect(); ghost.style.left = `${(e.clientX - s.left) / app.scale}px`; ghost.style.top = `${(e.clientY - s.top) / app.scale}px`; }
  };
  const onUp = (e: PointerEvent) => {
    if (!pal) return;
    const p = pal;
    pal = null;
    ghost.classList.add('hidden');
    if (!p.moved) { place(p.key); return; } // クリックだけなら空いている場所へ
    if (desk.contains(document.elementFromPoint(e.clientX, e.clientY))) place(p.key, desk.point(e));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  // 納期のタイマー
  const timerEl = $('#timer', root);
  const tick = () => {
    a.elapsed += 1000;
    if (a.challenge) {
      const left = job.minutes * 60000 - a.elapsed;
      timerEl.classList.remove('hidden');
      timerEl.classList.toggle('late', left < 0);
      timerEl.classList.toggle('soon', left >= 0 && left < 60000);
      timerEl.textContent = left >= 0 ? `納期まで ${fmtTime(left)}` : `納期を ${fmtTime(-left)} 超過`;
    }
    if (a.elapsed % 10000 === 0) game.save();
    if (tut) placeRing(ringTarget(tut.steps[stepIdx]));
  };
  const timer = window.setInterval(tick, 1000);
  if (a.challenge) { a.elapsed -= 1000; tick(); }

  log(`【${KIND_LABEL[job.kind]}】${job.client}「${job.title}」`);
  if (job.kind === 'trouble') log('既設のネットワークに不具合があります。診断ツールで原因を探して直しましょう。');
  if (job.kind === 'migrate') log('机の上は、いま動いているネットワークです。仕様書の「変更内容」のとおりに作り替えます。不合格の検収テストが、これから変える部分です。');
  changed();
  renderPanel();
  renderGuides();
  updateView();
  (window as any).__bench = { place, link, removeDevice, removeCable, diag, changed, desk, world, job, get results() { return results; }, select: (id: string) => desk.select({ kind: 'dev', id }) };

  return () => {
    clearInterval(timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    desk.destroy();
    game.save();
  };
}

function showResult(app: App, job: Job, out: Outcome, notes: ReviewItem[], answer: string): void {
  const game = app.game, up = out.levelAfter > out.levelBefore;
  const m = app.modal(`
    <div class="result${notes.length ? ' two' : ''}">
      <div class="r-main">
      <h2>納品完了</h2>
      <div class="r-client">${esc(job.client)}「${esc(job.title)}」</div>
      <div class="r-stars">${[1, 2, 3].map(i => `<span class="${i <= out.stars ? 'on' : ''}" style="animation-delay:${i * 0.28}s">★</span>`).join('')}</div>
      <div class="r-thanks"><img src="${portrait(job.industry)}" alt=""><p>${THANKS[out.stars]}</p></div>
      <div class="r-table">
        ${out.parts.map(p => `<div><span>${esc(p.label)}</span><b class="${p.amount < 0 ? 'neg' : ''}">${yen(p.amount)}</b></div>`).join('')}
        <div><span>機材費</span><b>${yen(-out.cost)}</b></div>
        <div class="total"><span>利益</span><b class="${out.profit < 0 ? 'neg' : ''}">${yen(out.profit)}</b></div>
      </div>
      <div class="r-meta">
        <span>経験値 <b>+${out.xp}</b></span>
        ${out.repDelta ? `<span>評判 <b class="${out.repDelta < 0 ? 'neg' : ''}">${out.repDelta > 0 ? '+' : ''}${out.repDelta}</b></span>` : ''}
        ${out.onTime === true ? '<span class="good">納期内に納品</span>' : out.onTime === false ? '<span class="neg">納期に間に合わず</span>' : ''}
        <span>資金 <b>${yen(out.final)}</b></span>
      </div>
      <div class="xpbar"><i style="width:${Math.round(game.xpProgress * 100)}%"></i><span>Lv.${game.level} ${esc(game.levelInfo.title)}</span></div>
      ${up ? `<div class="levelup"><b>レベルアップ! Lv.${out.levelAfter}</b><ul>${out.unlocks.map(u => `<li>${esc(u)}</li>`).join('')}</ul><small>機材とガイドのページが増えました。</small></div>` : ''}
      </div>
      ${notes.length ? `<div class="r-review"><h3>振り返り</h3>${notes.map(n => `<div><b>${esc(n.head)}</b><span>${esc(n.body)}</span></div>`).join('')}${answer ? `<details class="r-answer"><summary>模範解答の機器と設定を見る</summary><section>${answer}</section></details>` : ''}</div>` : ''}
      <div class="modal-btns"><button class="btn primary big" data-act="hub">受注へ戻る</button></div>
    </div>`, { locked: true });
  sfx('coin');
  for (let i = 1; i <= out.stars; i++) setTimeout(() => sfx('star'), 250 + i * 280);
  if (up) setTimeout(() => sfx('levelup'), 1500);
  onAct(m, act => { if (act === 'hub') { app.closeModal(); app.show('hub'); } });
}

export { stars };
