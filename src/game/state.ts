// ゲームの進行: 資金、レベル、評判、相場、倉庫、受注ボード、受注中の依頼
import { CheckResult } from '../core/checks';
import { generate } from '../core/gen';
import { Job, mulberry, worldCost } from '../core/job';
import { CABLE_PRICE, Device, MODEL, MODELS, World, clone, makeDevice } from '../core/model';
import { LEVEL_CAP } from './edition';
import { regularJob } from './regular';
import { TUTORIALS, tutorialJob } from './tutorial';

export const MAX_LEVEL = LEVEL_CAP;
export const START_MONEY = 30000;
/** レベル n になるのに必要な累計経験値 */
export const xpFor = (n: number): number => 45 * (n - 1) * (n + 2);

export interface LevelInfo { level: number; title: string; unlocks: string[] }
export const LEVELS: LevelInfo[] = [
  { level: 1, title: '見習い', unlocks: ['L2スイッチ', 'IPアドレスとサブネットマスク', 'ping'] },
  { level: 2, title: '見習い', unlocks: ['ルーター', 'デフォルトゲートウェイ、NAT、公開DNS', 'トラブル対応の依頼'] },
  { level: 3, title: '新人', unlocks: ['DHCP(ルーター内蔵)', 'L2スイッチ 16ポート', 'ARP表、tracert'] },
  { level: 4, title: '新人', unlocks: ['サーバー', 'DNSサービス(レコード、フォワーダー)'] },
  { level: 5, title: '若手', unlocks: ['サブネット分割(/25〜/28)', '2つのネットワークをルーターでつなぐ'] },
  { level: 6, title: '若手', unlocks: ['プロキシサービス', 'パケットフィルター(許可・拒否ルール)'] },
  { level: 7, title: '一人前', unlocks: ['NAS、ファイル共有', 'ゲスト用ネットワークの分離'] },
  { level: 8, title: '一人前', unlocks: ['L3スイッチ、VLAN対応スイッチ', 'VLAN、VLAN間ルーティング、スタティックルート'] },
  { level: 9, title: '中堅', unlocks: ['DHCPサービス(サーバー)', 'DHCPリレー'] },
  { level: 10, title: '中堅', unlocks: ['ファイアウォール', 'DMZ、公開サーバー、ポート転送'] },
  { level: 11, title: 'ベテラン', unlocks: ['VLAN対応スイッチ 24ポート', 'トランクポート(階をまたぐVLAN)'] },
  { level: 12, title: 'ベテラン', unlocks: ['ループと冗長化', 'メールサービス', 'L3スイッチ 24ポート'] },
  { level: 13, title: '匠', unlocks: ['無線アクセスポイント、無線LAN'] },
  { level: 14, title: '匠', unlocks: ['VPN(テレワーク)'] },
  { level: 15, title: '名人', unlocks: ['公開DNS(A・MX・TXTレコード)', 'HTTPSと証明書', 'SPF(メールの送信元の証明)'] },
  { level: 16, title: '名人', unlocks: ['負荷分散装置'] },
  { level: 17, title: '達人', unlocks: ['リバースプロキシ', 'ワイルドカード証明書、TLSの終端'] },
  { level: 18, title: '達人', unlocks: ['送信ドメイン認証(DKIM・DMARC)', 'プロキシを使わない宛先'] },
  { level: 19, title: '設計者', unlocks: ['広域イーサネット(本店と支店)', '業務用ルーター 4LAN', '構成変更の依頼'] },
  { level: 20, title: '設計者', unlocks: ['回線の複数契約', '拠点間VPN'] },
  { level: 21, title: '主任設計者', unlocks: ['ゲートウェイの冗長化(VRRP)', 'DHCPサーバーの二重化'] },
  { level: 22, title: '主任設計者', unlocks: ['クラウド、仮想サーバー', 'セキュリティグループ、クラウドへの移行'] },
  { level: 23, title: '統括', unlocks: ['監視サービス', 'L3スイッチの二重化'] },
  { level: 24, title: '統括', unlocks: ['複数の拠点とクラウドをまたぐ総合案件'] },
];

