// 検収テスト: 依頼ごとに生成され、すべて通れば納品できる
import { inCidr, ipStr, parseCidr, parseIp } from './ip';
import { Kind, Svc, SVC, World } from './model';
import { Net, WAN_IP, lineIp, browse, build, certCovers, connect, dkimResult, dmarcResult, ipOf, lbAlive, mailIn, mailOut, monitorResult, reach, resolve, usableProxy, webChain, PUBLIC_DNS, EXTERNAL } from './sim';

export type Target =
  | { dev: string }                      // 机の上の機器
  | { name: string; dev?: string }       // 社内の名前(dev があれば、その機器を指していること)
  | { ext: string }                      // インターネット上の名前かIPアドレス
  | { pub: true; ip?: string };          // 自社の公開アドレス(インターネット側から見た入口。ip を省くと1本目の回線)

export type Check =
  | { t: 'addr'; devs: string[]; cidr: string }
  | { t: 'dhcp'; devs: string[] }
  /** via: プロキシ経由か直接か。https: 証明書の名前が合うこと。by: そのWebサーバーが応答すること */
  | { t: 'flow'; from: string[]; to: Target; svc: Svc; expect: 'ok' | 'ng'; via?: 'proxy' | 'direct'; https?: boolean; by?: string; /** その回線(0始まり)から出ていくこと */ line?: number }
  | { t: 'mailIn'; domain: string }      // 社外から自社ドメイン宛のメールが届くこと
  | { t: 'mailOut' }                     // 社外へ送ったメールがSPFの検査を通ること
  | { t: 'dkim' }                        // 社外へ送ったメールのDKIM署名を検証できること
  | { t: 'dmarc' }                       // DMARCのレコードで、認証に失敗したメールの扱いを示していること
  | { t: 'monitor' }                     // 監視サーバーが機器すべての応答を確認できること
  | { t: 'gone'; dev: string }           // その機器を撤去してあること
  | { t: 'unused'; dev: string }         // その機器にケーブルがつながっていないこと
  /** near を指定すると、その機器と同じネットワークにつながっている機器だけを止めてみる */
  | { t: 'failover'; kinds: Kind[]; what: string; near?: string; checks: Check[] } // その種類の機器が1台止まっても通信が続くこと
  | { t: 'lb'; min: number }             // 負荷分散装置が min 台以上のWebサーバーに振り分けていること
  | { t: 'directWeb'; from: string[] }   // プロキシを通さず直接Webに出られないこと
  | { t: 'noProxy'; from: string[] }     // 社内のプロキシを使えないこと
  | { t: 'wifi'; devs: string[] }        // 無線でつながっていること
  | { t: 'redundant'; checks: Check[] }; // スイッチ間のケーブルが1本切れても通信が続くこと

export interface CheckResult { ok: boolean; reason?: string; /** 故障テスト中のため、判定を保留している */ hold?: boolean }
const ok: CheckResult = { ok: true };
const ng = (reason: string): CheckResult => ({ ok: false, reason });
const WEB_PROBE = parseIp(EXTERNAL['www.example.com'])!;

export type NameOf = (id: string) => string;

