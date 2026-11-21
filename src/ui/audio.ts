// 効果音: 素材ファイルを使わず、その場で合成する
let ctx: AudioContext | null = null;
let volume = 0.7;
export const setVolume = (v: number): void => { volume = v; };

function tone(freq: number, dur: number, type: OscillatorType, gain: number, at = 0, slide = 0): void {
  if (!ctx || volume <= 0) return;
  const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain * volume, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur: number, gain: number, at = 0, freq = 2400): void {
  if (!ctx || volume <= 0) return;
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = gain * volume;
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(ctx.currentTime + at);
}

export type Sfx = 'click' | 'tab' | 'place' | 'plug' | 'unplug' | 'ok' | 'ng' | 'coin' | 'star' | 'levelup' | 'pass' | 'open' | 'tick';
const SOUNDS: Record<Sfx, () => void> = {
  click: () => tone(660, 0.05, 'triangle', 0.12),
  tab: () => tone(520, 0.04, 'sine', 0.1),
  open: () => { tone(420, 0.07, 'sine', 0.1); tone(630, 0.09, 'sine', 0.1, 0.05); },
  place: () => { noise(0.05, 0.25, 0, 900); tone(180, 0.09, 'sine', 0.25, 0, -80); },
  plug: () => { noise(0.025, 0.35, 0, 3200); tone(880, 0.05, 'square', 0.05, 0.03); tone(1320, 0.07, 'sine', 0.1, 0.07); },
  unplug: () => { noise(0.03, 0.3, 0, 2000); tone(500, 0.08, 'sine', 0.1, 0.02, -200); },
  ok: () => { tone(784, 0.08, 'sine', 0.14); tone(1175, 0.14, 'sine', 0.14, 0.07); },
  ng: () => { tone(196, 0.14, 'sawtooth', 0.09); tone(165, 0.2, 'sawtooth', 0.09, 0.1); },
  pass: () => { tone(988, 0.06, 'triangle', 0.12); tone(1319, 0.1, 'triangle', 0.12, 0.05); },
  coin: () => { tone(1318, 0.06, 'square', 0.06); tone(1760, 0.18, 'square', 0.06, 0.06); },
  star: () => { tone(1047, 0.1, 'triangle', 0.16); tone(1568, 0.25, 'triangle', 0.14, 0.08); },
  levelup: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.14, i * 0.09)),
  tick: () => tone(1500, 0.02, 'square', 0.03),
};
export function sfx(name: Sfx): void {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    SOUNDS[name]();
  } catch { /* 音が出せない環境でも遊べるようにする */ }
}
