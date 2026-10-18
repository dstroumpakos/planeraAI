// Original score for "Hunted while you sleep", synthesised from scratch (no samples, no licensing).
// Night lullaby in A minor → radar tension → sunrise lift into C major. Cues mirror BEATS in index.html.
//   node music.js  ->  out/music.wav  +  out/planera-radar-9x16-sound.mp4 (video with music, -14 LUFS)
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const SR = 48000;
const DUR = 19.5;
const N = Math.round(SR * DUR);
const TAU = Math.PI * 2;

/* ---------- utilities ---------- */
let seed = 424242;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, p) => a + (b - a) * p;

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

/* ---------- story beats (index.html BEATS) ---------- */
const B = {
  tilt: 3.0, t2: 3.4, radarIn: 3.5, sweepFrom: 3.7, lockOn: 6.25, card: 6.6,
  drops: [7.2, 7.8, 8.3, 8.75, 9.15], lowest: 9.2,
  dawn: 9.7, sunUp: 9.9, phone: 11.1, notif: 12.05, push: 12.75, wipe: 13.25,
  headline: 13.7, logo: 15.9, slide: 16.65, live: 17.35, url: 17.6, badges: [17.8, 17.95],
};
// radar blips: [angle°, first-pass time = sweepFrom + angle / 240]
const BLIP_ANGLES = [292, 270, 255, 305, 322, 345, 42, 150, 104];

/* ---------- harmony ---------- */
const CH = {
  Am: { str: [57, 60, 64, 69, 72], root: 45 },
  F: { str: [53, 57, 60, 65, 69], root: 41 },
  C: { str: [48, 55, 60, 64, 67], root: 36 },
  G: { str: [55, 59, 62, 67, 71], root: 43 },
};
const SECTIONS = [
  [0.0, 1.5, "Am"], [1.5, 3.0, "F"], [3.0, 4.5, "Am"], [4.5, 6.5, "F"],      // night, radar
  [6.5, 7.5, "C"], [7.5, 8.5, "G"], [8.5, 9.7, "Am"],                      // the hunt
  [9.7, 11.0, "F"], [11.0, 12.05, "G"], [12.05, 13.45, "C"],                // sunrise, phone
  [13.7, 14.7, "C"], [14.7, 15.9, "F"], [15.9, 19.5, "C"],                  // headline, logo
];
const sectionAt = (t) => SECTIONS.find(([a, b]) => t >= a && t < b);

/* ---------- instruments ---------- */
const strCut = (t) => t < 3 ? 900 : t < 6.5 ? 1100 + 400 * smooth(3, 6.5, t) : t < 9.7 ? 1500 + 1300 * smooth(6.5, 9.2, t)
  : t < 13.5 ? 2000 + 1600 * smooth(9.7, 12.5, t) : t < 15.9 ? 3600 : 3000 - 900 * smooth(17, 19.5, t);
