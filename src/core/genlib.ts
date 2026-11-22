// 依頼の生成で共通に使う部品: 業種と名前の表、難易度と報酬の計算、トラブル対応への作り替え
import { evaluate } from './checks';
import { faultCatalog, faultCatalog2 } from './faults';
import { Difficulty, Factor, Job, Rng, mulberry, pick, shuffle } from './job';
import { World, clone } from './model';

export interface Industry {
  id: string; label: string; suffix: string[]; groups: string[]; guest?: string;
  extra: ('printer' | 'phone' | 'pos' | 'camera')[];
  person: string[];
}
export const INDUSTRIES: Industry[] = [
  { id: 'office', label: '事務所', suffix: ['商事', '税理士事務所', '企画', '法律事務所'], groups: ['総務部', '営業部', '経理部'], extra: ['printer', 'phone'], person: ['総務の担当者', '社長', '所長'] },
  { id: 'design', label: '設計事務所', suffix: ['設計事務所', 'デザイン', '建築工房'], groups: ['設計室', '営業部'], extra: ['printer'], person: ['所長', '設計主任'] },
  { id: 'shop', label: '店舗', suffix: ['マート', '書店', 'ベーカリー', '薬局'], groups: ['事務室', '売り場'], extra: ['printer', 'pos', 'camera'], person: ['店長', 'オーナー'] },
  { id: 'clinic', label: 'クリニック', suffix: ['クリニック', '歯科', '動物病院'], groups: ['受付', '診察室'], extra: ['printer', 'phone'], person: ['院長', '事務長'] },
  { id: 'school', label: '学習塾', suffix: ['学習塾', 'ゼミナール', '英会話教室'], groups: ['職員室'], guest: '教室', extra: ['printer'], person: ['塾長', '教室長'] },
  { id: 'hotel', label: '宿泊施設', suffix: ['ホテル', '旅館', 'ゲストハウス'], groups: ['事務所'], guest: 'ロビー', extra: ['printer', 'phone'], person: ['支配人', '女将'] },
  { id: 'cafe', label: '飲食店', suffix: ['カフェ', '珈琲店', '食堂'], groups: ['事務室'], guest: '客席', extra: ['printer', 'pos'], person: ['店長', 'マスター'] },
  { id: 'account', label: '会計事務所', suffix: ['会計事務所', '社労士事務所', '行政書士事務所'], groups: ['業務室', '受付'], extra: ['printer', 'phone'], person: ['所長', '事務の担当者'] },
  { id: 'estate', label: '不動産店', suffix: ['不動産', 'ホーム', '住宅販売'], groups: ['営業部', '管理部'], extra: ['printer', 'phone', 'camera'], person: ['店長', '営業の担当者'] },
  { id: 'nursery', label: '保育園', suffix: ['保育園', 'こども園', '幼稚園'], groups: ['職員室'], guest: '保護者ルーム', extra: ['printer', 'camera'], person: ['園長', '主任'] },
  { id: 'library', label: '図書館', suffix: ['図書館', '市民センター', '資料館'], groups: ['事務室', 'カウンター'], guest: '閲覧室', extra: ['printer'], person: ['館長', '司書'] },
  { id: 'factory', label: '工場', suffix: ['製作所', '工業', '食品'], groups: ['事務所', '製造ライン'], extra: ['printer', 'camera'], person: ['工場長', '総務の担当者'] },
];
export const NAMES: [string, string][] = [
  ['みどり', 'midori'], ['あおば', 'aoba'], ['北斗', 'hokuto'], ['さくら', 'sakura'], ['つばめ', 'tsubame'], ['ひまわり', 'himawari'],
  ['白樺', 'shirakaba'], ['ポラリス', 'polaris'], ['かもめ', 'kamome'], ['こだま', 'kodama'], ['すばる', 'subaru'], ['やまびこ', 'yamabiko'],
  ['あさひ', 'asahi'], ['しらゆり', 'shirayuri'], ['三日月', 'mikazuki'], ['はやぶさ', 'hayabusa'], ['もみじ', 'momiji'], ['わかば', 'wakaba'],
];