function checkOne(net: Net, q: Check, nameOf: NameOf, world?: World): CheckResult {
  if ((q.t === 'failover' || q.t === 'redundant') && world?.devices.some(d => d.off)) {
    return { ok: false, hold: true, reason: '故障テストで機器を止めている間は判定しません。止めた機器を動かすと判定します。' };
  }
  if (q.t === 'redundant') {
    const kind = (id: string) => net.byId.get(id)?.kind ?? '';
    const sw = (id: string) => ['l2', 'l2m', 'l3'].includes(kind(id));
    const base = q.checks.map(c => checkOne(net, c, nameOf)).find(r => !r.ok);
    if (base) return base;
    for (const c of world?.cables ?? []) {
      if (!sw(c.a.dev) || !sw(c.b.dev)) continue;
      const cut = build(world!.devices, world!.cables.filter(x => x !== c));
      if (q.checks.some(x => !checkOne(cut, x, nameOf).ok)) return ng(`${nameOf(c.a.dev)} と ${nameOf(c.b.dev)} の間のケーブルが切れると、通信できなくなります`);
    }
    return ok;
  }
  if (q.t === 'failover') {
    const base = q.checks.map(c => checkOne(net, c, nameOf)).find(r => !r.ok);
    if (base) return base;
    const seg = q.near ? net.ifaces.find(i => i.dev.id === q.near)?.seg : undefined;
    const list = (world?.devices ?? []).filter(d => q.kinds.includes(d.kind) && d.own !== 'fixed' && !d.off && (!seg || net.ifaces.some(i => i.dev === d && i.seg === seg)));
    if (list.length < 2) return ng(`${q.what}が${list.length}台しかなく、止まると通信できなくなります`);
    for (const d of list) {
      const cut = build(world!.devices.filter(x => x !== d), world!.cables.filter(c => c.a.dev !== d.id && c.b.dev !== d.id));
      const bad = q.checks.map(x => checkOne(cut, x, nameOf)).find(r => !r.ok);
      if (bad) return ng(`${d.name} が止まると通信できなくなります(${bad.reason})`);
    }
    return ok;
  }
  const dev = (id: string) => net.byId.get(id);
  if (q.t === 'gone') return (world ? world.devices.some(d => d.id === q.dev) : !!dev(q.dev)) ? ng(`${nameOf(q.dev)} がまだ机の上にあります(机から片付けます)`) : ok;
  if (q.t === 'unused') return (world?.cables ?? []).some(c => c.a.dev === q.dev || c.b.dev === q.dev) ? ng(`${nameOf(q.dev)} にケーブルがつながったままです`) : ok;
  if (q.t === 'mailIn' || q.t === 'mailOut' || q.t === 'dkim' || q.t === 'dmarc' || q.t === 'monitor') {
    const r = q.t === 'mailIn' ? mailIn(net) : q.t === 'mailOut' ? mailOut(net) : q.t === 'dkim' ? dkimResult(net) : q.t === 'dmarc' ? dmarcResult(net) : monitorResult(net);
    return r.ok ? ok : ng(r.reason);
  }
  if (q.t === 'lb') {
    const lb = net.devices.find(d => d.kind === 'lb');
    if (!lb) return ng('負荷分散装置がまだ机に置かれていません');
    const a = lbAlive(net, lb);
    if (a.all < q.min) return ng(`${lb.name} の振り分け先が ${a.all}台しか登録されていません`);
    return a.alive.length >= q.min ? ok : ng(`${lb.name} の振り分け先のうち、応答できるWebサーバーが ${a.alive.length}台しかありません`);
  }
  const ids = 'devs' in q ? q.devs : q.from;
  const tgt = q.t === 'flow' && 'dev' in q.to && q.to.dev ? [q.to.dev] : [];
  const missing = [...ids, ...tgt].find(id => !dev(id));
  if (missing) return ng(net.off.has(missing) ? `${nameOf(missing)} は故障テストで止めてあります` : `${nameOf(missing)} がまだ机に置かれていません`);
  const each = (list: string[], fn: (d: NonNullable<ReturnType<typeof dev>>) => CheckResult): CheckResult => {
    for (const id of list) { const r = fn(dev(id)!); if (!r.ok) return r; }
    return ok;
  };
  const by = (name: string, reason: string) => (reason.startsWith(name) ? reason : `${name}: ${reason}`);
  const needIp = (d: NonNullable<ReturnType<typeof dev>>): string | null => {
    if (d.kind === 'internet' || ipOf(net, d) != null) return null;
    const e = net.eff.get(d.id);
    if (d.kind === 'home') return `${d.name} はVPNにつながっていません(${e?.note ?? ''})`;
    return e?.dhcp ? `${d.name} はIPアドレスを取得できていません(${e.note ?? ''})` : `${d.name} のIPアドレスが未設定です`;
  };

  switch (q.t) {
    case 'addr': {
      const c = parseCidr(q.cidr)!;
      return each(q.devs, d => {
        const miss = needIp(d);
        if (miss) return ng(miss);
        const ip = ipOf(net, d)!;
        return inCidr(ip, c) ? ok : ng(`${d.name} (${ipStr(ip)}) が ${q.cidr} の範囲外です`);
      });
    }
    case 'dhcp':
      return each(q.devs, d => {
        const e = net.eff.get(d.id);
        if (!e?.dhcp) return ng(`${d.name} が「自動取得(DHCP)」になっていません`);
        return e.ip != null ? ok : ng(`${d.name} はIPアドレスを取得できていません(${e.note ?? ''})`);
      });
    case 'wifi':
      return each(q.devs, d => (net.eff.get(d.id)?.ap ? ok : ng(`${d.name} が無線でつながっていません(ケーブルを外し、SSIDと暗号化キーをアクセスポイントに合わせます)`)));
    case 'directWeb':
      return each(q.from, s => {
        const miss = needIp(s);
        if (miss) return ng(miss);
        return reach(net, s, WEB_PROBE, { svc: 'web' }).ok ? ng(`${s.name} からプロキシを通さず直接Webに出られてしまいます`) : ok;
      });
    case 'noProxy':
      return each(q.from, s => {
        const miss = needIp(s);
        if (miss) return ng(miss);
        const p = usableProxy(net, s);
        return p ? ng(`${s.name} から ${p.name} のプロキシを使えてしまいます`) : ok;
      });
    case 'flow': {
      const to = q.to;
      // 証明書の名前と、実際に応答したWebサーバーを確かめる
      const cert = (end: NonNullable<ReturnType<typeof dev>>): CheckResult => {
        if (q.svc !== 'web' || !('name' in to) || (!q.https && !q.by)) return ok;
        const c = webChain(net, end, to.name);
        if (!c.ok) return ng(c.reason);
        if (end.kind === 'internet') return ng(`${to.name} が、自社のサーバーではないアドレスを指しています`);
        const bad = q.https ? c.tls.find(x => !certCovers(x.cfg.cert, to.name)) : undefined;
        if (bad) return ng(`${bad.name} の証明書の名前(${bad.cfg.cert || '未設定'})が、アクセス先の ${to.name} に当てはまりません`);
        if (q.by && !c.served.some(x => x.id === q.by)) return ng(`${to.name} に、${nameOf(q.by)} ではなく ${c.served.map(x => x.name).join('・')} が応答しました`);
        return ok;
      };
      const toDev = 'dev' in to && to.dev ? dev(to.dev)! : null;
      if (toDev) { const miss = needIp(toDev); if (miss) return ng(miss); }
      return each(q.from, s => {
        const miss = needIp(s);
        if (miss) return ng(miss);
        const attempt = (): CheckResult => {
          let host: string | number;
          if ('pub' in to) host = to.ip ? parseIp(to.ip)! : WAN_IP;
          else if ('ext' in to) host = to.ext;
          else if ('name' in to) {
            const d = resolve(net, s, to.name);
            if (!d.ok) return ng(d.reason);
            if (toDev && d.ip !== ipOf(net, toDev)) return ng(`${to.name} が ${toDev.name} (${ipStr(ipOf(net, toDev)!)}) ではなく ${ipStr(d.ip)} を指しています`);
            host = q.svc === 'web' ? to.name : d.ip;
          } else host = ipOf(net, toDev!)!;
          if (q.svc === 'web' && s.kind === 'pc') {
            const r = browse(net, s, typeof host === 'number' ? ipStr(host) : host);
            if (!r.ok) return ng(r.reason);
            if (q.via === 'proxy' && r.via !== 'proxy') return ng(`${s.name} にプロキシが設定されていません`);
            if (q.via === 'direct' && r.via !== 'direct') return ng(`${s.name} が ${targetLabel(to, nameOf)} にプロキシ経由でつないでいます(「プロキシを使わない宛先」に登録します)`);
            if (q.line != null && r.seen !== lineIp(q.line)) return ng(`${s.name} から ${targetLabel(to, nameOf)} への通信が、回線${q.line + 1}ではなく別の回線(${ipStr(r.seen)})から出ています`);
            return cert(r.end);
          }
          const r = connect(net, s, host, q.svc);
          if (!r.ok) return ng(r.reason);
          if (toDev && r.end !== toDev) return ng(`別の機器(${r.end.name})が応答しました`);
          return cert(r.end);
        };
        const r = attempt();
        if (q.expect === 'ok') return r.ok ? ok : ng(by(s.name, r.reason!));
        return r.ok ? ng(`${s.name} から ${targetLabel(to, nameOf)} に${SVC[q.svc].label}で通信できてしまいます`) : ok;
      });
    }
  }
}