export interface Offer { id: string; seed: number; level: number; kind: 'build' | 'trouble'; ease: number; /** 常連のお客様からの依頼 */ special?: 'tanaka' }
/** 常連の依頼が出はじめる週 */
export const REGULAR_WEEK = 3;
/** 常連の依頼が出るのは、このレベルまで */
export const REGULAR_MAX_LEVEL = 6;
/** ハードモード(納期つき)で連続して成功したときの、経験値の倍率。n回目の成功に、n番目の値を掛ける(7回目からは最後の値) */
export const STREAK_XP = [1.5, 2, 3, 4, 6, 8];
export const streakMult = (n: number): number => (n <= 0 ? 1 : STREAK_XP[Math.min(n, STREAK_XP.length) - 1]);

/** プレイグラウンド(お金も依頼もない机)で、作業画面に渡す依頼。検収テストも報酬もない */
export const PLAY_JOB: Job = {
  id: 'playground', seed: 0, kind: 'build', client: '', industry: '事務所', person: '', title: '自由に組んで試す', brief: '', spec: [], tags: [],
  supplied: [], checks: [], initial: { devices: [], cables: [] }, solution: { devices: [], cables: [] }, par: 0,
  difficulty: { stars: 0, score: 0, factors: [] }, reward: 0, xp: 0, minutes: 0, hints: [], faults: [],
};
/** プレイグラウンドで、机の上に1つだけ置ける機器(種類 → ID)と、その名前 */
const PLAY_SINGLE: Record<string, [string, string]> = { internet: ['inet', 'インターネット'], cloud: ['cloud', 'クラウド'], wan: ['wan', '広域イーサネット'] };

export interface HelpUse { plan: boolean; reasons: boolean; answer: boolean }
export interface Active {
  offer: Offer | null;
  tutorial: string | null;
  world: World;
  /** 机から片付けたお客様の機器の設定 */
  shelf: Record<string, any>;
  /** 外して手元にあるお客様のケーブルの本数 */
  spare: number;
  seq: number;
  challenge: boolean;
  elapsed: number;
  help: HelpUse;
  advance: number;
  /** 受注したときの契約金と、その週の相場で見た模範解答の機材費 */
  reward?: number;
  par?: number;
  /** 診断ツールを使った回数(納品後の振り返りに出す) */
  diag?: Record<string, number>;
}
export interface StockItem { qty: number; cost: number }
export interface PriceMove { model: string; before: number; now: number }
export type PlanId = 'none' | 's' | 'm' | 'l' | 'custom';
export const PLANS: Record<Exclude<PlanId, 'custom'>, { label: string; fee: number; cap: number }> = {
  none: { label: '店の棚', fee: 0, cap: 6 },
  s: { label: '小さな倉庫', fee: 1500, cap: 20 },
  m: { label: '中くらいの倉庫', fee: 3500, cap: 60 },
  l: { label: '大きな倉庫', fee: 7000, cap: 150 },
};
/** 金額指定の倉庫: 定額より割高だが、いくらでも広くできる */
export const CUSTOM_RATE = 90;

