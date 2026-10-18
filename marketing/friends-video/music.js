// Original high-energy score for "Plan together. Go together.", synthesised from scratch (no samples, no licensing).
// 140 BPM electro-pop: build → tape-stop → half-time → DROP (friends join) → breakdown (AI dialog) → riser → BIG DROP
// on the live update → muffled groove under the chat → final hit. Cues mirror BEATS in index.html.
//   node music.js  ->  out/music.wav  +  out/planera-friends-9x16-sound.mp4 (video with music, -14 LUFS)
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const SR = 48000;
const DUR = 21;
const N = Math.round(SR * DUR);
const TAU = Math.PI * 2;

/* ---------- utilities ---------- */
let seed = 9001;
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
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  }
}
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
class Saw { constructor(f) { this.p = rnd(); this.f = f; } next(fm = 1) { const dt = this.f * fm / SR; this.p += dt; if (this.p >= 1) this.p -= 1; return 2 * this.p - 1 - polyblep(this.p, dt); } }

/* ---------- story beats (index.html BEATS) ---------- */
const CHAOS = [0.45, 0.9, 1.3, 1.65, 1.95, 2.2, 2.42, 2.6, 2.75, 2.88, 2.99, 3.09, 3.18, 3.27];
const PAYOFF = [16.0, 16.4, 16.8];
const B = {
  stamp: 3.45, toApp: 4.45, tapInvite: 5.35, sheet: 5.5, tapGroup: 6.3, toChat: 6.5, sent: 6.95,
  toGrid: 7.45, joins: [8.35, 8.7, 9.05, 9.4], toOwner: 10.2, scrollDay2: 10.5,
  tapAI: 11.15, modal: 11.25, typeReq: [11.55, 12.2], typeTime: [12.3, 12.55], tapGo: 12.75, adding: 12.85, added: 13.25,
  toGrid2: 13.6, live: 14.25, toChat2: 15.6, heart: 17.15,
  wipe: 17.5, tag: 17.85, logo: 18.4, slide: 19.05, url: 19.6, badges: [19.8, 19.95],
};

/* ---------- tempo: 140 BPM, grid placed so the live update (14.25) is a bar downbeat ---------- */
const BEAT = 60 / 140, BAR = BEAT * 4, S16 = BEAT / 4;
const DROP1 = B.live - 4 * BAR;           // ≈ 7.39, right as the friends' phones fly in
const DROP2 = B.live;
const beatTimes = (a, b, step = BEAT) => { const out = []; let k = Math.ceil((a - DROP1) / step - 1e-6); for (let t = DROP1 + k * step; t < b - 1e-6; k++, t = DROP1 + k * step) out.push([t, k]); return out; };

/* ---------- harmony: Bm – G – D – A ---------- */
const CH = { Bm: [59, 62, 66], G: [59, 62, 67], D: [62, 66, 69], A: [61, 64, 69] };
const ROOT = { Bm: 35, G: 31, D: 38, A: 33 };
const SECTIONS = [
  [0, 3.45, "Bm"],
  [4.45, 5.9, "G"], [5.9, DROP1, "A"],
  [DROP1, DROP1 + BAR, "Bm"], [DROP1 + BAR, DROP1 + 2 * BAR, "G"], [DROP1 + 2 * BAR, DROP1 + 3 * BAR, "D"], [DROP1 + 3 * BAR, DROP2, "A"],
  [DROP2, DROP2 + BAR, "D"], [DROP2 + BAR, B.tag - 0.15, "A"],
  [B.tag - 0.15, 21, "D"],
];
const chordAt = (t) => { const s = SECTIONS.find(([a, b]) => t >= a && t < b); return s ? s[2] : null; };

