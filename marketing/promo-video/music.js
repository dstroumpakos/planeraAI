// Original cinematic soundtrack for the brand film, synthesised from scratch (no samples, no licensing).
// Trailer arc: D minor (Dm–B♭–F–C) building to the drop, silence, then a D major resolve on the logo.
// Every hit is placed on the same timestamps as the animation in index.html (see T below).
//   node music.js  ->  out/music.wav  +  out/planera-brand-9x16-sound.mp4 (video with music, -14 LUFS)
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const SR = 48000;
const DUR = 20.5;
const N = SR * DUR;
const TAU = Math.PI * 2;

/* ---------- utilities ---------- */
let seed = 1234567;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

class Bus { constructor() { this.L = new Float32Array(N); this.R = new Float32Array(N); } }
const mix = new Bus(), send = new Bus();

function put(i, v, pan = 0, rev = 0) {
  if (i < 0 || i >= N || !isFinite(v)) return;
  const a = (pan + 1) * Math.PI / 4, gl = Math.cos(a), gr = Math.sin(a);
  mix.L[i] += v * gl; mix.R[i] += v * gr;
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

/* ---------- arrangement ---------- */
// chord: strings voicing, low root, choir notes
const CH = {
  Dm: { str: [50, 57, 62, 65, 69], root: 38 },
  Bb: { str: [46, 53, 58, 62, 65], root: 34 },
  F: { str: [53, 57, 60, 65, 69], root: 41 },
  C: { str: [48, 55, 60, 64, 67], root: 36 },
  D: { str: [50, 57, 62, 66, 69, 76], root: 38 },
};
const SECTIONS = [
  [0.0, 3.0, "Dm"], [3.0, 5.0, "Bb"], [5.0, 7.0, "F"], [7.0, 9.0, "C"],
  [9.0, 10.0, "Bb"], [10.0, 11.0, "C"],
  [11.0, 13.0, "Dm"], [13.0, 14.5, "Bb"], [14.5, 15.5, "C"],   // planning scene
  [16.2, 20.5, "D"],
];
const sectionAt = (t) => SECTIONS.find(([a, b]) => t >= a && t < b);

// animation sync points (from index.html)
const T = {
  planeFrom: 0.15, land: 2.0, headline: 2.55, rollIn: 4.9,
  cities: [5.35, 5.97, 6.52, 7.0, 7.42, 7.8], anywhere: 8.14,
  drop: 9.0, words: [9.45, 9.65, 9.85],
  // planning scene (index.html: PROMPT / TYPE_FROM / TYPE_TO / PRESS / DAY_FROM / DAY_STEP)
  plan: { text: "5 days in Lisbon, food & sunsets", from: 11.1, to: 12.3, press: 12.45, ready: 13.6, head: 13.25, dayFrom: 13.55, dayStep: 0.2 },
  // end card, pushed back 4.5 s by the planning scene
  silence: 15.5, darkWipe: 15.65, logo: 16.2, slide: 16.9,
  url: 18.1, badges: [18.35, 18.5],
};

/* ---------- string section (supersaw ensemble with vibrato) ---------- */
const strCut = (t) => t < 2.55 ? 500 + 700 * smooth(0, 2.5, t) : t < 9 ? 1300 + 1500 * smooth(2.55, 9, t) : t < 11 ? 3200
  : t < 15.6 ? 1500 + 1600 * smooth(13, 15.5, t) : 2600 - 800 * smooth(17.5, 20.5, t);
const strLevel = (t) => t < 2.55 ? 0.05 + 0.05 * smooth(0.5, 2.5, t) : t < 9 ? 0.09 + 0.06 * smooth(5, 9, t) : t < 11 ? 0.15
  : t < 15.6 ? 0.075 + 0.065 * smooth(13, 15.5, t) : 0.17 * (1 - 0.35 * smooth(18, 20.5, t));
function strings(a, b, notes, atk, rel, levelFn, cutFn, rev = 0.55) {
  for (const m of notes) for (const det of [-14, -5, 5, 14]) {
    const osc = new Saw(mtof(m) * Math.pow(2, det / 1200)), lp = new Biquad(), lp2 = new Biquad();
    const vRate = 4.8 + rnd() * 0.8, vPh = rnd() * TAU, pan = det / 16 * 0.75;
    const i0 = Math.floor(a * SR), i1 = Math.min(N, Math.floor((b + rel) * SR));
    for (let i = i0; i < i1; i++) {
      const t = i / SR;
      if ((i & 63) === 0) { const c = cutFn(t); lp.set("lp", c, 0.7); lp2.set("lp", c * 1.4, 0.6); }
      const vib = 1 + 0.0022 * Math.sin(TAU * vRate * t + vPh) * smooth(a, a + 0.8, t);
      const env = smooth(a, a + atk, t) * (1 - smooth(b, b + rel, t));
      put(i, lp2.run(lp.run(osc.next(vib))) * env * levelFn(t) / Math.sqrt(notes.length * 4), pan, rev);
    }
  }
}
for (const [a, b, name] of SECTIONS) {
  const atk = a === 0 ? 2.2 : a === T.logo ? 0.05 : 0.35;
  strings(a, b, CH[name].str, atk, b === T.silence ? 0.12 : 0.6, strLevel, strCut);
}

/* ---------- choir pad ("ah" formants) ---------- */
function choir(a, b, notes, g, atk = 0.8, rel = 1.2) {
  const formants = [[800, 1.0], [1150, 0.5], [2900, 0.25]];
  for (const m of notes) for (const det of [-8, 8]) {
    const osc = new Saw(mtof(m) * Math.pow(2, det / 1200));
    const bps = formants.map(([f]) => { const q = new Biquad(); q.set("bp", f, 7); return q; });
    const vPh = rnd() * TAU, i0 = Math.floor(a * SR), i1 = Math.min(N, Math.floor((b + rel) * SR));
    for (let i = i0; i < i1; i++) {
      const t = i / SR, x = osc.next(1 + 0.003 * Math.sin(TAU * 5.3 * t + vPh));
      let y = 0; for (let k = 0; k < 3; k++) y += bps[k].run(x) * formants[k][1];
      put(i, y * smooth(a, a + atk, t) * (1 - smooth(b, b + rel, t)) * g / notes.length, det < 0 ? -0.6 : 0.6, 0.8);
    }
  }
}
choir(0.3, 2.6, [62, 69], 0.10, 1.8, 0.8);
choir(T.logo, 19.7, [62, 66, 69, 74], 0.16, 0.25, 1.0);

/* ---------- low drone + sub ---------- */
function drone(a, b, m, g, atk, rel) {
  let ph = 0; const saw = new Saw(mtof(m)), lp = new Biquad(); lp.set("lp", 220, 0.8);
  const i0 = Math.floor(a * SR), i1 = Math.min(N, Math.floor((b + rel) * SR));
  for (let i = i0; i < i1; i++) {
    const t = i / SR; ph += TAU * mtof(m) / SR;
    put(i, (Math.sin(ph) + lp.run(saw.next()) * 0.6) * smooth(a, a + atk, t) * (1 - smooth(b, b + rel, t)) * g, 0, 0.1);
  }
}
drone(0, 2.6, 26, 0.18, 2.0, 0.3);
for (const [a, b, name] of SECTIONS) if (a >= 2.5) drone(a === 3 ? 3 : a, b, CH[name].root - 12, 0.16, 0.15, 0.3);
drone(T.headline, 3.0, 26, 0.16, 0.05, 0.2);

/* ---------- ostinato (staccato strings, 16ths) ---------- */
function spiccato(t0, m, g, pan) {
  const oscs = [-9, 0, 9].map((d) => new Saw(mtof(m) * Math.pow(2, d / 1200))), lp = new Biquad();
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.2 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    if ((k & 15) === 0) lp.set("lp", 900 + 2600 * Math.exp(-t * 25), 0.9);
    let x = 0; for (const o of oscs) x += o.next();
    put(i0 + k, lp.run(x / 3) * Math.min(1, t / 0.005) * Math.exp(-t * 16) * g, pan, 0.3);
  }
}
const OST = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 7, 0, 12, 10];
for (let k = 0, t = 3.0; t < T.silence - 0.01; k++, t = 3.0 + k * 0.125) {
  const sec = sectionAt(t + 0.001); if (!sec) continue;
  const root = CH[sec[2]].str[0];
  if ((t < 5 || (t >= 11 && t < 13)) && k % 2) continue;   // 8ths under the headline and the typing, 16ths elsewhere
  const accent = k % 4 === 0 ? 1 : 0.62;
  const level = t < 5 ? 0.06 : t < 7 ? 0.08 : t < 9 ? 0.10 + 0.03 * smooth(7, 9, t) : t < 11 ? 0.13 : 0.055 + 0.07 * smooth(13, 15.5, t);
  const m = root + OST[k % 16];
  spiccato(t, m, level * accent, -0.25);
  if ((t >= 7 && t < 11) || t >= 14.5) spiccato(t, m + 12, level * accent * 0.55, 0.3);
}