export type Base = Omit<Job, 'difficulty' | 'reward' | 'xp' | 'minutes'>;

// 机の上の状態を、ケーブル1本ごと・設定の項目ごとに並べる(2つの状態の違う場所を調べるために使う)
function leaves(w: World): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of w.cables) m.set(`cable:${c.id}`, `${c.a.dev}:${c.a.port}-${c.b.dev}:${c.b.port}`);
  const walk = (k: string, v: unknown): void => { if (v && typeof v === 'object') for (const [a, b] of Object.entries(v)) walk(`${k}.${a}`, b); else m.set(k, String(v)); };
  for (const d of w.devices) walk(`dev:${d.id}`, d.cfg);
  return m;
}
const diffKeys = (a: Map<string, string>, b: Map<string, string>): string[] => [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k));
/** 2つの机の上で、違っている場所(ケーブル、設定の項目)の数 */
export const worldDiff = (a: World, b: World): number => diffKeys(leaves(a), leaves(b)).length;

/** 正解の構成に不具合を入れて、トラブル対応の依頼にする。症状の出る不具合を入れられなければ null */
export function makeTrouble(base: Base, factors: Factor[], seed: number, cap: number, r: Rng, nameOf: (id: string) => string): Job | null {
  const solution = base.solution, checks = base.checks, rawChecks = checks.map(c => c.check);
  const chance = (p: number) => r() < p;
  const broken = clone(solution);
  for (const d of broken.devices) if (d.own === 'bought') { d.own = 'supplied'; d.cost = 0; }
  for (const c of broken.cables) c.free = true;
  const count = Math.min(4, 1 + Math.floor(cap / 3) + (chance(0.4) ? 1 : 0));
  const picked: { desc: string; weight: number }[] = [], touched = new Set<string>();
  const fr = mulberry(seed ^ 0x9e3779b9);
  // 元からある不具合の並び順は変えず、あとから増えた不具合をその間に差し込む
  const order = shuffle(fr, faultCatalog), fr2 = mulberry(seed ^ 0x7f4a7c15);
  for (const f of faultCatalog2) order.splice(Math.floor(fr2() * (order.length + 1)), 0, f);
  for (const f of order) {
    if (picked.length >= count) break;
    // 単独で入れたときに、検収テストが1つ以上落ちる不具合だけを使う
    const solo = clone(solution), s1 = mulberry(seed + f.key.length * 977);
    if (!f.apply(solo, s1)) continue;
    if (evaluate(solo, rawChecks, nameOf).every(x => x.ok)) continue;
    // すでに入れた不具合と同じ場所(同じケーブル、同じ設定項目)を触る不具合は使わない。あとの不具合が前の不具合を消してしまうため
    const before = clone(broken), b0 = leaves(broken);
    const desc = f.apply(broken, mulberry(seed + f.key.length * 977));
    const keys = diffKeys(b0, leaves(broken));
    // 机の上を何も変えなかった不具合も使わない
    if (!desc || !keys.length || keys.some(k => touched.has(k))) { broken.devices = before.devices; broken.cables = before.cables; continue; }
    for (const k of keys) touched.add(k);
    picked.push({ desc, weight: f.weight });
  }
  if (!picked.length || evaluate(broken, rawChecks, nameOf).every(x => x.ok)) return null;
  // 直す仕事は組み立てより手数が少ないので、規模の点数は半分にする
  const scale = Math.round(factors.reduce((t, f) => t + f.pts, 0) * 0.4);
  const fs: Factor[] = [
    { label: 'ネットワークの規模と内容', pts: scale },
    { label: `不具合の数(${picked.length})`, pts: picked.length * 3 },
    { label: '不具合の見つけにくさ', pts: picked.reduce((s, p) => s + p.weight, 0) },
  ];
  const symptom = evaluate(broken, rawChecks, nameOf).map((x, i) => (x.ok ? '' : checks[i].label)).filter(Boolean);
  return finish({
    ...base, kind: 'trouble', title: siteTitle(troubleTitle(symptom, r), symptom, base), supplied: [], initial: broken, par: 0,
    brief: `${pick(r, ['先週から', '昨日の模様替えのあとから', '機器を入れ替えてから', '今朝から'])}調子が悪くて困っています。${picked.length > 1 ? '困っていることは1つではありません。' : ''}${pick(r, ['前に頼んだ業者とは連絡がつきません。', '設定した担当者は先月退職しました。', '自分たちで触ってみましたが、直りませんでした。'])}仕様書のとおりに動くように直してください。`,
    hints: ['まず検収テストで落ちている項目を見て、どの機器の通信が失敗しているかを絞ります。', '失敗している機器を選び、診断ツールの ping を近い相手から順に打ちます(同じネットワークの機器 → ゲートウェイ → その先)。', '止まった場所の機器の設定と配線を、仕様書と見比べます。'],
    faults: picked.map(p => p.desc),
  }, fs);
}