/* ---------- instruments ---------- */
const sc = new Float32Array(N).fill(1);
function duck(t0, depth) { const i0 = Math.floor(t0 * SR); for (let k = 0; k < 0.35 * SR; k++) { const t = k / SR; if (i0 + k < N) sc[i0 + k] = Math.min(sc[i0 + k], 1 - depth * Math.exp(-t * 11)); } }
function kick(t0, g, depth = 0.65) {
  const i0 = Math.floor(t0 * SR); let ph = 0;
  for (let k = 0; k < 0.42 * SR; k++) {
    const t = k / SR; ph += TAU * (48 + 140 * Math.exp(-t * 38)) / SR;
    put(drums, i0 + k, (Math.tanh(Math.sin(ph) * 2.2) * Math.exp(-t * 7.5) + noise() * Math.exp(-t * 700) * 0.35) * g, 0, 0);
  }
  duck(t0, depth);
}
function noiseHit(bus, t0, dur, type, fc, q, decay, g, pan, rev) {
  const f = new Biquad(); f.set(type, fc, q); const i0 = Math.floor(t0 * SR);
  for (let k = 0; k < dur * SR; k++) { const t = k / SR; put(bus, i0 + k, f.run(noise()) * Math.min(1, t / 0.001) * Math.exp(-t * decay) * g, pan, rev); }
}
function clap(t0, g) { for (const o of [0, 0.011, 0.022]) noiseHit(drums, t0 + o, 0.02, "bp", 1500, 1.3, 110, g * 0.6, 0, 0.2); noiseHit(drums, t0 + 0.032, 0.25, "bp", 1300, 1.0, 17, g, 0, 0.28); }
function snare(t0, g) {
  noiseHit(drums, t0, 0.2, "bp", 2600, 0.7, 26, g, 0, 0.18);
  const i0 = Math.floor(t0 * SR); let ph = 0;
  for (let k = 0; k < 0.1 * SR; k++) { const t = k / SR; ph += TAU * 200 / SR; put(drums, i0 + k, Math.sin(ph) * Math.exp(-t * 35) * g * 0.7, 0); }
}
const hat = (t0, g, pan = 0) => noiseHit(drums, t0, 0.05, "hp", 9000, 0.8, 95, g, pan, 0.03);
const ohat = (t0, g, pan = 0) => noiseHit(drums, t0, 0.3, "hp", 7500, 0.7, 11, g, pan, 0.06);
const crash = (t0, g) => { noiseHit(fx, t0, 2.2, "hp", 4800, 0.6, 2.2, g, -0.45, 0.25); noiseHit(fx, t0, 2.2, "hp", 5100, 0.6, 2.2, g, 0.45, 0.25); };
function snareRoll(a, b, g0, g1) { // 8ths → 16ths → 32nds
  const L = b - a;
  for (let t = a; t < b - 0.005;) { const x = (t - a) / L; snare(t, g0 + (g1 - g0) * x); t += x < 0.4 ? BEAT / 2 : x < 0.75 ? S16 : S16 / 2; }
}
function subDrop(t0, g) { const i0 = Math.floor(t0 * SR); let ph = 0; for (let k = 0; k < 1.6 * SR; k++) { const t = k / SR; ph += TAU * (30 + 70 * Math.exp(-t * 4)) / SR; put(fx, i0 + k, Math.tanh(Math.sin(ph) * 1.6) * Math.exp(-t * 2) * g, 0, 0); } }
// supersaw: pumping chord stabs and pads
function supersaw(t0, dur, notes, g, cut0, cut1, atk = 0.004, rel = 0.06, bus = music) {
  for (const m of notes) for (const d of [-18, -9, 0, 9, 18]) {
    const o = new Saw(mtof(m) * Math.pow(2, d / 1200)), lp = new Biquad(), i0 = Math.floor(t0 * SR), len = Math.floor((dur + rel) * SR);
    for (let k = 0; k < len; k++) {
      const t = k / SR;
      if ((k & 31) === 0) lp.set("lp", cut1 + (cut0 - cut1) * Math.exp(-t * 9), 0.8);
      const env = Math.min(1, t / atk) * (1 - smooth(dur, dur + rel, t));
      put(bus, i0 + k, lp.run(o.next()) * env * g / Math.sqrt(notes.length * 5), d / 24, 0.3);
    }
  }
}
function padSweep(a, b, notes, g, c0, c1) { // sustained supersaw pad with a filter sweep
  for (const m of notes) for (const d of [-14, 0, 14]) {
    const o = new Saw(mtof(m) * Math.pow(2, d / 1200)), lp = new Biquad(), i0 = Math.floor(a * SR), i1 = Math.min(N, Math.floor((b + 0.2) * SR));
    for (let i = i0; i < i1; i++) {
      const t = i / SR; if ((i & 63) === 0) lp.set("lp", c0 * Math.pow(c1 / c0, clamp((t - a) / (b - a))), 0.9);
      put(music, i, lp.run(o.next()) * smooth(a, a + 0.3, t) * (1 - smooth(b, b + 0.2, t)) * g / Math.sqrt(notes.length * 3), d / 18, 0.4);
    }
  }
}
function bass(t0, m, dur, g, cut = 700) {
  const f = mtof(m), saw = new Saw(f), saw2 = new Saw(f * 1.006), lp = new Biquad(), i0 = Math.floor(t0 * SR); let ph = 0;
  for (let k = 0; k < (dur + 0.03) * SR; k++) {
    const t = k / SR; ph += TAU * f / SR;
    if ((k & 31) === 0) lp.set("lp", 180 + cut * Math.exp(-t * 16), 1.3);
    const v = Math.sin(ph) * 0.85 + lp.run(saw.next() + saw2.next()) * 0.35;
    put(music, i0 + k, Math.tanh(v * 1.4) * Math.min(1, t / 0.003) * (1 - smooth(dur, dur + 0.03, t)) * g, 0, 0);
  }
}
function lead(t0, m, dur, g, pan = 0) { // bright pluck lead
  const a = new Saw(mtof(m)), b = new Saw(mtof(m) * 1.004), c = new Saw(mtof(m + 12) * 0.998), lp = new Biquad(), i0 = Math.floor(t0 * SR);
  for (let k = 0; k < (dur + 0.12) * SR; k++) {
    const t = k / SR; if ((k & 15) === 0) lp.set("lp", 1200 + 5500 * Math.exp(-t * 14), 1.2);
    put(music, i0 + k, lp.run(a.next() + b.next() + 0.4 * c.next()) * 0.4 * Math.min(1, t / 0.003) * Math.exp(-t * 4) * (1 - smooth(dur, dur + 0.12, t)) * g, pan, 0.3);
  }
}
function bell(t0, m, g, pan = 0, dur = 2.2, rev = 0.5) {
  const fc = mtof(m), i0 = Math.floor(t0 * SR); let pc = 0, pm = 0;
  for (let k = 0; k < dur * SR; k++) { const t = k / SR, idx = 1.6 * Math.exp(-t * 7); pm += TAU * fc * 3.5 / SR; pc += TAU * fc / SR; put(fx, i0 + k, Math.sin(pc + idx * Math.sin(pm)) * Math.min(1, t / 0.002) * Math.exp(-t * 2.6) * g, pan, rev); }
}
function bloop(t0, m, g, pan = 0) {
  const f = mtof(m), i0 = Math.floor(t0 * SR); let ph = 0;
  for (let k = 0; k < 0.16 * SR; k++) { const t = k / SR; ph += TAU * f * (0.75 + 0.5 * Math.min(1, t / 0.035)) / SR; put(fx, i0 + k, Math.sin(ph) * Math.min(1, t / 0.002) * Math.exp(-t * 26) * g, pan, 0.15); }
}
const click = (t0, g) => noiseHit(fx, t0, 0.02, "bp", 3500, 1.5, 500, g, 0, 0.05);
function whoosh(a, b, f0, f1, g, peakAt = 0.65) {
  const bp = new Biquad(), i0 = Math.floor(a * SR), len = Math.floor((b - a) * SR);
  for (let k = 0; k < len; k++) {
    const x = k / len; if ((k & 31) === 0) bp.set("bp", f0 * Math.pow(f1 / f0, x), 1.4);
    const env = x < peakAt ? Math.pow(x / peakAt, 2) : Math.pow(1 - (x - peakAt) / (1 - peakAt), 1.5);
    put(fx, i0 + k, bp.run(noise()) * env * g, Math.sin(x * 5) * 0.4, 0.3);
  }
}
function riser(a, b, g, pitch = true) { // noise sweep + rising saw
  const hp = new Biquad(), lp = new Biquad(), o = new Saw(200), o2 = new Saw(201), i0 = Math.floor(a * SR), len = Math.floor((b - a) * SR);
  for (let k = 0; k < len; k++) {
    const x = k / len;
    if ((k & 31) === 0) { hp.set("hp", 500 * Math.pow(16, x), 0.8); lp.set("lp", 800 + 7000 * x, 1.2); o.f = 110 * Math.pow(8, x); o2.f = o.f * 1.01; }
    put(fx, i0 + k, (hp.run(noise()) * 0.8 + (pitch ? lp.run(o.next() + o2.next()) * 0.25 : 0)) * Math.pow(x, 2.2) * g, Math.sin(x * 9) * 0.3, 0.25);
  }
}
function tapeStop(t0, notes, g, dur = 0.5) {
  const saws = notes.map((m) => new Saw(mtof(m))), lp = new Biquad(); lp.set("lp", 2200, 0.7);
  for (let k = 0; k < dur * SR; k++) { const x = k / (dur * SR); let s = 0; for (const o of saws) s += o.next(Math.pow(1 - x, 2)); put(fx, Math.floor(t0 * SR) + k, lp.run(s / notes.length) * (1 - x) * g, 0, 0.1); }
}
function scratch(t0, g) {
  const bp = new Biquad(), i0 = Math.floor(t0 * SR), len = Math.floor(0.32 * SR);
  for (let k = 0; k < len; k++) { const x = k / len; if ((k & 15) === 0) bp.set("bp", 400 + 2600 * Math.abs(Math.sin(x * Math.PI * 2.2)), 3); put(fx, i0 + k, bp.run(noise()) * Math.sin(Math.PI * x) * g * 1.6, 0, 0.1); }
}

