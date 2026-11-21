// 依頼(ジョブ)の型と、小さな共通部品
import { Check } from './checks';
import { CABLE_PRICE, Cable, Device, MODEL, World, makeDevice } from './model';

export interface SuppliedDef { id: string; model: string; name: string; cfg?: any }
export interface JobCheck { check: Check; label: string }
export interface Factor { label: string; pts: number }
export interface Difficulty { stars: number; score: number; factors: Factor[] }
export interface SpecRow { head: string; body: string }

export interface Job {
  id: string;
  seed: number;
  kind: 'build' | 'trouble';
  tutorial?: string;
  client: string;
  industry: string;
  person: string;
  title: string;
  brief: string;
  spec: SpecRow[];
  tags: string[];
  /** パレットから机に置けるお客様の機器(initial にすでにあるものは除く) */
  supplied: SuppliedDef[];
  checks: JobCheck[];
  initial: World;
  solution: World;
  /** 模範解答の機材費(定価) */
  par: number;
  difficulty: Difficulty;
  reward: number;
  xp: number;
  /** チャレンジモードの納期(分) */
  minutes: number;
  /** ヘルプ「方針」で見せる文 */
  hints: string[];
  /** トラブル対応で仕込んだ不具合(ヘルプ「答え」で見せる) */
  faults: string[];
}

export const DESK_W = 1400;
export const DESK_H = 800;

export type Rng = () => number;
export function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randInt = (r: Rng, a: number, b: number): number => a + Math.floor(r() * (b - a + 1));
export const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
export function shuffle<T>(r: Rng, list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** 機材費。お客様の機器と既設ケーブルは数えない */
export const worldCost = (w: World): number =>
  w.devices.reduce((s, d) => s + (d.own === 'bought' || d.own === 'stock' ? d.cost : 0), 0) + w.cables.filter(c => !c.free).length * CABLE_PRICE;

/** 機器とケーブルを組み立てる補助 */
export class Builder {
  devices: Device[] = [];
  cables: Cable[] = [];
  private n = 0;
  add(model: string, id: string, name: string, own: Device['own'] = 'bought'): Device {
    const d = makeDevice(model, id, name, own, 0, 0, own === 'bought' ? MODEL[model].price : 0);
    this.devices.push(d);
    return d;
  }
  used(dev: Device, port: number): boolean {
    return this.cables.some(c => (c.a.dev === dev.id && c.a.port === port) || (c.b.dev === dev.id && c.b.port === port));
  }
  freePort(dev: Device, from = 0): number {
    for (let i = from; i < dev.ports.length; i++) if (!this.used(dev, i)) return i;
    throw new Error(`${dev.name} に空きポートがありません`);
  }
  link(a: Device, pa: number, b: Device, pb: number): void {
    this.cables.push({ id: 'c' + ++this.n, a: { dev: a.id, port: pa }, b: { dev: b.id, port: pb } });
  }
  /** ホストなどポート0の機器を、スイッチの空きポートにつなぐ。使ったポート番号を返す */
  plug(host: Device, sw: Device, hostPort = 0): number {
    const p = this.freePort(sw);
    this.link(host, hostPort, sw, p);
    return p;
  }
  world(): World { return { devices: this.devices, cables: this.cables }; }
}