/* ---------- percussion ---------- */
function taiko(t0, g, pitch = 1, pan = 0) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(1.0 * SR), slap = new Biquad(); slap.set("bp", 320 * pitch, 1.2); let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR, f = 62 * pitch * (1 + 0.6 * Math.exp(-t * 30));
    ph += TAU * f / SR;
    const v = Math.tanh(Math.sin(ph) * 2) * Math.exp(-t * 5.5) + slap.run(noise()) * Math.exp(-t * 28) * 1.4;
    put(i0 + k, v * g, pan, 0.45);
  }
}
function timpaniRoll(a, b, g0, g1, m = 38) {
  for (let t = a; t < b; t += 0.055 + rnd() * 0.01) {
    const g = g0 + (g1 - g0) * clamp((t - a) / (b - a)), i0 = Math.floor(t * SR); let ph = 0;
    for (let k = 0; k < 0.5 * SR; k++) { const tt = k / SR; ph += TAU * mtof(m) * (1 + 0.04 * Math.exp(-tt * 20)) / SR; put(i0 + k, (Math.sin(ph) * Math.exp(-tt * 4) + noise() * Math.exp(-tt * 60) * 0.25) * g * (0.8 + rnd() * 0.4), 0, 0.4); }
  }
}
function subBoom(t0, g) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(3 * SR); let ph = 0;
  for (let k = 0; k < len; k++) { const t = k / SR; ph += TAU * (32 + 55 * Math.exp(-t * 3)) / SR; put(i0 + k, Math.tanh(Math.sin(ph) * 1.5) * Math.exp(-t * 1.4) * g, 0, 0.05); }
}
function noiseBurst(t0, dur, fc, decay, g, rev) {
  const lpL = new Biquad(), lpR = new Biquad(); lpL.set("lp", fc, 0.6); lpR.set("lp", fc, 0.6);
  const i0 = Math.floor(t0 * SR);
  for (let k = 0; k < dur * SR; k++) { const t = k / SR, e = Math.min(1, t / 0.002) * Math.exp(-t * decay) * g; put(i0 + k, lpL.run(noise()) * e, -0.7, rev); put(i0 + k, lpR.run(noise()) * e, 0.7, rev); }
}
// braam: detuned low brass power chord with an opening filter and a growl
function braam(t0, notes, g, dur = 3.2) {
  for (const m of notes) for (const d of [-12, 0, 12]) {
    const osc = new Saw(mtof(m) * Math.pow(2, d / 1200)), lp = new Biquad(), i0 = Math.floor(t0 * SR), len = Math.floor(dur * SR);
    for (let k = 0; k < len; k++) {
      const t = k / SR;
      if ((k & 31) === 0) lp.set("lp", 140 + 2200 * Math.pow(Math.sin(Math.PI * Math.min(1, t / 1.6)), 1.5) * Math.exp(-t * 0.6), 1.3);
      const growl = 1 + 0.004 * Math.exp(-t * 6) * Math.sin(TAU * 31 * t);
      const env = Math.min(1, t / 0.03) * Math.exp(-t * 0.9);
      put(i0 + k, Math.tanh(lp.run(osc.next(growl)) * 2.2) * env * g / notes.length, d / 20, 0.5);
    }
  }
}
function impact(t0, g, braamNotes) {
  taiko(t0, 0.75 * g, 0.9); subBoom(t0, 0.55 * g); noiseBurst(t0, 2.5, 2600, 2.6, 0.16 * g, 0.7);
  if (braamNotes) braam(t0, braamNotes, 0.5 * g);
}