/* ---------- 1) chat chaos: everything speeds up and piles on ---------- */
for (const [t, k] of beatTimes(0.85, B.stamp)) kick(t, 0.55 + 0.25 * (t / B.stamp), 0.45);
for (const [t, k] of beatTimes(0.2, B.stamp, S16)) hat(t, (0.03 + 0.07 * (t / B.stamp)) * (k % 2 ? 0.6 : 1), k % 2 ? 0.3 : -0.3);
for (const [t, k] of beatTimes(0.4, B.stamp, BEAT / 2)) bass(t, ROOT.Bm + (k % 4 === 3 ? 12 : 0), BEAT / 2 - 0.03, 0.2, 500 + 900 * (t / B.stamp));
{ // arpeggio climbing an octave as the chat floods
  const ARP = [71, 74, 78, 83, 78, 74];
  for (const [t, k] of beatTimes(0.3, B.stamp, S16)) lead(t, ARP[((k % 6) + 6) % 6] + (t > 2.2 ? 12 : 0), S16 * 0.8, 0.07 + 0.08 * (t / B.stamp), k % 2 ? 0.35 : -0.35);
}
snareRoll(2.1, B.stamp - 0.02, 0.06, 0.24);
riser(1.4, B.stamp, 0.2);
const POPS = [74, 78, 81, 76, 79, 83, 78, 81, 86, 83, 88, 85, 90, 86];
CHAOS.forEach((t, i) => bloop(t, POPS[i], 0.13, (i % 2 ? 0.35 : -0.35)));
// "47 messages. 0 plans." — the whole thing grinds to a halt
tapeStop(B.stamp, [59, 66, 71, 74], 0.35, 0.55); scratch(B.stamp, 0.32); kick(B.stamp, 1.0, 0); subDrop(B.stamp, 0.45); crash(B.stamp, 0.08);

