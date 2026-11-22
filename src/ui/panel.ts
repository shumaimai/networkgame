// 機器の設定パネル(右下)。HTMLを組み立てるだけで、入力の反映は bench.ts が行う
import { ipStr, maskOf, parseCidr, parseCidrList, parseIp } from '../core/ip';
import { CABLE_PRICE, Cable, Device, GwCfg, L3Cfg, MODEL, ServerCfg, SVC, Svc, SwitchCfg, deniesByDefault, dkimKey, isEndpoint, isGateway, isHost } from '../core/model';
import { CLOUD_IP, EXTERNAL, Net, PUBLIC_DNS, lineIp, reach, tunnelState } from '../core/sim';
import { ENTRY } from '../game/guide';
import { esc, yen } from './dom';

const PREFIXES = [8, 16, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
const SVCS: (Svc | 'any')[] = ['any', 'ping', 'dns', 'web', 'proxy', 'file', 'print', 'mail', 'voice'];
const svcLabel = (s: Svc | 'any') => (s === 'any' ? 'すべて' : `${SVC[s].label} (${SVC[s].port})`);

export const VALID: Record<string, (v: string) => boolean> = {
  ip: v => parseIp(v) != null,
  cidr: v => parseCidr(v) != null,
  host: v => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v),
  proxy: v => /^.+:\d+$/.test(v),
  cert: v => v.split(/[\s,、]+/).filter(Boolean).every(x => /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(x)),
  list: v => v.split(/[\s,、]+/).filter(Boolean).length === parseCidrList(v).length,
};
export const ROW_TEMPLATE: Record<string, () => any> = {
  routes: () => ({ dest: '', via: '' }),
  rules: () => ({ action: 'deny', src: 'any', dst: 'any', svc: 'any' }),
  svis: () => ({ vlan: 10, ip: '', prefix: 24, relay: '' }),
  records: () => ({ name: '', ip: '' }),
  pools: () => ({ start: '', end: '', prefix: 24, gw: '', dns: '' }),
  forwards: () => ({ svc: 'web', to: '' }),
  zone: () => ({ type: 'A', name: '', value: '' }),
  tunnels: () => ({ peer: '', key: '', nets: '' }),
  rpRules: () => ({ host: '', to: '' }),
};
export const getPath = (o: any, path: string): any => path.split('.').reduce((x, k) => x[k], o);
export function setPath(o: any, path: string, v: any): void {
  const ks = path.split('.'), last = ks.pop()!;
  ks.reduce((x, k) => x[k], o)[last] = v;
}

const OWN: Record<string, string> = { fixed: '据え付けの設備', supplied: 'お客様の機器', stock: '在庫から使用' };

/** level: いまのレベル。まだ習っていない内容の設定欄は出さない */
export interface PanelCtx { net: Net; diagTarget: string; cables: Cable[]; devices: Device[]; level: number; /** 入力を助けるボタンを出す(研修では出さない) */ assist?: boolean }

/** 同じスイッチにつながっている、設定済みの端末(設定を写す元にする) */
export function copySource(d: Device, ctx: Pick<PanelCtx, 'cables' | 'devices'>): Device | null {
  const other = (c: Cable, id: string) => (c.a.dev === id ? c.b.dev : c.b.dev === id ? c.a.dev : null);
  const hubs = ctx.cables.map(c => other(c, d.id)).filter((x): x is string => !!x);
  const near = ctx.devices.filter(x => x !== d && isEndpoint(x.kind) && x.cfg.mode !== 'dhcp' && x.cfg.ip && ctx.cables.some(c => hubs.includes(other(c, x.id) ?? '')));
  // 写す元は1台に決める(同じ種類の端末を優先し、机に置いた順でいちばん早いもの)。写したあとは、ボタンが出なくなる
  return near.find(x => x.kind === d.kind) ?? near[0] ?? null;
}
export const COPY_LABEL: Record<string, string> = { prefix: 'マスク', gw: 'ゲートウェイ', dns: 'DNS', proxy: 'プロキシ', noProxy: 'プロキシを使わない宛先' };
/** 写す項目。IPアドレスは機器ごとに違うので入れない。changed を指定すると、値が変わる項目だけを返す */
export function copyKeys(to: Device, from: Device, changed = false): string[] {
  const keys = ['prefix', 'gw', ...(to.kind !== 'printer' ? ['dns'] : []), ...(to.kind === 'pc' && from.kind === 'pc' ? ['proxy', 'noProxy'] : [])];
  return keys.filter(k => (k === 'prefix' || from.cfg[k]) && (!changed || String(to.cfg[k] ?? '') !== String(from.cfg[k] ?? '')));
}

