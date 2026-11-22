// 機器の設定パネル(右下)。HTMLを組み立てるだけで、入力の反映は bench.ts が行う
import { ipStr, maskOf, parseCidr, parseCidrList, parseIp } from '../core/ip';
import { CABLE_PRICE, Cable, Device, GwCfg, L3Cfg, MODEL, ServerCfg, SVC, Svc, SwitchCfg, isEndpoint, isGateway, isHost } from '../core/model';
import { EXTERNAL, Net, PUBLIC_DNS } from '../core/sim';
import { esc, yen } from './dom';

const PREFIXES = [8, 16, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
const SVCS: (Svc | 'any')[] = ['any', 'ping', 'dns', 'web', 'proxy', 'file', 'print', 'mail', 'voice'];
const svcLabel = (s: Svc | 'any') => (s === 'any' ? 'すべて' : `${SVC[s].label} (${SVC[s].port})`);

export const VALID: Record<string, (v: string) => boolean> = {
  ip: v => parseIp(v) != null,
  cidr: v => parseCidr(v) != null,
  host: v => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v),
  proxy: v => /^.+:\d+$/.test(v),
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
};
export const getPath = (o: any, path: string): any => path.split('.').reduce((x, k) => x[k], o);
export function setPath(o: any, path: string, v: any): void {
  const ks = path.split('.'), last = ks.pop()!;
  ks.reduce((x, k) => x[k], o)[last] = v;
}

const OWN: Record<string, string> = { fixed: '据え付けの設備', supplied: 'お客様の機器', stock: '在庫から使用' };

export interface PanelCtx { net: Net; diagTarget: string; cables: Cable[]; devices: Device[] }

export function cablePanel(c: Cable, devices: Device[]): string {
  const a = devices.find(d => d.id === c.a.dev)!, b = devices.find(d => d.id === c.b.dev)!;
  return `<h2>LANケーブル</h2><div class="sub">${c.free ? 'お客様のケーブル' : '購入品 ' + yen(CABLE_PRICE)}</div>
    <h3>接続</h3><div class="info">${esc(a.name)} [${esc(a.ports[c.a.port])}]<br>⇔ ${esc(b.name)} [${esc(b.ports[c.b.port])}]</div>
    <button class="btn danger wide" data-act="unplug">ケーブルを外す${c.free ? '' : '(返金)'}</button>`;
}

