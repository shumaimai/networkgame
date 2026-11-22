// 納品後の振り返り: 何が原因だったか、どの診断で見つけられるか、機材費が模範解答とどう違ったか
import { Job, worldCost } from '../core/job';
import { CABLE_PRICE, MODEL, World } from '../core/model';

// 不具合の説明文から、それを見つけるのに向いた調べ方を選ぶ(上から順に当てはめる)
const FIND: [RegExp, string][] = [
  [/拠点間VPN|事前共有キー|VPNの認証キー|VPNで配るアドレス/, 'VPNの設定欄に出る「未接続」「つながっていません」の理由を読む'],
  [/仮想IP/, 'ルーターやL3スイッチの設定画面で、仮想IPアドレスをどの機器が受け持っているかを見る'],
  [/回線が .* ポートに挿さって/, 'ルーターを選び、WANの欄に「まだ回線につながっていません」と出ていないかを見る'],
  [/ケーブルが抜けて/, '机の上の配線を見る。arp で相手が見えるかを確かめてもよい'],
  [/と同じ\(|重複/, 'arp で、同じIPアドレスの機器が複数ないかを見る'],
  [/無線|SSID/, 'ノートPCとアクセスポイントの間に点線が出ているかを見る'],
  [/DHCP|配布範囲|自動取得/, '「自動取得」のPCで ipconfig を打ち、受け取ったアドレス、ゲートウェイ、DNSサーバーを確かめる'],
  [/別のネットワークのもの|サブネットマスク/, 'ipconfig の結果を、仕様書のアドレスと見比べる'],
  [/ゲートウェイ|LAN側のIPアドレス/, 'tracert で通信が最初の機器から先へ進まないことを確かめ、ゲートウェイの欄をルーターのアドレスと見比べる'],
  [/SPF|DKIM|DMARC/, '公開DNSのTXTレコードを、ガイドの例と見比べる'],
  [/DNS|フォワーダー|レコード/, 'nslookup で名前を引き、返ってくるアドレスを確かめる'],
  [/NAT/, 'ping の結果に「戻りの通信が失敗」と出ることを確かめる'],
  [/ルート|ネクストホップ/, 'tracert で、通信がどの機器まで進むかを見る。「戻りの通信が失敗」と出たら、返事の側のルートを確かめる'],
  [/VLAN|トランク/, '同じ部署の機器に ping を打ち、届かない機器がつながっているポートのVLAN番号を見る'],
  [/ルール/, 'ping や Web閲覧で×印が出た機器のフィルターを、上の行から順に読む'],
  [/プロキシ/, 'PCの「Web閲覧」を使い、結果に出る理由を読む'],
  [/監視/, '監視サービスの一覧で、「×」の行や抜けている機器を探す'],
  [/ポート転送|証明書|振り分け先|リバースプロキシ|Webサービス/, '外から届く順(公開DNS、ポート転送、サーバーの設定)に、設定を1つずつ確かめる'],
  [/利用を許可|ファイル共有|メールサービス/, 'サーバーを選び、サービスのオンと「利用を許可」を確かめる'],
];
export const findBy = (fault: string): string => FIND.find(([re]) => re.test(fault))?.[1] ?? '失敗する通信の途中にある機器を、手前から順に ping で確かめる';

const DIAG_ORDER = ['ping', 'tracert', 'nslookup', 'web', 'ipconfig', 'arp'];
const DIAG_LABEL: Record<string, string> = { web: 'Web閲覧' };
function diagLine(diag: Record<string, number>): string {
  const used = DIAG_ORDER.filter(k => diag[k]).map(k => `${DIAG_LABEL[k] ?? k} ${diag[k]}回`);
  return used.length ? `使った診断ツール: ${used.join('、')}` : '診断ツールは使いませんでした。';
}

export interface ReviewItem { head: string; body: string }
/** world: 納品したときの机の上。par: 模範解答の機材費(受注した週の値段)。diag: 診断ツールを使った回数 */
export function review(job: Job, world: World, par: number, diag: Record<string, number> = {}, o: { stars?: number; limit3?: number; answerUsed?: boolean } = {}): ReviewItem[] {
  const out: ReviewItem[] = [], money = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
  // ★が3つに届かなかった理由
  if (o.stars != null && o.stars < 3) {
    const why = [o.limit3 != null && worldCost(world) > o.limit3 ? `機材費が ${money(worldCost(world))} で、★3になる上限(${money(o.limit3)})を超えました。` : '', o.answerUsed ? 'ヘルプの「答えを見る」を使ったので、★が1つ減りました。' : ''].filter(Boolean);
    if (why.length) out.push({ head: '評価', body: why.join('') });
  }
  if (job.kind === 'trouble') {
    for (const f of job.faults.slice(0, 4)) out.push({ head: '原因', body: `${f}。見つけ方: ${findBy(f)}` });
    // 診断ツールを使わずに直したとき(配線を見れば分かる不具合だけの依頼は除く)
    const used = Object.values(diag).some(n => n > 0), visible = job.faults.every(f => /ケーブルが抜けて|ポートに挿さって/.test(f));
    out.push({ head: '診断', body: diagLine(diag) + (!used && !visible ? '設定画面を1台ずつ開いて見つける方法でも直せますが、機器が増えると時間がかかります。先に tracert や ipconfig を使うと、開く設定画面を絞れます。' : '') });
    return out;
  }
  const cost = worldCost(world), yen = money;
  // 購入した機材(在庫品を含む)とケーブルを、模範解答と比べる
  const count = (w: World, own: string[]) => { const m: Record<string, number> = {}; for (const d of w.devices) if (own.includes(d.own)) m[d.model] = (m[d.model] ?? 0) + 1; return m; };
  const mine = count(world, ['bought', 'stock']), ref = count(job.solution, ['bought']);
  const myCables = world.cables.filter(c => !c.free).length, refCables = job.solution.cables.filter(c => !c.free).length;
  const models = [...new Set([...Object.keys(ref), ...Object.keys(mine)])].filter(k => (mine[k] ?? 0) !== (ref[k] ?? 0));
  const list = (m: Record<string, number>, cables: number) => [...models.filter(k => m[k]).map(k => `${MODEL[k].label} ${m[k]}台`), ...(myCables !== refCables ? [`LANケーブル ${cables}本`] : [])].join('、') || '追加の機材なし';
  const more = models.filter(k => (mine[k] ?? 0) > (ref[k] ?? 0)), fewer = models.filter(k => (mine[k] ?? 0) < (ref[k] ?? 0));
  let body = cost <= par ? `${yen(cost)} でした。模範解答(${yen(par)})と同じか、それより少ない額です。` : `${yen(cost)} でした。模範解答(${yen(par)})より ${yen(cost - par)} 多くかかっています。`;
  if (fewer.length || (more.length && myCables < refCables)) {
    // 機材を入れ替えた構成: 足した・減らしたの両方を並べる
    body += `構成の違い: 模範解答は ${list(ref, refCables)}。今回は ${list(mine, myCables)}。`;
    // 机の上に残した機器(お客様のものも含む)の台数で比べる
    const infra = (w: World) => w.devices.filter(x => x.own !== 'fixed' && !['pc', 'printer', 'phone', 'camera', 'pos'].includes(x.kind)).length;
    const d = infra(job.solution) - infra(world), less = [d > 0 ? `机の上の機器は${d}台少なく` : '', myCables < refCables ? `LANケーブルは${refCables - myCables}本少なく` : ''].filter(Boolean);
    if (less.length) body += `${less.join('、')}済んでいます。機器やケーブルが少ないと、配線と故障の調査が簡単になります。${cost > par ? '値段と配線の簡単さのどちらを取るかは、設計する人が決めます。' : ''}`;
    else if (d < 0) body += `机の上の機器は${-d}台多くなっています。`;
  } else if (more.length || myCables > refCables) {
    body += `模範解答より多く使ったもの: ${[...more.map(k => `${MODEL[k].label} ${mine[k] - (ref[k] ?? 0)}台`), ...(myCables > refCables ? [`LANケーブル ${myCables - refCables}本(1本 ${yen(CABLE_PRICE)})`] : [])].join('、')}`;
  } else if (cost > par) body += '機材の数は模範解答と同じで、買ったときの値段が違います。';
  out.push({ head: '機材費', body });
  out.push({ head: '診断', body: diagLine(diag) });
  return out;
}