export function cablePanel(c: Cable, devices: Device[]): string {
  const a = devices.find(d => d.id === c.a.dev)!, b = devices.find(d => d.id === c.b.dev)!;
  return `<h2>LANケーブル</h2><div class="sub">${c.free ? 'お客様のケーブル' : '購入品 ' + yen(CABLE_PRICE)}</div>
    <h3>接続</h3><div class="info">${esc(a.name)} [${esc(a.ports[c.a.port])}]<br>⇔ ${esc(b.name)} [${esc(b.ports[c.b.port])}]</div>
    <button class="btn danger wide" data-act="unplug">ケーブルを外す${c.free ? '' : '(返金)'}</button>`;
}

// 設定欄の見出しと、それを説明しているガイドの項目。先に書いた項目から、いまのレベルで読めるものを選ぶ
const HELP: [RegExp, (k: string) => string[]][] = [
  [/^ネットワーク設定/, k => (k === 'server' || k === 'nas' ? ['server'] : k === 'lb' ? ['lb'] : ['ip'])],
  [/^Webプロキシ/, () => ['proxy']], [/^無線LAN/, () => ['ap']],
  [/^DNSサービス/, () => ['server-dns']], [/^DHCPサービス/, () => ['relay', 'dhcp']], [/^プロキシサービス/, () => ['proxy']],
  [/^Webサービス/, () => ['https', 'forward', 'server']], [/^リバースプロキシ/, () => ['rproxy']], [/^ファイル共有/, () => ['nas']],
  [/^メールサービス/, () => ['mail']], [/^監視サービス/, () => ['monitor']],
  [/^説明/, k => (k === 'wan' ? ['wan'] : ['l2'])], [/^ポートのVLAN/, () => ['vlan']], [/^VLANインターフェース/, () => ['l3']],
  [/^スタティックルート/, () => ['route']], [/^フィルター/, k => (k === 'fw' ? ['fw', 'filter'] : ['filter'])], [/^セキュリティグループ/, () => ['cloud']],
  [/^(WAN|インターネット側)/, k => (k === 'cloud' ? ['cloud'] : ['nat'])], [/^(LAN\d?|DMZ)$/, k => (k === 'fw' ? ['fw', 'router'] : ['router'])], [/^vNET/, () => ['cloud']],
  [/^拠点間VPN/, () => ['s2s']], [/^VPN/, () => ['vpn']], [/^ポート転送/, () => ['forward']],
  [/^振り分け先/, () => ['lb']], [/^HTTPS/, () => ['tls']], [/^回線/, () => ['lines', 'nat']], [/^公開DNS/, () => ['pubdns']], [/^診断ツール/, () => ['diag-ping']],
];
/** 見出しの右に、対応するガイドを開く「?」ボタンを付ける */
function addHelp(html: string, kind: string, level: number): string {
  return html.replace(/<h3>([^<]+)((?:<small>[^<]*<\/small>)?)<\/h3>/g, (all, title: string, small: string) => {
    const id = HELP.find(([re]) => re.test(title))?.[1](kind).find(x => ENTRY[x] && ENTRY[x].level <= level);
    return id ? `<h3>${title}${small}<button class="q" data-act="guide-to" data-id="${id}" title="ガイド「${esc(ENTRY[id].title)}」を開く">?</button></h3>` : all;
  });
}