// 拠点が2つ以上ある依頼では、どの拠点で困っているかを題名にする
function siteTitle(title: string, symptom: string[], base: Base): string {
  const sites = (base.zones ?? []).filter(z => z.tone !== 'cloud').map(z => z.label);
  if (sites.length < 2 || !/Web|インターネット|調子|急に/.test(title)) return title;
  // 拠点をまたぐ ping の項目は、どちらの拠点が原因でも落ちるので、拠点の判定には使わない
  const cross = (x: string) => /に通信できる$/.test(x);
  const hit = sites.filter(l => symptom.some(x => !cross(x) && x.startsWith(l)));
  if (hit.length === 1) return `${hit[0]}だけ通信できない`;
  if (!hit.length && symptom.some(cross)) return '拠点の間で通信できない';
  if (hit.length < sites.length) return title;
  return [title, 'どの拠点でも通信できない', '複数の拠点で不具合が出ている'][symptom.length % 3];
}

function troubleTitle(symptom: string[], r: Rng): string {
  const s = symptom.join(' ');
  // 拠点・クラウド・冗長化など、あとから増えた内容の症状
  if (symptom.every(x => /止まっても|切れても/.test(x))) return '1台止まると全体が止まってしまう';
  if (symptom.every(x => /DKIM|DMARC|なりすまし/.test(x))) return '送ったメールが迷惑メールにされる';
  if (symptom.every(x => /監視/.test(x))) return '監視の画面に出てこない機器がある';
  if (symptom.every(x => /仮想サーバー|公開アドレス\(/.test(x))) return 'クラウドのサーバーがおかしい';
  if (symptom.every(x => /応答する|証明書/.test(x))) return 'Webサイトの表示がおかしい';
  if (/印刷/.test(s) && symptom.length === 1) return '印刷できない';
  if (/Web|開ける|インターネット/.test(s)) return pick(r, ['インターネットにつながらない', 'Webが見られない']);
  if (/共有/.test(s)) return '共有フォルダが開けない';
  if (/通信できない|出られない|使えない/.test(s)) return '見えてはいけないものが見えている';
  return pick(r, ['ネットワークの調子が悪い', '急につながらなくなった']);
}

export function finish(base: Base, factors: Factor[]): Job {
  const score = factors.reduce((s, f) => s + f.pts, 0);
  const stars = score < 9 ? 1 : score < 18 ? 2 : score < 30 ? 3 : score < 45 ? 4 : 5;
  const difficulty: Difficulty = { stars, score, factors };
  const labor = 5000 + score * 800;
  const reward = Math.round((base.par * 1.12 + labor) / 500) * 500;
  return { ...base, difficulty, reward, xp: 20 + score * 6, minutes: Math.round(4 + score * 0.45) };
}