/** 依頼1件ごとの記録(どこで止まりやすいかを調べるために残す) */
export interface PlayLog {
  week: number; level: number; client: string; title: string; kind: string; tags: string[]; score: number;
  result: 'delivered' | 'abandoned'; stars: number; seconds: number; challenge: boolean;
  help: string[]; diag: Record<string, number>;
  /** 取り下げたときに、不合格のまま残っていた検収テスト */
  failed: string[];
}
export interface HistoryItem { client: string; title: string; kind: string; stars: number; profit: number; week: number }
export interface Save {
  v: 2;
  seed: number;
  money: number; xp: number; rep: number; week: number;
  tutorialDone: string[];
  tutorialSkipped: boolean;
  market: Record<string, number>;
  stock: Record<string, StockItem>;
  plan: PlanId; planFee: number;
  board: Offer[];
  active: Active | null;
  history: HistoryItem[];
  seenDict: string[];
  /** 前の週の相場(値動きの表示に使う) */
  prevMarket?: Record<string, number>;
  /** 週の変わり目の知らせを出し終えた週 */
  weekSeen?: number;
  /** 直前の週の変わり目に払った倉庫代 */
  lastFee?: number;
  /** 納品したときの机の上(常連の依頼で、続きから作業するために残す) */
  keep?: Record<string, World>;
  /** 納品し終えた常連の依頼 */
  regularDone?: string[];
  log?: PlayLog[];
  /** 納品した件数、利益の合計、★3の件数 */
  totals?: { n: number; profit: number; star3: number };
  /** ハードモードで連続して成功している回数と、これまでの最高 */
  streak?: number;
  bestStreak?: number;
  /** プレイグラウンドの机の上 */
  play?: Active;
  /** 研修のあとの「進め方の説明」を見終えた(途中で終えた場合も含む) */
  introSeen?: boolean;
  settings: { sfx: number; bgm: number };
}

export interface Outcome {
  /** ハードモードの連続成功: 納品する前の回数、納品したあとの回数、経験値に掛けた倍率 */
  streakBefore: number; streak: number; xpMult: number;
  stars: number; reward: number; parts: { label: string; amount: number }[];
  cost: number; profit: number; xp: number;
  levelBefore: number; levelAfter: number; unlocks: string[];
  onTime: boolean | null; repDelta: number; final: number;
}

export const HELP_COST: Record<keyof HelpUse, number> = { plan: 0.1, reasons: 0.2, answer: 0.4 };
export const BULK: [number, number][] = [[20, 0.2], [10, 0.15], [5, 0.1], [3, 0.05]];
export const bulkRate = (qty: number): number => BULK.find(([n]) => qty >= n)?.[1] ?? 0;

export function newSave(seed = (Date.now() ^ (Math.random() * 2 ** 31)) >>> 0): Save {
  return {
    v: 2, seed, money: START_MONEY, xp: 0, rep: 50, week: 1, tutorialDone: [], tutorialSkipped: false,
    market: {}, stock: {}, plan: 'none', planFee: 0, board: [], active: null, history: [], seenDict: [], settings: { sfx: 0.7, bgm: 0.4 },
  };
}

export class Game {
  private jobCache = new Map<string, Job>();
  constructor(public s: Save, private persist: (s: Save) => void = () => {}) {}
  save(): void { this.persist(this.s); }

  // ---- プレイグラウンド ----
  /** プレイグラウンドを開いている間は true。機器もケーブルも無料で、レベルに関係なく置ける */
  sandbox = false;
  playground(): Active {
    return (this.s.play ??= { offer: null, tutorial: null, world: { devices: [], cables: [] }, shelf: {}, spare: 0, seq: 1, challenge: false, elapsed: 0, help: { plan: false, reasons: false, answer: false }, advance: 0 });
  }
  clearPlayground(): void { this.s.play = undefined; this.save(); }
  /** いま作業している机(プレイグラウンドか、受注した依頼) */
  private get cur(): Active { return this.sandbox ? this.playground() : this.s.active!; }
  private playDevice(model: string): Device | string {
    const m = MODEL[model], single = PLAY_SINGLE[m.kind];
    if (single && this.cur.world.devices.some(d => d.kind === m.kind)) return `${single[1]}は、机の上に1つだけ置けます。`;
    const d = makeDevice(model, single ? single[0] : this.nextId(), single ? single[1] : this.nameFor(model), 'bought', 0, 0, 0);
    // 公開DNSのレコードを編集できるよう、回線にはドメインを付けておく
    if (m.kind === 'internet') d.cfg.domain = 'play.example.jp';
    return d;
  }
  get streak(): number { return this.s.streak ?? 0; }

