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
    if (!bgmTimer) bgmRun();
    SOUNDS[name]();
  } catch { /* 音が出せない環境でも遊べるようにする */ }
}

// ---- BGM: ゆっくりした和音と、ときどき鳴る短い音を、その場で合成して流し続ける ----
let bgmVol = 0.4, bgmOut: GainNode | null = null, bgmTimer = 0, bgmNext = 0, bar = 0;
const BGM_LEVEL = 0.22, BAR = 8;
// 4小節で一回りする和音(低い音域)と、その上で鳴らす音
const CHORDS = [[146.83, 185.0, 220.0, 277.18], [123.47, 146.83, 185.0, 220.0], [98.0, 123.47, 146.83, 185.0], [110.0, 138.59, 164.81, 185.0]];
const BELLS = [293.66, 369.99, 440.0, 554.37, 587.33, 739.99];

function bgmBar(t: number): void {
  if (!ctx || !bgmOut) return;
  const chord = CHORDS[bar % CHORDS.length];
  for (const [i, f] of chord.entries()) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.value = f;
    o.detune.value = (i - 1.5) * 3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(i === 0 ? 0.3 : 0.16, t + 2.5);
    g.gain.setValueAtTime(i === 0 ? 0.3 : 0.16, t + BAR - 1);
    g.gain.linearRampToValueAtTime(0.0001, t + BAR + 2.5);
    o.connect(g).connect(bgmOut);
    o.start(t); o.stop(t + BAR + 2.6);
  }
  // 1小節に1〜2回、短い音を重ねる
  for (const at of [1.5, 5.5]) {
    if (Math.random() < 0.35) continue;
    const o = ctx.createOscillator(), g = ctx.createGain(), s = t + at + Math.random() * 1.5;
    o.type = 'sine';
    o.frequency.value = BELLS[Math.floor(Math.random() * BELLS.length)];
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.11, s + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 2.4);
    o.connect(g).connect(bgmOut);
    o.start(s); o.stop(s + 2.5);
  }
  bar++;
}
function bgmRun(): void {
  if (!ctx) return;
  if (bgmVol <= 0) { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = 0; } bgmOut?.gain.setTargetAtTime(0, ctx.currentTime, 0.2); return; }
  if (!bgmOut) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    bgmOut = ctx.createGain();
    bgmOut.gain.value = 0;
    bgmOut.connect(lp).connect(ctx.destination);
  }
  bgmOut.gain.setTargetAtTime(bgmVol * BGM_LEVEL, ctx.currentTime, 0.4);
  if (bgmTimer) return;
  bgmNext = Math.max(bgmNext, ctx.currentTime + 0.2);
  // 少し先の分まで予約しておく(画面が重いときも途切れないようにする)
  const tick = () => { while (ctx && bgmNext < ctx.currentTime + 2) { bgmBar(bgmNext); bgmNext += BAR; } };
  tick();
  bgmTimer = window.setInterval(tick, 700);
}
/** BGMの大きさ(0で止める)。音は、最初に画面を操作したあとから流れる */
export function setBgm(v: number): void { bgmVol = v; try { bgmRun(); } catch { /* 音が出せない環境でも遊べるようにする */ } }
