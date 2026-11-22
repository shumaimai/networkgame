// 作業画面: 机の上でネットワークを組み、検収テストを通して納品する
import { CheckResult, evaluate } from '../core/checks';
import { ipStr, parseIp } from '../core/ip';
import { Job, worldCost } from '../core/job';
import { CABLE_PRICE, Device, GwCfg, L3Cfg, MODEL, PortRef, ServerCfg, SVC, SwitchCfg, isGateway, isHost, makeDevice } from '../core/model';
import { Net, arpTable, browse, build, reach, resolve, traceroute } from '../core/sim';
import { Active, Game, HELP_COST, HelpUse, Outcome } from '../game/state';
import { Step, TUTORIALS } from '../game/tutorial';
import type { App } from './app';
import { sfx } from './audio';
import { Desk, Sel } from './desk';
import { openGuide } from './guide';
import { $, esc, img, nl2br, onAct, stars, yen } from './dom';
import { ROW_TEMPLATE, VALID, cablePanel, devicePanel, setPath } from './panel';

const PORTRAIT: Record<string, string> = { 会計事務所: 'p_office', 不動産店: 'p_shop', 保育園: 'p_school', 図書館: 'p_design', 事務所: 'p_office', 設計事務所: 'p_design', 店舗: 'p_shop', クリニック: 'p_clinic', 学習塾: 'p_school', 宿泊施設: 'p_hotel', 飲食店: 'p_cafe', 工場: 'p_factory' };
export const portrait = (industry: string): string => img(PORTRAIT[industry] ?? 'p_office');
const THANKS: Record<number, string> = { 3: '「完璧です!またお願いします。」', 2: '「助かりました。ありがとう。」', 1: '「動いてはいますが、少し高くつきましたね。」' };
const HELP_INFO: Record<keyof HelpUse, [string, string]> = {
  plan: ['方針を聞く', 'どんな機材を使い、どう組むかの考え方を教わります。'],
  reasons: ['原因を調べてもらう', '不合格の検収テストごとに、どこで何が起きているかを表示します。'],
  answer: ['答えを見る', '模範解答の構成と設定をすべて見ます。評価(★)も1つ下がります。'],
};
const fmtTime = (ms: number): string => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function mountBench(app: App, root: HTMLElement): () => void {
  const game: Game = app.game, a: Active = game.s.active!, job: Job = game.activeJob!;
  const world = a.world;
  const tut = job.tutorial ? TUTORIALS.find(t => t.id === job.tutorial)! : null;
  let net: Net = build(world.devices, world.cables);
  let results: CheckResult[] = [];
  let diagTarget = '', stepIdx = 0, pal: { key: string; label: string; kind: string; x0: number; y0: number; moved: boolean } | null = null;
  const diagDone = new Set<string>();
  const nameOf = (id: string) => world.devices.find(d => d.id === id)?.name ?? job.supplied.find(s => s.id === id)?.name ?? job.solution.devices.find(d => d.id === id)?.name ?? id;

  root.innerHTML = `
    <div class="bench">
      <header class="bar">
        <button class="btn ghost" data-act="back">◀ 受注へ</button>
        <div class="bar-title"><span class="chip ${job.kind}">${job.kind === 'build' ? '構築' : 'トラブル対応'}</span><b>${esc(job.client)}</b><span>${esc(job.title)}</span></div>
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
        ${job.spec.length ? `<h3>仕様書</h3><table class="spec">${job.spec.map(s => `<tr><th>${esc(s.head)}</th><td>${nl2br(s.body)}</td></tr>`).join('')}</table>` : ''}
        <h3>お金</h3><div id="b-cost" class="cost"></div>
      </aside>
      <section class="center">
        <div class="desk-wrap"><svg id="desk" class="desk"></svg><div id="coach" class="coach hidden"></div></div>
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
    const free = a.spare > 0;
    if (!free && !game.payCable()) { log('資金が足りません(LANケーブル)。', 'ng'); sfx('ng'); return false; }
    if (free) a.spare--;
    world.cables.push({ id: 'c' + a.seq++, a: { ...pa }, b: { ...pb }, free: free || undefined });
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
    link, removeCable, log,
    onSelect: () => { renderPanel(); },
    onMoved: () => game.save(),
  });

  // パレットから机へ。key: sup:<機器id> / buy:<型番> / stk:<型番>
  function place(key: string, pos?: { x: number; y: number }): void {
    const [kind, ref] = key.split(':');
    let d: Device;
    if (kind === 'sup') {
      const def = job.supplied.find(x => x.id === ref);
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
    world.devices.push(d);
    sfx('place');
    desk.sel = { kind: 'dev', id: d.id };
    changed();
    renderPanel();
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
  }
  function renderChecks(): void {
    const showWhy = a.help.reasons || !!tut;
    $('#checks', root).innerHTML = job.checks.map((c, i) => {
      const r = results[i];
      return `<li class="${r.ok ? 'ok' : 'ng'}"><span class="badge">${r.ok ? '合格' : '不合格'}</span><div>${esc(c.label)}${!r.ok && showWhy ? `<small>${esc(r.reason)}</small>` : ''}</div></li>`;
    }).join('');
    const n = results.filter(r => r.ok).length, all = n === results.length;
    $('#pass', root).textContent = `${n} / ${results.length}`;
    $('#pass', root).classList.toggle('all', all);
    $<HTMLButtonElement>('[data-act="deliver"]', root).disabled = !all;
  }
  function renderMoney(): void {
    const cost = worldCost(world), reward = game.rewardOf(job), pen = Math.round(reward * game.helpPenalty);
    $('#b-money', root).innerHTML = `資金 <b>${yen(game.s.money)}</b>`;
    const [l3] = game.starLimits(job);
    $('#b-cost', root).innerHTML = `
      <div><span>契約金</span><b>${yen(reward)}</b></div>
      ${pen ? `<div class="neg"><span>ヘルプの利用</span><b>${yen(-pen)}</b></div>` : ''}
      <div><span>機材費</span><b>${yen(-cost)}</b></div>
      <div class="total"><span>見込み利益</span><b class="${reward - pen - cost < 0 ? 'neg' : ''}">${yen(reward - pen - cost)}</b></div>
      <small>機材費 ${yen(l3)} 以下で ★3${a.challenge ? ` / 納期 ${job.minutes}分` : ''}</small>`;
  }
  const tile = (key: string, kind: string, name: string, sub: string, cls = '') =>
    `<div class="tile ${cls}" data-pal="${key}" data-kind="${kind}" data-label="${esc(name)}"><img src="${img(kind)}" alt="" draggable="false"><div><b>${esc(name)}</b><span>${sub}</span></div></div>`;
  function renderPalette(): void {
    const waiting = job.supplied.filter(x => !dev(x.id));
    const stock = Object.keys(game.s.stock);
    let h = '';
    if (job.supplied.length) {
      h += `<h3>お客様の機器<small>机に置く</small></h3>` + (waiting.length
        ? `<div class="tiles">${waiting.map(x => tile('sup:' + x.id, MODEL[x.model].kind, x.name, MODEL[x.model].short)).join('')}</div>`
        : '<div class="done">すべて机に置いてあります。</div>');
    }
    if (stock.length) h += `<h3>倉庫の在庫<small>仕入れ済み</small></h3><div class="tiles">${stock.map(m => tile('stk:' + m, MODEL[m].kind, MODEL[m].short, `残り ${game.stockQty(m)}`, 'stk')).join('')}</div>`;
    h += `<h3>購入<small>今週の価格</small></h3><div class="tiles">${game.catalog.map(m => {
      const p = game.price(m), mult = game.mult(m);
      return tile('buy:' + m, MODEL[m].kind, MODEL[m].short, `<i class="${mult < 0.95 ? 'down' : mult > 1.05 ? 'up' : ''}">${yen(p)}</i>`, game.s.money < p ? 'poor' : '');
    }).join('')}</div>
      <div class="note"><b>LANケーブル</b> ${yen(CABLE_PRICE)}/本${a.spare ? ` ・ <b>お客様のケーブル</b> 残り${a.spare}本(無料)` : ''}</div>`;
    paletteEl.innerHTML = h;
  }
  function renderPanel(): void {
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
    panel.innerHTML = devicePanel(d, { net, diagTarget, cables: world.cables, devices: world.devices });
    panel.querySelectorAll<HTMLInputElement>('[data-v]').forEach(validate);
    panel.scrollTop = top;
  }
  function validate(el: HTMLInputElement): void {
    const v = el.value.trim(), fn = VALID[el.dataset.v ?? ''];
    el.classList.toggle('bad', !!v && !!fn && !fn(v));
  }

  // ---------- 診断ツール ----------
  function diag(kind: string): void {
    const d = desk.sel?.kind === 'dev' ? dev(desk.sel.id) : null;
    if (!d) return;
    const target = diagTarget.trim(), tag = `${d.name}> ${kind}${kind === 'ipconfig' || kind === 'arp' ? '' : ' ' + target}`;
    if (kind === 'ipconfig') {
      const e = net.eff.get(d.id)!;
      log(tag, 'cmd');
      log(`   MACアドレス ${d.mac}\n   IPアドレス  ${e.ip != null ? ipStr(e.ip) + ' /' + e.prefix : '(なし)'}${e.dhcp ? (e.ip != null ? `  ※${e.lease} から自動取得` : `  ※取得できず: ${e.note}`) : ''}\n   ゲートウェイ ${e.gw != null ? ipStr(e.gw) : '(なし)'}\n   DNSサーバー ${e.dns != null ? ipStr(e.dns) : '(なし)'}`);
      diagDone.add('ipconfig'); updateCoach();
      return;
    }
    if (kind === 'arp') {
      const t = arpTable(net, d);
      log(tag, 'cmd');
      log(t.length ? t.map(x => `   ${x.ip.padEnd(16)} ${x.mac}${x.dup ? '  ← 同じIPアドレスの機器が複数あります' : ''}`).join('\n') : '   同じネットワークに、ほかの機器が見つかりません。');
      diagDone.add('arp'); updateCoach();
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
    diagDone.add(kind); diagDone.add(`${kind}:${ok ? 'ok' : 'ng'}`);
    void desk.playTrace(tnet.trace!);
    updateCoach();
  }

  // ---------- チュートリアルの案内 ----------
  const coach = $('#coach', root), ring = $('#ring', root);
  function updateCoach(): void {
    if (!tut) return;
    const ctx = { world, results, diag: diagDone };
    while (stepIdx < tut.steps.length - 1 && tut.steps[stepIdx].done(ctx)) { stepIdx++; sfx('ok'); }
    const step: Step = tut.steps[stepIdx];
    coach.classList.remove('hidden');
    coach.innerHTML = `<img src="${img('p_guide')}" alt=""><div><small>研修 ${TUTORIALS.indexOf(tut) + 1} / ${TUTORIALS.length}「${esc(tut.title)}」 ステップ ${stepIdx + 1} / ${tut.steps.length}</small><p>${esc(step.text)}</p></div>`;
    placeRing(step.target);
  }
  function placeRing(sel?: string): void {
    const el = sel ? root.querySelector(sel) : null;
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
      if (s.webOn) out.push('Webサービス: オン');
      if (s.fileOn) out.push(`ファイル共有: オン${s.fileAllow ? ` ・ 許可 ${s.fileAllow}` : ''}`);
    } else if (isGateway(d.kind)) {
      const g = c as GwCfg;
      g.lan.forEach((l, i) => { if (l.ip) out.push(`${d.ports[i + 1]}: ${l.ip} /${l.prefix}${l.dhcpOn ? ` ・ DHCP ${l.dhcpStart}〜${l.dhcpEnd}(DNS ${l.dhcpDns || 'なし'})` : ''}`); });
      for (const f of g.forwards) out.push(`ポート転送: ${SVC[f.svc].label} → ${f.to}`);
    } else if (d.kind === 'l3' || d.kind === 'l2m') {
      const s = c as SwitchCfg;
      out.push('ポートのVLAN: ' + s.portVlan.map((v, i) => `${i + 1}=${s.portMode[i] === 'trunk' ? 'T' : v}`).join(' '));
      if (d.kind === 'l3') for (const v of (c as L3Cfg).svis) out.push(`VLAN${v.vlan}: ${v.ip} /${v.prefix}${v.relay ? ` ・ DHCPリレー ${v.relay}` : ''}`);
    }
    for (const r of (c.routes ?? []) as { dest: string; via: string }[]) out.push(`ルート: ${r.dest} → ${r.via}`);
    (c.rules ?? []).forEach((r: any, i: number) => out.push(`ルール${i + 1}: ${r.action === 'allow' ? '許可' : '拒否'} ${r.src} → ${r.dst}(${r.svc === 'any' ? 'すべて' : SVC[r.svc as keyof typeof SVC].label})`));
    return out;
  }
  function answerHtml(): string {
    if (job.kind === 'trouble') return `<h3>仕込まれていた不具合</h3><ul class="plain">${job.faults.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`;
    const s = job.solution, n = (id: string) => s.devices.find(d => d.id === id)!;
    return `<h3>模範解答の機器と設定</h3><div class="answer">${s.devices.filter(d => d.kind !== 'internet').map(d => `<div><b>${esc(d.name)}</b> <small>${MODEL[d.model].label}</small><br>${cfgLines(d).map(esc).join('<br>') || '設定なし'}</div>`).join('')}</div>
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
    results = evaluate(world, job.checks.map(c => c.check), nameOf);
    const out = game.deliver(results);
    if (!out) { log('まだ合格していない検収テストがあります。', 'ng'); sfx('ng'); return; }
    clearInterval(timer);
    desk.stopAnim();
    showResult(app, job, out);
  }

  // ---------- 入力 ----------
  onAct(root, (act, el) => {
    switch (act) {
      case 'back': sfx('click'); app.show('hub'); break;
      case 'guide': sfx('open'); openGuide(app); break;
      case 'help': sfx('open'); openHelp(); break;
      case 'deliver': deliver(); break;
      case 'menu': {
        const m = app.modal(`<h2>メニュー</h2>
          <button class="btn wide" data-act="restart">最初からやり直す(購入した機材は返金)</button>
          ${tut ? '<button class="btn wide" data-act="skip">研修をスキップして、依頼を受けはじめる</button>' : '<button class="btn danger wide" data-act="abandon">この依頼を取り下げる(前金を返し、評判が下がる)</button>'}
          <div class="modal-btns"><button class="btn primary" data-act="close">閉じる</button></div>`);
        onAct(m, x => {
          if (x === 'restart') { game.restart(); app.closeModal(); app.show('bench'); }
          if (x === 'abandon') { game.abandon(); app.closeModal(); app.show('hub'); }
          if (x === 'skip') { game.abandon(); game.skipTutorial(); app.closeModal(); app.show('hub'); }
        });
        break;
      }
      case 'unplug': if (desk.sel?.kind === 'cable') removeCable(desk.sel.id); break;
      case 'remove': if (desk.sel?.kind === 'dev') removeDevice(desk.sel.id); break;
      case 'diag': diag(el.dataset.diag!); break;
      case 'add': case 'del': case 'up': {
        if (desk.sel?.kind !== 'dev') break;
        const list = dev(desk.sel.id)!.cfg[el.dataset.key!] as any[], i = Number(el.dataset.i);
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
    if (tut) placeRing(tut.steps[stepIdx].target);
  };
  const timer = window.setInterval(tick, 1000);
  if (a.challenge) { a.elapsed -= 1000; tick(); }

  log(`【${job.kind === 'build' ? '構築' : 'トラブル対応'}】${job.client}「${job.title}」`);
  if (job.kind === 'trouble') log('既設のネットワークに不具合があります。診断ツールで原因を探して直しましょう。');
  changed();
  renderPanel();
  (window as any).__bench = { place, link, removeDevice, removeCable, diag, changed, desk, world, job, get results() { return results; }, select: (id: string) => desk.select({ kind: 'dev', id }) };

  return () => {
    clearInterval(timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    desk.destroy();
    game.save();
  };
}

function showResult(app: App, job: Job, out: Outcome): void {
  const game = app.game, up = out.levelAfter > out.levelBefore;
  const m = app.modal(`
    <div class="result">
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
      <div class="modal-btns"><button class="btn primary big" data-act="hub">受注へ戻る</button></div>
    </div>`, { locked: true });
  sfx('coin');
  for (let i = 1; i <= out.stars; i++) setTimeout(() => sfx('star'), 250 + i * 280);
  if (up) setTimeout(() => sfx('levelup'), 1500);
  onAct(m, act => { if (act === 'hub') { app.closeModal(); app.show('hub'); } });
}

export { stars };