  // ---- レベル ----
  get level(): number {
    let n = 1;
    while (n < MAX_LEVEL && this.s.xp >= xpFor(n + 1)) n++;
    return n;
  }
  get levelInfo(): LevelInfo { return LEVELS[this.level - 1]; }
  /** 次のレベルまでの進み具合(0〜1) */
  get xpProgress(): number {
    const n = this.level;
    if (n >= MAX_LEVEL) return 1;
    return (this.s.xp - xpFor(n)) / (xpFor(n + 1) - xpFor(n));
  }
  /** 納品の合計。この数え方を入れる前のセーブでは、残っている一覧と記録から求める(利益は一覧に残っている分だけ) */
  get totals(): { n: number; profit: number; star3: number } {
    if (this.s.totals) return this.s.totals;
    const h = this.s.history, done = (this.s.log ?? []).filter(x => x.result === 'delivered');
    return { n: Math.max(h.length, done.length), profit: h.reduce((t, x) => t + x.profit, 0), star3: Math.max(h.filter(x => x.stars === 3).length, done.filter(x => x.stars === 3).length) };
  }
  get tutorialFinished(): boolean { return this.s.tutorialSkipped || TUTORIALS.every(t => this.s.tutorialDone.includes(t.id)); }
  get nextTutorial(): string | null { return this.tutorialFinished ? null : TUTORIALS.find(t => !this.s.tutorialDone.includes(t.id))!.id; }
  /** 評判(0〜100)を★の数(0.5刻み)にする */
  get repStars(): number { return Math.round(this.s.rep / 10) / 2; }
  get repMult(): number { return 0.85 + (this.s.rep / 100) * 0.3; }

  skipTutorial(): void {
    this.s.tutorialSkipped = true;
    this.s.xp = Math.max(this.s.xp, TUTORIALS.reduce((t, x) => t + x.xp, 0));
    if (!this.s.board.length) this.refreshBoard();
    this.save();
  }

  // ---- 相場と倉庫 ----
  mult(model: string): number { return this.s.market[model] ?? 1; }
  price(model: string): number { return Math.round((MODEL[model].price * this.mult(model)) / 100) * 100; }
  /** いま購入できる機材 */
  get catalog(): string[] { return MODELS.filter(m => m.price > 0 && m.level <= this.level).map(m => m.id); }
  get capacity(): number { return this.s.plan === 'custom' ? Math.floor(this.s.planFee / CUSTOM_RATE) : PLANS[this.s.plan].cap; }
  get weeklyFee(): number { return this.s.plan === 'custom' ? this.s.planFee : PLANS[this.s.plan].fee; }
  /** 前の週から値段が大きく動いた機材。値下がりと値上がりを、動きの大きい順に返す */
  priceMoves(max = 3): { down: PriceMove[]; up: PriceMove[] } {
    const prev = this.s.prevMarket;
    if (!prev) return { down: [], up: [] };
    const at = (m: string, k: number) => Math.round((MODEL[m].price * k) / 100) * 100;
    const list = this.catalog.map(m => ({ model: m, before: at(m, prev[m] ?? 1), now: this.price(m) })).filter(x => Math.abs(x.now / x.before - 1) >= 0.1);
    list.sort((a, b) => a.now / a.before - b.now / b.before);
    return { down: list.filter(x => x.now < x.before).slice(0, max), up: list.filter(x => x.now > x.before).reverse().slice(0, max) };
  }
  /** 机の上の在庫品の仕入れ値と、今週の新品の値段の差。正なら在庫のほうが安い(倉庫代は含まない) */
  stockDiff(w: World): number {
    return w.devices.reduce((t, d) => t + (d.own === 'stock' ? this.price(d.model) - d.cost : 0), 0);
  }
  /** まだ買えない機材を、買えるようになるレベルの順に全部返す(この版の上限のレベルまで) */
  upcoming(): string[] {
    return MODELS.filter(m => m.price > 0 && m.level > this.level && m.level <= MAX_LEVEL).sort((a, b) => a.level - b.level).map(m => m.id);
  }
  get stockUsed(): number { return Object.entries(this.s.stock).reduce((t, [m, i]) => t + MODEL[m].size * i.qty, 0); }
  stockQty(model: string): number { return this.s.stock[model]?.qty ?? 0; }