/* ---------- 2) the invite: half-time bounce, building into drop 1 ---------- */
whoosh(B.toApp - 0.05, B.toApp + 0.45, 600, 3600, 0.14);
for (const [t, k] of beatTimes(B.toApp + 0.05, 6.45)) {
  const bb = ((k % 4) + 4) % 4, c = chordAt(t);
  // half-time bounce: kick on 1 and the "and" of 2, clap on 3, 8th hats, busy bass, syncopated stabs
  if (bb === 0) kick(t, 0.85, 0.55);
  if (bb === 1) kick(t + BEAT / 2, 0.6, 0.45);
  if (bb === 2) clap(t, 0.34);
  hat(t, 0.045, -0.25); hat(t + BEAT / 2, 0.07, 0.25);
  if (bb === 3) ohat(t + BEAT / 2, 0.06, 0.2);
  bass(t, ROOT[c] + (bb === 3 ? 12 : 0), BEAT * 0.45, 0.24, 800);
  if (bb !== 2) bass(t + BEAT * 0.75, ROOT[c], BEAT * 0.2, 0.18, 800);
  supersaw(t + BEAT * 0.5, 0.13, CH[c].map((m) => m + 12), 0.15, 3200, 800);
  if (bb === 1 || bb === 3) supersaw(t + BEAT * 0.75, 0.1, CH[c].map((m) => m + 12), 0.1, 3200, 800);
}
click(B.tapInvite, 0.3); bloop(B.tapInvite + 0.02, 86, 0.06);
whoosh(B.sheet - 0.05, B.sheet + 0.35, 900, 2800, 0.08);
click(B.tapGroup, 0.3);
whoosh(B.toChat - 0.05, B.toChat + 0.4, 3000, 700, 0.1);
bloop(B.sent, 86, 0.16, 0.3); bloop(B.sent + 0.08, 93, 0.09, 0.3);
// build: kick 8ths, snare roll, riser, filtered chords opening up, then a breath before the drop
for (const [t, k] of beatTimes(6.45, DROP1 - 0.1, BEAT / 2)) { kick(t, 0.45 + 0.35 * clamp((t - 6.45) / 0.9), 0.4); supersaw(t, 0.08, CH.A.map((m) => m + 12), 0.07, 900 + 4000 * clamp((t - 6.45) / 0.9), 600); }
snareRoll(6.45, DROP1 - 0.1, 0.08, 0.28);
riser(5.9, DROP1 - 0.05, 0.22);