const strLevel = (t) => t < 3 ? 0.045 * smooth(0, 1.5, t) + 0.01 : t < 6.5 ? 0.065 : t < 9.7 ? 0.08 + 0.05 * smooth(6.5, 9.2, t)
  : t < 13.5 ? 0.09 + 0.05 * smooth(9.7, 12.5, t) : t < 15.9 ? 0.15 : 0.16 * (1 - 0.35 * smooth(17.5, 19.5, t));
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
function drone(a, b, m, g, atk, rel) {
  let ph = 0; const saw = new Saw(mtof(m)), lp = new Biquad(); lp.set("lp", 220, 0.8);
  const i0 = Math.floor(a * SR), i1 = Math.min(N, Math.floor((b + rel) * SR));
  for (let i = i0; i < i1; i++) {
    const t = i / SR; ph += TAU * mtof(m) / SR;
    put(i, (Math.sin(ph) + lp.run(saw.next()) * 0.6) * smooth(a, a + atk, t) * (1 - smooth(b, b + rel, t)) * g, 0, 0.1);
  }
}
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
function taiko(t0, g, pitch = 1, pan = 0) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(1.0 * SR), slap = new Biquad(); slap.set("bp", 320 * pitch, 1.2); let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR, f = 62 * pitch * (1 + 0.6 * Math.exp(-t * 30));
    ph += TAU * f / SR;
    put(i0 + k, (Math.tanh(Math.sin(ph) * 2) * Math.exp(-t * 5.5) + slap.run(noise()) * Math.exp(-t * 28) * 1.4) * g, pan, 0.45);
  }
}
function timpaniRoll(a, b, g0, g1, m) {
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
function braam(t0, notes, g, dur = 3.2) {
  for (const m of notes) for (const d of [-12, 0, 12]) {
    const osc = new Saw(mtof(m) * Math.pow(2, d / 1200)), lp = new Biquad(), i0 = Math.floor(t0 * SR), len = Math.floor(dur * SR);
    for (let k = 0; k < len; k++) {
      const t = k / SR;
      if ((k & 31) === 0) lp.set("lp", 140 + 2200 * Math.pow(Math.sin(Math.PI * Math.min(1, t / 1.6)), 1.5) * Math.exp(-t * 0.6), 1.3);
      const growl = 1 + 0.004 * Math.exp(-t * 6) * Math.sin(TAU * 31 * t);
      put(i0 + k, Math.tanh(lp.run(osc.next(growl)) * 2.2) * Math.min(1, t / 0.03) * Math.exp(-t * 0.9) * g / notes.length, d / 20, 0.5);
    }
  }
}
function impact(t0, g, braamNotes) {
  taiko(t0, 0.75 * g, 0.9); subBoom(t0, 0.55 * g); noiseBurst(t0, 2.5, 2600, 2.6, 0.16 * g, 0.7);
  if (braamNotes) braam(t0, braamNotes, 0.5 * g);
}
// FM bell; a higher ratio and faster decay make it a music-box tine
function bell(t0, m, g, pan, dur = 3, rev = 0.7, ratio = 3.5, index = 1.8, decay = 2.0) {
  const fc = mtof(m), i0 = Math.floor(t0 * SR), len = Math.floor(dur * SR); let pc = 0, pm = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR, idx = index * Math.exp(-t * 6);
    pm += TAU * fc * ratio / SR; pc += TAU * fc / SR;
    put(i0 + k, Math.sin(pc + idx * Math.sin(pm)) * Math.min(1, t / 0.002) * Math.exp(-t * decay) * g, pan, rev);
  }
}
const musicBox = (t, m, g, pan = 0) => bell(t, m, g, pan, 1.6, 0.6, 5.0, 1.1, 3.2);
function harp(t0, m, g, pan) {
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
function swell(a, b, g, glissNotes) {
  const hp = new Biquad(), i0 = Math.floor(a * SR), len = Math.floor((b - a) * SR);
  const gl = (glissNotes || []).map((m) => ({ o: new Saw(mtof(m)), m })), lp = new Biquad();
  for (let k = 0; k < len; k++) {
    const x = k / len;
    if ((k & 31) === 0) { hp.set("hp", 1500 + 5000 * x, 0.7); lp.set("lp", 500 + 4000 * x, 0.8); }
    let s = 0; for (const v of gl) { v.o.f = mtof(v.m + 12 * x); s += v.o.next(); }
    put(i0 + k, (hp.run(noise()) * 0.9 + (gl.length ? lp.run(s / gl.length) * 0.35 : 0)) * Math.pow(x, 2.6) * g, Math.sin(x * 7) * 0.25, 0.4);
  }
}
function tick(t0, f, g, pan = 0) { // clock / UI tick: filtered click + tiny tone
  const bp = new Biquad(); bp.set("bp", f * 2, 2); let ph = 0; const i0 = Math.floor(t0 * SR);
  for (let k = 0; k < 0.05 * SR; k++) { const t = k / SR; ph += TAU * f / SR; put(i0 + k, (bp.run(noise()) * Math.exp(-t * 400) * 1.2 + Math.sin(ph) * Math.exp(-t * 120) * 0.3) * g, pan, 0.15); }
}
function blip(t0, f0, f1, dur, g, pan = 0, rev = 0.5) { // sine glide (sonar, radar blip, price drop)
  const i0 = Math.floor(t0 * SR), len = Math.floor(dur * SR); let ph = 0;
  for (let k = 0; k < len; k++) { const x = k / len, t = k / SR; ph += TAU * f0 * Math.pow(f1 / f0, Math.min(1, x * 3)) / SR; put(i0 + k, Math.sin(ph) * Math.min(1, t / 0.003) * Math.exp(-t * 5 / dur) * g, pan, rev); }
}
function buzz(t0, dur, g) { // phone vibration motor
  const lp = new Biquad(); lp.set("lp", 400, 0.8); let ph = 0; const i0 = Math.floor(t0 * SR);
  for (let k = 0; k < dur * SR; k++) { const t = k / SR; ph += TAU * 165 / SR; const sq = Math.sign(Math.sin(ph)) * 0.6 + Math.sin(ph * 2) * 0.4; put(i0 + k, lp.run(sq) * smooth(0, 0.02, t) * (1 - smooth(dur - 0.04, dur, t)) * (0.7 + 0.3 * Math.sin(TAU * 30 * t)) * g, 0, 0.05); }
}

/* ---------- arrangement ---------- */
for (const [a, b, name] of SECTIONS) {
  const atk = a === 0 ? 1.8 : (a === B.headline || a === B.logo) ? 0.04 : 0.35;
  const rel = b === 13.45 ? 0.2 : b === 9.7 ? 0.25 : 0.6;
  strings(a, b, CH[name].str, atk, rel, strLevel, strCut);
  drone(a, b, CH[name].root - 12, a < 3 ? 0.12 : 0.15, a === 0 ? 1.5 : 0.15, 0.3);
}
choir(0.2, 3.1, [69, 76], 0.07, 1.6, 0.8);
choir(9.8, 13.45, [67, 72, 76], 0.10, 1.2, 0.3);
choir(B.logo, 18.8, [67, 72, 76, 79], 0.15, 0.25, 1.0);

// night: music-box lullaby + tick-tock
const LULLABY = [[81, 84, 88, 84, 81, 84], [77, 81, 84, 81, 77, 88]];
LULLABY.flat().forEach((m, i) => musicBox(0.35 + i * 0.25, m, 0.09 * (i % 3 === 0 ? 1 : 0.7), i % 2 ? 0.3 : -0.3));
// the clock: tick-tock, then the night fast-forwards (rate ramps up, holds, winds down)
{
  let t = 0.25, n = 0;
  while (t < 10.4) {
    const rate = t < 3.2 ? 2 : t < 6.5 ? lerp(2, 11, smooth(3.2, 6.5, t)) : t < 9.6 ? 11 : lerp(11, 2, smooth(9.6, 10.4, t));
    tick(t, n % 2 ? 1900 : 2400, t < 3.2 ? 0.05 : 0.035 * (1 - smooth(9.4, 10.4, t)) + 0.012, n % 2 ? 0.2 : -0.2);
    t += 1 / rate; n++;
  }
}
// "Planera doesn't." + radar
impact(B.t2, 0.55, null);
blip(B.sweepFrom, 1050, 980, 1.6, 0.11, 0, 0.8); blip(B.sweepFrom + 1.5, 1050, 980, 1.6, 0.09, 0, 0.8);
const PENTA = [93, 96, 98, 100, 103, 105, 108, 100, 96];
BLIP_ANGLES.forEach((a, i) => blip(B.sweepFrom + a / 240, mtof(PENTA[i]), mtof(PENTA[i]) * 0.98, 0.25, 0.045, Math.sin(a * Math.PI / 180) * 0.6, 0.5));
for (let k = 0, t = B.t2; t < B.lowest - 0.02; k++, t = B.t2 + k * 0.125) {   // ostinato: 8ths under the radar, 16ths in the hunt
  if (t < B.card && k % 2) continue;
  const sec = sectionAt(t + 0.001); if (!sec) continue;
  const root = CH[sec[2]].str[0], OST = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 7, 0, 12, 10];
  const lvl = t < B.card ? 0.045 : 0.06 + 0.06 * smooth(B.card, B.lowest, t);
  spiccato(t, root + OST[k % 16], lvl * (k % 4 === 0 ? 1 : 0.62), -0.25);
  if (t > 7.5) spiccato(t, root + 12 + OST[k % 16], lvl * 0.5 * (k % 4 === 0 ? 1 : 0.62), 0.3);
}
// lock on → fare card
blip(B.lockOn, 1760, 1760, 0.09, 0.07, 0, 0.3); blip(B.lockOn + 0.12, 1760, 1760, 0.09, 0.07, 0, 0.3);
whoosh(B.lockOn + 0.05, B.card + 0.1, 500, 3000, 0.12, () => 0, 0.85);
taiko(B.card, 0.4, 0.95); subBoom(B.card, 0.2);
// the hunt: heartbeat taiko, a falling blip + hit on every price drop
for (let t = B.card + 0.5; t < B.lowest - 0.05; t += 0.5) { taiko(t, 0.16, 0.8); taiko(t + 0.16, 0.1, 0.8); }
B.drops.forEach((t, i) => { blip(t, mtof(91 - i * 2), mtof(79 - i * 2), 0.3, 0.07, 0.15, 0.4); taiko(t, 0.3 + i * 0.07, 1.05 + i * 0.05); });
timpaniRoll(8.6, B.lowest - 0.02, 0.03, 0.2, 45);
// LOWEST PRICE
impact(B.lowest, 0.95, [33, 45, 52]);
[81, 84, 88, 93].forEach((m, i) => bell(B.lowest + 0.03 + i * 0.05, m, 0.045, -0.45 + i * 0.3, 3));
// sunrise: swell, the lullaby returns in major
swell(9.25, B.dawn + 0.3, 0.09, null);
[[9.9, [77, 81, 84, 81]], [10.9, [79, 83, 86, 83]], [11.6, [79, 83, 86, 91]]].forEach(([t0, ns]) => ns.forEach((m, i) => musicBox(t0 + i * 0.25, m, 0.075, i % 2 ? 0.3 : -0.3)));
// phone: buzz + notification chime
buzz(B.notif, 0.42, 0.22);
bell(B.notif + 0.06, 91, 0.075, 0, 2.5, 0.5); bell(B.notif + 0.2, 96, 0.075, 0, 2.5, 0.5);
// push into the notification → yellow → headline
swell(B.push, B.headline, 0.26, [48, 55, 60]);
impact(B.headline, 1.15, [24, 36, 43]);
const GROOVE = [[0, 1], [0.375, 0.5], [0.5, 0.8], [0.75, 0.55]];
for (let bar = B.headline; bar < B.logo - 0.3; bar += 1) for (const [o, v] of GROOVE) if (bar + o > B.headline + 0.1 && bar + o < B.logo - 0.3) taiko(bar + o, 0.4 * v, 1, (o * 4 % 2) - 0.5);
for (let k = 0, t = B.headline; t < B.logo - 0.25; k++, t = B.headline + k * 0.125) {
  const sec = sectionAt(t + 0.001); if (!sec) continue;
  const root = CH[sec[2]].str[0], OST = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 7, 0, 12, 10];
  spiccato(t, root + OST[k % 16], 0.11 * (k % 4 === 0 ? 1 : 0.62), -0.25);
  spiccato(t, root + 12 + OST[k % 16], 0.06 * (k % 4 === 0 ? 1 : 0.62), 0.3);
}
timpaniRoll(15.3, B.logo - 0.03, 0.04, 0.25, 36);
swell(15.2, B.logo, 0.22, [48, 55, 60]);
// logo: home chord
impact(B.logo, 1.25, [24, 36, 43, 48]);
[72, 76, 79, 84, 88].forEach((m, i) => bell(B.logo + 0.05 + i * 0.09, m, 0.05, -0.5 + i * 0.25, 4));
whoosh(B.slide, B.slide + 0.8, 2800, 800, 0.06, (x) => -0.5 + x, 0.4);
harp(B.live, 84, 0.18, 0); bell(B.live, 91, 0.035, 0, 3);
harp(B.url, 88, 0.16, 0);
harp(B.badges[0], 91, 0.16, -0.25); bell(B.badges[0], 96, 0.03, -0.25, 3);
harp(B.badges[1], 96, 0.16, 0.25); bell(B.badges[1], 100, 0.03, 0.25, 3);

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
  const t = n / SR, fade = Math.min(1, t / 0.03) * (1 - smooth(18.3, 19.5, t));
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

const video = path.join(OUT, "planera-radar-9x16.mp4");
const muxed = path.join(OUT, "planera-radar-9x16-sound.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", wavPath, "-map", "0:v", "-map", "1:a",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", muxed], { stdio: "inherit" });
console.log(`wrote ${muxed}`);