/* ---------- sound design ---------- */
function bell(t0, m, g, pan, dur = 3, rev = 0.7) {
  const fc = mtof(m), i0 = Math.floor(t0 * SR), len = Math.floor(dur * SR); let pc = 0, pm = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR, idx = 1.8 * Math.exp(-t * 6);
    pm += TAU * fc * 3.5 / SR; pc += TAU * fc / SR;
    put(i0 + k, Math.sin(pc + idx * Math.sin(pm)) * Math.min(1, t / 0.002) * Math.exp(-t * 2.0) * g, pan, rev);
  }
}
function harp(t0, m, g, pan) { // Karplus–Strong pluck
  const f = mtof(m), L = Math.max(2, Math.round(SR / f)), buf = new Float32Array(L), lp = new Biquad(); lp.set("lp", 3500, 0.7);
  for (let k = 0; k < L; k++) buf[k] = lp.run(noise());
  const i0 = Math.floor(t0 * SR); let p = 0, prev = 0;
  for (let k = 0; k < 2.2 * SR; k++) { const x = buf[p]; const y = 0.4985 * (x + prev); prev = x; buf[p] = y; p = (p + 1) % L; put(i0 + k, x * g, pan, 0.6); }
}
function whoosh(a, b, f0, f1, g, panFn, peakAt = 0.65) {
  const bp = new Biquad(), i0 = Math.floor(a * SR), len = Math.floor((b - a) * SR);
  for (let k = 0; k < len; k++) {
    const x = k / len;
    if ((k & 31) === 0) bp.set("bp", f0 * Math.pow(f1 / f0, x), 1.4);
    const env = x < peakAt ? Math.pow(x / peakAt, 2) : Math.pow(1 - (x - peakAt) / (1 - peakAt), 1.5);
    put(i0 + k, bp.run(noise()) * env * g, panFn(x), 0.35);
  }
}
// reverse swell: cymbal-like noise + rising string gliss, slamming shut at b
function swell(a, b, g, gliss = true) {
  const hp = new Biquad(), i0 = Math.floor(a * SR), len = Math.floor((b - a) * SR);
  const gl = [50, 57, 62].map((m) => ({ o: new Saw(mtof(m)), m })), lp = new Biquad();
  for (let k = 0; k < len; k++) {
    const x = k / len;
    if ((k & 31) === 0) { hp.set("hp", 1500 + 5000 * x, 0.7); lp.set("lp", 500 + 4000 * x, 0.8); }
    let s = 0; if (gliss) for (const v of gl) { v.o.f = mtof(v.m + 12 * x); s += v.o.next(); }
    put(i0 + k, (hp.run(noise()) * 0.9 + lp.run(s / 3) * 0.35) * Math.pow(x, 2.6) * g, Math.sin(x * 7) * 0.25, 0.4);
  }
}

