// 検収テスト: 依頼ごとに生成され、すべて通れば納品できる
import { inCidr, ipStr, parseCidr, parseIp } from './ip';
import { Svc, SVC, World } from './model';
import { Net, WAN_IP, browse, build, connect, ipOf, reach, resolve, usableProxy, PUBLIC_DNS, EXTERNAL } from './sim';

export type Target =
  | { dev: string }                      // 机の上の機器
  | { name: string; dev?: string }       // 社内の名前(dev があれば、その機器を指していること)
  | { ext: string }                      // インターネット上の名前かIPアドレス
  | { pub: true };                       // 自社の公開アドレス(インターネット側から見た入口)

export type Check =
  | { t: 'addr'; devs: string[]; cidr: string }
  | { t: 'dhcp'; devs: string[] }
  | { t: 'flow'; from: string[]; to: Target; svc: Svc; expect: 'ok' | 'ng'; via?: 'proxy' }
  | { t: 'directWeb'; from: string[] }   // プロキシを通さず直接Webに出られないこと
  | { t: 'noProxy'; from: string[] }     // 社内のプロキシを使えないこと
  | { t: 'wifi'; devs: string[] }        // 無線でつながっていること
  | { t: 'redundant'; checks: Check[] }; // スイッチ間のケーブルが1本切れても通信が続くこと

export interface CheckResult { ok: boolean; reason?: string }
const ok: CheckResult = { ok: true };
const ng = (reason: string): CheckResult => ({ ok: false, reason });
const WEB_PROBE = parseIp(EXTERNAL['www.example.com'])!;

export type NameOf = (id: string) => string;

function checkOne(net: Net, q: Check, nameOf: NameOf, world?: World): CheckResult {
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
  const dev = (id: string) => net.byId.get(id);
  const ids = q.t === 'addr' || q.t === 'dhcp' || q.t === 'wifi' ? q.devs : q.from;
  const tgt = q.t === 'flow' && 'dev' in q.to && q.to.dev ? [q.to.dev] : [];
  const missing = [...ids, ...tgt].find(id => !dev(id));
  if (missing) return ng(`${nameOf(missing)} がまだ机に置かれていません`);
  const each = (list: string[], fn: (d: NonNullable<ReturnType<typeof dev>>) => CheckResult): CheckResult => {
    for (const id of list) { const r = fn(dev(id)!); if (!r.ok) return r; }
    return ok;
  };
  const by = (name: string, reason: string) => (reason.startsWith(name) ? reason : `${name}: ${reason}`);
  const needIp = (d: NonNullable<ReturnType<typeof dev>>): string | null => {
    if (d.kind === 'internet' || ipOf(net, d) != null) return null;
    const e = net.eff.get(d.id);
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
      const toDev = 'dev' in to && to.dev ? dev(to.dev)! : null;
      if (toDev) { const miss = needIp(toDev); if (miss) return ng(miss); }
      return each(q.from, s => {
        const miss = needIp(s);
        if (miss) return ng(miss);
        const attempt = (): CheckResult => {
          let host: string | number;
          if ('pub' in to) host = WAN_IP;
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
            return ok;
          }
          const r = connect(net, s, host, q.svc);
          if (!r.ok) return ng(r.reason);
          if (toDev && r.end !== toDev) return ng(`別の機器(${r.end.name})が応答しました`);
          return ok;
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
  'pub' in to ? '公開アドレス' : 'ext' in to ? (to.ext === PUBLIC_DNS ? `インターネット(${PUBLIC_DNS})` : to.ext) : 'name' in to ? to.name : nameOf(to.dev);

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
    case 'directWeb': return `${who(q.from)} から直接Webには出られない`;
    case 'noProxy': return `${who(q.from)} から社内のプロキシを使えない`;
    case 'flow': {
      const t = targetLabel(q.to, nameOf), w = who(q.from);
      if (q.expect === 'ng') return `${w} から ${t} に${q.svc === 'ping' ? '' : SVC[q.svc].label + 'で'}通信できない`;
      const named = 'name' in q.to && q.to.dev ? `(${nameOf(q.to.dev)})` : '';
      switch (q.svc) {
        case 'ping': return `${w} から ${t} に通信できる`;
        case 'web': return q.via === 'proxy' ? `${w} がプロキシ経由で ${t} を開ける` : 'pub' in q.to ? `${w} が公開Webサイトを開ける` : `${w} で ${t} を開ける`;
        case 'print': return `${w} から ${t}${named} で印刷できる`;
        case 'file': return `${w} から ${t}${named} の共有フォルダを使える`;
        case 'mail': return `${w} から ${t}${named} でメールを送れる`;
        case 'voice': return `${w} から ${t} に電話をかけられる`;
        default: return `${w} から ${t} に${SVC[q.svc].label}で通信できる`;
      }
    }
  }
}