/* ---------- 3) DROP 1 — friends' phones fly in and join ---------- */
function dropGroove(a, b, energy, filtered = false) {
  for (const [t, k] of beatTimes(a, b, S16)) {
    const s16 = ((k % 16) + 16) % 16, c = chordAt(t); if (!c) continue;
    const onBeat = s16 % 4 === 0, off = s16 % 4 === 2;
    if (onBeat) kick(t, (filtered ? 0.55 : 0.92) * energy, filtered ? 0.45 : 0.7);
    if (s16 === 4 || s16 === 12) clap(t, (filtered ? 0.16 : 0.34) * energy);
    if (!filtered) { hat(t, (s16 % 2 ? 0.035 : 0.06) * energy, s16 % 2 ? 0.3 : -0.3); if (off) ohat(t, 0.08 * energy, 0.2); }
    else if (off) hat(t, 0.05, 0.2);
    // rolling offbeat bass + octave pops
    if (off) bass(t, ROOT[c] + (s16 === 14 ? 12 : 0), BEAT / 2 - 0.02, 0.27 * energy, filtered ? 350 : 900);
    // pumping supersaw stabs on the offbeats
    if (off) supersaw(t, 0.16, CH[c].map((m) => m + 12), (filtered ? 0.1 : 0.17) * energy, filtered ? 1200 : 5200, filtered ? 500 : 1100);
  }
}
const HOOK = { // one bar of 16ths per chord: [step, note]
  Bm: [[0, 83], [3, 81], [6, 78], [8, 78], [10, 81], [12, 83], [14, 86]],
  G: [[0, 83], [3, 81], [6, 79], [8, 78], [10, 79], [12, 81], [14, 83]],
  D: [[0, 86], [3, 85], [6, 81], [8, 78], [10, 81], [12, 85], [14, 86]],
  A: [[0, 85], [3, 83], [6, 81], [8, 76], [10, 81], [12, 85], [14, 88]],
};
function hook(a, b, g, octave = 0) {
  for (const [t, k] of beatTimes(a, b, S16)) { const s16 = ((k % 16) + 16) % 16, c = chordAt(t); if (!c) continue; for (const [st, m] of HOOK[c]) if (st === s16) lead(t, m + octave, S16 * 1.6, g, (s16 % 8) / 8 - 0.4); }
}
crash(DROP1, 0.2); subDrop(DROP1, 0.4);
dropGroove(DROP1, 11.25, 1);
hook(DROP1 + BAR, 11.25, 0.16);
[74, 78, 81, 86].forEach((m, i) => { bell(B.joins[i], m + 12, 0.08, -0.45 + i * 0.3); bloop(B.joins[i] + 0.02, m, 0.08); });
whoosh(B.toOwner - 0.05, B.toOwner + 0.4, 4000, 900, 0.1);