/* ---------- timeline ---------- */
// intro: the plane crosses, lands on Athens with a celesta-like bell
whoosh(T.planeFrom, 2.15, 250, 2200, 0.2, (x) => -0.7 + 1.4 * Math.sin(x * Math.PI * 0.8) * (1 - x * 0.6), 0.8);
bell(T.land, 81, 0.12, 0.1, 3.5); bell(T.land + 0.004, 74, 0.08, -0.2, 3.5);
swell(1.75, T.headline, 0.18);
// "Where to next?" — first braam
impact(T.headline, 1.0, [26, 38, 45]);
taiko(3.0, 0.35, 1); taiko(4.0, 0.4, 1); taiko(4.5, 0.25, 1.2);
whoosh(4.7, 5.45, 2400, 400, 0.14, (x) => 0.4 - 0.8 * x, 0.55);
// destination roll: taiko groove, harp plucks per city
const GROOVE = [[0, 1], [0.75, 0.55], [1.0, 0.85], [1.5, 0.6]];
for (const bar of [5, 7]) for (const [o, v] of GROOVE) taiko(bar + o, 0.42 * v * (bar === 7 ? 1.25 : 1), 1, (o * 2 % 2) - 0.5);
for (let t = 7.25; t < 8.5; t += 0.5) taiko(t, 0.22, 1.5, 0.4);
for (let t = 8.5; t < 8.95; t += 0.125) taiko(t, 0.2 + 0.4 * (t - 8.5), 1.35 + (t - 8.5), (t * 8 % 2) - 0.5);
timpaniRoll(7.9, 8.95, 0.03, 0.22);
[65, 69, 72, 76, 79, 81].forEach((m, i) => harp(T.cities[i], m, 0.22 + i * 0.02, i % 2 ? 0.3 : -0.3));
[72, 76, 79, 86].forEach((m, i) => bell(T.anywhere + i * 0.02, m, 0.05, [-0.4, -0.1, 0.1, 0.4][i], 3));
swell(7.6, T.drop, 0.28);
// the drop
impact(T.drop, 1.25, [22, 34, 41]);
const WORD_CHORDS = [[46, 53, 58, 65], [48, 55, 60, 67], [50, 57, 62, 69]];
T.words.forEach((t, i) => { braam(t, WORD_CHORDS[i].slice(0, 2), 0.22, 0.9); strings(t, t + 0.12, WORD_CHORDS[i], 0.01, 0.35, () => 0.16, () => 3600, 0.5); taiko(t, 0.55, 0.95 + i * 0.08); });
for (let t = 10.0; t < 10.9; t += 0.5) taiko(t, 0.32, 1.1, (t * 2 % 2) - 0.5);