  quote(model: string, qty: number): { unit: number; total: number; rate: number } {
    const rate = bulkRate(qty), unit = Math.round((this.price(model) * (1 - rate)) / 10) * 10;
    return { unit, total: unit * qty, rate };
  }
  /** 仕入れ。倉庫に入りきらない、または資金が足りないときは理由を返す */
  buyStock(model: string, qty: number): string | null {
    const q = this.quote(model, qty);
    if (q.total > this.s.money) return '資金が足りません';
    if (this.stockUsed + MODEL[model].size * qty > this.capacity) return '倉庫のスロットが足りません';
    const it = this.s.stock[model] ?? { qty: 0, cost: 0 };
    it.qty += qty; it.cost += q.total;
    this.s.stock[model] = it;
    this.s.money -= q.total;
    this.save();
    return null;
  }
  sellPrice(model: string): number { return Math.round((this.price(model) * 0.7) / 10) * 10; }
  sellStock(model: string, qty: number): void {
    const it = this.s.stock[model];
    if (!it || it.qty < qty) return;
    it.cost -= Math.round((it.cost / it.qty) * qty);
    it.qty -= qty;
    if (!it.qty) delete this.s.stock[model];
    this.s.money += this.sellPrice(model) * qty;
    this.save();
  }
  setPlan(plan: PlanId, fee = 0): string | null {
    const cap = plan === 'custom' ? Math.floor(fee / CUSTOM_RATE) : PLANS[plan].cap;
    if (this.stockUsed > cap) return '在庫がスロットに収まりません。先に在庫を減らしてください';
    this.s.plan = plan; this.s.planFee = plan === 'custom' ? fee : 0;
    this.save();
    return null;
  }
  private takeStock(model: string): number | null {
    const it = this.s.stock[model];
    if (!it || !it.qty) return null;
    const unit = Math.round(it.cost / it.qty);
    it.qty--; it.cost -= unit;
    if (!it.qty) delete this.s.stock[model];
    return unit;
  }
  private putStock(model: string, cost: number): void {
    const it = this.s.stock[model] ?? { qty: 0, cost: 0 };
    it.qty++; it.cost += cost;
    this.s.stock[model] = it;
  }

