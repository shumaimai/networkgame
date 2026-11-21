'use strict';
(() => {
  const SAVE_KEY = 'netgame-v3';
  const START_MONEY = 30000;
  const PREFIXES = [8, 16, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
  const KIND = { build: '構築', trouble: 'トラブル対応' };
  const RANKS = [[21, '匠'], [13, 'ベテラン'], [6, '一人前'], [0, '見習い']];
  const THANKS = { 3: '「完璧です!またお願いします。」', 2: '「助かりました。ありがとう。」', 1: '「動いてはいますが…ちょっと高くつきましたね。」' };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = n => (n < 0 ? '-' : '') + '¥' + Math.abs(n).toLocaleString('ja-JP');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);

  const svg = $('#canvas'), scene = $('#scene'), fx = $('#fx'), panel = $('#panel'), paletteEl = $('#palette'), orderEl = $('#order'),
    footEl = $('#order-foot'), consoleEl = $('#console'), ghost = $('#ghost'), modal = $('#modal'), modalBox = $('#modal-box');

  let W = 1000, H = 600; // 机の論理サイズ。layout() で表示領域に合わせる
  let S = loadSave();
  let level, devices, cables, seq, shelf, spare, hintIdx;
  let sel = null, linkFrom = null, linkGesture = null, drag = null, pal = null, anim = 0;
  let mouse = { x: 0, y: 0 }, results = [], diagTarget = '', modalClosable = true;

  // ---------- セーブ ----------
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s.money === 'number' && s.done && s.works) return s;
    } catch (e) { /* 壊れたセーブは無視して最初から */ }
    return { money: START_MONEY, done: {}, levelId: LEVELS[0].id, works: {}, seenHelp: false };
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* 保存不可の環境でも遊べるようにする */ }
  }
  function save() {
    S.works[level.id] = { devices, cables, seq, shelf, spare };
    persist();
  }

  // ---------- 状態 ----------
  const dev = id => devices.find(d => d.id === id);
  const cableAt = (d, p) => cables.find(c => (c.a.dev === d && c.a.port === p) || (c.b.dev === d && c.b.port === p));
  const cost = () => equipmentCost(devices, cables);
  const funds = () => S.money - cost();
  const doneCount = () => Object.keys(S.done).length;
  const totalStars = () => Object.values(S.done).reduce((s, d) => s + d.stars, 0);
  const rank = () => RANKS.find(([n]) => totalStars() >= n)[1];
  const unlocked = l => doneCount() >= l.need;

  function log(msg, cls = '') {
    const div = document.createElement('div');
    div.className = 'line ' + cls;
    div.textContent = msg;
    consoleEl.appendChild(div);
    while (consoleEl.children.length > 200) consoleEl.firstChild.remove();
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function startLevel(id, fresh) {
    level = LEVELS.find(l => l.id === id && unlocked(l)) || LEVELS[0];
    S.levelId = level.id;
    const w = (!fresh && S.works[level.id]) || initialState(level, W, H);
    ({ devices, cables, seq, shelf, spare } = w);
    devices.forEach(clampPos);
    hintIdx = 0; sel = null; linkFrom = null; drag = null; pal = null;
    stopAnim();
    consoleEl.innerHTML = '';
    log(`【${KIND[level.kind]}】「${level.name}」の依頼を開始しました。契約金 ${yen(level.contract)}`);
    if (level.kind === 'trouble') log('既設のネットワークに不具合があります。診断ツールで原因を探して直しましょう。');
    hideModal();
    changed();
    renderPanel();
  }

  // ---------- 机の上の配置 ----------
  const GEO = {
    pc: { w: 56, h: 44 }, printer: { w: 56, h: 44 }, server: { w: 50, h: 52 },
    l2: { w: 180, h: 36 }, l3: { w: 180, h: 36 }, router: { w: 124, h: 38 }, internet: { w: 130, h: 60 },
  };
  function clampPos(d) {
    const g = GEO[d.type];
    d.x = Math.round(clamp(d.x, g.w / 2 + 26, W - g.w / 2 - 26));
    d.y = Math.round(clamp(d.y, g.h / 2 + 40, H - g.h / 2 - 52));
  }

  // 机の大きさを表示領域に合わせる(横長でも縦長でも机いっぱいに使えるように)
  function layout() {
    const wrap = $('#canvas-wrap'), cw = wrap.clientWidth - 20, ch = wrap.clientHeight - 20;
    if (cw <= 0 || ch <= 0) return;
    W = clamp(Math.round(cw), 900, 1100);
    H = clamp(Math.round(W * ch / cw), 500, 1000);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const [cls, m] of [['wood', 0], ['mat', 18], ['mat-dots', 18]]) {
      const r = svg.querySelector('.' + cls);
      r.setAttribute('x', m); r.setAttribute('y', m);
      r.setAttribute('width', W - m * 2); r.setAttribute('height', H - m * 2);
    }
    if (devices) { devices.forEach(clampPos); renderCanvas(); }
  }

  // 机の上の空いている場所を探す(パレットをクリックしただけのとき用)
  function autoSpot(type) {
    const mid = Math.round(W / 2), swY = Math.max(300, Math.round(H * 0.47));
    const hostRows = [[105, H - 115, 115], [105, H - 220, 115]];
    const rows = {
      pc: hostRows, printer: hostRows,
      server: [[W - 115, swY, -115], [W - 115, swY - 110, -115]],
      router: [[mid, 185, 170], [160, 185, 170]],
      l2: [[Math.round(W * 0.3), swY, 215], [Math.round(W * 0.3), swY - 80, 215]],
      l3: [[mid, swY, 215], [200, swY, 215]],
    }[type];
    const g = GEO[type];
    for (const [x0, y, step] of rows) {
      for (let x = x0; x >= 60 && x <= W - 60; x += step) {
        if (devices.every(d => Math.abs(d.x - x) > (GEO[d.type].w + g.w) / 2 + 12 || Math.abs(d.y - y) > 75)) return { x, y };
      }
    }
    return { x: W / 2, y: H / 2 };
  }

  // パレットから机へ。key: 'sup:<機器id>'(お客様の機器) / 'buy:<種類>'(購入)
  function place(key, pos) {
    const [kind, ref] = key.split(':');
    let d;
    if (kind === 'sup') {
      const def = level.supplied.find(x => x.id === ref);
      if (!def || dev(ref)) return null;
      const p = pos || autoSpot(def.type);
      d = deviceFromDef(def, p.x, p.y);
      if (shelf[ref]) d.cfg = shelf[ref];
      delete shelf[ref];
      log(`${d.name} を机に置きました。`);
    } else {
      const t = TYPES[ref];
      if (!level.shop.includes(ref)) return null;
      if (funds() < t.price) { log(`資金が足りません(${t.label} ${yen(t.price)})`, 'ng'); return null; }
      let n = 1;
      while (devices.some(x => x.name === `${t.prefix}-${n}`)) n++;
      const p = pos || autoSpot(ref);
      d = makeDevice(ref, 'b' + seq++, `${t.prefix}-${n}`, p.x, p.y, 'bought');
      log(`${d.name} を購入して机に置きました(${yen(t.price)})`);
    }
    clampPos(d);
    devices.push(d);
    sel = { kind: 'dev', id: d.id };
    changed();
    renderPanel();
    return d.id;
  }

  function removeDevice(id) {
    const d = dev(id);
    if (!d || d.own === 'fixed') return;
    const gone = cables.filter(c => c.a.dev === id || c.b.dev === id), paid = gone.filter(c => !c.free).length;
    spare += gone.length - paid;
    cables = cables.filter(c => !gone.includes(c));
    devices = devices.filter(x => x.id !== id);
    if (d.own === 'supplied') {
      shelf[id] = d.cfg;
      log(`${d.name} を机から片付けました${paid ? `(ケーブル${paid}本ぶん ${yen(paid * CABLE_PRICE)} を返金)` : ''}。設定は残っています。`);
    } else log(`${d.name} を売却しました(返金 ${yen(TYPES[d.type].price + paid * CABLE_PRICE)})`);
    sel = null;
    changed();
    renderPanel();
  }

  // お客様のケーブルが余っていればそれを使い、なければ購入する
  function connect(a, b) {
    const da = dev(a.dev), db = dev(b.dev);
    if (!da || !db) return false;
    if (a.dev === b.dev) { log('同じ機器のポート同士は接続できません。', 'ng'); return false; }
    if (cableAt(a.dev, a.port) || cableAt(b.dev, b.port)) { log('そのポートは使用中です。', 'ng'); return false; }
    const free = spare > 0;
    if (!free && funds() < CABLE_PRICE) { log('資金が足りません(LANケーブル)', 'ng'); return false; }
    if (free) spare--;
    cables.push({ id: 'c' + seq++, a: { dev: a.dev, port: a.port }, b: { dev: b.dev, port: b.port }, free });
    log(`配線: ${da.name} [${da.ports[a.port]}] ⇔ ${db.name} [${db.ports[b.port]}]${free ? '(お客様のケーブルを使用)' : ''}`);
    return true;
  }

  function removeCable(id) {
    const c = cables.find(x => x.id === id);
    if (!c) return;
    if (c.free) spare++;
    cables = cables.filter(x => x !== c);
    if (sel && sel.kind === 'cable' && sel.id === id) sel = null;
    changed();
    renderPanel();
  }

  function select(s) {
    sel = s;
    renderCanvas();
    renderPanel();
  }

  function changed() {
    save();
    renderCanvas();
    renderOrder();
    renderPalette();
    renderTop();
  }

  // ---------- 機器の絵 ----------
  function portRel(d, i) {
    const g = GEO[d.type];
    if (TYPES[d.type].host) return { x: 0, y: -g.h / 2 - 9, dir: -1 };
    if (d.type === 'internet') return { x: 0, y: g.h / 2 + 9, dir: 1 };
    if (d.type === 'router') return i === 0 ? { x: 0, y: -g.h / 2 - 9, dir: -1 } : { x: i === 1 ? -30 : 30, y: g.h / 2 + 9, dir: 1 };
    return { x: (i - 3.5) * 20, y: g.h / 2 + 9, dir: 1 };
  }
  function portAbs(ref) {
    const d = dev(ref.dev), r = portRel(d, ref.port);
    return { x: d.x + r.x, y: d.y + r.y, dir: r.dir };
  }
  function portLabel(d, i) {
    if (d.type === 'router') return i === 0 ? { text: 'WAN', dx: 11, dy: 3, start: true } : { text: d.ports[i], dx: 0, dy: 17 };
    if (d.type === 'l2') return { text: String(i + 1), dx: 0, dy: 16 };
    if (d.type === 'l3') return { text: String(d.cfg.portVlan[i]), dx: 0, dy: 16 };
    return null;
  }
  const box = (d, tag) => `<rect class="body" x="-90" y="-18" width="180" height="36" rx="6"/><text class="tag" x="-70" y="4">${tag}</text><text class="inname" x="10" y="4">${esc(d.name)}</text>`;
  const ICON = {
    pc: () => `<rect class="body" x="-26" y="-22" width="52" height="32" rx="4"/><rect class="screen" x="-22" y="-18" width="44" height="24" rx="2"/><rect class="body" x="-5" y="10" width="10" height="7"/><rect class="body" x="-16" y="17" width="32" height="5" rx="2"/>`,
    printer: () => `<rect class="paper" x="-15" y="-22" width="30" height="14" rx="1"/><rect class="body" x="-26" y="-11" width="52" height="24" rx="4"/><rect class="paper" x="-15" y="7" width="30" height="15" rx="1"/><circle class="led" cx="18" cy="-3" r="2.5"/>`,
    server: () => `<rect class="body" x="-24" y="-26" width="48" height="52" rx="5"/><line class="slot" x1="-15" y1="-16" x2="15" y2="-16"/><line class="slot" x1="-15" y1="-8" x2="15" y2="-8"/><line class="slot" x1="-15" y1="0" x2="15" y2="0"/><circle class="led" cx="-13" cy="14" r="2.5"/><circle class="led" cx="-5" cy="14" r="2.5"/>`,
    l2: d => box(d, 'L2'),
    l3: d => box(d, 'L3'),
    router: d => `<rect class="body" x="-62" y="-19" width="124" height="38" rx="19"/><text class="tag" x="-42" y="4">RT</text><text class="inname" x="8" y="4">${esc(d.name)}</text>`,
    internet: () => {
      const blobs = s => `<ellipse cx="-32" cy="8" rx="${30 + s}" ry="${20 + s}"/><ellipse cx="0" cy="-8" rx="${36 + s}" ry="${22 + s}"/><ellipse cx="34" cy="8" rx="${30 + s}" ry="${20 + s}"/><ellipse cx="0" cy="12" rx="${34 + s}" ry="${16 + s}"/>`;
      return `<g class="outline">${blobs(1.5)}</g><g class="body">${blobs(0)}</g><text class="cname" x="0" y="3">Internet</text><text class="csub" x="0" y="17">公開DNS ${Sim.PUBLIC_DNS}</text>`;
    },
  };
  const mini = type => {
    const g = GEO[type];
    return `<svg class="mini dev t-${type}" viewBox="${-g.w / 2 - 4} ${-g.h / 2 - 4} ${g.w + 8} ${g.h + 8}">${ICON[type]({ name: '' })}</svg>`;
  };
  const services = d => [d.cfg.dnsOn && 'DNS', d.cfg.proxyOn && 'プロキシ'].filter(Boolean).join(' + ');

  function infoLines(d) {
    const c = d.cfg;
    if (d.type === 'router') {
      const l = c.lan.map((x, i) => (x.ip ? `LAN${i + 1} ${x.ip}/${x.prefix}` : null)).filter(Boolean);
      return l.length ? l : ['LAN未設定'];
    }
    if (d.type === 'l3') {
      const l = c.svis.filter(s => s.ip).map(s => `VLAN${s.vlan} ${s.ip}/${s.prefix}`);
      return l.length ? l : ['VLAN IFなし(L2動作)'];
    }
    return [];
  }

  function devSvg(d) {
    const g = GEO[d.type], host = TYPES[d.type].host, isServer = d.type === 'server';
    const isSel = sel && sel.kind === 'dev' && sel.id === d.id;
    let h = `<g class="dev t-${d.type}${isSel ? ' sel' : ''}" data-dev="${d.id}" transform="translate(${d.x},${d.y})">`;
    h += `<rect class="selbox" x="${-g.w / 2 - 10}" y="${-g.h / 2 - 20}" width="${g.w + 20}" height="${g.h + (isServer ? 66 : host ? 54 : 52)}" rx="8"/>`;
    h += ICON[d.type](d);
    d.ports.forEach((name, i) => {
      const p = portRel(d, i), used = !!cableAt(d.id, i);
      const act = linkFrom && linkFrom.dev === d.id && linkFrom.port === i;
      h += `<rect class="port${used ? ' used' : ''}${act ? ' active' : ''}" data-port="${d.id}:${i}" x="${p.x - 7}" y="${p.y - 7}" width="14" height="14" rx="3"><title>${esc(d.name)} ${esc(name)}</title></rect>`;
      const lab = portLabel(d, i);
      if (lab) h += `<text class="plabel${lab.start ? ' start' : ''}" x="${p.x + lab.dx}" y="${p.y + lab.dy}">${esc(lab.text)}</text>`;
    });
    if (host) {
      let y = g.h / 2 + 14;
      h += `<text class="dname" y="${y}">${esc(d.name)}</text>`;
      if (isServer) {
        y += 12;
        const s = services(d);
        h += `<text class="drole${s ? '' : ' none'}" y="${y}">${s || 'サービス停止中'}</text>`;
      }
      y += 13;
      h += d.cfg.ip ? `<text class="dip" y="${y}">${esc(d.cfg.ip)}/${d.cfg.prefix}</text>` : `<text class="dip warn" y="${y}">IP未設定</text>`;
    } else {
      const lines = infoLines(d);
      // L3スイッチは箱の上、ルーターは右横に設定内容を出す
      lines.forEach((t, i) => {
        h += d.type === 'l3'
          ? `<text class="dip side" x="${-g.w / 2 + 2}" y="${-g.h / 2 - 7 - (lines.length - 1 - i) * 12}">${esc(t)}</text>`
          : `<text class="dip side" x="${g.w / 2 + 12}" y="${-(lines.length - 1) * 6 + i * 12 + 3}">${esc(t)}</text>`;
      });
    }
    return h + '</g>';
  }

  function cablePath(c) {
    const a = portAbs(c.a), b = portAbs(c.b);
    const k = clamp(Math.hypot(a.x - b.x, a.y - b.y) * 0.45, 24, 90);
    return `M${a.x},${a.y} C${a.x},${a.y + a.dir * k} ${b.x},${b.y + b.dir * k} ${b.x},${b.y}`;
  }

  // ---------- 描画 ----------
  function renderCanvas() {
    let h = '';
    if (!devices.some(d => d.own !== 'fixed')) {
      h += `<text class="empty-hint" x="${W / 2}" y="${H / 2 + 10}">右の機材をここにドラッグして、机の上に並べましょう</text><text class="empty-sub" x="${W / 2}" y="${H / 2 + 34}">並べたら、ポート(小さな四角)同士をクリックしてLANケーブルでつなぎます</text>`;
    }
    for (const c of cables) {
      const p = cablePath(c), isSel = sel && sel.kind === 'cable' && sel.id === c.id;
      h += `<g class="cable${isSel ? ' sel' : ''}" data-cable="${c.id}"><path class="hit" d="${p}"/><path class="wire" d="${p}"/></g>`;
    }
    for (const d of devices) h += devSvg(d);
    if (linkFrom) {
      const p = portAbs(linkFrom);
      h += `<line class="rubber" x1="${p.x}" y1="${p.y}" x2="${mouse.x}" y2="${mouse.y}"/>`;
    }
    scene.innerHTML = h;
  }

  function renderTop() {
    $('#order-title').textContent = `【${KIND[level.kind]}】${level.name} — ${level.title}`;
    $('#rank').innerHTML = `ランク <b>${rank()}</b> ★${totalStars()}`;
    const f = $('#funds');
    f.textContent = '資金 ' + yen(funds());
    f.classList.toggle('minus', funds() < 0);
  }

  function renderOrder() {
    results = Sim.evaluate(devices, cables, level);
    const allOk = results.every(r => r.ok), c = cost(), profit = level.contract - c;
    orderEl.innerHTML = `
      <div class="client">${esc(level.name)}<span class="kind ${level.kind}">${KIND[level.kind]}</span><small>${esc(level.title)}</small></div>
      <div class="brief">${esc(level.brief)}</div>
      <h3>納品条件</h3>
      <ul class="reqs">${level.reqs.map((q, i) => `<li class="${results[i].ok ? 'ok' : 'ng'}"><span class="badge">${results[i].ok ? 'OK' : 'NG'}</span><div>${esc(q.label)}${results[i].ok ? '' : `<small>${esc(results[i].reason)}</small>`}</div></li>`).join('')}</ul>`;
    footEl.innerHTML = `
      <div class="money">
        <div>契約金</div><div>${yen(level.contract)}</div>
        <div>機材費</div><div>${yen(-c)}</div>
        <div class="total">見込み利益</div><div class="total${profit < 0 ? ' neg' : ''}">${yen(profit)}</div>
      </div>
      <div class="btns">
        <button class="primary" data-act="deliver" ${allOk ? '' : 'disabled'}>納品する</button>
        <button data-act="hint">ヒント</button>
        <button data-act="reset">やり直す</button>
      </div>`;
  }

  function renderPalette() {
    const waiting = level.supplied.filter(x => !dev(x.id));
    let h = `<h3>お客様の機器<small>机に置く(無料)</small></h3>`;
    h += waiting.length
      ? `<div class="tiles">${waiting.map(x => `<div class="tile" data-pal="sup:${x.id}" data-type="${x.type}" data-label="${esc(x.name)}" title="${esc(TYPES[x.type].desc)}">${mini(x.type)}<div><b>${esc(x.name)}</b><span>${TYPES[x.type].label}</span></div></div>`).join('')}</div>`
      : '<div class="done">すべて机に置いてあります。</div>';
    h += `<h3>購入する機材<small>ドラッグで机へ</small></h3><div class="tiles">${level.shop.map(t => {
      const T = TYPES[t];
      return `<div class="tile${funds() < T.price ? ' poor' : ''}" data-pal="buy:${t}" data-type="${t}" data-label="${T.label}" title="${esc(T.desc)}">${mini(t)}<div><b>${T.label}</b><span class="price">${yen(T.price)}</span></div></div>`;
    }).join('')}</div>`;
    h += `<div class="note"><b>LANケーブル</b> ${yen(CABLE_PRICE)}/本 — ポート(小さな四角)をクリックし、続けて接続先のポートをクリック。${spare ? `<br><b>お客様のケーブル</b> 残り${spare}本(無料で使えます)` : ''}</div>`;
    paletteEl.innerHTML = h;
  }

  // ---------- 設定パネル ----------
  const getPath = (o, path) => path.split('.').reduce((x, k) => x[k], o);
  function setPath(o, path, v) {
    const ks = path.split('.'), last = ks.pop();
    ks.reduce((x, k) => x[k], o)[last] = v;
  }
  const VALID = {
    ip: v => IP.parse(v) != null,
    cidr: v => IP.parseCidr(v) != null,
    host: v => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v),
    proxy: v => /^.+:\d+$/.test(v),
    list: v => v.split(/[\s,、]+/).filter(Boolean).every(x => IP.parseCidr(x)),
  };
  function validate(el) {
    const v = el.value.trim(), fn = VALID[el.dataset.v];
    el.classList.toggle('bad', !!v && !!fn && !fn(v));
  }
  const ROW_TEMPLATE = { routes: { dest: '', via: '' }, deny: { src: '', dst: '' }, svis: { vlan: 10, ip: '', prefix: 24 }, records: { name: '', ip: '' } };
  const OWN_LABEL = { fixed: '据え付けの設備', supplied: 'お客様の機器' };

  function renderPanel() {
    if (!sel) {
      panel.innerHTML = '<div class="empty">机の上の機器やケーブルをクリックすると、ここに設定が表示されます。<br><br>ケーブルを外す: ケーブルを選んで Delete キー、または右クリック。</div>';
      return;
    }
    if (sel.kind === 'cable') {
      const c = cables.find(x => x.id === sel.id), a = dev(c.a.dev), b = dev(c.b.dev);
      panel.innerHTML = `<h2>LANケーブル</h2><div class="sub">${c.free ? 'お客様のケーブル' : '購入品 ' + yen(CABLE_PRICE)}</div>
        <h3>接続</h3><div class="info">${esc(a.name)} [${esc(a.ports[c.a.port])}]<br>⇔ ${esc(b.name)} [${esc(b.ports[c.b.port])}]</div>
        <button class="danger sell" data-act="unplug">ケーブルを外す${c.free ? '' : '(返金)'}</button>`;
      return;
    }
    const d = dev(sel.id), t = TYPES[d.type], c = d.cfg;
    const field = (label, path, v, ph = '') => `<label><span>${label}</span><input data-bind="${path}" data-v="${v}" value="${esc(getPath(c, path))}" placeholder="${ph}" spellcheck="false" autocomplete="off"></label>`;
    const toggle = (path, label) => `<label class="toggle"><input type="checkbox" data-bind="${path}"${c[path] ? ' checked' : ''}><span>${label}</span></label>`;
    const maskSel = (path, short) => `<select data-bind="${path}" data-num>${PREFIXES.map(p => `<option value="${p}"${Number(getPath(c, path)) === p ? ' selected' : ''}>${short ? '' : IP.str(IP.mask(p)) + ' '}/${p}</option>`).join('')}</select>`;
    const mask = path => `<label><span>サブネットマスク</span>${maskSel(path)}</label>`;
    const rows = (key, [k1, ph1, v1], [k2, ph2, v2], head, addLabel) => `<div class="colhead"><span>${head[0]}</span><span></span><span>${head[1]}</span><span></span></div>` + c[key].map((r, i) => `<div class="rowline"><input data-bind="${key}.${i}.${k1}" data-v="${v1}" value="${esc(r[k1])}" placeholder="${ph1}" spellcheck="false"><span class="arrow">→</span><input data-bind="${key}.${i}.${k2}" data-v="${v2}" value="${esc(r[k2])}" placeholder="${ph2}" spellcheck="false"><button class="x" data-act="del" data-key="${key}" data-i="${i}">×</button></div>`).join('') + `<button class="add" data-act="add" data-key="${key}">+ ${addLabel}</button>`;
    const routes = () => '<h3>スタティックルート</h3>' + rows('routes', ['dest', '192.168.10.0/24', 'cidr'], ['via', '中継先のIP', 'ip'], ['宛先ネットワーク', 'ネクストホップ'], 'ルートを追加');
    const deny = () => '<h3>通信拒否ルール</h3>' + rows('deny', ['src', '送信元 例 192.168.50.0/24', 'cidr'], ['dst', '宛先', 'cidr'], ['送信元', '宛先'], '拒否ルールを追加');

    let h = `<h2>${esc(d.name)}</h2><div class="sub">${t.label} / ${d.own === 'bought' ? '購入品 ' + yen(t.price) : OWN_LABEL[d.own]}</div>`;
    switch (d.type) {
      case 'pc':
        h += '<h3>ネットワーク設定</h3>' + field('IPアドレス', 'ip', 'ip', '192.168.1.10') + mask('prefix') + field('ゲートウェイ', 'gw', 'ip', '空欄可') + field('DNSサーバー', 'dns', 'ip', '空欄可')
          + '<h3>Webプロキシ</h3>' + field('プロキシ', 'proxy', 'proxy', 'アドレス:ポート(空欄=使わない)');
        break;
      case 'printer':
        h += '<h3>ネットワーク設定</h3>' + field('IPアドレス', 'ip', 'ip', '192.168.1.200') + mask('prefix') + field('ゲートウェイ', 'gw', 'ip', '空欄可');
        break;
      case 'server':
        h += '<h3>ネットワーク設定</h3>' + field('IPアドレス', 'ip', 'ip') + mask('prefix') + field('ゲートウェイ', 'gw', 'ip')
          + field('参照DNS', 'dns', 'ip', c.dnsOn ? '空欄=自分のDNSサービス' : 'このサーバーが使うDNS')
          + '<h3>DNSサービス</h3>' + toggle('dnsOn', 'DNSサービスを動かす');
        if (c.dnsOn) {
          h += '<div style="height:8px"></div>' + rows('records', ['name', 'printer.example.local', 'host'], ['ip', 'IPアドレス', 'ip'], ['名前(レコード)', 'IPアドレス'], 'レコードを追加')
            + '<div style="height:8px"></div>' + field('フォワーダー', 'forwarder', 'ip', `例 ${Sim.PUBLIC_DNS}`)
            + '<div class="info">登録した名前はこのサーバーが答えます。それ以外(Webサイトなど)はフォワーダーへ転送して調べるため、サーバー自身がそこへ通信できる必要があります。</div>';
        }
        h += '<h3>プロキシサービス</h3>' + toggle('proxyOn', 'プロキシサービスを動かす');
        if (c.proxyOn) {
          h += '<div style="height:8px"></div>'
            + `<label><span>待受ポート</span><input type="number" min="1" max="65535" data-bind="proxyPort" data-num value="${esc(c.proxyPort)}"></label>`
            + field('利用を許可', 'proxyAllow', 'list', '空欄=すべて 例 192.168.10.0/24')
            + '<div class="info">PCの代わりにWebサイトへアクセスします。このサーバー自身が名前解決(参照DNS)とインターネット接続をできる必要があります。</div>';
        }
        break;
      case 'l2':
        h += '<h3>説明</h3><div class="info">設定は不要です。つないだ機器はすべて同じネットワーク(ブロードキャストドメイン)になります。</div>';
        break;
      case 'l3':
        h += '<h3>ポートのVLAN</h3><div class="vlans">' + c.portVlan.map((v, i) => `<label><span>ポート${i + 1}</span><input type="number" min="1" max="4094" data-bind="portVlan.${i}" data-num value="${esc(v)}"></label>`).join('') + '</div>'
          + '<h3>VLANインターフェース</h3><div class="colhead svi"><span>VLAN</span><span>IPアドレス</span><span>マスク</span><span></span></div>'
          + c.svis.map((s, i) => `<div class="rowline svi"><input type="number" min="1" max="4094" data-bind="svis.${i}.vlan" data-num value="${esc(s.vlan)}"><input data-bind="svis.${i}.ip" data-v="ip" value="${esc(s.ip)}" placeholder="192.168.10.254" spellcheck="false">${maskSel(`svis.${i}.prefix`, true)}<button class="x" data-act="del" data-key="svis" data-i="${i}">×</button></div>`).join('')
          + '<button class="add" data-act="add" data-key="svis">+ VLANインターフェースを追加</button>'
          + '<div class="info" style="margin-top:8px">同じVLANのポート同士は同じネットワークです。VLANインターフェースにIPを設定すると、そのIPが各機器のゲートウェイになり、VLAN間を中継します。</div>'
          + routes() + deny();
        break;
      case 'router':
        h += `<h3>WAN(インターネット側)</h3><div class="info">ISPから自動取得: <code>${Sim.WAN}</code><br>デフォルトルート: WAN / NAT: 有効</div>`
          + '<h3>LAN1</h3>' + field('IPアドレス', 'lan.0.ip', 'ip', '192.168.1.1') + mask('lan.0.prefix')
          + '<h3>LAN2</h3>' + field('IPアドレス', 'lan.1.ip', 'ip', '未使用なら空欄') + mask('lan.1.prefix')
          + routes()
          + '<h3>ファイアウォール(Webへの直接通信)</h3>'
          + `<label><span>許可する送信元</span><select data-bind="fwMode"><option value="all"${c.fwMode === 'all' ? ' selected' : ''}>すべて許可</option><option value="list"${c.fwMode === 'list' ? ' selected' : ''}>指定した送信元のみ</option></select></label>`
          + field('許可リスト', 'fwAllow', 'list', '例 192.168.1.80, 192.168.50.0/24')
          + deny();
        break;
      case 'internet':
        h += `<h3>説明</h3><div class="info">契約済みのインターネット回線です。ルーターの <code>WAN</code> ポートに接続してください。<br>公開DNS: <code>${Sim.PUBLIC_DNS}</code><br>Webサイト: ${Object.keys(Sim.EXTERNAL).map(n => `<code>${n}</code>`).join(' ')}</div>`;
        break;
    }
    if (t.host) {
      const canName = d.type !== 'printer';
      h += `<h3>診断ツール</h3><div class="diag"><input id="diag-target" value="${esc(diagTarget)}" placeholder="${canName ? 'IPアドレス または ホスト名' : 'IPアドレス'}" spellcheck="false" autocomplete="off"><div class="row"><button data-act="diag" data-kind="ping">ping</button>${canName ? '<button data-act="diag" data-kind="nslookup">nslookup</button>' : ''}${d.type === 'pc' ? '<button data-act="diag" data-kind="web">Web閲覧</button>' : ''}</div></div>`;
    }
    if (d.own === 'bought') h += '<button class="danger sell" data-act="remove">売却する(返金)</button>';
    if (d.own === 'supplied') h += '<button class="sell" data-act="remove">机から片付ける</button>';
    panel.innerHTML = h;
    panel.querySelectorAll('[data-v]').forEach(validate);
  }

  // 診断ツール。結果をログに出し、通信の流れを机の上でアニメーションする
  function diag(kind) {
    const d = dev(sel.id), target = diagTarget.trim();
    if (!target) { log('診断の宛先を入力してください。', 'ng'); return; }
    const net = Sim.build(devices, cables, { trace: true }), tag = `[${d.name}] ${kind} ${target}`;
    let r, text;
    if (kind === 'nslookup') { r = Sim.resolve(net, d, target); text = x => IP.str(x.ip); }
    else if (kind === 'web') { r = Sim.web(net, d, target); text = x => `表示できました(${x.via === 'proxy' ? 'プロキシ経由' : '直接接続'})`; }
    else {
      let ip = IP.parse(target);
      if (ip == null) {
        const n = Sim.resolve(net, d, target);
        if (n.ok) ip = n.ip; else r = n;
      }
      if (!r) { r = Sim.reach(net, d, ip, { label: 'ping' }); text = x => `応答あり(経路: ${x.hops.join(' → ')})`; }
    }
    if (net.trace.length > 1) for (const t of net.trace) log(`   ${t.label}: ${t.hops.join(' → ')}${t.ok ? '' : ' ✕'}`, 'step');
    log(r.ok ? `${tag} → ${text(r)}` : `${tag} → 失敗: ${r.reason}`, r.ok ? 'ok' : 'ng');
    playTrace(net.trace);
  }

  // ---------- パケットのアニメーション ----------
  // 描画フレームを待つ。フレームが間引かれる環境でも止まらないよう、タイマーと早い方で進める
  const frame = () => new Promise(r => { const t = setTimeout(r, 34); requestAnimationFrame(() => { clearTimeout(t); r(); }); });
  function stopAnim() { anim++; fx.innerHTML = ''; }

  async function playTrace(trace) {
    stopAnim();
    const token = anim;
    for (const t of trace) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('r', 6);
      for (const [segs, rep] of [[t.path, false], [t.back, true]]) {
        dot.setAttribute('class', `packet k-${t.kind}${rep ? ' rep' : ''}`);
        for (const s of segs) {
          const wire = scene.querySelector(`[data-cable="${s.cable}"] .wire`);
          if (!wire) continue;
          // 途中で机の上が描き直されても動き続けられるよう、先に軌跡を点列にしておく
          const len = wire.getTotalLength(), N = 16, pts = [];
          for (let i = 0; i <= N; i++) pts.push(wire.getPointAtLength(len * i / N));
          const dur = clamp(len * 0.9, 110, 280), t0 = performance.now();
          fx.appendChild(dot);
          for (;;) {
            if (token !== anim) return;
            const k = Math.min(1, (performance.now() - t0) / dur), f = (s.rev ? 1 - k : k) * N;
            const i = Math.min(N - 1, Math.floor(f)), u = f - i;
            dot.setAttribute('cx', pts[i].x + (pts[i + 1].x - pts[i].x) * u);
            dot.setAttribute('cy', pts[i].y + (pts[i + 1].y - pts[i].y) * u);
            if (k >= 1) break;
            await frame();
          }
        }
      }
      dot.remove();
      if (!t.ok) {
        const d = dev(t.failAt);
        if (d) {
          const g = document.createElementNS(SVG_NS, 'g');
          g.setAttribute('class', 'failmark');
          g.setAttribute('transform', `translate(${d.x},${d.y})`);
          g.innerHTML = '<circle r="17"/><path d="M-7,-7 L7,7 M7,-7 L-7,7"/>';
          fx.appendChild(g);
          setTimeout(() => g.remove(), 1500);
        }
        return;
      }
    }
  }

  // ---------- 納品 ----------
  function deliver() {
    results = Sim.evaluate(devices, cables, level);
    if (!results.every(r => r.ok)) { log('まだ満たしていない納品条件があります。', 'ng'); return false; }
    const c = cost(), profit = level.contract - c;
    const st = c <= level.par ? 3 : c <= level.par * 1.3 + 3000 ? 2 : 1;
    const prev = S.done[level.id];
    if (!prev) S.money += profit;
    S.done[level.id] = { stars: Math.max(st, prev ? prev.stars : 0), profit: prev ? Math.max(profit, prev.profit) : profit };
    delete S.works[level.id];
    persist();
    stopAnim();
    $('#funds').textContent = '資金 ' + yen(S.money);
    $('#rank').innerHTML = `ランク <b>${rank()}</b> ★${totalStars()}`;
    const fresh = LEVELS.filter(l => !S.done[l.id] && unlocked(l));
    showModal(`<h2>納品完了 — ${esc(level.name)}</h2>
      <div class="stars">${stars(st)}</div>
      <p class="thanks">${THANKS[st]}</p>
      <div class="result">
        <div>契約金</div><div>${yen(level.contract)}</div>
        <div>機材費</div><div>${yen(-c)}</div>
        <div class="total">利益</div><div class="total">${yen(profit)}</div>
      </div>
      <p>${prev ? '再納品のため、資金は変動しません(記録のみ更新)。' : `資金が ${yen(S.money)} になりました。`}${st < 3 ? `<br>機材費を ${yen(level.par)} 以下に抑えると ★3 です。` : ''}
      ${doneCount() === LEVELS.length ? '<br>すべての依頼を納品しました。お疲れさまでした!' : fresh.length ? `<br>受付中の依頼が ${fresh.length} 件あります。` : ''}</p>
      <div class="modal-btns">
        <button data-act="level" data-id="${level.id}" data-fresh="1">もう一度</button>
        <button class="primary" data-act="board">依頼ボードへ</button>
      </div>`, false);
    return true;
  }

  // ---------- モーダル ----------
  function showModal(html, closable = true) {
    modalClosable = closable;
    modalBox.innerHTML = html;
    modal.classList.remove('hidden');
  }
  function hideModal() { modal.classList.add('hidden'); }

  function showBoard() {
    // 納品直後(机の上は納品済み)は、依頼を選ぶまで閉じられないようにする
    const mustPick = !modal.classList.contains('hidden') && !modalClosable, n = doneCount();
    showModal(`<h2>依頼ボード</h2><div class="rankline">ランク <b>${rank()}</b> / 納品 ${n}件 / 評価 ★${totalStars()}</div>` + LEVELS.map(l => {
      const done = S.done[l.id], open = unlocked(l);
      return `<button class="lv${l.id === level.id ? ' cur' : ''}" ${open ? `data-act="level" data-id="${l.id}"` : 'disabled'}><span class="kind ${l.kind}">${KIND[l.kind]}</span><span class="nm">${esc(l.name)}<small>${esc(open ? l.title : '???')}</small></span><span class="ct">${yen(l.contract)}</span><span class="st${done ? '' : ' none'}">${done ? stars(done.stars) : open ? '受付中' : `あと${l.need - n}件で解放`}</span></button>`;
    }).join('') + `<div class="modal-btns"><button class="danger" data-act="wipe">セーブデータを消去</button>${mustPick ? '' : '<button data-act="close">閉じる</button>'}</div>`, !mustPick);
  }

  function showHelp() {
    showModal(`<h2>遊び方</h2>
      <p>あなたはネットワーク屋さんです。依頼ボードから仕事を選び、お客様の要望どおりのネットワークを納品して報酬を受け取ります。</p>
      <ol>
        <li>右の<b>機材パレット</b>から、お客様のPCやプリンタ、購入するスイッチ・ルーター・サーバーを<b>机にドラッグ</b>して並べます。</li>
        <li>機器の<b>ポート(小さな四角)</b>をクリックし、続けて接続先のポートをクリックして<b>LANケーブル</b>でつなぎます(ドラッグでも可)。</li>
        <li>机の上の機器をクリックすると右下に<b>設定</b>が開きます。IPアドレス、ゲートウェイ、DNS、プロキシなどを設定します。</li>
        <li>左の<b>納品条件</b>がすべて OK になったら「納品する」を押します。</li>
      </ol>
      <ul>
        <li><b>構築</b>の依頼は空の机から組み上げます。<b>トラブル対応</b>の依頼は、既設のネットワークの不具合を探して直します。</li>
        <li><b>サーバー</b>にはDNSサービス(レコード登録・フォワーダー)とプロキシサービス(待受ポート・利用許可)を立てられます。</li>
        <li>PCやサーバーの<b>診断ツール</b>(ping / nslookup / Web閲覧)を使うと、通信が机の上を流れ、どこで止まったかが分かります。</li>
        <li>機材費が安いほど利益と評価(★)が上がります。機材は売却すれば全額返金されます。</li>
        <li>ケーブルは選択して Delete キー、または右クリックで外せます。</li>
      </ul>
      <div class="modal-btns"><button class="primary" data-act="close">はじめる</button></div>`);
  }

  // ---------- 入力 ----------
  function svgPoint(e) {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  const portRef = el => { const [d, p] = el.dataset.port.split(':'); return { dev: d, port: Number(p) }; };

  // 配線先を決める。機器本体を指した場合は空きポートを自動で選ぶ(ポートに意味がある機器は除く)
  function linkTarget(el, from) {
    const pe = el && el.closest && el.closest('[data-port]');
    if (pe) return portRef(pe);
    const de = el && el.closest && el.closest('[data-dev]');
    if (!de || de.dataset.dev === from.dev) return null;
    const d = dev(de.dataset.dev);
    if (d.type === 'router' || d.type === 'l3') { log(`${d.name} は接続するポートを直接クリックしてください。`, 'ng'); return null; }
    const p = d.ports.findIndex((_, i) => !cableAt(d.id, i));
    if (p < 0) { log(`${d.name} に空きポートがありません。`, 'ng'); return null; }
    return { dev: d.id, port: p };
  }

  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    mouse = svgPoint(e);
    const pe = e.target.closest('[data-port]');
    if (linkFrom) {
      const from = linkFrom, t = linkTarget(e.target, from);
      linkFrom = null;
      if (t && !(t.dev === from.dev && t.port === from.port)) { connect(from, t); changed(); return; }
      if (pe) { renderCanvas(); return; }
    }
    if (pe) {
      const ref = portRef(pe), c = cableAt(ref.dev, ref.port);
      if (c) select({ kind: 'cable', id: c.id });
      else { linkFrom = ref; linkGesture = { x: mouse.x, y: mouse.y }; renderCanvas(); }
      e.preventDefault();
      return;
    }
    const de = e.target.closest('[data-dev]');
    if (de) {
      const d = dev(de.dataset.dev);
      select({ kind: 'dev', id: d.id });
      drag = { id: d.id, dx: mouse.x - d.x, dy: mouse.y - d.y };
      e.preventDefault();
      return;
    }
    const ce = e.target.closest('[data-cable]');
    select(ce ? { kind: 'cable', id: ce.dataset.cable } : null);
  });

  // パレットの機材をつまむ
  paletteEl.addEventListener('pointerdown', e => {
    const t = e.target.closest('[data-pal]');
    if (!t || e.button !== 0) return;
    pal = { key: t.dataset.pal, type: t.dataset.type, label: t.dataset.label, x0: e.clientX, y0: e.clientY, moved: false };
    e.preventDefault();
  });

  window.addEventListener('pointermove', e => {
    if (pal) {
      if (!pal.moved && Math.hypot(e.clientX - pal.x0, e.clientY - pal.y0) > 6) {
        pal.moved = true;
        ghost.innerHTML = mini(pal.type) + `<span>${esc(pal.label)}</span>`;
        ghost.classList.remove('hidden');
      }
      if (pal.moved) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
    } else if (drag) {
      const p = svgPoint(e), d = dev(drag.id);
      d.x = p.x - drag.dx;
      d.y = p.y - drag.dy;
      clampPos(d);
      renderCanvas();
    } else if (linkFrom) {
      mouse = svgPoint(e);
      const r = scene.querySelector('.rubber');
      if (r) { r.setAttribute('x2', mouse.x); r.setAttribute('y2', mouse.y); }
    }
  });

  window.addEventListener('pointerup', e => {
    if (pal) {
      const p = pal;
      pal = null;
      ghost.classList.add('hidden');
      if (!p.moved) { place(p.key); return; } // クリックだけなら空いている場所へ
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && svg.contains(el)) place(p.key, svgPoint(e));
      return;
    }
    if (drag) { drag = null; save(); return; }
    if (!linkFrom || !linkGesture) return;
    const p = svgPoint(e), moved = Math.hypot(p.x - linkGesture.x, p.y - linkGesture.y) > 10;
    linkGesture = null;
    if (!moved) return; // クリック操作: 接続先のクリックを待つ
    const from = linkFrom, t = linkTarget(document.elementFromPoint(e.clientX, e.clientY), from);
    linkFrom = null;
    if (t) connect(from, t);
    changed();
  });

  svg.addEventListener('contextmenu', e => {
    const ce = e.target.closest('[data-cable]');
    if (!ce) return;
    e.preventDefault();
    removeCable(ce.dataset.cable);
  });

  window.addEventListener('keydown', e => {
    if (!modal.classList.contains('hidden')) {
      if (e.key === 'Escape' && modalClosable) hideModal();
      return;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement ? document.activeElement.tagName : '')) return;
    if (e.key === 'Escape' && linkFrom) { linkFrom = null; renderCanvas(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel.kind === 'cable') removeCable(sel.id);
  });

  panel.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'diag-target') { diagTarget = el.value; return; }
    if (!el.dataset.bind || !sel || sel.kind !== 'dev') return;
    const toggle = el.type === 'checkbox';
    setPath(dev(sel.id).cfg, el.dataset.bind, toggle ? el.checked : 'num' in el.dataset ? (parseInt(el.value, 10) || 0) : el.value.trim());
    validate(el);
    changed();
    if (toggle) renderPanel(); // サービスのオン/オフで設定項目が変わる
  });
  panel.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'diag-target') diag('ping');
  });
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'unplug') return removeCable(sel.id);
    if (act === 'remove') return removeDevice(sel.id);
    if (act === 'diag') return diag(b.dataset.kind);
    const list = dev(sel.id).cfg[b.dataset.key];
    if (act === 'add') list.push({ ...ROW_TEMPLATE[b.dataset.key] });
    if (act === 'del') list.splice(Number(b.dataset.i), 1);
    changed();
    renderPanel();
  });

  $('#left').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'deliver') deliver();
    if (b.dataset.act === 'reset') { startLevel(level.id, true); log('最初の状態に戻しました(購入した機材は全額返金)。'); }
    if (b.dataset.act === 'hint') {
      log(`ヒント ${hintIdx % level.hints.length + 1}/${level.hints.length}: ${level.hints[hintIdx % level.hints.length]}`, 'hint');
      hintIdx++;
    }
  });

  modal.addEventListener('click', e => {
    if (e.target === modal && modalClosable) return hideModal();
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') hideModal();
    if (act === 'board') showBoard();
    if (act === 'level') startLevel(b.dataset.id, !!b.dataset.fresh);
    if (act === 'wipe') {
      if (b.dataset.armed) resetAll();
      else { b.dataset.armed = '1'; b.textContent = 'もう一度押すと消去します'; }
    }
  });

  $('#btn-levels').addEventListener('click', showBoard);
  $('#btn-help').addEventListener('click', showHelp);

  function resetAll() {
    S = { money: START_MONEY, done: {}, levelId: LEVELS[0].id, works: {}, seenHelp: true };
    startLevel(LEVELS[0].id, true);
    log('セーブデータを消去しました。');
  }

  // ---------- 起動 ----------
  layout();
  window.addEventListener('resize', () => { layout(); save(); });
  startLevel(S.levelId, false);
  if (!S.seenHelp) { S.seenHelp = true; persist(); showHelp(); }

  // テスト・デバッグ用
  window.Game = {
    startLevel, place, deliver, resetAll, changed, cost, funds,
    put: (id, x, y) => place('sup:' + id, x == null ? undefined : { x, y }),
    buy: (type, x, y) => place('buy:' + type, x == null ? undefined : { x, y }),
    remove: removeDevice,
    connect: (a, pa, b, pb) => connect({ dev: a, port: pa }, { dev: b, port: pb }),
    unplug: (d, p) => { const c = cableAt(d, p); if (c) removeCable(c.id); },
    select: id => select({ kind: 'dev', id }),
    device: id => dev(id),
    devices: () => devices,
    cables: () => cables,
    spare: () => spare,
    results: () => results,
    state: () => S,
    size: () => ({ W, H }),
  };
})();