// planning scene: "Let's plan it." lifts away, the prompt drops in and types itself
whoosh(10.5, 11.05, 2600, 600, 0.1, (x) => 0.3 - 0.6 * x, 0.6);
taiko(11.0, 0.32, 0.9); subBoom(11.0, 0.18);
function key(t0, i) {
  const bp = new Biquad(); bp.set("bp", 2600 + (i % 4) * 300, 1.3); let ph = 0;
  const f = 1300 + (i % 3) * 140, pan = ((i * 7) % 5 - 2) * 0.12, i0 = Math.floor(t0 * SR);
  for (let k = 0; k < 0.07 * SR; k++) { const t = k / SR; ph += TAU * f / SR; put(i0 + k, bp.run(noise()) * Math.exp(-t * 240) * 0.09 + Math.sin(ph) * Math.exp(-t * 90) * 0.018, pan, 0.12); }
}
const PL = T.plan;
[...PL.text].forEach((ch, i) => { if (ch !== " ") key(PL.from + (i + 0.5) / PL.text.length * (PL.to - PL.from), i); });
// send: tap, chime, the bar glides up
taiko(PL.press, 0.22, 1.5); bell(PL.press, 86, 0.07, 0.2, 2.5);
whoosh(PL.press + 0.1, 13.2, 700, 3200, 0.08, (x) => 0.2 - 0.4 * x, 0.5);
// "Building your trip…": a rising celesta shimmer, then "ready"
[74, 77, 79, 81, 84, 86, 89].forEach((m, i) => bell(12.8 + i * 0.11, m, 0.028, (i % 2 ? 0.35 : -0.35), 2));
taiko(PL.head, 0.3, 1.0);
[74, 77, 81, 86].forEach((m, i) => bell(PL.ready + i * 0.015, m, 0.04, [-0.4, -0.1, 0.1, 0.4][i], 3));
// each day card lands with a harp note up the B♭ chord, its check mark with a soft tap
[70, 74, 77, 82, 86].forEach((m, i) => {
  const t = PL.dayFrom + i * PL.dayStep;
  harp(t, m, 0.2, i % 2 ? 0.3 : -0.3);
  key(t + 0.4, i + 10);
});
// build out of the itinerary into the silence before the logo
for (let t = 14.5; t < 15.45; t += 0.25) taiko(t, 0.25 + 0.3 * (t - 14.5), 1.1, (t * 4 % 2) - 0.5);
timpaniRoll(14.9, 15.47, 0.04, 0.26);
// silence, then a reverse swell into the logo and a D major resolve
swell(T.silence + 0.05, T.logo, 0.3);
whoosh(T.darkWipe, T.logo + 0.05, 500, 3500, 0.12, () => 0, 0.88);
impact(T.logo, 1.35, [26, 38, 45, 50]);
[62, 66, 69, 74, 78].forEach((m, i) => bell(T.logo + 0.05 + i * 0.09, m + 12, 0.05, -0.5 + i * 0.25, 4));
whoosh(T.slide, T.slide + 0.8, 2800, 800, 0.06, (x) => -0.5 + x, 0.4);
// end card: harp + bells on the URL and badges
harp(T.url, 81, 0.18, 0); bell(T.url, 86, 0.04, 0, 3);
harp(T.badges[0], 85, 0.16, -0.25); bell(T.badges[0], 90, 0.035, -0.25, 3);
harp(T.badges[1], 88, 0.16, 0.25); bell(T.badges[1], 93, 0.035, 0.25, 3);