  // ---- 週と受注ボード ----
  private rollMarket(): void {
    const r = mulberry(this.s.seed + this.s.week * 7717);
    if (Object.keys(this.s.market).length) this.s.prevMarket = { ...this.s.market };
    for (const m of MODELS) {
      if (!m.price) continue;
      const cur = this.mult(m.id);
      let next = 1 + (cur - 1) * 0.65 + (r() - 0.5) * 0.55;
      if (r() < 0.07) next = 0.5 + r() * 0.2;         // 特売
      else if (r() < 0.05) next = 1.6 + r() * 0.4;    // 品薄
      this.s.market[m.id] = Math.round(Math.max(0.5, Math.min(2, next)) * 100) / 100;
    }
  }
  refreshBoard(): void {
    if (!Object.keys(this.s.market).length) this.rollMarket();
    const r = mulberry(this.s.seed + this.s.week * 104651), level = this.level;
    const eases = [0.05, 0.3, 0.55, 0.8, 1];
    const troubles = level >= 2 ? new Set([1, 3 + (r() < 0.5 ? 0 : 1)]) : new Set<number>();
    this.s.board = eases.map((ease, i) => ({
      id: `w${this.s.week}-${i}`, seed: Math.floor(r() * 2 ** 31), level, kind: troubles.has(i) ? 'trouble' as const : 'build' as const, ease,
    }));
    // 常連のお客様: 納品するまで、いちばん易しい枠に出し続ける
    // レベルが上がったあとは出さない(依頼の中身が、そのころ習う内容と合わなくなるため)
    if (this.tutorialFinished && this.s.week >= REGULAR_WEEK && level <= REGULAR_MAX_LEVEL && !this.s.regularDone?.includes('tanaka')) {
      this.s.board[0] = { id: `w${this.s.week}-r`, seed: 0, level: 1, kind: 'build', ease: 0, special: 'tanaka' };
    }
  }
  /** 1週間進める: 倉庫代を払い、相場とボードが変わる */
  nextWeek(): void {
    this.s.week++;
    this.s.lastFee = this.weeklyFee;
    this.s.money -= this.weeklyFee;
    this.rollMarket();
    this.refreshBoard();
    this.save();
  }
  job(o: Offer): Job {
    let j = this.jobCache.get(o.id + o.seed);
    if (!j) { j = o.special ? regularJob(this.s.keep?.t1) : generate(o.seed, o.level, { kind: o.kind, ease: o.ease }); this.jobCache.set(o.id + o.seed, j); }
    return j;
  }
  get activeJob(): Job | null {
    const a = this.s.active;
    return !a ? null : a.tutorial ? tutorialJob(a.tutorial) : this.job(a.offer!);
  }
  /** 報酬(評判による増減込み)。前金はその半分 */
  rewardOf(job: Job): number {
    if (job.tutorial) return job.reward;
    const a = this.s.active;
    if (a && a.reward != null && !a.tutorial && this.job(a.offer!) === job) return a.reward;
    // 機材が値上がりしている週は、そのぶん契約金も上がる
    return Math.round(((job.reward + Math.max(0, this.parNow(job) - job.par)) * this.repMult) / 500) * 500;
  }
  /** 今週の相場で、模範解答どおりに機材を買ったときの費用 */
  parNow(job: Job): number {
    if (job.kind === 'trouble') return 0;
    return job.solution.devices.reduce((t, d) => t + (d.own === 'bought' ? this.price(d.model) : 0), 0) + job.solution.cables.filter(c => !c.free).length * CABLE_PRICE;
  }
  /** ★3 と ★2 になる機材費の上限 */
  starLimits(job: Job): [number, number] {
    if (job.kind === 'trouble') return [1500, 12000];
    const par = this.s.active?.par ?? this.parNow(job);
    return [Math.round(par * 1.12) + 500, Math.round(par * 1.4) + 3000];
  }

  // ---- 受注 ----
  private begin(job: Job, a: Pick<Active, 'offer' | 'tutorial' | 'challenge'>): void {
    const reward = this.rewardOf(job), par = job.tutorial ? job.par : this.parNow(job);
    const advance = Math.round(reward / 2 / 500) * 500;
    this.s.money += advance;
    this.s.active = {
      ...a, world: clone(job.initial), shelf: {}, spare: 0, seq: 1, elapsed: 0,
      help: { plan: false, reasons: false, answer: false }, advance, reward, par,
    };
    this.save();
  }
  accept(o: Offer, challenge: boolean): void { this.begin(this.job(o), { offer: o, tutorial: null, challenge }); }
  startTutorial(id: string): void { this.begin(tutorialJob(id), { offer: null, tutorial: id, challenge: false }); }

