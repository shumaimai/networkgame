'use strict';
// ネットワークシミュレータ(画面に依存しない)
// L2: ケーブル/L2スイッチ/同一VLANのL3スイッチポートを同じセグメントとして扱う
// L3: ホストのゲートウェイ、ルーター/L3スイッチの経路表、NAT、ファイアウォール、拒否ルールを評価する
// サービス: サーバー機のDNS(レコード・フォワーダー)とプロキシ(待受ポート・利用許可)
const Sim = (() => {
  const WAN_IP = IP.parse('203.0.113.2'), ISP_IP = IP.parse('203.0.113.1'), WAN_PREFIX = 30;
  const PUBLIC_DNS = '8.8.8.8';
  const EXTERNAL = {
    'www.example.com': '93.184.216.34',
    'mail.example.net': '198.51.100.25',
    'update.example.org': '198.51.100.80',
  };
  const WEB_PROBE = IP.parse(EXTERNAL['www.example.com']);

  const isHost = d => !!TYPES[d.type].host;
  const hasDns = d => d.type === 'server' && !!d.cfg.dnsOn;
  const hasProxy = d => d.type === 'server' && !!d.cfg.proxyOn;
  const isRouting = d => d.type === 'router' || d.type === 'l3' || d.type === 'internet';
  const fail = (reason, extra) => ({ ok: false, reason, ...extra });
  const cidrList = s => String(s || '').split(/[\s,、]+/).filter(Boolean).map(IP.parseCidr).filter(Boolean);
  const inCidr = (ip, c) => IP.inNet(ip, c.ip, c.prefix);
  const proxyAllows = (px, ip) => { const l = cidrList(px.cfg.proxyAllow); return !l.length || l.some(c => inCidr(ip, c)); };

  // opts.trace: true にすると reach() ごとの物理経路を net.trace に記録する(パケットのアニメーション用)
  function build(devices, cables, opts = {}) {
    const parent = {}, adj = {};
    const find = k => {
      if (!(k in parent)) parent[k] = k;
      while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
      return k;
    };
    const key = (d, i) => d + ':' + i;
    const link = (a, b, cable, rev) => {
      parent[find(a)] = find(b);
      (adj[a] = adj[a] || []).push({ to: b, cable, rev });
      (adj[b] = adj[b] || []).push({ to: a, cable, rev: !rev });
    };

    for (const c of cables) link(key(c.a.dev, c.a.port), key(c.b.dev, c.b.port), c.id, false);
    for (const d of devices) {
      if (d.type === 'l2') d.ports.forEach((_, i) => link(key(d.id, i), 'hub:' + d.id, null, false));
      if (d.type === 'l3') d.cfg.portVlan.forEach((v, i) => link(key(d.id, i), 'hub:' + d.id + ':' + Number(v), null, false));
    }

    const ifaces = [];
    const add = (dev, name, ports, ip, prefix) => {
      if (typeof ip === 'string') ip = IP.parse(ip);
      if (ip == null || !ports.length) return;
      const keys = ports.map(i => key(dev.id, i));
      ifaces.push({ dev, name, ip, prefix: Number(prefix), ports: keys, seg: find(keys[0]) });
    };
    for (const d of devices) {
      const c = d.cfg;
      if (isHost(d)) add(d, 'eth0', [0], c.ip, c.prefix);
      else if (d.type === 'internet') add(d, 'ISP', [0], ISP_IP, WAN_PREFIX);
      else if (d.type === 'router') {
        add(d, 'WAN', [0], WAN_IP, WAN_PREFIX);
        c.lan.forEach((l, i) => add(d, 'LAN' + (i + 1), [i + 1], l.ip, l.prefix));
      } else if (d.type === 'l3') {
        for (const s of c.svis) {
          const ports = c.portVlan.map((v, i) => (Number(v) === Number(s.vlan) ? i : -1)).filter(i => i >= 0);
          add(d, 'VLAN' + s.vlan, ports, s.ip, s.prefix);
        }
      }
    }
    return { devices, ifaces, adj, trace: opts.trace ? [] : null };
  }

  const ifs = (net, dev) => net.ifaces.filter(i => i.dev === dev);
  const owns = (net, dev, ip) => net.ifaces.some(i => i.dev === dev && i.ip === ip);
  const neighbors = (net, iface, ip) => net.ifaces.filter(i => i !== iface && i.seg === iface.seg && i.ip === ip);

  // インターフェース a から b まで、実際に通るケーブルの並びを求める
  function physPath(net, a, b) {
    const goal = new Set(b.ports), prev = new Map(a.ports.map(p => [p, null])), queue = a.ports.slice();
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      if (goal.has(cur)) {
        const path = [];
        for (let e = prev.get(cur); e; e = prev.get(e.from)) if (e.cable) path.unshift({ cable: e.cable, rev: e.rev });
        return path;
      }
      for (const e of net.adj[cur] || []) {
        if (!prev.has(e.to)) { prev.set(e.to, { from: cur, cable: e.cable, rev: e.rev }); queue.push(e.to); }
      }
    }
    return [];
  }

  // dev から dst へ送るときの出力インターフェースと次の中継先を決める
  function lookup(net, dev, dst) {
    const list = ifs(net, dev);
    if (isHost(dev)) {
      const i = list[0];
      if (!i) return { err: `${dev.name} にIPアドレスが設定されていません` };
      if (IP.inNet(dst, i.ip, i.prefix)) return { iface: i, hop: dst, direct: true };
      const gw = IP.parse(dev.cfg.gw);
      if (gw == null) return { err: `${dev.name} にデフォルトゲートウェイが設定されていません` };
      if (!IP.inNet(gw, i.ip, i.prefix)) return { err: `${dev.name} のゲートウェイ ${dev.cfg.gw} は自分のネットワークの外です` };
      return { iface: i, hop: gw };
    }
    let best = null;
    const cand = (len, r) => { if (!best || len > best.len) best = { len, ...r }; };
    for (const i of list) if (IP.inNet(dst, i.ip, i.prefix)) cand(i.prefix + 0.5, { iface: i, hop: dst, direct: true });
    for (const r of dev.cfg.routes || []) {
      const c = IP.parseCidr(r.dest), via = IP.parse(r.via);
      if (!c || via == null || !inCidr(dst, c)) continue;
      const out = list.find(i => IP.inNet(via, i.ip, i.prefix));
      if (out) cand(c.prefix, { iface: out, hop: via });
    }
    if (dev.type === 'router' && !IP.isPrivate(dst)) cand(-1, { iface: list.find(i => i.name === 'WAN'), hop: ISP_IP, wan: true });
    return best || { err: `${dev.name} に ${IP.str(dst)} への経路がありません` };
  }

  // 片方向にパケットを送る。path は通ったケーブル、失敗時の at は止まった機器
  function send(net, src, srcIp, dst, opts = {}) {
    const hops = [src.name], path = [];
    let cur = src, nat = null, natAt = 0;
    const stop = reason => fail(reason, { hops, path, at: cur.id });
    for (let ttl = 0; ttl < 16; ttl++) {
      if (owns(net, cur, dst)) return { ok: true, end: cur, hops, path, nat, natAt };
      if (cur.type === 'internet') {
        const ii = ifs(net, cur)[0];
        if (!IP.inNet(dst, ii.ip, ii.prefix)) {
          if (IP.isPrivate(dst)) return stop('インターネット上ではプライベートアドレス宛の通信は破棄されます(NATが必要)');
          return { ok: true, end: cur, hops, path, nat, natAt };
        }
      }
      if (cur !== src) {
        if (!isRouting(cur)) return stop(`${cur.name} はルーターではないため中継できません(ゲートウェイの指定先を確認)`);
        if (!opts.back && (cur.cfg.deny || []).some(r => {
          const s = IP.parseCidr(r.src), d = IP.parseCidr(r.dst);
          return s && d && inCidr(srcIp, s) && inCidr(dst, d);
        })) return stop(`${cur.name} の通信拒否ルールで遮断されました`);
      }
      const r = lookup(net, cur, dst);
      if (r.err) return stop(r.err);
      if (cur.type === 'router' && r.iface.name === 'WAN') {
        if (opts.web && !opts.back && cur.cfg.fwMode === 'list' && !cidrList(cur.cfg.fwAllow).some(c => inCidr(srcIp, c))) {
          return stop(`${cur.name} のファイアウォールが ${IP.str(srcIp)} からのWeb直接通信を遮断しました`);
        }
        nat = cur;
        natAt = path.length;
      }
      const n = neighbors(net, r.iface, r.hop);
      if (n.length > 1) return stop(`IPアドレス ${IP.str(r.hop)} が重複しています(${n.map(i => i.dev.name).join(' / ')})`);
      if (!n.length) {
        if (r.wan) return stop(`${cur.name} のWANポートがインターネット回線につながっていません`);
        if (r.direct) return stop(`${cur.name} と同じネットワーク上に ${IP.str(r.hop)} が見つかりません(配線・IP・VLANを確認)`);
        return stop(`${cur.name} から${isHost(cur) ? 'ゲートウェイ' : '中継先'} ${IP.str(r.hop)} に届きません(配線・IPを確認)`);
      }
      path.push(...physPath(net, r.iface, n[0]));
      cur = n[0].dev;
      hops.push(cur.name);
    }
    return stop('経路がループしています(ルートの設定を確認)');
  }

  // 往復の疎通確認(行き + 戻り)
  function reach(net, src, dst, opts = {}) {
    const res = (() => {
      const early = reason => fail(reason, { hops: [src.name], path: [], back: [], failAt: src.id });
      const si = ifs(net, src)[0];
      if (!si) return early(`${src.name} にIPアドレスが設定されていません`);
      if (!IP.isHostAddr(si.ip, si.prefix)) return early(`${src.name} のIP ${IP.str(si.ip)} はネットワーク/ブロードキャストアドレスのため使えません`);
      const dup = neighbors(net, si, si.ip);
      if (dup.length) return early(`${src.name} のIP ${IP.str(si.ip)} が ${dup[0].dev.name} と重複しています`);
      const f = send(net, src, si.ip, dst, opts);
      if (!f.ok) return fail(f.reason, { hops: f.hops, path: f.path, back: [], failAt: f.at });
      // NATした場合、戻りはインターネットからルーターまで来た道を逆にたどり、そこから送信元へ向かう
      const b = send(net, f.nat || f.end, dst, si.ip, { back: true });
      const wan = f.nat ? f.path.slice(f.natAt).reverse().map(x => ({ cable: x.cable, rev: !x.rev })) : [];
      if (!b.ok) return fail(`行きは届きますが、戻りの通信が失敗: ${b.reason}`, { hops: f.hops, path: f.path, back: wan.concat(b.path), failAt: b.at });
      return { ok: true, end: f.end, hops: f.hops, path: f.path, back: wan.concat(b.path) };
    })();
    if (net.trace) net.trace.push({ label: opts.label || 'ping', kind: opts.kind || 'ping', ...res });
    return res;
  }

  // 名前解決。src が参照DNSを持たず自分でDNSサービスを動かしていれば、自分に問い合わせる
  function resolve(net, src, name) {
    name = String(name).trim().toLowerCase();
    const dnsIp = IP.parse(src.cfg.dns);
    if (dnsIp == null) return hasDns(src) ? lookupOn(net, src, name, 0) : fail(`${src.name} にDNSサーバーが設定されていません`);
    const r = reach(net, src, dnsIp, { label: 'DNS問い合わせ', kind: 'dns' });
    if (!r.ok) return fail(`DNSサーバー ${src.cfg.dns} に届きません: ${r.reason}`);
    return answer(net, r.end, IP.str(dnsIp), name, 0);
  }
  function answer(net, server, addr, name, depth) {
    if (server.type === 'internet') {
      if (addr !== PUBLIC_DNS) return fail(`${addr} はDNSサーバーではありません`);
      if (!EXTERNAL[name]) return fail(`公開DNSは ${name} を知りません(社内の名前は社内のDNSサーバーに登録します)`);
      return { ok: true, ip: IP.parse(EXTERNAL[name]) };
    }
    if (!hasDns(server)) return fail(`${server.name} ではDNSサービスが動いていません`);
    return lookupOn(net, server, name, depth);
  }
  function lookupOn(net, server, name, depth) {
    const rec = (server.cfg.records || []).find(r => String(r.name).trim().toLowerCase() === name);
    if (rec) {
      const ip = IP.parse(rec.ip);
      return ip == null ? fail(`${server.name} の ${name} のレコードに正しいIPアドレスが入っていません`) : { ok: true, ip };
    }
    const fwd = IP.parse(server.cfg.forwarder);
    if (fwd == null) return fail(`${server.name} に ${name} のレコードがなく、フォワーダー(外部の名前の転送先)も未設定です`);
    if (depth >= 3) return fail('DNSの転送がループしています');
    const f = reach(net, server, fwd, { label: 'DNS転送', kind: 'dns' });
    if (!f.ok) return fail(`${server.name} がフォワーダー ${server.cfg.forwarder} に問い合わせできません: ${f.reason}`);
    if (f.end === server) return fail(`${server.name} のフォワーダーが自分自身を指しています`);
    return answer(net, f.end, IP.str(fwd), name, depth + 1);
  }

  // Web閲覧(プロキシ設定があればプロキシ経由)
  function web(net, src, name) {
    const target = n => {
      const ip = IP.parse(String(name).trim());
      return ip != null ? { ok: true, ip } : resolve(net, n, name);
    };
    const p = String(src.cfg.proxy || '').trim();
    if (!p) {
      const d = target(src);
      if (!d.ok) return d;
      const w = reach(net, src, d.ip, { web: true, label: 'Webアクセス', kind: 'web' });
      return w.ok ? { ok: true, via: 'direct', hops: w.hops } : w;
    }
    const m = p.match(/^(.+):(\d+)$/);
    if (!m) return fail(`${src.name} のプロキシ設定は「アドレス:ポート」の形式で入力してください`);
    let pip = IP.parse(m[1]);
    if (pip == null) {
      const d = resolve(net, src, m[1]);
      if (!d.ok) return fail(`プロキシ名 ${m[1]} を解決できません: ${d.reason}`);
      pip = d.ip;
    }
    const r = reach(net, src, pip, { label: 'プロキシへ接続', kind: 'web' });
    if (!r.ok) return fail(`プロキシ ${m[1]} に届きません: ${r.reason}`);
    const px = r.end;
    if (!hasProxy(px)) return fail(`${px.name} ではプロキシサービスが動いていません`);
    if (Number(m[2]) !== Number(px.cfg.proxyPort)) return fail(`${px.name} のプロキシは ${px.cfg.proxyPort} 番ポートで待ち受けています(PC側の設定: ${m[2]})`);
    if (!proxyAllows(px, IP.parse(src.cfg.ip))) return fail(`${px.name} のプロキシが ${src.cfg.ip} からの利用を許可していません`);
    const d = target(px);
    if (!d.ok) return fail(`${px.name} が名前解決できません: ${d.reason}`);
    const w = reach(net, px, d.ip, { web: true, label: 'Webアクセス(プロキシから)', kind: 'web' });
    if (!w.ok) return fail(`${px.name} からWebサイトに届きません: ${w.reason}`);
    return { ok: true, via: 'proxy', hops: r.hops.concat(w.hops.slice(1)) };
  }

  // 納品条件を1つ判定する
  function checkReq(net, level, q) {
    const dev = id => net.devices.find(d => d.id === id);
    const ipOf = d => IP.parse(d.cfg.ip);
    const by = (d, reason) => (reason.startsWith(d.name) ? reason : `${d.name}: ${reason}`);
    const each = (ids, fn) => {
      for (const id of ids) { const r = fn(dev(id)); if (!r.ok) return r; }
      return { ok: true };
    };
    const missing = [].concat(q.devs || [], q.from || [], q.to || []).find(id => !dev(id));
    if (missing) return fail(`${(level.supplied.find(x => x.id === missing) || { name: missing }).name} がまだ机に置かれていません`);
    switch (q.t) {
      case 'subnet': {
        const c = IP.parseCidr(q.cidr);
        return each(q.devs, d => {
          const ip = ipOf(d);
          if (ip == null) return fail(`${d.name} のIPアドレスが未設定です`);
          return inCidr(ip, c) ? { ok: true } : fail(`${d.name} (${d.cfg.ip}) が ${q.cidr} の範囲外です`);
        });
      }
      case 'reach': {
        const to = dev(q.to), ip = ipOf(to);
        if (ip == null) return fail(`${to.name} のIPアドレスが未設定です`);
        return each(q.from, s => {
          const r = reach(net, s, ip);
          if (!r.ok) return fail(`${s.name} → ${to.name}: ${r.reason}`);
          return r.end === to ? { ok: true } : fail(`${s.name} → ${to.name}: 別の機器(${r.end.name})が応答しました`);
        });
      }
      case 'noreach':
        return each(q.from, s => {
          if (ipOf(s) == null) return fail(`${s.name} のIPアドレスが未設定です`);
          return each(q.to, t => {
            const ip = ipOf(t);
            if (ip == null) return fail(`${t.name} のIPアドレスが未設定です`);
            return reach(net, s, ip).ok ? fail(`${s.name} から ${t.name} に通信できてしまいます`) : { ok: true };
          });
        });
      case 'internet':
        return each(q.from, s => {
          const r = reach(net, s, IP.parse(PUBLIC_DNS));
          return r.ok ? r : fail(by(s, r.reason));
        });
      case 'name': {
        // 名前が引けて、その先が目的の機器(q.to)であること
        const to = q.to && dev(q.to), want = to && ipOf(to);
        if (to && want == null) return fail(`${to.name} のIPアドレスが未設定です`);
        return each(q.from, s => {
          const d = resolve(net, s, q.name);
          if (!d.ok) return fail(by(s, d.reason));
          if (to && d.ip !== want) return fail(`${q.name} が ${to.name} (${to.cfg.ip}) ではなく ${IP.str(d.ip)} を指しています`);
          const r = reach(net, s, d.ip);
          return r.ok ? r : fail(by(s, r.reason));
        });
      }
      case 'web':
        return each(q.from, s => {
          const r = web(net, s, q.name);
          if (!r.ok) return fail(by(s, r.reason));
          if (q.via === 'proxy' && r.via !== 'proxy') return fail(`${s.name} にプロキシが設定されていません`);
          return r;
        });
      case 'noDirectWeb':
        return each(q.from, s => {
          if (ipOf(s) == null) return fail(`${s.name} のIPアドレスが未設定です`);
          return reach(net, s, WEB_PROBE, { web: true }).ok ? fail(`${s.name} からプロキシを通さず直接Webに出られてしまいます`) : { ok: true };
        });
      case 'noProxy': {
        // どのプロキシサーバーも使えないこと(届かない、または利用許可で弾かれる)
        const proxies = net.devices.filter(d => hasProxy(d) && ipOf(d) != null);
        return each(q.from, s => {
          const ip = ipOf(s);
          if (ip == null) return fail(`${s.name} のIPアドレスが未設定です`);
          const p = proxies.find(x => proxyAllows(x, ip) && reach(net, s, ipOf(x)).ok);
          return p ? fail(`${s.name} から ${p.name} のプロキシを使えてしまいます`) : { ok: true };
        });
      }
    }
    return fail('未知の条件です');
  }

  function evaluate(devices, cables, level) {
    const net = build(devices, cables);
    return level.reqs.map(q => checkReq(net, level, q));
  }

  return { build, reach, resolve, web, evaluate, EXTERNAL, PUBLIC_DNS, WAN: '203.0.113.2/30', ISP: '203.0.113.1' };
})();