export function devicePanel(d: Device, ctx: PanelCtx): string {
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
  const rules = (fw: boolean) => `<h3>フィルター<small>上から順に調べ、最初に当てはまったルールに従う</small></h3>`
    + (c.rules as any[]).map((_, i) => `<div class="rule"><span class="no">${i + 1}</span>${sel(`rules.${i}.action`, [['allow', '許可'], ['deny', '拒否']])}${sel(`rules.${i}.svc`, SVCS.map(s => [s, svcLabel(s)] as [string, string]))}
      <button class="x" data-act="up" data-key="rules" data-i="${i}" title="上へ"${i === 0 ? ' disabled' : ''}>▲</button>${del('rules', i)}
      ${inp(`rules.${i}.src`, 'cidr', '送信元 any')}<span class="arrow">→</span>${inp(`rules.${i}.dst`, 'cidr', '宛先 any')}</div>`).join('')
    + addBtn('rules', 'ルールを追加')
    + `<div class="info">${fw ? 'どのルールにも当てはまらない通信は<b>遮断</b>します。' : 'どのルールにも当てはまらない通信は<b>通します</b>。'}戻りの通信は自動で通ります。送信元・宛先は <code>any</code>、IPアドレス、<code>192.168.1.0/24</code> の形で書きます。</div>`;

  let h = `<h2>${esc(d.name)}</h2><div class="sub">${m.label} / ${d.own === 'bought' ? '購入品 ' + yen(d.cost) : OWN[d.own]}</div>`;
  if (isHost(d.kind)) h += `<div class="mac">MACアドレス <code>${d.mac}</code></div>`;

  if (isEndpoint(d.kind)) {
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
      if (s.webOn) h += '<div class="svc">' + field('証明書の名前', 'cert', 'host', 'HTTPSで公開する名前(使わないなら空欄)') + '</div>';
    }
    h += '<h3>ファイル共有</h3>' + toggle('fileOn', '共有フォルダを使えるようにする (445)');
    if (s.fileOn) h += '<div class="svc">' + field('利用を許可', 'fileAllow', 'list', '空欄=すべて 例 192.168.10.0/24') + '</div>';
    if (d.kind === 'server') h += '<h3>メールサービス</h3>' + toggle('mailOn', 'メールを受け付ける (25)');
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
          <span class="relay-l">DHCPリレー</span>${inp(`svis.${i}.relay`, 'ip', 'DHCPサーバーのIP(使わないなら空欄)')}</div>`).join('')
        + addBtn('svis', 'VLANインターフェースを追加') + routes() + rules(false);
    }
  } else if (isGateway(d.kind)) {
    const g = c as GwCfg, fw = d.kind === 'fw';
    h += `<h3>${d.ports[0]}(外側)</h3>`;
    if (fw) h += `<label class="f"><span>アドレス</span>${sel('wan.mode', [['auto', '回線から自動取得'], ['static', '手動で設定']], true)}</label>`;
    if (g.wan.mode === 'auto') h += `<div class="info">回線につなぐと <code>203.0.113.2/30</code> を受け取り、外向きの通信はここから出ていきます。</div>`;
    else h += field('IPアドレス', 'wan.ip', 'ip') + mask('wan.prefix') + field('ゲートウェイ', 'wan.gw', 'ip');
    h += toggle('nat', 'NAT(社内のアドレスを外側のアドレスに書き換える)');
    g.lan.forEach((l, i) => {
      h += `<h3>${d.ports[i + 1]}</h3>` + field('IPアドレス', `lan.${i}.ip`, 'ip', i === 0 && !fw ? '192.168.1.1' : '未使用なら空欄') + mask(`lan.${i}.prefix`) + toggle(`lan.${i}.dhcpOn`, 'DHCPでアドレスを配る');
      if (l.dhcpOn) h += `<div class="svc"><div class="row pair">${inp(`lan.${i}.dhcpStart`, 'ip', '開始')}<span class="arrow">〜</span>${inp(`lan.${i}.dhcpEnd`, 'ip', '終了')}<span></span></div>${field('配るDNS', `lan.${i}.dhcpDns`, 'ip', `例 ${PUBLIC_DNS}`)}<div class="info">ゲートウェイには、この${d.ports[i + 1]}のIPアドレスを配ります。</div></div>`;
    });
    if (ctx.devices.some(x => x.kind === 'home')) {
      h += '<h3>VPN<small>社外の端末を社内に入れる</small></h3>' + toggle('vpn.on', 'リモートアクセスVPNを受け付ける');
      if (g.vpn?.on) h += '<div class="svc">' + field('認証キー', 'vpn.key', '', '') + field('配るアドレス', 'vpn.ip', 'ip', 'LANの範囲の空きアドレス') + '<div class="info">つないできた端末は、このアドレスを持つLANの端末として扱われます。</div></div>';
    }
    h += routes() + rules(fw)
      + '<h3>ポート転送<small>外から来た通信を社内のサーバーへ送る</small></h3>'
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
  } else if (d.kind === 'internet') {
    h += `<h3>回線</h3><div class="info">契約済みのインターネット回線です。ルーターやファイアウォールの外側のポートにつなぎます。<br>会社の外側のアドレス: <code>203.0.113.2</code><br>公開DNS: <code>${PUBLIC_DNS}</code><br>Webサイト: ${Object.keys(EXTERNAL).map(n => `<code>${n}</code>`).join(' ')}</div>`;
    if (c.domain) {
      h += `<h3>公開DNS<small>${esc(c.domain)}</small></h3><div class="colhead zone"><span>種類</span><span>名前</span><span>値</span><span></span></div>`
        + (c.zone as any[]).map((_, i) => `<div class="row zone">${sel(`zone.${i}.type`, [['A', 'A'], ['MX', 'MX'], ['TXT', 'TXT']])}${inp(`zone.${i}.name`, '', 'www')}${inp(`zone.${i}.value`, '', '値')}${del('zone', i)}</div>`).join('')
        + addBtn('zone', 'レコードを追加')
        + `<div class="info">インターネット上のだれもが引ける、自社ドメインの名前です。名前の <code>@</code> はドメインそのもの(${esc(c.domain)})を表します。<br><b>A</b> 名前 → IPアドレス<br><b>MX</b> メールの届け先のサーバー名<br><b>TXT</b> SPFなどの文字列 例 <code>v=spf1 ip4:203.0.113.2 -all</code></div>`;
    }
  }

  if (isHost(d.kind)) {
    const name = d.kind !== 'printer';
    const b = (k: string, label: string, title: string) => `<button class="btn small" data-act="diag" data-diag="${k}" title="${title}">${label}</button>`;
    h += `<h3>診断ツール</h3><div class="diag"><input id="diag-target" value="${esc(ctx.diagTarget)}" placeholder="${name ? '宛先: IPアドレス または 名前' : '宛先: IPアドレス'}" spellcheck="false" autocomplete="off">
      <div class="diag-row">${b('ping', 'ping', '宛先まで往復できるか')}${b('tracert', 'tracert', '途中で通る機器を順に表示')}${name ? b('nslookup', 'nslookup', '名前をIPアドレスに変えられるか') : ''}${d.kind === 'pc' ? b('web', 'Web閲覧', 'Webサイトを開けるか') : ''}</div>
      <div class="diag-row">${b('ipconfig', 'ipconfig', 'この機器のアドレス設定')}${b('arp', 'arp', '同じネットワークで見えている機器')}</div></div>`;
  }
  if (d.own === 'bought') h += '<button class="btn danger wide" data-act="remove">返品する(返金)</button>';
  if (d.own === 'stock') h += '<button class="btn wide" data-act="remove">倉庫に戻す</button>';
  if (d.own === 'supplied') h += '<button class="btn wide" data-act="remove">机から片付ける</button>';
  return h;
}