  /** 机の上の購入品を返品・在庫に戻して、依頼をやり直せる状態にする */
  private clearDesk(): void {
    const a = this.s.active!;
    for (const d of a.world.devices) this.returnDevice(d);
    this.s.money += a.world.cables.filter(c => !c.free).length * CABLE_PRICE;
  }
  restart(): void {
    const a = this.s.active!, job = this.activeJob!;
    this.clearDesk();
    Object.assign(a, { world: clone(job.initial), shelf: {}, spare: 0, seq: 1 });
    this.save();
  }
  private record(job: Job, a: Active, result: PlayLog['result'], stars: number, failed: string[]): void {
    const help = (Object.keys(a.help) as (keyof HelpUse)[]).filter(k => a.help[k]);
    (this.s.log ??= []).push({
      week: this.s.week, level: this.level, client: job.client, title: job.tutorial ? `研修: ${job.title}` : job.title, kind: job.kind, tags: job.tags, score: job.difficulty.score,
      result, stars, seconds: Math.round(a.elapsed / 1000), challenge: a.challenge, help, diag: { ...a.diag }, failed,
    });
    if (this.s.log.length > 400) this.s.log.splice(0, this.s.log.length - 400);
  }
  /** プレイの記録をCSVにする(表計算ソフトで開ける) */
  logCsv(): string {
    const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = (this.s.log ?? []).map(x => [x.week, x.level, x.client, x.title, x.kind === 'build' ? '構築' : x.kind === 'trouble' ? 'トラブル対応' : '構成変更', x.tags.join(' '), x.score,
      x.result === 'delivered' ? '納品' : '取り下げ', x.stars, x.seconds, x.challenge ? 'あり' : '', x.help.map(k => ({ plan: '方針', reasons: '原因', answer: '答え' }[k] ?? k)).join(' '),
      Object.entries(x.diag).map(([k, n]) => `${k}:${n}`).join(' '), x.failed.join(' / ')].map(q).join(','));
    return ['週,レベル,依頼主,依頼,種類,タグ,難易度の点数,結果,★,かかった時間(秒),ハードモード,使ったヘルプ,診断ツールの回数,不合格のまま残った検収テスト', ...rows].join('\r\n');
  }
  /** failed: 取り下げた時点で不合格だった検収テスト(記録に残す) */
  abandon(failed: string[] = []): void {
    const a = this.s.active;
    if (!a) return;
    const job = this.activeJob;
    if (job) this.record(job, a, 'abandoned', 0, failed);
    // ハードモードの依頼を取り下げると、連続成功は0に戻る
    if (a.challenge) this.s.streak = 0;
    this.clearDesk();
    this.s.money -= a.advance;
    if (!a.tutorial) { this.s.rep = Math.max(0, this.s.rep - 5); this.s.board = this.s.board.filter(o => o.id !== a.offer!.id); }
    this.s.active = null;
    this.save();
  }

  // ---- 作業中の売り買い ----
  // 机の上にすでにある機器と重ならないIDにする(前に納品した机から始まる依頼では、そのときの購入品のIDが残っている)
  private nextId(): string {
    const a = this.cur, used = new Set([...a.world.devices.map(d => d.id), ...Object.keys(a.shelf)]);
    let id = 'b' + a.seq++;
    while (used.has(id)) id = 'b' + a.seq++;
    return id;
  }
  private nameFor(model: string): string {
    const m = MODEL[model], ds = this.cur.world.devices, prefix = m.prefix || m.short;
    let n = 1;
    while (ds.some(d => d.name === `${prefix}-${n}`)) n++;
    return `${prefix}-${n}`;
  }
  /** 新品を買って机に置く */
  buyDevice(model: string): Device | string {
    if (this.sandbox) return this.playDevice(model);
    const price = this.price(model);
    if (price > this.s.money) return `資金が足りません(${MODEL[model].label})`;
    this.s.money -= price;
    return makeDevice(model, this.nextId(), this.nameFor(model), 'bought', 0, 0, price);
  }
  /** 倉庫の在庫を机に置く */
  useStock(model: string): Device | string {
    const cost = this.takeStock(model);
    if (cost == null) return '在庫がありません';
    return makeDevice(model, this.nextId(), this.nameFor(model), 'stock', 0, 0, cost);
  }
  /** 机から外した機器の精算。購入品は返品、在庫品は倉庫へ戻す */
  returnDevice(d: Device): void {
    if (d.own === 'bought') this.s.money += d.cost;
    else if (d.own === 'stock') this.putStock(d.model, d.cost);
  }
  payCable(): boolean {
    if (this.sandbox) return true;
    if (this.s.money < CABLE_PRICE) return false;
    this.s.money -= CABLE_PRICE;
    return true;
  }
  refundCable(): void { if (!this.sandbox) this.s.money += CABLE_PRICE; }