/* ---------- concert-hall reverb (Freeverb, pre-delayed) ---------- */
function freeverb(inL, inR, room = 0.93, damp = 0.32, predelay = 0.03) {
  const s = SR / 44100, combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225], pd = Math.round(predelay * SR);
  const mk = (len) => ({ buf: new Float32Array(Math.round(len * s)), i: 0, store: 0 });
  const chan = (input, spread) => {
    const cs = combs.map((c) => mk(c * 1.25 + spread)), as = aps.map((a) => mk(a + spread)), out = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const x = (n >= pd ? input[n - pd] : 0) * 0.015; let y = 0;
      for (const c of cs) { const o = c.buf[c.i]; c.store = o * (1 - damp) + c.store * damp; c.buf[c.i] = x + c.store * room; c.i = (c.i + 1) % c.buf.length; y += o; }
      for (const a of as) { const b = a.buf[a.i]; const o = -y + b; a.buf[a.i] = y + b * 0.5; a.i = (a.i + 1) % a.buf.length; y = o; }
      out[n] = y;
    }
    return out;
  };
  return [chan(inL, 0), chan(inR, 23)];
}
const [wetL, wetR] = freeverb(send.L, send.R);

/* ---------- master ---------- */
const outL = new Float32Array(N), outR = new Float32Array(N);
const hpL = new Biquad(), hpR = new Biquad(); hpL.set("hp", 26, 0.7); hpR.set("hp", 26, 0.7);
let peak = 0;
for (let n = 0; n < N; n++) {
  const t = n / SR, fade = Math.min(1, t / 0.03) * (1 - smooth(19.1, 20.5, t));
  const l = Math.tanh(hpL.run(mix.L[n] + wetL[n] * 1.35) * 1.15) * fade;
  const r = Math.tanh(hpR.run(mix.R[n] + wetR[n] * 1.35) * 1.15) * fade;
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
const LN = "loudnorm=I=-14:TP=-1.2:LRA=14";
const pass1 = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", rawPath, "-af", LN + ":print_format=json", "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(pass1.stderr.slice(pass1.stderr.lastIndexOf("{"), pass1.stderr.lastIndexOf("}") + 1));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", rawPath, "-af",
  `${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
  "-ar", String(SR), wavPath], { stdio: "inherit" });
fs.unlinkSync(rawPath);
console.log(`wrote ${wavPath} (input ${m.input_i} LUFS → -14)`);

const video = path.join(OUT, "planera-brand-9x16.mp4");
const muxed = path.join(OUT, "planera-brand-9x16-sound.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", wavPath, "-map", "0:v", "-map", "1:a",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", muxed], { stdio: "inherit" });
console.log(`wrote ${muxed}`);