export function devicePanel(d: Device, ctx: PanelCtx): string {
  return addHelp(panelBody(d, ctx), d.kind, ctx.level);
}
function panelBody(d: Device, ctx: PanelCtx): string {
  const m = MODEL[d.model], c = d.cfg;
  const val = (path: string) => esc(getPath(c, path));
  const field = (label: string, path: string, v: string, ph = '') =>
    `<label class="f"><span>${label}</span><input data-bind="${path}" data-v="${v}" value="${val(path)}" placeholder="${esc(ph)}" spellcheck="false" autocomplete="off"></label>`;
  const num = (label: string, path: string, min = 1, max = 65535) =>
    `<label class="f"><span>${label}</span><input type="number" min="${min}" max="${max}" data-bind="${path}" data-num value="${val(path)}"></label>`;
  const toggle = (path: string, label: string) =>
    `<label class="toggle"><input type="checkbox" data-bind="${path}" data-rerender${getPath(c, path) ? ' checked' : ''}><i></i><span>${label}</span></label>`;
  const maskSel = (path: string, short = false) =>
    `<select data-bind="${path}" data-num>${PREFIXES.map(p => `<option value="${p}"${Number(getPath(c, path)) === p ? ' selected' : ''}>${short ? '' : ipStr(maskOf(p)) + ' '}/${p}</option>`).join('')}</select>`;
  const mask = (path: string) => `<label class="f"><span>サブネットマスク</span>${maskSel(path)}</label>`;
  const sel = (path: string, opts: [string, string][], rerender = false) =>
    `<select data-bind="${path}"${rerender ? ' data-rerender' : ''}>${opts.map(([v, l]) => `<option value="${v}"${String(getPath(c, path)) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const del = (key: string, i: number) => `<button class="x" data-act="del" data-key="${key}" data-i="${i}" title="削除">×</button>`;
  const addBtn = (key: string, label: string) => `<button class="add" data-act="add" data-key="${key}">+ ${label}</button>`;
  const inp = (path: string, v: string, ph: string) => `<input data-bind="${path}" data-v="${v}" value="${val(path)}" placeholder="${esc(ph)}" spellcheck="false" autocomplete="off">`;
  const pair = (key: string, a: [string, string, string], b: [string, string, string], head: [string, string], addLabel: string) =>
    `<div class="colhead pair"><span>${head[0]}</span><span></span><span>${head[1]}</span><span></span></div>`
    + (c[key] as any[]).map((_, i) => `<div class="row pair">${inp(`${key}.${i}.${a[0]}`, a[1], a[2])}<span class="arrow">→</span>${inp(`${key}.${i}.${b[0]}`, b[1], b[2])}${del(key, i)}</div>`).join('')
    + addBtn(key, addLabel);
  const routes = () => '<h3>スタティックルート</h3>' + pair('routes', ['dest', 'cidr', '宛先 192.168.10.0/24'], ['via', 'ip', '次の中継先'], ['宛先ネットワーク', 'ネクストホップ'], 'ルートを追加');
  const rules = (fw: boolean, title = 'フィルター') => `<h3>${title}<small>上から順に調べ、最初に当てはまったルールに従う</small></h3>`
    + (c.rules as any[]).map((_, i) => `<div class="rule"><span class="no">${i + 1}</span>${sel(`rules.${i}.action`, [['allow', '許可'], ['deny', '拒否']])}${sel(`rules.${i}.svc`, SVCS.map(s => [s, svcLabel(s)] as [string, string]))}
      <button class="x" data-act="up" data-key="rules" data-i="${i}" title="上へ"${i === 0 ? ' disabled' : ''}>▲</button>${del('rules', i)}
      ${inp(`rules.${i}.src`, 'cidr', '送信元 any')}<span class="arrow">→</span>${inp(`rules.${i}.dst`, 'cidr', '宛先 any')}</div>`).join('')
    + addBtn('rules', 'ルールを追加')
    + `<div class="info">${fw ? 'どのルールにも当てはまらない通信は<b>遮断</b>します。' : 'どのルールにも当てはまらない通信は<b>通します</b>。'}戻りの通信は自動で通ります。送信元・宛先は <code>any</code>、IPアドレス、<code>192.168.1.0/24</code> の形で書きます。</div>`;

  let h = `<h2>${esc(d.name)}</h2><div class="sub">${m.label} / ${d.own === 'bought' ? '購入品 ' + yen(d.cost) : OWN[d.own]}</div>`;
  if (isHost(d.kind)) h += `<div class="mac">MACアドレス <code>${d.mac}</code></div>`;

  if (isEndpoint(d.kind)) {
    const from = ctx.assist && c.mode !== 'dhcp' ? copySource(d, ctx) : null, keys = from ? copyKeys(d, from, true) : [];
    if (from && keys.length) h += `<button class="btn wide assist" data-act="copy-cfg">${esc(from.name)} の${keys.map(k => COPY_LABEL[k]).join('・')}を写す<small>IPアドレスは写しません。この機器の番号は自分で入力します。</small></button>`;
    h += '<h3>ネットワーク設定</h3>'
      + `<label class="f"><span>アドレスの決め方</span>${sel('mode', [['static', '手動で設定'], ['dhcp', '自動取得 (DHCP)']], true)}</label>`;
    if (c.mode === 'dhcp') {
      const e = ctx.net.eff.get(d.id);
      h += e?.ip != null
        ? `<div class="lease ok"><b>${esc(e.lease)}</b> から受け取りました<table><tr><td>IPアドレス</td><td>${ipStr(e.ip)} /${e.prefix}</td></tr><tr><td>ゲートウェイ</td><td>${e.gw != null ? ipStr(e.gw) : '(なし)'}</td></tr><tr><td>DNSサーバー</td><td>${e.dns != null ? ipStr(e.dns) : '(なし)'}</td></tr></table></div>`
        : `<div class="lease ng">アドレスを取得できていません<br><small>${esc(e?.note ?? '')}</small></div>`;
    } else {
      h += field('IPアドレス', 'ip', 'ip', '192.168.1.10') + mask('prefix') + field('ゲートウェイ', 'gw', 'ip', '空欄可');
      if (d.kind !== 'printer') h += field('DNSサーバー', 'dns', 'ip', '空欄可');
    }
    if (d.kind === 'pc') {
      h += '<h3>Webプロキシ</h3>' + field('プロキシ', 'proxy', 'proxy', 'アドレス:ポート(空欄=使わない)');
      if (ctx.level >= 18 || c.noProxy) h += field('プロキシを使わない宛先', 'noProxy', '', '例 saas.example.com');
      if (ctx.devices.some(x => x.kind === 'ap')) h += '<h3>無線LAN<small>ケーブルをつないでいないときに使う</small></h3>' + field('SSID', 'wifi.ssid', '', '') + field('暗号化キー', 'wifi.key', '', '');
    }
  } else if (d.kind === 'server' || d.kind === 'nas') {
    const s = c as ServerCfg;
    h += '<h3>ネットワーク設定</h3>' + field('IPアドレス', 'ip', 'ip') + mask('prefix') + field('ゲートウェイ', 'gw', 'ip')
      + field('参照DNS', 'dns', 'ip', s.dnsOn ? '空欄=自分のDNSサービス' : 'この機器が使うDNS');
    if (d.kind === 'server') {
      h += '<h3>DNSサービス</h3>' + toggle('dnsOn', '名前をIPアドレスに変える');
      if (s.dnsOn) h += '<div class="svc">' + pair('records', ['name', 'host', 'printer.example.local'], ['ip', 'ip', 'IPアドレス'], ['名前(レコード)', 'IPアドレス'], 'レコードを追加')
        + field('フォワーダー', 'forwarder', 'ip', `外部の名前の転送先 例 ${PUBLIC_DNS}`) + '</div>';
      h += '<h3>DHCPサービス</h3>' + toggle('dhcpOn', 'IPアドレスを自動で配る');
      if (s.dhcpOn) h += '<div class="svc">' + s.pools.map((_, i) => `<div class="pool"><div class="pool-h">配布範囲 ${i + 1}${del('pools', i)}</div>
          <div class="row pair">${inp(`pools.${i}.start`, 'ip', '開始')}<span class="arrow">〜</span>${inp(`pools.${i}.end`, 'ip', '終了')}${maskSel(`pools.${i}.prefix`, true)}</div>
          ${field('配るゲートウェイ', `pools.${i}.gw`, 'ip')}${field('配るDNS', `pools.${i}.dns`, 'ip')}</div>`).join('') + addBtn('pools', '配布範囲を追加')
        + '<div class="info">同じネットワークの端末に配ります。別のネットワークへ配るには、L3スイッチのDHCPリレーでこのサーバーを指定し、そのネットワーク用の配布範囲を作ります。</div></div>';
      h += '<h3>プロキシサービス</h3>' + toggle('proxyOn', 'PCの代わりにWebへアクセスする');
      if (s.proxyOn) h += '<div class="svc">' + num('待受ポート', 'proxyPort') + field('利用を許可', 'proxyAllow', 'list', '空欄=すべて 例 192.168.10.0/24')
        + '<div class="info">このサーバー自身が名前解決(参照DNS)とインターネット接続をできる必要があります。</div></div>';
      h += '<h3>Webサービス</h3>' + toggle('webOn', 'Webサイトを公開する (80/443)');
      if (s.webOn) h += '<div class="svc">' + field('証明書の名前', 'cert', 'cert', 'HTTPSで公開する名前(使わないなら空欄)') + '</div>';
      if (ctx.level >= 17 || s.rpOn) {
        h += '<h3>リバースプロキシ</h3>' + toggle('rpOn', '届いたWebアクセスを、名前ごとに別のサーバーへ転送する');
        if (s.rpOn) h += '<div class="svc">' + pair('rpRules', ['host', 'host', 'www.example.jp'], ['to', 'ip', '転送先のIP'], ['アクセスされた名前', '転送先のWebサーバー'], '転送先を追加')
          + (s.webOn ? '' : field('証明書の名前', 'cert', 'cert', '例 *.example.jp'))
          + '<div class="info">外からのHTTPSはこのサーバーが受けるので、証明書もここに入れます。<code>*.example.jp</code> と書くと、<code>www.example.jp</code> や <code>shop.example.jp</code> のような直下の名前すべてに当てはまります。</div></div>';
      }
    }
    h += '<h3>ファイル共有</h3>' + toggle('fileOn', '共有フォルダを使えるようにする (445)');
    if (s.fileOn) h += '<div class="svc">' + field('利用を許可', 'fileAllow', 'list', '空欄=すべて 例 192.168.10.0/24') + '</div>';
    if (d.kind === 'server') {
      h += '<h3>メールサービス</h3>' + toggle('mailOn', 'メールを受け付ける (25)');
      if (s.mailOn && (ctx.level >= 18 || s.dkimOn)) {
        h += '<div class="svc">' + toggle('dkimOn', '送るメールにDKIMの署名を付ける');
        if (s.dkimOn) h += field('セレクター', 'dkimSel', '', 's1')
          + `<div class="info">公開鍵: <code>${dkimKey(d)}</code><br>公開DNSに、名前 <code class="cp" data-act="copy">${esc(s.dkimSel)}._domainkey</code> のTXTレコードを作り、値に <code class="cp" data-act="copy">v=DKIM1; k=rsa; p=${dkimKey(d)}</code> を登録します。受信側は、この公開鍵で署名を確かめます。名前と値は、クリックでコピーできます。</div>`;
        h += '</div>';
      }
      if (ctx.level >= 23 || s.monOn) {
        h += '<h3>監視サービス</h3>' + toggle('monOn', '登録した機器に、定期的に ping を打つ');
        if (s.monOn) {
          const list = String(s.monTargets ?? '').split(/[\s,、]+/).map(x => [x, parseIp(x)] as const).filter(x => x[1] != null);
          h += '<div class="svc">' + field('監視先', 'monTargets', 'list', '例 192.168.1.1, 192.168.1.60')
            + `<div class="info">${list.length ? list.map(([t, n]) => { const r = reach(ctx.net, d, n!); return r.ok ? `<span class="st-up">○</span> <code>${esc(t)}</code> ${esc(r.end.name)}` : `<span class="st-down">×</span> <code>${esc(t)}</code> 応答なし`; }).join('<br>') : '監視先がまだありません。'}</div>`
            + '<div class="info">ルーターやL3スイッチ、ほかのサーバーのIPアドレスを、カンマで区切って並べます。入力した結果は、機器を選び直すと更新されます。</div></div>';
        }
      }
    }
  } else if (d.kind === 'l2') {
    h += '<h3>説明</h3><div class="info">設定は不要です。つないだ機器はすべて同じネットワーク(ブロードキャストドメイン)になります。</div>';
  } else if (d.kind === 'l2m' || d.kind === 'l3') {
    const s = c as SwitchCfg;
    h += `<h3>ポートのVLAN<small>T = トランク(複数のVLANを通す)</small></h3><div class="vlans${d.ports.length > 8 ? ' many' : ''}">`
      + d.ports.map((_, i) => `<div class="vp"><span>${i + 1}</span><input type="number" min="1" max="4094" data-bind="portVlan.${i}" data-num value="${esc(s.portVlan[i])}"${s.portMode[i] === 'trunk' ? ' disabled' : ''}>
        <label title="トランク"><input type="checkbox" data-bind="portMode.${i}" data-trunk data-rerender${s.portMode[i] === 'trunk' ? ' checked' : ''}>T</label></div>`).join('') + '</div>'
      + '<div class="info">同じVLAN番号のポート同士だけが、同じネットワークになります。スイッチ同士をトランクでつなぐと、複数のVLANを1本のケーブルで運べます。</div>';
    if (d.kind === 'l3') {
      const l = c as L3Cfg;
      h += '<h3>VLANインターフェース<small>各VLANのゲートウェイになる</small></h3><div class="colhead svi"><span>VLAN</span><span>IPアドレス</span><span>マスク</span><span></span></div>'
        + l.svis.map((_, i) => `<div class="row svi"><input type="number" min="1" max="4094" data-bind="svis.${i}.vlan" data-num value="${val(`svis.${i}.vlan`)}">${inp(`svis.${i}.ip`, 'ip', '192.168.10.254')}${maskSel(`svis.${i}.prefix`, true)}${del('svis', i)}
          <span class="relay-l">DHCPリレー</span>${inp(`svis.${i}.relay`, 'ip', 'DHCPサーバーのIP(使わないなら空欄)')}
          ${ctx.level >= 21 || l.svis[i].vip ? `<span class="vip-l">仮想IP</span>${inp(`svis.${i}.vip`, 'ip', '2台で同じアドレス(冗長化)')}<input type="number" min="1" max="254" data-bind="svis.${i}.prio" data-num value="${esc(l.svis[i].prio ?? 100)}" title="優先度。大きいほうが、ふだん仮想IPアドレスを受け持つ">` : ''}</div>`).join('')
        + addBtn('svis', 'VLANインターフェースを追加') + routes() + rules(false);
    }
  } else if (isGateway(d.kind)) {
    const g = c as GwCfg, fw = d.kind === 'fw', cl = d.kind === 'cloud';
    const wi = ctx.net.ifaces.find(i => i.dev === d && i.wan), online = !!wi && ctx.net.ifaces.some(i => i.dev.kind === 'internet' && i.seg === wi.seg);
    h += `<h3>${cl ? 'インターネット側' : d.ports[0] + '(外側)'}</h3>`;
    if (fw) h += `<label class="f"><span>アドレス</span>${sel('wan.mode', [['auto', '回線から自動取得'], ['static', '手動で設定']], true)}</label>`;
    if (cl) h += `<div class="info">契約済みのクラウドです。インターネットには最初からつながっていて、ケーブルは要りません。<br>外側のアドレス: <code>${ipStr(CLOUD_IP)}</code></div>`;
    else if (g.wan.mode === 'auto') h += `<div class="info">回線につなぐと外側のアドレスを受け取り、外向きの通信はここから出ていきます。<br>${online ? `いまのアドレス: <code>${ipStr(wi!.ip)}/30</code>${wi!.via != null ? `<br>回線の向こう(プロバイダ側)のアドレス: <code>${ipStr(wi!.via)}</code>` : ''}` : 'まだ回線につながっていません。'}</div>`;
    else h += field('IPアドレス', 'wan.ip', 'ip') + mask('wan.prefix') + field('ゲートウェイ', 'wan.gw', 'ip');
    h += toggle('nat', `NAT(${cl ? '仮想ネットワーク' : '社内'}のアドレスを外側のアドレスに書き換える)`);
    g.lan.forEach((l, i) => {
      const pn = cl ? 'vNET' : d.ports[i + 1];
      h += `<h3>${cl ? 'vNET<small>vNIC につないだ仮想サーバーのネットワーク</small>' : pn}</h3>` + field('IPアドレス', `lan.${i}.ip`, 'ip', i === 0 && !fw ? (cl ? '10.20.0.1' : '192.168.1.1') : '未使用なら空欄') + mask(`lan.${i}.prefix`);
      if (!cl) h += toggle(`lan.${i}.dhcpOn`, 'DHCPでアドレスを配る');
      if (l.dhcpOn && !cl) h += `<div class="svc"><div class="row pair">${inp(`lan.${i}.dhcpStart`, 'ip', '開始')}<span class="arrow">〜</span>${inp(`lan.${i}.dhcpEnd`, 'ip', '終了')}<span></span></div>${field('配るDNS', `lan.${i}.dhcpDns`, 'ip', `例 ${PUBLIC_DNS}`)}<div class="info">ゲートウェイには、この${pn}のIPアドレスを配ります。仮想IPを設定しているときは、仮想IPアドレスを配ります。</div></div>`;
      if (!cl && (ctx.level >= 21 || l.vip)) {
        const vip = parseIp(l.vip), grp = vip == null ? undefined : ctx.net.vrrp.find(v => v.vip === vip && v.members.includes(d.id));
        h += `<div class="row vr"><span class="vip-l">仮想IP</span>${inp(`lan.${i}.vip`, 'ip', '2台で同じアドレス(冗長化)')}<input type="number" min="1" max="254" data-bind="lan.${i}.prio" data-num value="${esc(l.prio ?? 100)}" title="優先度。大きいほうが、ふだん仮想IPアドレスを受け持つ"></div>`;
        if (l.vip && !d.off) h += `<div class="info">${!grp ? '仮想IPアドレスが、このポートのネットワークの範囲にありません。' : grp.master === d.id ? `いまは<b>この機器</b>が ${esc(l.vip)} を受け持っています${grp.members.length < 2 ? '(同じ仮想IPアドレスを設定した機器が、ほかにありません)' : ''}。` : `いまは <b>${esc(ctx.devices.find(x => x.id === grp.master)?.name)}</b> が ${esc(l.vip)} を受け持っています。この機器は控えです。`}右の数字は優先度です。</div>`;
      }
    });
    if (ctx.level >= 20 || g.tunnels?.length || cl) {
      h += '<h3>拠点間VPN<small>インターネット経由で、ほかの拠点とつなぐ</small></h3>'
        + (g.tunnels ?? []).map((t, i) => {
          const st = tunnelState(ctx.net, d, t);
          return `<div class="pool tun"><div class="pool-h"><span>相手 ${i + 1} <b class="${st ? 'st-down' : 'st-up'}">${st ? '未接続' : '接続中'}</b></span>${del('tunnels', i)}</div>
            ${field('相手の外側のアドレス', `tunnels.${i}.peer`, 'ip', '例 203.0.113.6')}${field('事前共有キー', `tunnels.${i}.key`, '', '両側で同じ文字列')}${field('相手側のネットワーク', `tunnels.${i}.nets`, 'list', '例 192.168.20.0/24')}
            ${st && t.peer ? `<small class="why">${esc(st)}</small>` : ''}</div>`;
        }).join('')
        + addBtn('tunnels', '相手を追加')
        + '<div class="info">相手側のネットワーク宛の通信を、アドレスを書き換えずに相手の機器まで運びます。相手の機器にも、こちらを相手にした設定が要ります。</div>';
    }
    if (ctx.devices.some(x => x.kind === 'home')) {
      h += '<h3>VPN<small>社外の端末を社内に入れる</small></h3>' + toggle('vpn.on', 'リモートアクセスVPNを受け付ける');
      if (g.vpn?.on) h += '<div class="svc">' + field('認証キー', 'vpn.key', '', '') + field('配るアドレス', 'vpn.ip', 'ip', 'LANの範囲の空きアドレス') + '<div class="info">つないできた端末は、このアドレスを持つLANの端末として扱われます。</div></div>';
    }
    h += routes() + rules(deniesByDefault(d.kind), cl ? 'セキュリティグループ' : 'フィルター')
      + `<h3>ポート転送<small>外から来た通信を${cl ? '仮想' : '社内の'}サーバーへ送る</small></h3>`
      + g.forwards.map((_, i) => `<div class="row fwd">${sel(`forwards.${i}.svc`, SVCS.filter(s => s !== 'any' && s !== 'ping').map(s => [s, svcLabel(s)] as [string, string]))}<span class="arrow">→</span>${inp(`forwards.${i}.to`, 'ip', 'サーバーのIP')}${del('forwards', i)}</div>`).join('')
      + addBtn('forwards', '転送を追加');
  } else if (d.kind === 'home') {
    const e = ctx.net.eff.get(d.id);
    h += '<h3>VPN<small>インターネット経由で会社につなぐ</small></h3>' + field('接続先', 'vpn.server', 'ip', '会社の外側のアドレス') + field('認証キー', 'vpn.key', '', '') + field('DNSサーバー', 'dns', 'ip', '空欄可')
      + (e?.ip != null ? `<div class="lease ok"><b>${esc(e.lease)}</b> に接続しました<table><tr><td>社内でのアドレス</td><td>${ipStr(e.ip)} /${e.prefix}</td></tr></table></div>` : `<div class="lease ng">VPNにつながっていません<br><small>${esc(e?.note ?? '')}</small></div>`);
  } else if (d.kind === 'ap') {
    h += '<h3>無線LAN</h3>' + field('SSID', 'ssid', '', 'ネットワーク名') + field('暗号化キー', 'key', '', 'パスワード')
      + '<div class="info">SSIDと暗号化キーが同じPCを、有線LANにつなぎます。</div>';
  } else if (d.kind === 'lb') {
    h += '<h3>ネットワーク設定</h3>' + field('IPアドレス', 'ip', 'ip') + mask('prefix') + field('ゲートウェイ', 'gw', 'ip')
      + '<h3>振り分け先</h3>' + field('Webサーバー', 'backends', 'list', '例 172.16.1.81, 172.16.1.82')
      + '<div class="info">このアドレスに届いたWebアクセスを、振り分け先のWebサーバーへ順に渡します。応答しないサーバーは外して、残りで続けます。</div>';
    if (ctx.level >= 17 || c.cert) h += '<h3>HTTPS</h3>' + field('証明書の名前', 'cert', 'cert', '空欄=Webサーバー側の証明書を使う')
      + '<div class="info">ここに証明書を入れると、HTTPSはこの機器が受けます。振り分け先のWebサーバーには証明書が要りません。</div>';
  } else if (d.kind === 'wan') {
    h += '<h3>説明</h3><div class="info">通信会社の拠点間回線(広域イーサネット)です。各拠点のルーターをつなぐと、同じL2スイッチにつないだときと同じように通信できます。設定は不要です。この回線からインターネットには出られません。</div>';
  } else if (d.kind === 'internet') {
    const multi = d.ports.length > 1;
    h += `<h3>回線</h3><div class="info">契約済みのインターネット回線です。ルーターやファイアウォールの外側のポートにつなぎます。<br>${multi ? 'つないだ機器が受け取る外側のアドレス: ' + d.ports.map((pn, i) => `${esc(pn)} <code>${ipStr(lineIp(i))}</code>`).join('、') : '会社の外側のアドレス: <code>203.0.113.2</code>'}${ctx.devices.some(x => x.kind === 'cloud') ? `<br>クラウドの外側のアドレス: <code>${ipStr(CLOUD_IP)}</code>` : ''}<br>公開DNS: <code>${PUBLIC_DNS}</code><br>Webサイト: ${Object.keys(EXTERNAL).map(n => `<code>${n}</code>`).join(' ')}</div>`;
    if (c.domain) {
      h += `<h3>公開DNS<small>${esc(c.domain)}</small></h3><div class="colhead zone"><span>種類</span><span>名前</span><span>値</span><span></span></div>`
        + (c.zone as any[]).map((_, i) => `<div class="row zone">${sel(`zone.${i}.type`, [['A', 'A'], ['MX', 'MX'], ['TXT', 'TXT']])}${inp(`zone.${i}.name`, '', 'www')}${inp(`zone.${i}.value`, '', '値')}${del('zone', i)}</div>`).join('')
        + addBtn('zone', 'レコードを追加')
        + `<div class="info">インターネット上のだれもが引ける、自社ドメインの名前です。名前の <code>@</code> はドメインそのもの(${esc(c.domain)})を表します。<br><b>A</b> 名前 → IPアドレス<br><b>MX</b> メールの届け先のサーバー名<br><b>TXT</b> SPFなどの文字列 例 <code>v=spf1 ip4:203.0.113.2 -all</code>${ctx.level >= 18 ? '<br>DKIMの公開鍵は名前 <code>セレクター._domainkey</code>、DMARCは名前 <code>_dmarc</code> のTXTレコードに書きます。' : ''}</div>`;
    }
  }

  if (isHost(d.kind) && !d.off) {
    const name = d.kind !== 'printer';
    const b = (k: string, label: string, title: string) => `<button class="btn small" data-act="diag" data-diag="${k}" title="${title}">${label}</button>`;
    h += `<h3>診断ツール</h3><div class="diag"><input id="diag-target" value="${esc(ctx.diagTarget)}" placeholder="${name ? '宛先: IPアドレス または 名前' : '宛先: IPアドレス'}" spellcheck="false" autocomplete="off">
      <div class="diag-row">${b('ping', 'ping', '宛先まで往復できるか')}${b('tracert', 'tracert', '途中で通る機器を順に表示')}${name ? b('nslookup', 'nslookup', '名前をIPアドレスに変えられるか') : ''}${d.kind === 'pc' ? b('web', 'Web閲覧', 'Webサイトを開けるか') : ''}</div>
      <div class="diag-row">${b('ipconfig', 'ipconfig', 'この機器のアドレス設定')}${b('arp', 'arp', '同じネットワークで見えている機器')}</div></div>`;
  }
  if (d.off || (ctx.level >= 12 && !isEndpoint(d.kind) && !['internet', 'wan', 'cloud', 'home'].includes(d.kind))) {
    h += `<h3>故障テスト</h3><button class="btn wide${d.off ? ' primary' : ''}" data-act="toggle-off">${d.off ? 'この機器を動かす' : 'この機器を一時的に止める'}</button>
      <div class="info">${d.off ? '止めてあります。この機器を通る通信はできません。動かすまで納品はできません。' : '止めた状態で ping を打つと、残りの機器だけで通信できるかを確かめられます。設定や配線は消えません。'}</div>`;
  }
  if (d.own === 'bought') h += '<button class="btn danger wide" data-act="remove">返品する(返金)</button>';
  if (d.own === 'stock') h += '<button class="btn wide" data-act="remove">倉庫に戻す</button>';
  if (d.own === 'supplied') h += '<button class="btn wide" data-act="remove">机から片付ける</button>';
  return h;
}