/* ---------- 4) breakdown — the AI dialog; then the long build ---------- */
whoosh(11.2, 11.7, 4000, 400, 0.12);
padSweep(11.25, 12.54, CH.D.map((m) => m + 12), 0.16, 500, 1400);
padSweep(12.54, DROP2 - 0.1, CH.A.map((m) => m + 12), 0.18, 1400, 6000);
for (const [t, k] of beatTimes(11.3, 13.2, BEAT / 2)) hat(t, 0.035, k % 2 ? 0.3 : -0.3);
for (const [t, k] of beatTimes(11.3, 13.2, BEAT)) bass(t, ROOT[chordAt(t)], BEAT * 0.8, 0.12, 300);
click(B.tapAI, 0.3); bloop(B.modal, 81, 0.06);
const REQ = "Fado night in Alfama";
[...REQ].forEach((ch, i) => { if (ch !== " ") click(B.typeReq[0] + (i + 0.5) / REQ.length * (B.typeReq[1] - B.typeReq[0]), 0.13); });
[0, 1, 2, 3, 4].forEach((i) => click(B.typeTime[0] + (i + 0.5) / 5 * (B.typeTime[1] - B.typeTime[0]), 0.13));
click(B.tapGo, 0.3);
[86, 90, 93, 98].forEach((m, i) => bell(B.adding + i * 0.1, m, 0.03, i % 2 ? 0.35 : -0.35, 1.6));
bloop(B.added, 88, 0.12); bell(B.added + 0.02, 93, 0.05, 0, 2.5);
// build: kicks 4 → 8 → 16, snare roll, big riser, then half a beat of silence
for (const [t, k] of beatTimes(13.2, DROP2 - BEAT / 2, BEAT)) kick(t, 0.6, 0.4);
snareRoll(DROP2 - 2 * BAR / 2, DROP2 - BEAT / 2, 0.06, 0.32);
riser(12.6, DROP2 - BEAT / 2, 0.28);
whoosh(B.toGrid2 - 0.1, B.toGrid2 + 0.4, 600, 4500, 0.1, 0.7);

