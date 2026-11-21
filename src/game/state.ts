// ゲームの進行: 資金、レベル、評判、相場、倉庫、受注ボード、受注中の依頼
import { CheckResult } from '../core/checks';
import { generate } from '../core/gen';
import { Job, mulberry, worldCost } from '../core/job';
import { CABLE_PRICE, Device, MODEL, MODELS, World, clone, makeDevice } from '../core/model';
import { TUTORIALS, tutorialJob } from './tutorial';

export const MAX_LEVEL = 13;
export const START_MONEY = 30000;
/** レベル n になるのに必要な累計経験値 */
export const xpFor = (n: number): number => 30 * (n - 1) * (n + 2);

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
];

export interface Offer { id: string; seed: number; level: number; kind: 'build' | 'trouble'; ease: number }
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
}
export interface StockItem { qty: number; cost: number }
export type PlanId = 'none' | 's' | 'm' | 'l' | 'custom';
export const PLANS: Record<Exclude<PlanId, 'custom'>, { label: string; fee: number; cap: number }> = {
  none: { label: '事務所の棚', fee: 0, cap: 6 },
  s: { label: '小さな倉庫', fee: 1500, cap: 20 },
  m: { label: '中くらいの倉庫', fee: 3500, cap: 60 },
  l: { label: '大きな倉庫', fee: 7000, cap: 150 },
};
/** 金額指定の倉庫: 定額より割高だが、いくらでも広くできる */
export const CUSTOM_RATE = 90;

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
  settings: { sfx: number; bgm: number };
}

export interface Outcome {
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
    if (this.stockUsed + MODEL[model].size * qty > this.capacity) return '倉庫に入りきりません';
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
    if (this.stockUsed > cap) return '在庫が入りきりません。先に在庫を減らしてください';
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
  }
  /** 1週間進める: 倉庫代を払い、相場とボードが変わる */
  nextWeek(): void {
    this.s.week++;
    this.s.money -= this.weeklyFee;
    this.rollMarket();
    this.refreshBoard();
    this.save();
  }
  job(o: Offer): Job {
    let j = this.jobCache.get(o.id + o.seed);
    if (!j) { j = generate(o.seed, o.level, { kind: o.kind, ease: o.ease }); this.jobCache.set(o.id + o.seed, j); }
    return j;
  }
  get activeJob(): Job | null {
    const a = this.s.active;
    return !a ? null : a.tutorial ? tutorialJob(a.tutorial) : this.job(a.offer!);
  }
  /** 報酬(評判による増減込み)。前金はその半分 */
  rewardOf(job: Job): number { return job.tutorial ? job.reward : Math.round((job.reward * this.repMult) / 500) * 500; }

  // ---- 受注 ----
  private begin(job: Job, a: Pick<Active, 'offer' | 'tutorial' | 'challenge'>): void {
    const advance = Math.round(this.rewardOf(job) / 2 / 500) * 500;
    this.s.money += advance;
    this.s.active = {
      ...a, world: clone(job.initial), shelf: {}, spare: 0, seq: 1, elapsed: 0,
      help: { plan: false, reasons: false, answer: false }, advance,
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
  abandon(): void {
    const a = this.s.active;
    if (!a) return;
    this.clearDesk();
    this.s.money -= a.advance;
    if (!a.tutorial) { this.s.rep = Math.max(0, this.s.rep - 5); this.s.board = this.s.board.filter(o => o.id !== a.offer!.id); }
    this.s.active = null;
    this.save();
  }

  // ---- 作業中の売り買い ----
  private nextId(): string { return 'b' + this.s.active!.seq++; }
  private nameFor(model: string): string {
    const m = MODEL[model], ds = this.s.active!.world.devices;
    let n = 1;
    while (ds.some(d => d.name === `${m.prefix}-${n}`)) n++;
    return `${m.prefix}-${n}`;
  }
  /** 新品を買って机に置く */
  buyDevice(model: string): Device | string {
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
    if (this.s.money < CABLE_PRICE) return false;
    this.s.money -= CABLE_PRICE;
    return true;
  }
  refundCable(): void { this.s.money += CABLE_PRICE; }

  useHelp(kind: keyof HelpUse): void { this.s.active!.help[kind] = true; this.save(); }
  get helpPenalty(): number {
    const h = this.s.active?.tutorial ? undefined : this.s.active?.help;
    return h ? (Object.keys(HELP_COST) as (keyof HelpUse)[]).reduce((t, k) => t + (h[k] ? HELP_COST[k] : 0), 0) : 0;
  }

  /** ★の基準になる機材費 */
  static starLimits(job: Job): [number, number] {
    return job.kind === 'trouble' ? [1500, 12000] : [Math.round(job.par * 1.1), Math.round(job.par * 1.4 + 3000)];
  }

  // ---- 納品 ----
  deliver(results: CheckResult[]): Outcome | null {
    const a = this.s.active, job = this.activeJob;
    if (!a || !job || !results.every(r => r.ok)) return null;
    const cost = worldCost(a.world), [l3, l2] = Game.starLimits(job);
    let stars = cost <= l3 ? 3 : cost <= l2 ? 2 : 1;
    if (a.help.answer) stars = Math.max(1, stars - 1);
    const base = this.rewardOf(job), parts: Outcome['parts'] = [{ label: '契約金', amount: base }];
    const penalty = Math.round(base * this.helpPenalty);
    if (penalty) parts.push({ label: 'ヘルプの利用', amount: -penalty });
    let onTime: boolean | null = null;
    if (a.challenge) {
      onTime = a.elapsed <= job.minutes * 60000;
      if (onTime) parts.push({ label: '納期ボーナス', amount: Math.round((base * 0.3) / 100) * 100 });
    }
    const reward = parts.reduce((t, p) => t + p.amount, 0);
    const levelBefore = this.level;
    const xp = job.tutorial ? job.xp : Math.round(job.xp * (0.6 + 0.2 * stars) * (onTime ? 1.2 : 1));
    const repDelta = job.tutorial ? 0 : (stars - 2) * 4 + (onTime === false ? -3 : onTime ? 1 : 0);
    this.s.money += reward - a.advance;
    this.s.xp += xp;
    this.s.rep = Math.max(0, Math.min(100, this.s.rep + repDelta));
    this.s.history.unshift({ client: job.client, title: job.title, kind: job.kind, stars, profit: reward - cost, week: this.s.week });
    this.s.history.length = Math.min(this.s.history.length, 50);
    if (a.tutorial) { if (!this.s.tutorialDone.includes(a.tutorial)) this.s.tutorialDone.push(a.tutorial); }
    this.s.active = null;
    const levelAfter = this.level;
    const unlocks = LEVELS.filter(l => l.level > levelBefore && l.level <= levelAfter).flatMap(l => l.unlocks);
    if (job.tutorial) { if (this.tutorialFinished) this.refreshBoard(); this.save(); }
    else this.nextWeek();
    return { stars, reward, parts, cost, profit: reward - cost, xp, levelBefore, levelAfter, unlocks, onTime, repDelta, final: this.s.money };
  }
}
