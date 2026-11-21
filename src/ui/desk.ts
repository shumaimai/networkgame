// 机の上(SVG): 機器とケーブルの描画、ドラッグ、配線、パケットのアニメーション
import { ipStr } from '../core/ip';
import { DESK_H, DESK_W } from '../core/job';
import { Cable, Device, GwCfg, L3Cfg, PortRef, SwitchCfg, World, isGateway, isHost } from '../core/model';
import { Net, TraceItem } from '../core/sim';
import { clamp, esc, img } from './dom';

export type Sel = { kind: 'dev'; id: string } | { kind: 'cable'; id: string } | null;
export interface DeskHost {
  world: World;
  net: Net;
  readOnly?: boolean;
  emptyHint?: [string, string];
  /** 机の一部だけを映すとき: [x, y, 幅, 高さ] */
  view?: [number, number, number, number];
  /** ケーブルをつなぐ。つなげたら true */
  link(a: PortRef, b: PortRef): boolean;
  removeCable(id: string): void;
  onSelect(sel: Sel): void;
  onMoved(): void;
  log(msg: string, cls?: string): void;
}

const NS = 'http://www.w3.org/2000/svg';
const VLAN_COLORS = ['#4fd1c5', '#f6a04d', '#b794f4', '#f687b3', '#9ae66e', '#63b3ed', '#ffd166', '#fc8181'];
export const vlanColor = (v: number): string => (v === 1 ? '#8fa0c4' : VLAN_COLORS[(v * 7) % VLAN_COLORS.length]);
const SPRITE: Record<string, number> = { internet: 124 };
// /24 はいちばん多いので省いて、ラベルを短くする
const pf = (prefix: number): string => (Number(prefix) === 24 ? '' : '/' + prefix);

interface Geo { top: number; bottom: number; half: number; sprite: number; spriteY: number }
function geo(d: Device): Geo {
  if (isHost(d.kind)) return { top: -66, bottom: 92, half: 56, sprite: 78, spriteY: -4 };
  if (d.kind === 'internet') return { top: -62, bottom: 74, half: 78, sprite: 124, spriteY: -6 };
  const n = d.ports.length - (isGateway(d.kind) ? 1 : 0);
  const cols = Math.min(12, n), rows = Math.ceil(n / 12);
  const half = Math.max(62, isGateway(d.kind) ? (n * 46) / 2 + 12 : (cols * 22) / 2 + 12);
  return { top: isGateway(d.kind) ? -74 : -52, bottom: 46 + rows * 24 + 12, half, sprite: 74, spriteY: -12 };
}
export function portRel(d: Device, i: number): { x: number; y: number; dir: number } {
  if (isHost(d.kind)) return { x: 0, y: -54, dir: -1 };
  if (d.kind === 'internet') return { x: 0, y: 60, dir: 1 };
  if (isGateway(d.kind)) {
    if (i === 0) return { x: 0, y: -60, dir: -1 };
    const n = d.ports.length - 1;
    return { x: (i - 1 - (n - 1) / 2) * 46, y: 46, dir: 1 };
  }
  const n = d.ports.length, cols = Math.min(12, n), row = Math.floor(i / 12), c = i % 12;
  return { x: (c - (cols - 1) / 2) * 22, y: 46 + row * 24, dir: 1 };
}

export class Desk {
  sel: Sel = null;
  private scene: SVGGElement;
  private fx: SVGGElement;
  private linkFrom: PortRef | null = null;
  private gesture: { x: number; y: number } | null = null;
  private drag: { id: string; dx: number; dy: number; moved: boolean } | null = null;
  private mouse = { x: 0, y: 0 };
  private anim = 0;
  private off: (() => void)[] = [];

  constructor(private svg: SVGSVGElement, private host: DeskHost) {
    const [vx, vy, vw, vh] = host.view ?? [0, 0, DESK_W, DESK_H];
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
    svg.innerHTML = `<defs>
      <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="14" cy="14" r="1.2" fill="#2b3a5c"/></pattern>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#05080f" flood-opacity=".55"/></filter>
    </defs>
    <rect class="mat" x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="26"/>
    <rect class="mat-dots" x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="26"/>
    <g class="scene"></g><g class="fx"></g>`;
    this.scene = svg.querySelector('.scene')!;
    this.fx = svg.querySelector('.fx')!;
    if (!host.readOnly) this.bind();
  }
  destroy(): void { this.stopAnim(); this.off.forEach(f => f()); }