/* ---------- 5) DROP 2 — the new activity lands on every phone ---------- */
crash(DROP2, 0.26); subDrop(DROP2, 0.55); kick(DROP2, 1.0);
[0, 0.03, 0.06, 0.09].forEach((d, i) => bloop(DROP2 + d, [86, 88, 90, 93][i], 0.09, -0.45 + i * 0.3));
[74, 78, 81, 86].forEach((m, i) => bell(DROP2 + 0.02, m + 12, 0.045, -0.45 + i * 0.3, 2.5));
dropGroove(DROP2, B.toChat2, 1.1);
hook(DROP2, B.toChat2, 0.18, 12);
// payoff chat: the groove keeps going, muffled behind the conversation
whoosh(B.toChat2 - 0.05, B.toChat2 + 0.4, 2500, 600, 0.12);
dropGroove(B.toChat2, B.wipe - 0.05, 0.9, true);
PAYOFF.forEach((t, i) => bloop(t, [81, 83, 86][i], 0.13, i % 2 ? 0.35 : -0.35));
bell(B.heart, 93, 0.07, 0.3, 2); bell(B.heart + 0.06, 98, 0.05, 0.3, 2);

/* ---------- 6) end card: hit, last drop, ringing chord ---------- */
riser(16.9, B.tag, 0.22); whoosh(B.wipe, B.tag, 700, 4000, 0.12, 0.85);
crash(B.tag, 0.24); subDrop(B.tag, 0.5); kick(B.tag, 1.0);
supersaw(B.tag, 0.5, CH.D.map((m) => m + 12), 0.2, 6000, 1500, 0.004, 0.4);
dropGroove(B.tag + BEAT, 20.2, 0.95);
hook(B.tag + BEAT, 20.2, 0.15, 12);
[74, 78, 81, 86, 90].forEach((m, i) => bell(B.logo + i * 0.07, m, 0.06, -0.5 + i * 0.25, 3));
whoosh(B.slide, B.slide + 0.7, 2800, 800, 0.06);
bloop(B.url, 86, 0.08); bloop(B.badges[0], 90, 0.08, -0.3); bloop(B.badges[1], 93, 0.08, 0.3);
const END = 20.25;
kick(END, 0.9, 0); crash(END, 0.18); supersaw(END, 0.6, [62, 66, 69, 74], 0.22, 5000, 1200, 0.004, 0.5); bass(END, 38, 0.6, 0.28);

/* ---------- reverb ---------- */
function freeverb(inL, inR, room = 0.84, damp = 0.3) {
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

/* ---------- master: pumping music bus, glue, soft clip ---------- */
const outL = new Float32Array(N), outR = new Float32Array(N);
const hpL = new Biquad(), hpR = new Biquad(); hpL.set("hp", 28, 0.7); hpR.set("hp", 28, 0.7);
let peak = 0;
for (let n = 0; n < N; n++) {
  const t = n / SR, fade = Math.min(1, t / 0.02) * (1 - smooth(20.4, 21, t));
  const l = Math.tanh(hpL.run(music.L[n] * sc[n] + drums.L[n] + fx.L[n] + wetL[n]) * 1.35) * fade;
  const r = Math.tanh(hpR.run(music.R[n] * sc[n] + drums.R[n] + fx.R[n] + wetR[n]) * 1.35) * fade;
  outL[n] = l; outR[n] = r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
}

/* ---------- write WAV, loudness-normalise to -14 LUFS, mux ---------- */
const OUT = path.join(__dirname, "out");
function writeWav(file, L, R, gain) {
  const wav = Buffer.alloc(44 + N * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write("WAVE", 8); wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(N * 4, 40);
  for (let n = 0; n < N; n++) {
    wav.writeInt16LE(Math.round(clamp(L[n] * gain, -1, 1) * 32767), 44 + n * 4);
    wav.writeInt16LE(Math.round(clamp(R[n] * gain, -1, 1) * 32767), 46 + n * 4);
  }
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
console.log(`wrote ${wavPath} (input ${m.input_i} LUFS → -14); drop 1 at ${DROP1.toFixed(2)}s, drop 2 at ${DROP2}s`);

const video = path.join(OUT, "planera-friends-9x16.mp4");
const muxed = path.join(OUT, "planera-friends-9x16-sound.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", wavPath, "-map", "0:v", "-map", "1:a",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", muxed], { stdio: "inherit" });
console.log(`wrote ${muxed}`);