export function evaluate(world: World, checks: Check[], nameOf: NameOf = id => id): CheckResult[] {
  const net = build(world.devices, world.cables);
  return checks.map(q => checkOne(net, q, nameOf, world));
}

const targetLabel = (to: Target, nameOf: NameOf): string =>
  'pub' in to ? (to.ip ? `公開アドレス(${to.ip})` : '公開アドレス') : 'ext' in to ? (to.ext === PUBLIC_DNS ? `インターネット(${PUBLIC_DNS})` : to.ext) : 'name' in to ? to.name : nameOf(to.dev);

const listNames = (ids: string[], nameOf: NameOf): string => {
  const names = ids.map(nameOf);
  return names.length <= 3 ? names.join('・') : `${names.slice(0, 2).join('・')} ほか${names.length - 2}台`;
};

/** 検収テストを日本語の1行にする */
export function describe(q: Check, nameOf: NameOf, group?: string): string {
  const who = (ids: string[]) => group ?? (ids[0] === 'inet' ? 'インターネット側の利用者' : listNames(ids, nameOf));
  switch (q.t) {
    case 'addr': return `${who(q.devs)} のIPアドレスが ${q.cidr} の範囲内`;
    case 'dhcp': return `${who(q.devs)} がDHCPでIPアドレスを自動取得している`;
    case 'wifi': return `${who(q.devs)} が無線LANでつながっている`;
    case 'redundant': return 'スイッチ同士をつなぐケーブルが1本切れても、社内の通信が続く';
    case 'mailIn': return `社外から ${q.domain} 宛に送られたメールが届く`;
    case 'mailOut': return '社外へ送ったメールが、なりすましと判定されずに届く';
    case 'lb': return `負荷分散装置が ${q.min}台のWebサーバーに振り分けている`;
    case 'dkim': return '社外へ送ったメールのDKIM署名を、受信側が検証できる';
    case 'dmarc': return 'DMARCのレコードで、認証に失敗したメールを受け取らないよう示している';
    case 'monitor': return '監視サーバーが、ネットワーク機器とサーバーすべての応答を確認できる';
    case 'gone': return `${nameOf(q.dev)} を撤去してある`;
    case 'unused': return `${nameOf(q.dev)} にケーブルがつながっていない`;
    case 'failover': return `${q.what}のどれか1台が止まっても、通信が続く`;
    case 'directWeb': return `${who(q.from)} から直接Webには出られない`;
    case 'noProxy': return `${who(q.from)} から社内のプロキシを使えない`;
    case 'flow': {
      const t = targetLabel(q.to, nameOf), w = who(q.from);
      if (q.expect === 'ng') return q.svc === 'ping' ? `${w} から ${t} に通信できない` : `${w} から ${t} に${SVC[q.svc].label}で通信できない`;
      const named = 'name' in q.to && q.to.dev ? `(${nameOf(q.to.dev)})` : '';
      switch (q.svc) {
        case 'ping': return `${w} から ${t} に通信できる`;
        case 'web': if (q.by) return `${w} が ${q.https ? 'https://' : ''}${t} を開くと、${nameOf(q.by)} が応答する${q.https ? '(証明書の警告なし)' : ''}`;
          if (q.line != null) return `${w} が、プロキシを通さず回線${q.line + 1}から直接 ${t} を開ける`;
          if (q.via === 'direct') return `${w} がプロキシを通さずに ${t} を開ける`;
          return q.https ? `${w} が https://${t} を証明書の警告なしで開ける` : q.via === 'proxy' ? `${w} がプロキシ経由で ${t} を開ける` : 'pub' in q.to ? `${w} が公開Webサイトを開ける` : `${w} で ${t} を開ける`;
        case 'print': return `${w} から ${t}${named} で印刷できる`;
        case 'file': return `${w} から ${t}${named} の共有フォルダを使える`;
        case 'mail': return `${w} から ${t}${named} でメールを送れる`;
        case 'voice': return `${w} から ${t} に電話をかけられる`;
        default: return `${w} から ${t} に${SVC[q.svc].label}で通信できる`;
      }
    }
  }
}