  private dev(id: string): Device | undefined { return this.host.world.devices.find(d => d.id === id); }
  private cableAt(d: string, p: number): Cable | undefined {
    return this.host.world.cables.find(c => (c.a.dev === d && c.a.port === p) || (c.b.dev === d && c.b.port === p));
  }
  private portAbs(ref: PortRef) { const d = this.dev(ref.dev)!, r = portRel(d, ref.port); return { x: d.x + r.x, y: d.y + r.y, dir: r.dir }; }
  clampPos(d: Device): void {
    const g = geo(d);
    d.x = Math.round(clamp(d.x, g.half + 14, DESK_W - g.half - 14));
    d.y = Math.round(clamp(d.y, -g.top + 10, DESK_H - g.bottom - 6));
  }
  /** 画面座標 → 机の座標 */
  point(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const m = this.svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  contains(el: Element | null): boolean { return !!el && this.svg.contains(el); }

  // パレットをクリックしただけのときに置く、空いている場所
  autoSpot(d: Device): { x: number; y: number } {
    const rows: [number, number, number][] = isHost(d.kind) && d.kind !== 'server' && d.kind !== 'nas'
      ? [[130, 660, 128], [130, 520, 128]]
      : d.kind === 'server' || d.kind === 'nas' ? [[DESK_W - 130, 330, -150], [DESK_W - 130, 480, -150]]
        : isGateway(d.kind) ? [[DESK_W / 2, 210, 240], [260, 210, 240]]
          : d.kind === 'l3' ? [[DESK_W / 2, 350, 330], [300, 350, 330]] : [[DESK_W / 2 - 240, 440, 300], [DESK_W / 2 - 240, 330, 300]];
    const g = geo(d);
    for (const [x0, y, step] of rows) {
      for (let x = x0; x >= 80 && x <= DESK_W - 80; x += step) {
        if (this.host.world.devices.every(o => Math.abs(o.x - x) > geo(o).half + g.half + 6 || Math.abs(o.y - y) > 110)) return { x, y };
      }
    }
    return { x: DESK_W / 2, y: DESK_H / 2 };
  }

  // ---------- 描画 ----------
  private infoLines(d: Device): string[] {
    if (isGateway(d.kind)) {
      const c = d.cfg as GwCfg;
      const l = c.lan.map((x, i) => (x.ip ? `${d.ports[i + 1]} ${x.ip}/${x.prefix}${x.dhcpOn ? ' DHCP' : ''}` : '')).filter(Boolean);
      return l.length ? l : ['LAN未設定'];
    }
    if (d.kind === 'l3') {
      const l = (d.cfg as L3Cfg).svis.filter(s => s.ip).map(s => `VLAN${s.vlan} ${s.ip}/${s.prefix}`);
      return l.length ? l.slice(0, 5) : ['VLAN IFなし'];
    }
    if (d.kind === 'ap') return [d.cfg.ssid ? `SSID ${d.cfg.ssid}` : 'SSID未設定'];
    return [];
  }

  private devSvg(d: Device): string {
    const g = geo(d), host = isHost(d.kind), selected = this.sel?.kind === 'dev' && this.sel.id === d.id;
    const sprite = SPRITE[d.kind] ?? g.sprite;
    let h = `<g class="dev k-${d.kind}${selected ? ' sel' : ''}" data-dev="${d.id}" transform="translate(${d.x},${d.y})">`;
    h += `<rect class="selbox" x="${-g.half}" y="${g.top}" width="${g.half * 2}" height="${g.bottom - g.top}" rx="14"/>`;
    if (!host && d.kind !== 'internet') {
      const n = d.ports.length - (isGateway(d.kind) ? 1 : 0), rows = Math.ceil(n / 12);
      h += `<rect class="strip" x="${-g.half + 6}" y="32" width="${g.half * 2 - 12}" height="${rows * 24 + 4}" rx="8"/>`;
    }
    h += `<image class="sprite" href="${img(d.kind)}" x="${-sprite / 2}" y="${g.spriteY - sprite / 2}" width="${sprite}" height="${sprite}" filter="url(#shadow)"/>`;
    const sc = d.kind === 'l2m' || d.kind === 'l3' ? (d.cfg as SwitchCfg) : null;
    d.ports.forEach((name, i) => {
      const p = portRel(d, i), used = !!this.cableAt(d.id, i);
      const active = this.linkFrom?.dev === d.id && this.linkFrom.port === i;
      const trunk = sc?.portMode[i] === 'trunk';
      const style = sc ? ` style="--vlan:${trunk ? '#ffffff' : vlanColor(Number(sc.portVlan[i]) || 1)}"` : '';
      h += `<rect class="port${used ? ' used' : ''}${active ? ' active' : ''}${sc ? ' vl' : ''}" data-port="${d.id}:${i}" x="${p.x - 8}" y="${p.y - 8}" width="16" height="16" rx="4"${style}><title>${esc(d.name)} ${esc(name)}${sc ? (trunk ? ' トランク' : ' VLAN' + sc.portVlan[i]) : ''}</title></rect>`;
      if (isGateway(d.kind)) h += i === 0 ? `<text class="plabel start" x="${p.x + 13}" y="${p.y + 4}">${esc(name)}</text>` : `<text class="plabel" x="${p.x}" y="${p.y + 21}">${esc(name)}</text>`;
      else if (sc) h += `<text class="plabel in" x="${p.x}" y="${p.y + 3.5}">${trunk ? 'T' : sc.portVlan[i]}</text>`;
    });
    if (host) {
      let y = 50;
      h += `<text class="dname" y="${y}">${esc(d.name)}</text>`;
      if (d.kind === 'server' || d.kind === 'nas') {
        const c = d.cfg, s = [c.dnsOn && 'DNS', c.dhcpOn && 'DHCP', c.proxyOn && 'プロキシ', c.webOn && 'Web', c.fileOn && '共有', c.mailOn && 'メール'].filter(Boolean).join('・');
        y += 15;
        h += `<text class="drole${s ? '' : ' none'}" y="${y}">${s || 'サービス停止中'}</text>`;
      }
      y += 16;
      const e = this.host.net.eff.get(d.id);
      if (e?.dhcp) h += e.ip != null ? `<text class="dip" y="${y}">${ipStr(e.ip)}${pf(e.prefix)} 自動</text>` : `<text class="dip warn" y="${y}">DHCP 取得できず</text>`;
      else h += d.cfg.ip ? `<text class="dip" y="${y}">${esc(d.cfg.ip)}${pf(d.cfg.prefix)}</text>` : `<text class="dip warn" y="${y}">IP未設定</text>`;
    } else if (d.kind === 'internet') {
      h += `<text class="dname" y="-58">インターネット</text>`;
    } else {
      const x = 46;
      h += `<text class="dname side" x="${x}" y="-26">${esc(d.name)}</text>`;
      this.infoLines(d).forEach((t, i) => { h += `<text class="dip side" x="${x}" y="${-10 + i * 13}">${esc(t)}</text>`; });
    }
    return h + '</g>';
  }

  private cablePath(c: Cable): string {
    const a = this.portAbs(c.a), b = this.portAbs(c.b);
    const k = clamp(Math.hypot(a.x - b.x, a.y - b.y) * 0.42, 26, 110);
    return `M${a.x},${a.y} C${a.x},${a.y + a.dir * k} ${b.x},${b.y + b.dir * k} ${b.x},${b.y}`;
  }

  render(): void {
    const w = this.host.world;
    let h = '';
    if (this.host.emptyHint && !w.devices.some(d => d.own !== 'fixed')) {
      h += `<text class="empty-hint" x="${DESK_W / 2}" y="${DESK_H / 2 + 10}">${esc(this.host.emptyHint[0])}</text><text class="empty-sub" x="${DESK_W / 2}" y="${DESK_H / 2 + 44}">${esc(this.host.emptyHint[1])}</text>`;
    }
    for (const c of w.cables) {
      if (!this.dev(c.a.dev) || !this.dev(c.b.dev)) continue;
      const p = this.cablePath(c), sel = this.sel?.kind === 'cable' && this.sel.id === c.id;
      h += `<g class="cable${sel ? ' sel' : ''}${c.free ? ' free' : ''}" data-cable="${c.id}"><path class="hit" d="${p}"/><path class="wire-bg" d="${p}"/><path class="wire" d="${p}"/></g>`;
    }
    // 無線でつながっているPCとアクセスポイント
    for (const d of w.devices) {
      const ap = this.host.net.eff.get(d.id)?.ap, a = ap ? w.devices.find(x => x.kind === 'ap' && x.name === ap) : null;
      if (a) h += `<line class="wifi" x1="${d.x}" y1="${d.y - 40}" x2="${a.x}" y2="${a.y}"/>`;
    }
    for (const d of w.devices) h += this.devSvg(d);
    if (this.linkFrom) {
      const p = this.portAbs(this.linkFrom);
      h += `<line class="rubber" x1="${p.x}" y1="${p.y}" x2="${this.mouse.x}" y2="${this.mouse.y}"/>`;
    }
    this.scene.innerHTML = h;
  }

  select(sel: Sel, notify = true): void {
    this.sel = sel;
    this.render();
    if (notify) this.host.onSelect(sel);
  }

  // ---------- 入力 ----------
  private portRef(el: Element): PortRef { const [d, p] = (el as HTMLElement).dataset.port!.split(':'); return { dev: d, port: Number(p) }; }

  // 配線先を決める。機器本体を指した場合は空きポートを自動で選ぶ(ポートに意味がある機器は除く)
  private linkTarget(el: Element | null, from: PortRef): PortRef | null {
    const pe = el?.closest('[data-port]');
    if (pe) return this.portRef(pe);
    const de = el?.closest<HTMLElement>('[data-dev]');
    if (!de || de.dataset.dev === from.dev) return null;
    const d = this.dev(de.dataset.dev!)!;
    if (isGateway(d.kind) || d.kind === 'l3' || d.kind === 'l2m') { this.host.log(`${d.name} は、つなぐポートを直接クリックしてください。`, 'ng'); return null; }
    const p = d.ports.findIndex((_, i) => !this.cableAt(d.id, i));
    if (p < 0) { this.host.log(`${d.name} に空きポートがありません。`, 'ng'); return null; }
    return { dev: d.id, port: p };
  }

  private bind(): void {
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: any) => void) => {
      t.addEventListener(type, fn);
      this.off.push(() => t.removeEventListener(type, fn));
    };
    on(this.svg, 'pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      this.mouse = this.point(e);
      const pe = target.closest('[data-port]');
      if (this.linkFrom) {
        const from = this.linkFrom, t = this.linkTarget(target, from);
        this.linkFrom = null;
        if (t && !(t.dev === from.dev && t.port === from.port)) { this.host.link(from, t); this.render(); return; }
        if (pe) { this.render(); return; }
      }
      if (pe) {
        const ref = this.portRef(pe), c = this.cableAt(ref.dev, ref.port);
        if (c) this.select({ kind: 'cable', id: c.id });
        else { this.linkFrom = ref; this.gesture = { ...this.mouse }; this.render(); }
        e.preventDefault();
        return;
      }
      const de = target.closest<HTMLElement>('[data-dev]');
      if (de) {
        const d = this.dev(de.dataset.dev!)!;
        this.select({ kind: 'dev', id: d.id });
        this.drag = { id: d.id, dx: this.mouse.x - d.x, dy: this.mouse.y - d.y, moved: false };
        e.preventDefault();
        return;
      }
      const ce = target.closest<HTMLElement>('[data-cable]');
      this.select(ce ? { kind: 'cable', id: ce.dataset.cable! } : null);
    });
    on(window, 'pointermove', (e: PointerEvent) => {
      if (this.drag) {
        const p = this.point(e), d = this.dev(this.drag.id);
        if (!d) { this.drag = null; return; }
        d.x = p.x - this.drag.dx; d.y = p.y - this.drag.dy;
        this.drag.moved = true;
        this.clampPos(d);
        this.render();
      } else if (this.linkFrom) {
        this.mouse = this.point(e);
        const r = this.scene.querySelector('.rubber');
        if (r) { r.setAttribute('x2', String(this.mouse.x)); r.setAttribute('y2', String(this.mouse.y)); }
      }
    });
    on(window, 'pointerup', (e: PointerEvent) => {
      if (this.drag) { const moved = this.drag.moved; this.drag = null; if (moved) this.host.onMoved(); return; }
      if (!this.linkFrom || !this.gesture) return;
      const p = this.point(e), moved = Math.hypot(p.x - this.gesture.x, p.y - this.gesture.y) > 12;
      this.gesture = null;
      if (!moved) return; // クリック操作: 接続先のクリックを待つ
      const from = this.linkFrom, t = this.linkTarget(document.elementFromPoint(e.clientX, e.clientY), from);
      this.linkFrom = null;
      if (t) this.host.link(from, t);
      this.render();
    });
    on(this.svg, 'contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const ce = (e.target as Element).closest<HTMLElement>('[data-cable]');
      if (ce) this.host.removeCable(ce.dataset.cable!);
    });
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
      if (e.key === 'Escape' && this.linkFrom) { this.linkFrom = null; this.render(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel?.kind === 'cable') this.host.removeCable(this.sel.id);
    });
  }

  // ---------- パケットのアニメーション ----------
  stopAnim(): void { this.anim++; this.fx.innerHTML = ''; }

  async playTrace(trace: TraceItem[], loop = false): Promise<void> {
    this.stopAnim();
    const token = this.anim;
    // 描画フレームを待つ。フレームが間引かれる環境でも止まらないよう、タイマーと早い方で進める
    const frame = () => new Promise<void>(r => { const t = setTimeout(r, 34); requestAnimationFrame(() => { clearTimeout(t); r(); }); });
    const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    do {
      for (const t of trace) {
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('r', '8');
        dot.setAttribute('filter', 'url(#glow)');
        for (const [segs, rep] of [[t.path, false], [t.back, true]] as const) {
          dot.setAttribute('class', `packet k-${t.kind}${rep ? ' rep' : ''}`);
          for (const s of segs) {
            const wire = this.scene.querySelector<SVGPathElement>(`[data-cable="${s.cable}"] .wire`);
            if (!wire) continue;
            // 途中で机の上が描き直されても動き続けられるよう、先に軌跡を点列にしておく
            const len = wire.getTotalLength(), N = 18, pts: DOMPoint[] = [];
            for (let i = 0; i <= N; i++) pts.push(wire.getPointAtLength((len * i) / N));
            const dur = clamp(len * 0.8, 120, 300), t0 = performance.now();
            this.fx.appendChild(dot);
            for (;;) {
              if (token !== this.anim) return;
              const k = Math.min(1, (performance.now() - t0) / dur), f = (s.rev ? 1 - k : k) * N;
              const i = Math.min(N - 1, Math.floor(f)), u = f - i;
              dot.setAttribute('cx', String(pts[i].x + (pts[i + 1].x - pts[i].x) * u));
              dot.setAttribute('cy', String(pts[i].y + (pts[i + 1].y - pts[i].y) * u));
              if (k >= 1) break;
              await frame();
            }
          }
        }
        dot.remove();
        if (!t.ok) {
          const d = t.failAt ? this.dev(t.failAt) : undefined;
          if (d) {
            const g = document.createElementNS(NS, 'g');
            g.setAttribute('class', 'failmark');
            g.setAttribute('transform', `translate(${d.x},${d.y - 8})`);
            g.innerHTML = '<circle r="24"/><path d="M-10,-10 L10,10 M10,-10 L-10,10"/>';
            this.fx.appendChild(g);
            setTimeout(() => g.remove(), 1600);
          }
          break;
        }
      }
      if (loop) await wait(1400);
    } while (loop && token === this.anim);
  }
}