  useHelp(kind: keyof HelpUse): void { this.s.active!.help[kind] = true; this.save(); }
  get helpPenalty(): number {
    const h = this.s.active?.tutorial ? undefined : this.s.active?.help;
    return h ? (Object.keys(HELP_COST) as (keyof HelpUse)[]).reduce((t, k) => t + (h[k] ? HELP_COST[k] : 0), 0) : 0;
  }


  // ---- 納品 ----
  deliver(results: CheckResult[]): Outcome | null {
    const a = this.s.active, job = this.activeJob;
    if (!a || !job || !results.every(r => r.ok)) return null;
    const cost = worldCost(a.world), [l3, l2] = this.starLimits(job);
    let stars = cost <= l3 ? 3 : cost <= l2 ? 2 : 1;
    if (a.help.answer) stars = Math.max(1, stars - 1);
    const base = this.rewardOf(job), parts: Outcome['parts'] = [{ label: '契約金', amount: base }];
    const penalty = Math.round(base * this.helpPenalty);
    if (penalty) parts.push({ label: 'ヘルプの利用', amount: -penalty });
    let onTime: boolean | null = null;
    const streakBefore = this.streak;
    let streak = streakBefore, xpMult = 1;
    if (a.challenge) {
      onTime = a.elapsed <= job.minutes * 60000;
      if (onTime) parts.push({ label: '納期ボーナス', amount: Math.round((base * 0.3) / 100) * 100 });
      // 連続成功に数えるのは、納期に間に合い、ヘルプの「答え」を使わなかった納品。それ以外は0に戻る
      if (onTime && !a.help.answer) { streak = streakBefore + 1; xpMult = streakMult(streak); } else streak = 0;
    }
    const reward = parts.reduce((t, p) => t + p.amount, 0);
    const levelBefore = this.level;
    const xp = job.tutorial ? job.xp : Math.round(job.xp * (0.6 + 0.2 * stars) * xpMult);
    this.s.streak = streak;
    this.s.bestStreak = Math.max(this.s.bestStreak ?? 0, streak);
    const repDelta = job.tutorial ? 0 : (stars - 2) * 4 + (onTime === false ? -3 : onTime ? 1 : 0);
    this.s.money += reward - a.advance;
    this.s.xp += xp;
    this.s.rep = Math.max(0, Math.min(100, this.s.rep + repDelta));
    // 件数と利益の合計は、一覧(50件まで)とは別に数える
    const t = this.totals;
    this.s.totals = { n: t.n + 1, profit: t.profit + reward - cost, star3: t.star3 + (stars === 3 ? 1 : 0) };
    this.s.history.unshift({ client: job.client, title: job.title, kind: job.kind, stars, profit: reward - cost, week: this.s.week });
    this.s.history.length = Math.min(this.s.history.length, 50);
    if (a.tutorial) { if (!this.s.tutorialDone.includes(a.tutorial)) this.s.tutorialDone.push(a.tutorial); }
    this.record(job, a, 'delivered', stars, []);
    if (a.tutorial === 't1') this.s.keep = { ...this.s.keep, t1: clone(a.world) };
    if (a.offer?.special) this.s.regularDone = [...(this.s.regularDone ?? []), a.offer.special];
    this.s.active = null;
    const levelAfter = this.level;
    const unlocks = LEVELS.filter(l => l.level > levelBefore && l.level <= levelAfter).flatMap(l => l.unlocks);
    if (job.tutorial) { if (this.tutorialFinished) this.refreshBoard(); this.save(); }
    else this.nextWeek();
    return { stars, reward, parts, cost, profit: reward - cost, xp, levelBefore, levelAfter, unlocks, onTime, repDelta, final: this.s.money, streakBefore, streak, xpMult };
  }
}
