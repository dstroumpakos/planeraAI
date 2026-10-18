// Original score for the OTA-partners LinkedIn film, synthesised from scratch (no samples, no licensing).
// Calm, modern B2B: 108 BPM, C major, electric-piano chords, soft beat, UI sound design.
// LinkedIn autoplays muted, so the captions carry the story; this rewards those who turn sound on.
//   node music.js  ->  out/music.wav  +  out/planera-ota-partners-4x5-sound.mp4 (-14 LUFS)
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const TM = require("./timemap.js");
const V = TM.storyToVideo; // story-clock cue → time in the film
const SR = 48000, DUR = TM.VIDEO_END, N = Math.round(SR * DUR), TAU = Math.PI * 2;
let seed = 2027;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
class Bus { constructor() { this.L = new Float32Array(N); this.R = new Float32Array(N); } }
const music = new Bus(), drums = new Bus(), fx = new Bus(), send = new Bus();
function put(bus, i, v, pan = 0, rev = 0) {
  if (i < 0 || i >= N || !isFinite(v)) return;
  const a = (pan + 1) * Math.PI / 4, gl = Math.cos(a), gr = Math.sin(a);
  bus.L[i] += v * gl; bus.R[i] += v * gr;
  if (rev) { send.L[i] += v * gl * rev; send.R[i] += v * gr * rev; }
}
class Biquad {
  constructor() { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set("lp", 1000, 0.707); }
  set(type, fc, q) {
    fc = Math.min(Math.max(fc, 20), SR * 0.45);
    const w = TAU * fc / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2; const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    if (type === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else if (type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
function polyblep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
class Saw { constructor(f) { this.p = rnd(); this.f = f; } next(fm = 1) { const dt = this.f * fm / SR; this.p += dt; if (this.p >= 1) this.p -= 1; return 2 * this.p - 1 - polyblep(this.p, dt); } }

/* ---------- cues (index.html BEATS) ---------- */
const B = {
  phoneIn: 0.15, homeScroll: 1.0, hl: 2.6, toDash: 4.3,
  tapAdd: 5.25, typeTitle: [5.6, 6.35], typeDesc: [6.4, 7.0], typeDest: [7.05, 7.35], typePrice: [7.4, 7.55], typeUrl: [7.6, 7.95],
  tapUns: 8.25, pickerIn: 8.35, tapPhoto: 8.85, tapUse: 9.25, tapAllGr: 9.85, tapSubmit: 10.55,
  csv: 10.95, approve: 12.75, toPhone: 13.85, rowSlide: 14.5, tapCard: 15.75, sheetIn: 15.85, tapCta: 18.5, siteIn: 18.65,
  toDash2: 21.25, stats: [22.0, 23.6], end: 24.75, logo: 25.2, slide: 25.85, url: 26.9,
};
// every cue is authored on the story clock; move it to film time
(function mapCues(o) { for (const k of Object.keys(o)) o[k] = Array.isArray(o[k]) ? o[k].map(V) : typeof o[k] === "number" ? V(o[k]) : o[k]; })(B);
const BEAT = 60 / 108, BAR = 4 * BEAT;
const GRID0 = B.toPhone + 0.65 - 4 * BAR; // the new card sliding into the app lands on a downbeat

/* ---------- instruments ---------- */
const sc = new Float32Array(N).fill(1);
function epiano(t0, m, g, pan = 0, dur = 1.6) { // FM electric piano (tine)
  const fc = mtof(m), i0 = Math.floor(t0 * SR); let pc = 0, pm = 0;
  for (let k = 0; k < dur * SR; k++) {
    const t = k / SR, idx = 1.4 * Math.exp(-t * 5) + 0.15;
    pm += TAU * fc / SR; pc += TAU * fc / SR;
    const v = Math.sin(pc + idx * Math.sin(pm)) * Math.min(1, t / 0.003) * Math.exp(-t * 1.8) * (1 - smooth(dur - 0.25, dur, t));
    put(music, i0 + k, v * g, pan, 0.3);
  }
}
function pad(a, b, notes, g, cut = 1600) {
  for (const m of notes) for (const d of [-9, 9]) {
    const o = new Saw(mtof(m) * Math.pow(2, d / 1200)), lp = new Biquad(); lp.set("lp", cut, 0.7);
    const i0 = Math.floor(a * SR), i1 = Math.min(N, Math.floor((b + 0.6) * SR));
    for (let i = i0; i < i1; i++) { const t = i / SR; put(music, i, lp.run(o.next()) * smooth(a, a + 0.6, t) * (1 - smooth(b, b + 0.6, t)) * g / notes.length, d < 0 ? -0.5 : 0.5, 0.45); }
  }
}
function bass(t0, m, dur, g) {
  const f = mtof(m), i0 = Math.floor(t0 * SR); let ph = 0; const saw = new Saw(f), lp = new Biquad(); lp.set("lp", 380, 0.9);
  for (let k = 0; k < (dur + 0.05) * SR; k++) { const t = k / SR; ph += TAU * f / SR; put(music, i0 + k, (Math.sin(ph) + lp.run(saw.next()) * 0.3) * Math.min(1, t / 0.005) * Math.exp(-t * 1.6) * (1 - smooth(dur, dur + 0.05, t)) * g, 0, 0); }
}
function kick(t0, g) {
  const i0 = Math.floor(t0 * SR); let ph = 0;
  for (let k = 0; k < 0.35 * SR; k++) { const t = k / SR; ph += TAU * (50 + 90 * Math.exp(-t * 30)) / SR; put(drums, i0 + k, Math.sin(ph) * Math.exp(-t * 9) * g, 0, 0); if (i0 + k < N) sc[i0 + k] = Math.min(sc[i0 + k], 1 - 0.3 * Math.exp(-t * 9)); }
}
function noiseHit(bus, t0, dur, type, fc, q, decay, g, pan, rev) { const f = new Biquad(); f.set(type, fc, q); const i0 = Math.floor(t0 * SR); for (let k = 0; k < dur * SR; k++) { const t = k / SR; put(bus, i0 + k, f.run(noise()) * Math.min(1, t / 0.001) * Math.exp(-t * decay) * g, pan, rev); } }
const rim = (t0, g) => { noiseHit(drums, t0, 0.08, "bp", 1800, 2, 60, g, 0.1, 0.2); };
const clap = (t0, g) => { for (const o of [0, 0.01, 0.02]) noiseHit(drums, t0 + o, 0.02, "bp", 1400, 1.2, 110, g * 0.6, 0, 0.2); noiseHit(drums, t0 + 0.03, 0.2, "bp", 1300, 1, 20, g, 0, 0.3); };
const shaker = (t0, g, pan = 0) => noiseHit(drums, t0, 0.07, "hp", 6500, 0.7, 50, g, pan, 0.05);
const crash = (t0, g) => { noiseHit(fx, t0, 2, "hp", 5000, 0.6, 2.4, g, -0.4, 0.3); noiseHit(fx, t0, 2, "hp", 5200, 0.6, 2.4, g, 0.4, 0.3); };
function bell(t0, m, g, pan = 0, dur = 2.2, rev = 0.5) { const fc = mtof(m), i0 = Math.floor(t0 * SR); let pc = 0, pm = 0; for (let k = 0; k < dur * SR; k++) { const t = k / SR, idx = 1.5 * Math.exp(-t * 7); pm += TAU * fc * 3.5 / SR; pc += TAU * fc / SR; put(fx, i0 + k, Math.sin(pc + idx * Math.sin(pm)) * Math.min(1, t / 0.002) * Math.exp(-t * 2.6) * g, pan, rev); } }
function bloop(t0, m, g, pan = 0) { const f = mtof(m), i0 = Math.floor(t0 * SR); let ph = 0; for (let k = 0; k < 0.15 * SR; k++) { const t = k / SR; ph += TAU * f * (0.8 + 0.4 * Math.min(1, t / 0.03)) / SR; put(fx, i0 + k, Math.sin(ph) * Math.min(1, t / 0.002) * Math.exp(-t * 28) * g, pan, 0.15); } }
const click = (t0, g) => { noiseHit(fx, t0, 0.02, "bp", 3200, 1.6, 500, g, 0, 0.05); noiseHit(fx, t0 + 0.07, 0.015, "bp", 2600, 1.6, 600, g * 0.6, 0, 0.05); };
function whoosh(a, b, f0, f1, g, peakAt = 0.65) { const bp = new Biquad(), i0 = Math.floor(a * SR), len = Math.floor((b - a) * SR); for (let k = 0; k < len; k++) { const x = k / len; if ((k & 31) === 0) bp.set("bp", f0 * Math.pow(f1 / f0, x), 1.4); const env = x < peakAt ? Math.pow(x / peakAt, 2) : Math.pow(1 - (x - peakAt) / (1 - peakAt), 1.5); put(fx, i0 + k, bp.run(noise()) * env * g, Math.sin(x * 5) * 0.4, 0.3); } }
function riser(a, b, g) { const hp = new Biquad(), i0 = Math.floor(a * SR), len = Math.floor((b - a) * SR); for (let k = 0; k < len; k++) { const x = k / len; if ((k & 31) === 0) hp.set("hp", 700 * Math.pow(10, x), 0.8); put(fx, i0 + k, hp.run(noise()) * Math.pow(x, 2.2) * g, 0, 0.25); } }
function subHit(t0, g) { const i0 = Math.floor(t0 * SR); let ph = 0; for (let k = 0; k < 1.4 * SR; k++) { const t = k / SR; ph += TAU * (34 + 50 * Math.exp(-t * 4)) / SR; put(fx, i0 + k, Math.sin(ph) * Math.exp(-t * 2.4) * g, 0, 0); } }

/* ---------- harmony: C – Am – F – G per bar from the grid ---------- */
const PROG = [["C", [60, 64, 67, 71], 36], ["Am", [57, 60, 64, 67], 33], ["F", [57, 60, 65, 69], 29], ["G", [59, 62, 67, 69], 31]];
const barIndex = (t) => Math.floor((t - GRID0) / BAR + 1e-6);
const chordAt = (t) => PROG[((barIndex(t) % 4) + 4) % 4];
const beats = (a, b, step) => { const out = []; let k = Math.ceil((a - GRID0) / step - 1e-6); for (let t = GRID0 + k * step; t < b - 1e-6; k++, t = GRID0 + k * step) out.push([t, k]); return out; };

// energy curve: hook (sparse) → workspace (groove) → quote (full) → phone (lighter) → result (full) → end
const energy = (t) => t < V(1.0) ? 0 : t < B.toDash ? 1 : t < B.approve ? 1 : t < B.toDash2 ? 2 : t < B.end ? 2 : 3;
const END_T = V(28.0);

// chords: e-piano comping on beats 1 and the "and" of 2; pads under everything
for (const [t, k] of beats(0, END_T, BEAT)) {
  const [name, ns] = chordAt(t), e = energy(t), b = ((k % 4) + 4) % 4;
  if (e === 0 && b !== 0) continue;
  if (b === 0) ns.forEach((m, i) => epiano(t + i * 0.012, m, e === 0 ? 0.07 : 0.085, -0.3 + i * 0.2, 1.8));
  if (e >= 1 && b === 1) ns.slice(1).forEach((m, i) => epiano(t + BEAT / 2 + i * 0.01, m + 12, 0.045, 0.3 - i * 0.2, 0.9));
}
for (let i = Math.max(0, barIndex(0)); ; i++) { const a = GRID0 + i * BAR; if (a >= END_T) break; const s = Math.max(0, a); const [, ns] = chordAt(a + 0.01); pad(s, Math.min(END_T, a + BAR), ns.map((m) => m), 0.05, 1300); }
// rhythm section
for (const [t, k] of beats(V(1.0), B.end - 0.05, BEAT / 2)) {
  const e = energy(t), b8 = ((k % 8) + 8) % 8;
  if (e >= 1 && b8 % 2 === 0) kick(t, b8 === 0 || b8 === 4 ? 0.55 : 0.32);
  if (e >= 1 && (b8 === 2 || b8 === 6)) (e >= 2 ? clap : rim)(t, e >= 2 ? 0.2 : 0.16);
  if (e >= 1) shaker(t, b8 % 2 ? 0.045 : 0.025, b8 % 2 ? 0.25 : -0.25);
  if (e >= 1 && b8 % 2 === 0) { const [, , root] = chordAt(t); bass(t, root + (b8 === 6 ? 7 : 0), BEAT * 0.9, e >= 2 ? 0.2 : 0.15); }
}
// the hook before the window opens: quiet clock-like pulse


/* ---------- sound design on the cues ---------- */
whoosh(B.phoneIn, B.phoneIn + 0.7, 500, 3000, 0.1);                                             // phone rises
whoosh(B.homeScroll, B.homeScroll + 1.0, 1600, 600, 0.05);                                     // scroll to the row
bell(B.hl, 88, 0.06, 0.2); bell(B.hl + 0.1, 91, 0.05, 0.2);                                     // "your package"
whoosh(B.toDash - 0.05, B.toDash + 0.5, 600, 3200, 0.12);                                       // into the dashboard
click(B.tapAdd, 0.28);
const typeClicks = (a, b, n) => { for (let i = 0; i < n; i++) noiseHit(fx, a + (i + 0.5) / n * (b - a), 0.02, "bp", 2800 + (i % 3) * 300, 1.4, 420, 0.06, ((i * 7) % 5 - 2) * 0.1, 0.05); };
typeClicks(...B.typeTitle, 14); typeClicks(...B.typeDesc, 12); typeClicks(...B.typeDest, 6); typeClicks(...B.typePrice, 3); typeClicks(...B.typeUrl, 8);
click(B.tapUns, 0.28); whoosh(B.pickerIn - 0.05, B.pickerIn + 0.35, 900, 2600, 0.06);
click(B.tapPhoto, 0.24); bloop(B.tapPhoto + 0.02, 79, 0.07);
click(B.tapUse, 0.28); bloop(B.tapUse + 0.05, 84, 0.07);
click(B.tapAllGr, 0.28); for (let i = 0; i < 12; i++) bloop(B.tapAllGr + 0.06 + i * 0.03, [72, 74, 76, 79, 81, 84][i % 6] + (i > 5 ? 12 : 0), 0.035, -0.4 + i * 0.07); // market chips
click(B.tapSubmit, 0.28); whoosh(B.tapSubmit + 0.05, B.tapSubmit + 0.5, 900, 4200, 0.08, 0.8);
bloop(B.csv, 76, 0.05);
[72, 76, 79, 84].forEach((m, i) => bell(B.approve + i * 0.06, m + 12, 0.045, -0.3 + i * 0.2, 2.5)); // approved
whoosh(B.toPhone - 0.05, B.toPhone + 0.55, 700, 3500, 0.1);
crash(B.rowSlide + 0.1, 0.08); subHit(B.rowSlide + 0.1, 0.2); whoosh(B.rowSlide, B.rowSlide + 0.55, 3000, 900, 0.06); // live in the app
bloop(B.tapCard, 79, 0.09); whoosh(B.sheetIn, B.sheetIn + 0.45, 800, 2800, 0.06);
bloop(B.tapCta, 84, 0.09); whoosh(B.siteIn, B.siteIn + 0.45, 2600, 900, 0.07); bell(B.siteIn + 0.25, 91, 0.04, 0.2, 2);
whoosh(B.toDash2 - 0.05, B.toDash2 + 0.5, 3500, 700, 0.1);
for (let i = 0; i < 14; i++) noiseHit(fx, B.stats[0] + Math.pow(i / 14, 1.6) * (B.stats[1] - B.stats[0]), 0.02, "bp", 3600, 2, 500, 0.04, 0.2, 0.05); // counters ticking
bell(B.stats[1], 88, 0.05, 0, 2);
riser(B.end - 0.9, B.end + 0.05, 0.12);
crash(B.end + 0.05, 0.14); subHit(B.end + 0.05, 0.3); kick(B.end + 0.05, 0.6);
[72, 76, 79, 84, 88].forEach((m, i) => bell(B.logo + i * 0.07, m, 0.05, -0.5 + i * 0.25, 3));
whoosh(B.slide, B.slide + 0.7, 2800, 800, 0.05);
bloop(B.url, 84, 0.08);
[48, 60, 64, 67, 72, 76].forEach((m, i) => epiano(END_T, m, 0.08, -0.4 + i * 0.16, 1.5));
bass(END_T, 36, 1.3, 0.2);

/* ---------- reverb + master ---------- */
function freeverb(inL, inR, room = 0.86, damp = 0.3) {
  const s = SR / 44100, combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225];
  const mk = (len) => ({ buf: new Float32Array(Math.round(len * s)), i: 0, store: 0 });
  const chan = (input, spread) => {
    const cs = combs.map((c) => mk(c + spread)), as = aps.map((a) => mk(a + spread)), out = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const x = input[n] * 0.015; let y = 0;
      for (const c of cs) { const o = c.buf[c.i]; c.store = o * (1 - damp) + c.store * damp; c.buf[c.i] = x + c.store * room; c.i = (c.i + 1) % c.buf.length; y += o; }
      for (const a of as) { const b = a.buf[a.i]; const o = -y + b; a.buf[a.i] = y + b * 0.5; a.i = (a.i + 1) % a.buf.length; y = o; }
      out[n] = y;
    }
    return out;
  };
  return [chan(inL, 0), chan(inR, 23)];
}
const [wetL, wetR] = freeverb(send.L, send.R);
const outL = new Float32Array(N), outR = new Float32Array(N);
const hpL = new Biquad(), hpR = new Biquad(); hpL.set("hp", 30, 0.7); hpR.set("hp", 30, 0.7);
let peak = 0;
for (let n = 0; n < N; n++) {
  const t = n / SR, fade = Math.min(1, t / 0.03) * (1 - smooth(DUR - 0.8, DUR, t));
  const l = Math.tanh(hpL.run(music.L[n] * sc[n] + drums.L[n] + fx.L[n] + wetL[n]) * 1.15) * fade;
  const r = Math.tanh(hpR.run(music.R[n] * sc[n] + drums.R[n] + fx.R[n] + wetR[n]) * 1.15) * fade;
  outL[n] = l; outR[n] = r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
}

/* ---------- write, loudness-normalise, mux ---------- */
const OUT = path.join(__dirname, "out");
function writeWav(file, L, R, gain) {
  const wav = Buffer.alloc(44 + N * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write("WAVE", 8); wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(N * 4, 40);
  for (let n = 0; n < N; n++) { wav.writeInt16LE(Math.round(clamp(L[n] * gain, -1, 1) * 32767), 44 + n * 4); wav.writeInt16LE(Math.round(clamp(R[n] * gain, -1, 1) * 32767), 46 + n * 4); }
  fs.writeFileSync(file, wav);
}
const rawPath = path.join(OUT, "music.raw.wav"), wavPath = path.join(OUT, "music.wav");
writeWav(rawPath, outL, outR, 0.89 / peak);
const LN = "loudnorm=I=-14:TP=-1.2:LRA=11";
const pass1 = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", rawPath, "-af", LN + ":print_format=json", "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(pass1.stderr.slice(pass1.stderr.lastIndexOf("{"), pass1.stderr.lastIndexOf("}") + 1));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", rawPath, "-af",
  `${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
  "-ar", String(SR), wavPath], { stdio: "inherit" });
fs.unlinkSync(rawPath);
console.log(`wrote ${wavPath} (input ${m.input_i} LUFS → -14)`);
const video = path.join(OUT, "planera-ota-partners-4x5.mp4"), muxed = path.join(OUT, "planera-ota-partners-4x5-sound.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", wavPath, "-map", "0:v", "-map", "1:a",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", muxed], { stdio: "inherit" });
console.log(`wrote ${muxed}`);
