// Generates the in-app Lottie animations into assets/animations/, each in a
// light and a dark variant (<name>.light.json / <name>.dark.json):
//
//   trip-generating     loop      floating globe, rolling continents, plane orbiting, pins + routes
//   trip-ready          one-shot  boarding pass swings in, plane crosses it, stamp slams + confetti
//   premium-unlocked    one-shot  padlock drops, springs open, falls away; crown bursts up
//   achievement-badge   one-shot  medal swings in on its ribbon, flips, laurels + star + shine
//   radar-scan          loop      sweep with afterglow, blips pop price tags, plane blip, pulses
//   empty-trips         loop      bags hop into a plane's hold, it takes off, a new one lands
//   loader-mark         loop      the Planera mark draws, pops and erases; a comet orbits it
//
// Brand yellow stays fixed; "ink" (outlines, details) is #1D1D1B on light and
// #FAF9F6 on dark backgrounds.
//
//   node scripts/build-ui-animations.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "assets", "animations");
// Exact brand vectors (see extract-lockup-vectors.mjs), used for the tail mark.
const BRAND = JSON.parse(readFileSync(join(HERE, "planera-lockup-vectors.json"), "utf8"));

const FPS = 60;
const YELLOW = [1, 0.898, 0, 1]; // #FFE500
const WHITE = [1, 1, 1, 1];
const INKS = {
    light: [0.114, 0.114, 0.106, 1], // #1D1D1B
    dark: [0.98, 0.976, 0.965, 1], // #FAF9F6
};

// ── Properties & keyframes ──────────────────────────────────────────────────
const val = (k) => ({ a: 0, k });
const isProp = (x) => x !== null && typeof x === "object" && !Array.isArray(x) && "a" in x;
const prop = (x) => (isProp(x) ? x : val(x));

// Cubic-bezier easings, CSS order: [x1, y1, x2, y2].
const EASE = {
    linear: [0, 0, 1, 1],
    inOut: [0.65, 0, 0.35, 1],
    out: [0.22, 1, 0.36, 1],
    in: [0.55, 0, 1, 0.45],
};

// track([t, value, ease?], …) — the last key's ease is unused.
function track(...keys) {
    return {
        a: 1,
        k: keys.map(([t, v, ease = EASE.linear], idx) => {
            const s = Array.isArray(v) ? v : [v];
            if (idx === keys.length - 1) return { t, s };
            const n = s.length;
            const [ox, oy, ix, iy] = ease;
            return { t, s, o: { x: Array(n).fill(ox), y: Array(n).fill(oy) }, i: { x: Array(n).fill(ix), y: Array(n).fill(iy) } };
        }),
    };
}
// Layer scale track from plain percentages: scaleTrack([t, 100, ease], …) or [t, [x, y], ease].
const scaleTrack = (...keys) =>
    track(...keys.map(([t, v, e]) => [t, Array.isArray(v) ? [...v, 100] : [v, v, 100], e]));

// Spatial position track; a key may carry bezier tangents (to: out of this
// point, ti: into the next point, relative to it) for curved motion.
function motion(...keys) {
    return {
        a: 1,
        k: keys.map(([t, [x, y], ease = EASE.linear, to = [0, 0], ti = [0, 0]], idx) => {
            const s = [x, y, 0];
            if (idx === keys.length - 1) return { t, s };
            const [ox, oy, ix, iy] = ease;
            return { t, s, to: [...to, 0], ti: [...ti, 0], o: { x: ox, y: oy }, i: { x: ix, y: iy } };
        }),
    };
}

// ── Geometry helpers ────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const rad = (d) => (d * Math.PI) / 180;
// Point on a circle, angle measured clockwise from 12 o'clock.
const polar = (c, r, a) => [c[0] + r * Math.sin(rad(a)), c[1] - r * Math.cos(rad(a))];

function mulberry32(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Shape items ─────────────────────────────────────────────────────────────
const tr = ({ p = [0, 0], a = [0, 0], s = [100, 100], r = 0, o = 100 } = {}) => ({
    ty: "tr",
    nm: "Transform",
    p: prop(p),
    a: prop(a),
    s: prop(s),
    r: prop(r),
    o: prop(o),
    sk: val(0),
    sa: val(0),
});
// Items render front-to-back: earlier items sit on top (stroke before fill).
const group = (nm, items, transform) => ({ ty: "gr", nm, it: [...items, tr(transform)] });
const ellipse = (c, size) => ({
    ty: "el",
    nm: "Ellipse",
    d: 1,
    p: prop(c),
    s: isProp(size) ? size : val(typeof size === "number" ? [size, size] : size),
});
const rect = (c, size, r = 0) => ({ ty: "rc", nm: "Rect", d: 1, p: prop(c), s: prop(size), r: prop(r) });
const star = (c, outer, inner, points = 5, rot = 0) => ({
    ty: "sr",
    nm: "Star",
    sy: 1,
    d: 1,
    pt: val(points),
    p: prop(c),
    r: prop(rot),
    ir: prop(inner),
    is: val(0),
    or: prop(outer),
    os: val(0),
});
const polygon = (c, radius, points, rot = 0) => ({
    ty: "sr",
    nm: "Polygon",
    sy: 2,
    d: 1,
    pt: val(points),
    p: prop(c),
    r: prop(rot),
    or: prop(radius),
    os: val(0),
});
const pathData = (v, { closed = false, i, o } = {}) => ({
    c: closed,
    v,
    i: i ?? v.map(() => [0, 0]),
    o: o ?? v.map(() => [0, 0]),
});
const path = (v, opts) => ({ ty: "sh", nm: "Path", ks: val(pathData(v, opts)) });
// Path through cubic segments [p0, c1, c2, p3].
function curve(segs, closed = false) {
    const v = [segs[0][0]];
    const i = [[0, 0]];
    const o = [];
    for (const [p0, c1, c2, p3] of segs) {
        o.push(sub(c1, p0));
        v.push(p3);
        i.push(sub(c2, p3));
    }
    o.push([0, 0]);
    if (closed) {
        i[0] = i.pop();
        v.pop();
        o.pop();
    }
    return { ty: "sh", nm: "Curve", ks: val({ c: closed, v, i, o }) };
}
const fill = (c, o = 100) => ({ ty: "fl", nm: "Fill", c: prop(c), o: prop(o), r: 1 });
function stroke(c, w, { o = 100, cap = 2, join = 2, dash } = {}) {
    const st = { ty: "st", nm: "Stroke", c: prop(c), o: prop(o), w: prop(w), lc: cap, lj: join, ml: 4 };
    if (dash) {
        st.d = [
            { n: "d", nm: "dash", v: val(dash[0]) },
            { n: "g", nm: "gap", v: val(dash[1]) },
            { n: "o", nm: "offset", v: val(0) },
        ];
    }
    return st;
}
const trim = (s = 0, e = 100, o = 0) => ({ ty: "tm", nm: "Trim", s: prop(s), e: prop(e), o: prop(o), m: 1 });

// Circular arc (clockwise in screen space, degrees from the +x axis) as cubic segments ≤ 90°.
function arcSegs(c, r, fromDeg, toDeg) {
    const segs = [];
    const n = Math.ceil(Math.abs(toDeg - fromDeg) / 90);
    const step = (toDeg - fromDeg) / n;
    for (let s = 0; s < n; s++) {
        const a0 = rad(fromDeg + s * step);
        const a1 = rad(fromDeg + (s + 1) * step);
        const k = (4 / 3) * Math.tan((a1 - a0) / 4) * r;
        const p0 = [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)];
        const p3 = [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)];
        segs.push([p0, [p0[0] - k * Math.sin(a0), p0[1] + k * Math.cos(a0)], [p3[0] + k * Math.sin(a1), p3[1] - k * Math.cos(a1)], p3]);
    }
    return segs;
}

// ── Layers & composition ────────────────────────────────────────────────────
function layer(nm, shapes, { p = [0, 0], a = [0, 0], s = 100, r = 0, o = 100, parent, ao = 0, mask } = {}) {
    const l = {
        ddd: 0,
        ty: 4,
        nm,
        sr: 1,
        ks: {
            o: prop(o),
            r: prop(r),
            p: isProp(p) ? p : val([...p, 0]),
            a: isProp(a) ? a : val([...a, 0]),
            s: isProp(s) ? s : val([s, s, 100]),
        },
        ao,
        shapes,
        ip: 0,
        st: 0,
        bm: 0,
        parentName: parent,
    };
    if (mask) {
        l.hasMask = true;
        l.masksProperties = [{ inv: false, mode: "a", pt: val(mask), o: val(100), x: val(0), nm: "Mask 1" }];
    }
    return l;
}
function nullLayer(nm, { p, a, s = 100, r = 0, parent } = {}) {
    const l = layer(nm, [], { p, a, s, r, parent });
    l.ty = 3;
    delete l.shapes;
    l.ks.o = val(0);
    return l;
}
// Layers are listed front-to-back.
function comp(nm, { op, w = 400, h = 400, layers }) {
    const ind = new Map();
    layers.forEach((l, idx) => {
        l.ind = idx + 1;
        l.op = op;
        if (!ind.has(l.nm)) ind.set(l.nm, l.ind);
    });
    for (const l of layers) {
        if (l.parentName) {
            l.parent = ind.get(l.parentName);
            if (!l.parent) throw new Error(`${nm}: no parent layer "${l.parentName}"`);
        }
        delete l.parentName;
    }
    return { v: "5.7.4", fr: FPS, ip: 0, op, w, h, nm, ddd: 0, assets: [], layers, markers: [] };
}

// ── Shared motifs ───────────────────────────────────────────────────────────
// Plane silhouette pointing along +x (auto-orient turns it along its path).
const PLANE_PTS = [
    [30, 0], [22, -3.5], [4, -3.5], [-8, -24], [-15, -24], [-7, -3.5], [-20, -3.5], [-26, -12],
    [-31, -12], [-27, 0], [-31, 12], [-26, 12], [-20, 3.5], [-7, 3.5], [-15, 24], [-8, 24], [4, 3.5], [22, 3.5],
];
const plane = (length, body, outline, outlineW = 3) =>
    group("Plane", [path(PLANE_PTS.map((p) => mul(p, length / 61)), { closed: true }), stroke(outline, outlineW), fill(body)]);

// Map pin with its tip at (0,0).
const pin = (ink) =>
    group("Pin", [
        group("Hole", [ellipse([0, -30], 13), fill(ink)]),
        group("Body", [
            path([[0, 0], [-17, -30], [0, -48], [17, -30]], {
                closed: true,
                i: [[7, -9], [0, 10], [-9.4, 0], [0, -9.4]],
                o: [[-7, -9], [0, -9.4], [9.4, 0], [0, 10]],
            }),
            stroke(ink, 4),
            fill(YELLOW),
        ]),
    ]);

const sparkle = (ink, size = 16) => group("Sparkle", [star([0, 0], size, size * 0.28, 4), stroke(ink, 2), fill(YELLOW)]);

// Pop a sparkle in and out at `t0`.
const sparkleLayer = (ink, nm, pos, t0, size) =>
    layer(nm, [sparkle(ink, size)], {
        p: pos,
        s: scaleTrack([t0, 0, EASE.out], [t0 + 10, 120, EASE.inOut], [t0 + 24, 0]),
        r: track([t0, 0], [t0 + 24, 90]),
    });

// ── Shared builders ─────────────────────────────────────────────────────────
// The page background each ink is designed for, and an opaque tint of ink over it.
const BACKGROUND = { light: [0.98, 0.976, 0.965, 1], dark: [0.09, 0.09, 0.09, 1] };
const tint = (ink, pct) => {
    const bg = ink === INKS.light ? BACKGROUND.light : BACKGROUND.dark;
    return bg.map((c, i) => (i === 3 ? 1 : c + (ink[i] - c) * (pct / 100)));
};
// Cubic segments → raw Lottie path data (for masks and shape keyframes).
function segsData(segs, closed = false) {
    const v = [segs[0][0]];
    const i = [[0, 0]];
    const o = [];
    for (const [p0, c1, c2, p3] of segs) {
        o.push(sub(c1, p0));
        v.push(p3);
        i.push(sub(c2, p3));
    }
    o.push([0, 0]);
    if (closed) {
        i[0] = i.pop();
        v.pop();
        o.pop();
    }
    return { c: closed, v, i, o };
}
const circleData = (c, r) => segsData(arcSegs(c, r, 0, 360), true);

// Arc of an ellipse rotated by `rotDeg` (angles in degrees from its +x axis).
function ellipseArc(c, rx, ry, rotDeg, fromDeg, toDeg) {
    const cos = Math.cos(rad(rotDeg));
    const sin = Math.sin(rad(rotDeg));
    const map = ([x, y]) => [c[0] + x * rx * cos - y * ry * sin, c[1] + x * rx * sin + y * ry * cos];
    return arcSegs([0, 0], 1, fromDeg, toDeg).map((seg) => seg.map(map));
}

// Pie slice from the centre, angles clockwise from 12 o'clock.
function wedge(c, r, a0, a1) {
    const p0 = polar(c, r, a0);
    const p3 = polar(c, r, a1);
    const k = (4 / 3) * Math.tan(rad(a1 - a0) / 4) * r;
    const t0 = [Math.cos(rad(a0)), Math.sin(rad(a0))];
    const t1 = [Math.cos(rad(a1)), Math.sin(rad(a1))];
    return path([c, p0, p3], { closed: true, o: [[0, 0], mul(t0, k), [0, 0]], i: [[0, 0], [0, 0], mul(t1, -k)] });
}

// Slowly turning sunburst behind a hero object.
const sunburst = (c, r, t0, until, rays = 12) =>
    layer("Sunburst", [group("Rays", [...Array.from({ length: rays }, (_, k) => wedge(c, r, k * (360 / rays), k * (360 / rays) + 360 / rays / 2)), fill(YELLOW, 20)])], {
        a: c,
        p: c,
        s: scaleTrack([t0, 0, EASE.out], [t0 + 16, 100]),
        r: track([t0, 0], [until, 40]),
    });

const glowRing = (nm, c, t0, size = 200) =>
    layer(nm, [group("Glow", [ellipse(c, size), stroke(YELLOW, 10)])], {
        a: c,
        p: c,
        s: scaleTrack([t0, 40, EASE.out], [t0 + 38, 170]),
        o: track([t0 - 1, 0], [t0, 90], [t0 + 38, 0]),
    });

// Confetti thrown out of `origin` at t0, falling with a little gravity.
function confettiBurst(ink, origin, t0, { count = 16, seed = 7, dist = [110, 190], life = 70 } = {}) {
    const rnd = mulberry32(seed);
    return Array.from({ length: count }, (_, i) => {
        const angle = rnd() * 360;
        const p1 = polar(origin, dist[0] + rnd() * (dist[1] - dist[0]), angle);
        const p2 = add(p1, [Math.sin(rad(angle)) * 18, 60 + rnd() * 40]);
        const piece =
            i % 3 === 0
                ? group("Piece", [ellipse([0, 0], 10), fill(ink)])
                : group("Piece", [rect([0, 0], i % 3 === 1 ? [14, 8] : [8, 14], 2), fill(i % 2 ? YELLOW : ink), ...(i % 2 ? [stroke(ink, 1.5)] : [])]);
        const mid = t0 + Math.round(life * 0.5);
        return layer(`Confetti ${i}`, [piece], {
            p: motion([t0, origin, EASE.out, mul(sub(p1, origin), 0.4), [0, 0]], [mid, p1, EASE.in], [t0 + life, p2]),
            r: track([t0, 0], [t0 + life, (rnd() - 0.5) * 720]),
            o: track([t0 - 1, 0], [t0, 100], [t0 + life - 20, 100], [t0 + life, 0]),
        });
    });
}

// ── 1. Trip generating (loop) ───────────────────────────────────────────────
// A floating globe with continents rolling across it, a plane orbiting it
// (passing behind and in front), pins popping in and routes joining them.
function tripGenerating(ink) {
    const OP = 240;
    const C = [200, 200];
    const R = 108;
    const bobTrack = (amp, base) =>
        track(...[0, 60, 120, 180, 240].map((t, k) => [t, typeof base === "number" ? base + (k % 2 ? amp : 0) : [base[0], base[1] + (k % 2 ? -amp : 0), 0], EASE.inOut]));

    // Continents: a strip of blobs scrolling under a circular mask; two copies
    // a strip-width apart make the scroll seamless.
    const STRIP = 300;
    const CONTINENTS = [
        [[-120, -40, 54, 40], [-100, -20, 40, 52], [-118, 6, 26, 30]],
        [[-40, 30, 64, 38], [-20, 52, 40, 30]],
        [[20, -58, 58, 30], [44, -40, 30, 30]],
        [[70, 6, 70, 56], [96, 34, 40, 40], [58, 36, 26, 22]],
        [[130, -46, 40, 30]],
    ];
    const continentSet = (offset) =>
        CONTINENTS.map((blobs, k) => group(`Continent ${k}`, [...blobs.map(([x, y, w, h]) => ellipse([C[0] + x + offset, C[1] + y], [w, h])), fill(YELLOW)]));
    const land = layer("Land", [group("Strip", [...continentSet(0), ...continentSet(-STRIP)], { p: track([0, [0, 0]], [OP, [STRIP, 0]]) })], {
        parent: "Globe",
        mask: circleData(C, R - 2),
    });

    // Plane orbit: a tilted ellipse; the lower half passes in front of the globe.
    const RX = 158;
    const RY = 40;
    const TILT = -14;
    const orbitAt = (phi) => {
        const [x, y] = [RX * Math.cos(rad(phi)), RY * Math.sin(rad(phi))];
        const cs = Math.cos(rad(TILT));
        const sn = Math.sin(rad(TILT));
        return [C[0] + x * cs - y * sn, C[1] + x * sn + y * cs];
    };
    const orbitDir = (phi) => {
        const [dx, dy] = [-RX * Math.sin(rad(phi)), RY * Math.cos(rad(phi))];
        const cs = Math.cos(rad(TILT));
        const sn = Math.sin(rad(TILT));
        return (Math.atan2(dx * sn + dy * cs, dx * cs - dy * sn) * 180) / Math.PI;
    };
    const samples = [];
    let lastR = null;
    for (let t = 0; t <= OP; t += 4) {
        const phi = (360 * t) / OP;
        let r = orbitDir(phi);
        if (lastR !== null) while (r - lastR > 180) r -= 360;
        if (lastR !== null) while (lastR - r > 180) r += 360;
        lastR = r;
        samples.push({ t, p: orbitAt(phi), r, s: 84 + 16 * Math.sin(rad(phi)) });
    }
    const orbitPlane = (nm, visible) =>
        layer(nm, [plane(40, YELLOW, ink)], {
            parent: "Globe",
            p: track(...samples.map(({ t, p }) => [t, [...p, 0]])),
            r: track(...samples.map(({ t, r }) => [t, r])),
            s: track(...samples.map(({ t, s }) => [t, [s, s, 100]])),
            o: visible === "front" ? track([0, 100], [119, 100], [120, 0], [239, 0], [240, 100]) : track([0, 0], [119, 0], [120, 100], [239, 100], [240, 0]),
        });
    const orbitHalf = (nm, from, to) =>
        layer(nm, [group("Orbit", [curve(ellipseArc(C, RX, RY, TILT, from, to)), stroke(ink, 3, { o: 35, dash: [0.1, 12] })])], { parent: "Globe" });

    // Pins pop onto the globe one by one and dotted routes join them.
    const PINS = [[158, 232], [222, 168], [252, 238]];
    const pinLayer = (pos, i) => {
        const t = 24 + i * 44;
        return layer(`Pin ${i}`, [pin(ink)], {
            parent: "Globe",
            p: pos,
            s: scaleTrack([t, 0, EASE.out], [t + 10, 84, EASE.inOut], [t + 18, 70]),
            o: track([t - 1, 0], [t, 100], [196, 100], [214, 0]),
        });
    };
    const route = (a, b, t, i) => {
        const mid = mul(add(a, b), 0.5);
        const lift = add(mid, [0, -46]);
        return layer(`Route ${i}`, [group("Route", [
            curve([[a, add(a, mul(sub(lift, a), 0.6)), add(b, mul(sub(lift, b), 0.6)), b]]),
            trim(0, track([t, 0, EASE.inOut], [t + 26, 100])),
            stroke(ink, 4, { dash: [0.1, 10] }),
        ])], { parent: "Globe", o: track([0, 100], [196, 100], [214, 0], [OP, 0]) });
    };

    return comp("Trip generating", {
        op: OP,
        layers: [
            ...[[64, 86], [338, 92], [348, 300], [58, 292]].map((pos, i) => sparkleLayer(ink, `Sparkle ${i}`, pos, 20 + i * 52, i % 2 ? 11 : 15)),
            nullLayer("Globe", { a: C, p: bobTrack(7, C) }),
            orbitPlane("Plane (front)", "front"),
            orbitHalf("Orbit (front)", 0, 180),
            ...PINS.map(pinLayer),
            route(PINS[0], PINS[1], 50, 0),
            route(PINS[1], PINS[2], 94, 1),
            layer("Globe rim", [
                group("Highlight", [curve(arcSegs(C, R - 16, 200, 250)), stroke(WHITE, 6, { o: 55 })]),
                group("Rim", [ellipse(C, 2 * R), stroke(ink, 6)]),
            ], { parent: "Globe" }),
            land,
            // Opaque so the plane really disappears behind the globe.
            layer("Ocean", [group("Ocean", [ellipse(C, 2 * R), fill(tint(ink, 8))])], { parent: "Globe" }),
            orbitHalf("Orbit (back)", 180, 360),
            orbitPlane("Plane (back)", "back"),
            layer("Shadow", [group("Shadow", [ellipse([200, 352], [150, 18]), fill(ink, 10)])], {
                a: [200, 352],
                p: [200, 352],
                s: track(...[0, 60, 120, 180, 240].map((t, k) => [t, k % 2 ? [84, 84, 100] : [100, 100, 100], EASE.inOut])),
            }),
        ],
    });
}

// ── 2. Trip ready (one-shot) ────────────────────────────────────────────────
// A boarding pass swings up, a tiny plane flies across it, then a stamp
// slams down — squash, shake, ink ring, check mark and confetti.
function tripReady(ink) {
    const OP = 140;
    const C = [200, 214];
    const SP = [222, 222]; // stamp centre
    const IMPACT = 52;
    const FROM = [96, 176];
    const TO = [262, 176];

    // Barcode bars fit inside the stub (x 294–330).
    const barcode = [2, 3, 2, 4, 2, 3, 2].reduce(
        (acc, w) => {
            acc.items.push(rect([acc.x + w / 2, 214], [w, 96]));
            acc.x += w + 2.6;
            return acc;
        },
        { x: 295, items: [] },
    ).items;

    return comp("Trip ready", {
        op: OP,
        layers: [
            ...confettiBurst(ink, SP, IMPACT, { count: 18, seed: 11, dist: [120, 200], life: 80 }),
            layer("Stamp", [
                group("Check", [path([[-24, 2], [-6, 20], [26, -16]]), trim(0, track([IMPACT + 2, 0, EASE.out], [IMPACT + 14, 100])), stroke(ink, 9)], { p: SP }),
                group("Inner ring", [ellipse(SP, 78), stroke(ink, 2, { o: 50 })]),
                group("Ring", [ellipse(SP, 96), stroke(ink, 7)]),
            ], {
                a: SP,
                p: SP,
                s: scaleTrack([36, 190, EASE.in], [IMPACT, 88, EASE.out], [IMPACT + 6, 106, EASE.inOut], [IMPACT + 12, 100]),
                r: track([36, -40, EASE.in], [IMPACT, -14]),
                o: track([35, 0], [36, 0], [44, 100]),
            }),
            layer("Impact ring", [group("Ring", [ellipse(SP, 100), stroke(ink, 4)])], {
                a: SP,
                p: SP,
                s: scaleTrack([IMPACT, 70, EASE.out], [IMPACT + 26, 210]),
                o: track([IMPACT - 1, 0], [IMPACT, 60], [IMPACT + 26, 0]),
            }),
            nullLayer("Ticket", {
                a: C,
                p: track([0, [200, 440, 0], EASE.out], [16, [200, 202, 0], EASE.inOut], [24, [200, 218, 0], EASE.inOut], [30, [...C, 0]]),
                r: track([0, -16, EASE.out], [18, 4, EASE.inOut], [28, 0], [IMPACT, 0], [IMPACT + 3, -2.5], [IMPACT + 6, 2], [IMPACT + 9, -1], [IMPACT + 12, 0]),
                s: scaleTrack([IMPACT - 1, 100], [IMPACT + 1, [104, 92], EASE.out], [IMPACT + 7, [98, 103], EASE.inOut], [IMPACT + 13, 100]),
            }),
            layer("Ticket plane", [plane(26, ink, ink, 1)], {
                parent: "Ticket",
                p: motion([18, FROM, EASE.inOut], [44, TO]),
                o: track([16, 0], [20, 100]),
            }),
            layer("Ticket face", [
                group("Route", [path([FROM, TO]), stroke(ink, 3, { o: 45, dash: [0.1, 9] })]),
                group("Ends", [ellipse(FROM, 12), ellipse(TO, 12), fill(ink)]),
                group("Text", [rect([130, 214], [90, 10], 5), rect([118, 236], [66, 8], 4), rect([122, 258], [74, 8], 4), fill(ink, 55)]),
                group("Barcode", [...barcode, fill(ink)]),
                group("Perforation", [path([[288, 152], [288, 276]]), stroke(ink, 3, { o: 60, dash: [6, 7], cap: 1 })]),
                group("Ticket", [rect(C, [272, 142], 18), stroke(ink, 6), fill(YELLOW)]),
            ], { parent: "Ticket" }),
        ],
    });
}

// ── 3. Premium unlocked (one-shot) ──────────────────────────────────────────
// A padlock drops in, shakes, braces and springs open, falls away — and a
// crown bursts up out of it in front of a turning sunburst.
function premiumUnlocked(ink) {
    const OP = 160;
    const LOCK = [200, 250];
    const HINGE = [152, 192];
    const CROWN = [200, 214];
    const T_OPEN = 54;
    const T_FALL = 72;
    const T_CROWN = 78;
    const lockFade = track([0, 0], [4, 100], [T_FALL + 4, 100], [T_FALL + 18, 0]);

    return comp("Premium unlocked", {
        op: OP,
        layers: [
            ...[[96, 120], [312, 104], [336, 250], [70, 270], [204, 64], [292, 330]].map((pos, i) =>
                sparkleLayer(ink, `Sparkle ${i}`, pos, T_CROWN + 12 + i * 5, i % 2 ? 12 : 18),
            ),
            nullLayer("Crown rig", {
                a: CROWN,
                p: track([T_CROWN, [200, 290, 0], EASE.out], [T_CROWN + 16, [200, 196, 0], EASE.inOut], [T_CROWN + 24, [200, 222, 0], EASE.inOut], [T_CROWN + 32, [...CROWN, 0]]),
                s: scaleTrack([T_CROWN, 0, EASE.out], [T_CROWN + 14, 116, EASE.inOut], [T_CROWN + 22, 94, EASE.inOut], [T_CROWN + 30, 100]),
                r: track([T_CROWN, -24, EASE.out], [T_CROWN + 18, 5, EASE.inOut], [T_CROWN + 28, 0]),
            }),
            layer("Crown", [
                group("Band jewels", [ellipse([160, 262], 11), ellipse([200, 262], 14), ellipse([240, 262], 11), fill(ink)]),
                group("Band", [rect([200, 262], [154, 28], 7), stroke(ink, 6), fill(YELLOW)]),
                group("Tip jewels", [ellipse([118, 166], 18), ellipse([200, 144], 20), ellipse([282, 166], 18), stroke(ink, 4), fill(YELLOW)]),
                group("Crown", [path([[128, 252], [118, 172], [160, 208], [200, 152], [240, 208], [282, 172], [272, 252]], { closed: true }), stroke(ink, 6), fill(YELLOW)]),
            ], { parent: "Crown rig", o: track([T_CROWN - 1, 0], [T_CROWN, 100]) }),
            glowRing("Glow 1", CROWN, T_CROWN + 8),
            glowRing("Glow 2", CROWN, T_CROWN + 18),
            nullLayer("Lock", {
                a: LOCK,
                p: track([0, [200, 40, 0], EASE.in], [14, [...LOCK, 0]], [T_FALL, [...LOCK, 0], EASE.in], [T_FALL + 18, [200, 350, 0]]),
                s: scaleTrack([14, [118, 82], EASE.out], [20, [94, 106], EASE.inOut], [26, 100], [T_OPEN - 8, 100, EASE.inOut], [T_OPEN - 2, [108, 90], EASE.out], [T_OPEN + 4, [96, 104], EASE.inOut], [T_OPEN + 10, 100]),
                r: track([28, 0], [31, -7], [34, 7], [37, -6], [40, 6], [43, 0], [T_FALL, 0, EASE.in], [T_FALL + 18, 16]),
            }),
            layer("Body", [
                group("Keyhole", [ellipse([200, 240], 26), rect([200, 262], [10, 30], 5), fill(ink)]),
                group("Body", [rect(LOCK, [160, 128], 26), stroke(ink, 8), fill(YELLOW)]),
            ], { parent: "Lock", o: lockFade }),
            layer("Shackle", [group("Shackle", [
                path([HINGE, [152, 140], [248, 140], [248, 192]], { i: [[0, 0], [0, 0], [0, -64], [0, 0]], o: [[0, 0], [0, -64], [0, 0], [0, 0]] }),
                stroke(ink, 18, { cap: 1 }),
            ])], {
                parent: "Lock",
                o: lockFade,
                a: HINGE,
                p: motion([T_OPEN, HINGE, EASE.out], [T_OPEN + 8, [HINGE[0], HINGE[1] - 32]]),
                r: track([T_OPEN + 6, 0, EASE.out], [T_OPEN + 14, -34, EASE.inOut], [T_OPEN + 20, -26]),
            }),
            sunburst(CROWN, 170, T_CROWN + 6, OP),
        ],
    });
}

// ── 4. Achievement badge (one-shot) ─────────────────────────────────────────
// A medal drops in on its ribbon and swings to rest, flips like a coin, then
// laurel leaves pop in, the star punches in, a shine sweeps across.
function achievementBadge(ink) {
    const OP = 170;
    const PIVOT = [200, -20];
    const M = [200, 216];
    const T_SETTLE = 76;
    const T_LEAVES = 80;

    // Laurel: a stem arcs up each side of the medal and leaf pairs pop along it,
    // angled outward from the stem like a real wreath.
    const STEM_R = 100;
    const leaf = (angle, side, k, outward) => {
        const t = T_LEAVES + 6 + k * 3;
        const tangent = angle + (side < 0 ? 90 : -90); // direction the stem grows (bottom → top)
        return group(`Leaf ${side}-${k}-${outward}`, [ellipse([0, -15], [14, 30]), stroke(ink, 3), fill(YELLOW)], {
            p: polar(M, STEM_R + (outward ? 6 : -6), angle),
            r: tangent + (outward ? 1 : -1) * side * -38,
            s: track([t, [0, 0], EASE.out], [t + 8, [120, 120], EASE.inOut], [t + 14, [100, 100]]),
        });
    };
    const LEFT = [200, 222, 244, 266, 288];
    const leaves = [
        group("Stems", [
            curve(arcSegs(M, STEM_R, 90 + 100, 90 + 10).map((seg) => seg).reverse().map(([a, b, c, d]) => [d, c, b, a])),
            curve(arcSegs(M, STEM_R, 90 - 10, 90 - 100).map((seg) => seg).reverse().map(([a, b, c, d]) => [d, c, b, a])),
            trim(0, track([T_LEAVES, 0, EASE.out], [T_LEAVES + 18, 100])),
            stroke(ink, 4),
        ]),
        ...LEFT.flatMap((a, k) => [leaf(a, -1, k, true), leaf(a, -1, k, false), leaf(360 - a, 1, k, true), leaf(360 - a, 1, k, false)]),
    ];

    return comp("Achievement badge", {
        op: OP,
        layers: [
            ...[[86, 110], [316, 96], [340, 262], [62, 270], [130, 360], [278, 362]].map((pos, i) =>
                sparkleLayer(ink, `Sparkle ${i}`, pos, T_SETTLE + 10 + i * 6, i % 2 ? 12 : 17),
            ),
            ...confettiBurst(ink, M, T_SETTLE + 20, { count: 12, seed: 5, dist: [130, 190], life: 64 }),
            nullLayer("Rig", {
                a: PIVOT,
                p: track([0, [200, -300, 0], EASE.in], [16, [...PIVOT, 0]]),
                r: track([16, -24, EASE.inOut], [34, 15, EASE.inOut], [50, -8, EASE.inOut], [64, 4, EASE.inOut], [T_SETTLE, 0]),
            }),
            nullLayer("Medal", {
                parent: "Rig",
                a: M,
                p: M,
                s: scaleTrack([36, 100, EASE.in], [42, [3, 100], EASE.out], [48, 100], [94, 100, EASE.out], [100, 108, EASE.inOut], [108, 100]),
            }),
            layer("Shine", [group("Shine", [rect([0, 0], [30, 320]), fill(WHITE, 70)], {
                p: track([104, [M[0] - 160, M[1]], EASE.inOut], [124, [M[0] + 160, M[1]]]),
                r: 20,
            })], { parent: "Medal", mask: circleData(M, 72) }),
            layer("Star", [group("Star", [star(M, 40, 17, 5), fill(ink)])], {
                parent: "Medal",
                a: M,
                p: M,
                s: scaleTrack([0, 100], [92, 100, EASE.in], [96, 0, EASE.out], [104, 130, EASE.inOut], [112, 100]),
                r: track([96, -72, EASE.out], [112, 0]),
            }),
            layer("Medal", [
                group("Inner", [ellipse(M, 116), stroke(ink, 3, { o: 40 })]),
                group("Disc", [ellipse(M, 150), stroke(ink, 7), fill(YELLOW)]),
                group("Loop", [ellipse([200, 136], 22), stroke(ink, 6)]),
            ], { parent: "Medal" }),
            layer("Laurel", leaves, { parent: "Rig" }),
            layer("Ribbon", [
                group("Right strap", [path([[262, -30], [226, -30], [194, 132], [226, 132]], { closed: true }), stroke(ink, 5), fill(ink)]),
                group("Left strap", [path([[138, -30], [174, -30], [206, 132], [174, 132]], { closed: true }), stroke(ink, 5), fill(YELLOW)]),
            ], { parent: "Rig" }),
            sunburst(M, 170, T_SETTLE, OP),
        ],
    });
}

// ── 5. Radar scan (loop) ────────────────────────────────────────────────────
// Two sweeps per loop with afterglow; blips ping and pop price tags as the
// sweep finds them, a plane blip crosses the scope, pulses ripple out.
function radarScan(ink) {
    const OP = 240;
    const SWEEP = 120; // frames per revolution
    const C = [200, 200];
    const R = 160;

    const blip = ([angle, r, pass], i) => {
        const pos = polar(C, r, angle);
        const t = pass * SWEEP + (angle / 360) * SWEEP;
        const tagAt = add(pos, [30, -26]);
        return [
            layer(`Tag ${i}`, [group("Tag", [
                group("Price", [rect([-6, 0], [18, 5], 2), rect([10, 0], [6, 5], 2), fill(ink)]),
                group("Tag", [rect([0, 0], [48, 24], 12), stroke(ink, 3), fill(YELLOW)]),
            ])], {
                p: tagAt,
                s: scaleTrack([t + 4, 0, EASE.out], [t + 12, 115, EASE.inOut], [t + 18, 100], [t + 40, 100, EASE.in], [t + 48, 0]),
            }),
            layer(`Blip ${i}`, [group("Blip", [ellipse([0, 0], 16), stroke(ink, 3), fill(YELLOW)])], {
                p: pos,
                s: scaleTrack([t - 1, 0], [t + 4, 130, EASE.out], [t + 10, 100]),
                o: track([t, 100], [t + 32, 100], [t + 50, 0]),
            }),
            layer(`Blip ${i} ping`, [group("Ping", [ellipse([0, 0], 16), stroke(YELLOW, 3)])], {
                p: pos,
                s: scaleTrack([t, 50, EASE.out], [t + 36, 300]),
                o: track([t - 1, 0], [t, 80], [t + 36, 0]),
            }),
        ];
    };
    const ticks = Array.from({ length: 36 }, (_, k) => path([polar(C, R + 10, k * 10), polar(C, R + (k % 3 ? 16 : 22), k * 10)]));
    const pulse = track([0, [10, 10, 100], EASE.out], [60, [220, 220, 100]], [119, [220, 220, 100]], [120, [10, 10, 100], EASE.out], [180, [220, 220, 100]], [OP, [220, 220, 100]]);

    return comp("Radar scan", {
        op: OP,
        layers: [
            layer("Center", [group("Center", [ellipse(C, 16), fill(ink)])]),
            ...[[40, 112, 0], [170, 76, 0], [95, 132, 1], [200, 118, 1]].flatMap(blip),
            layer("Plane blip", [plane(22, ink, ink, 1)], {
                p: motion([0, [74, 262]], [OP, [326, 142]]),
                r: (Math.atan2(142 - 262, 326 - 74) * 180) / Math.PI,
                o: track([0, 0], [30, 80], [OP - 30, 80], [OP, 0]),
            }),
            layer("Sweep", [
                group("Edge", [path([C, polar(C, R, 0)]), stroke(ink, 2, { o: 60 }), stroke(YELLOW, 8)]),
                group("Glow 1", [wedge(C, R, -20, 0), fill(YELLOW, 34)]),
                group("Glow 2", [wedge(C, R, -45, -20), fill(YELLOW, 18)]),
                group("Glow 3", [wedge(C, R, -80, -45), fill(YELLOW, 8)]),
            ], { a: C, p: C, r: track([0, 0], [OP, 720]) }),
            layer("Pulse", [group("Pulse", [ellipse(C, 16), stroke(ink, 3)])], {
                a: C,
                p: C,
                s: pulse,
                o: track([0, 50], [60, 0], [119, 0], [120, 50], [180, 0], [OP, 0]),
            }),
            layer("Ticks", [group("Ticks", [...ticks, stroke(ink, 2, { o: 35 })], { a: C, p: C, r: track([0, 0], [OP, -30]) })]),
            layer("Grid", [
                group("Rings", [ellipse(C, 108), ellipse(C, 214), stroke(ink, 3, { o: 22 })]),
                group("Edge", [ellipse(C, 2 * R), stroke(ink, 4, { o: 40 })]),
                group("Cross", [path([[C[0], C[1] - R], [C[0], C[1] + R]]), path([[C[0] - R, C[1]], [C[0] + R, C[1]]]), stroke(ink, 2, { o: 14 })]),
                group("Scope", [ellipse(C, 2 * R), fill(ink, 5)]),
            ]),
        ],
    });
}

// ── 6. Empty trips (loop) ───────────────────────────────────────────────────
// A 6s story: bags drop onto a belt loader and hop into the plane's cargo
// hold (the plane "gulps" each one), the door slides shut and the loader
// drives off, the plane taxis and takes off, a new plane lands, opens its door
// and the loader drives back in — matching frame 0.
function emptyTrips(ink) {
    const OP = 360;
    const INTERIOR = [0.09, 0.09, 0.09, 1];
    const GROUND = 330;
    const PIVOT = [200, GROUND]; // main-gear contact point: the plane rotates here
    const DOOR = [150, 244];
    const DOOR_SIZE = [38, 40];
    const DOOR_LIFT = 32; // open door sits flush under the fuselage top

    // ── Plane motion ──
    const T_CLOSE = [226, 240];
    const T_LOADER_OUT = [240, 264];
    const T_TAXI = 250;
    const T_ROTATE = 284;
    const T_GONE = 308;
    const T_TOUCH = 330;
    const T_STOP = 340;
    const T_LOADER_IN = [336, 358];
    const at = (dx, dy) => [PIVOT[0] + dx, PIVOT[1] + dy, 0];
    const planeP = track(
        [0, at(0, 0)],
        [T_TAXI, at(0, 0), EASE.in],
        [T_ROTATE, at(110, 0), [0.3, 0, 0.8, 0.6]],
        [T_GONE, at(470, -200)],
        [T_GONE + 1, at(-330, -170), [0.2, 0.4, 0.4, 1]],
        [T_TOUCH, at(-46, 0), EASE.out],
        [T_STOP, at(0, 0)],
        [OP, at(0, 0)],
    );
    const planeR = track(
        [0, 0],
        [T_ROTATE - 6, 0, EASE.inOut],
        [T_ROTATE + 8, -11],
        [T_GONE, -16],
        [T_GONE + 1, -7, EASE.out],
        [T_TOUCH, 0],
        [OP, 0],
    );

    // ── Bags ──
    const S = [14, 314];
    const E = [146, 258];
    const d = sub(E, S);
    const len = Math.hypot(...d);
    const up = [d[1] / len, -d[0] / len];
    const BELT_W = 14;
    const ANGLE = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
    const surface = (s) => add(add(S, mul(d, s)), mul(up, BELT_W / 2));
    const DROP = [8, 60, 112]; // when each bag starts falling
    const gulps = DROP.map((t) => t + 106); // when each bag disappears inside
    const SQUASH = [[14, [124, 78]], [18, [90, 112]], [22, [104, 96]], [26, [100, 100]]];

    function bagState(t, t0) {
        const tl = t - t0;
        const land = surface(0.07);
        const from = add(land, [-46, -150]);
        if (tl < 0) return { p: from, r: -30, s: [100, 100], o: 0 };
        if (tl < 14) {
            // Fall (accelerating) with a spin onto the belt.
            const q = tl / 14;
            return {
                p: [from[0] + (land[0] - from[0]) * q, from[1] + (land[1] - from[1]) * q * q],
                r: -30 + (ANGLE + 30) * q,
                s: [92, 108],
                o: Math.min(100, tl * 30),
            };
        }
        if (tl < 26) {
            // Squash and stretch on landing.
            let sc = SQUASH[0][1];
            for (let k = 0; k < SQUASH.length - 1; k++) {
                const [ta, va] = SQUASH[k];
                const [tb, vb] = SQUASH[k + 1];
                if (tl >= ta && tl <= tb) {
                    const q = (tl - ta) / (tb - ta);
                    sc = [va[0] + (vb[0] - va[0]) * q, va[1] + (vb[1] - va[1]) * q];
                }
            }
            return { p: land, r: ANGLE, s: sc, o: 100 };
        }
        if (tl < 94) {
            // Ride up, bumping over the rollers.
            const q = (tl - 26) / 68;
            const bump = Math.abs(Math.sin(tl * 0.45)) * 2.2;
            return { p: add(surface(0.07 + 0.93 * q), mul(up, bump)), r: ANGLE + 3 * Math.sin(tl * 0.35), s: [100, 100], o: 100 };
        }
        if (tl < 108) {
            // Hop through the door into the hold.
            const q = (tl - 94) / 14;
            return { p: add(surface(1 + 0.32 * q), mul(up, 64 * q * (1 - q))), r: ANGLE - 14 * q, s: [100 - 12 * q, 100 - 12 * q], o: 100 };
        }
        return { p: surface(1.32), r: ANGLE, s: [88, 88], o: 0 };
    }
    const bagLayer = (nm, shape, h, t0) => {
        const keys = [];
        for (let t = 0; t <= OP; t += 2) keys.push([t, bagState(t, t0)]);
        return layer(nm, [shape], {
            parent: "Scene",
            a: [0, h / 2], // bottom-centre, so squash keeps the bag on the belt
            p: track(...keys.map(([t, st]) => [t, [...st.p, 0]])),
            r: track(...keys.map(([t, st]) => [t, st.r])),
            s: track(...keys.map(([t, st]) => [t, [...st.s, 100]])),
            o: track(...keys.map(([t, st]) => [t, st.o])),
        });
    };
    const swing = track(...Array.from({ length: 19 }, (_, k) => [k * 20, k % 2 ? -22 : 22, EASE.inOut]));
    const suitcase = group("Suitcase", [
        group("Tag", [path([[0, 0], [0, 9]]), stroke(ink, 2), group("Label", [rect([0, 13], [9, 8], 2), stroke(ink, 2), fill(YELLOW)])], { p: [8, -25], r: swing }),
        group("Handle", [path([[-9, -18], [-9, -26], [9, -26], [9, -18]]), stroke(ink, 4)]),
        group("Stripes", [path([[-12, -13], [-12, 13]]), path([[12, -13], [12, 13]]), stroke(ink, 3, { o: 35, cap: 1 })]),
        group("Body", [rect([0, 0], [46, 36], 7), stroke(ink, 4), fill(YELLOW)]),
    ]);
    const duffel = group("Duffel", [
        group("Band", [rect([0, 0], [8, 28]), fill(YELLOW)]),
        group("Straps", [path([[-15, -12], [-9, -23], [9, -23], [15, -12]]), stroke(ink, 4)]),
        group("Body", [rect([0, 0], [58, 28], 14), fill(ink)]),
    ]);
    const box = group("Box", [
        group("Tape", [path([[-17, 0], [17, 0]]), path([[0, -17], [0, 17]]), stroke(ink, 4, { cap: 1 })]),
        group("Body", [rect([0, 0], [34, 34], 6), stroke(ink, 4), fill(YELLOW)]),
    ]);

    // ── Belt ──
    const beltStripes = stroke(YELLOW, 3, { cap: 1, dash: [8, 16] });
    beltStripes.d[2].v = track([0, 0], [OP, -720]); // crawls uphill at the bags' speed
    const roller = (s, i) =>
        group(`Roller ${i}`, [path([[-4, 0], [4, 0]]), stroke(ink, 2), ellipse([0, 0], 10), stroke(ink, 2), fill(YELLOW)], {
            p: add(S, mul(d, s)),
            r: track([0, 0], [OP, 1440]),
        });

    // ── Plane parts (parented to "Plane", drawn in scene coordinates when parked) ──
    const wheelSpin = track([0, 0], [T_TAXI, 0, EASE.in], [T_GONE, 1440], [T_GONE + 1, 1440, EASE.out], [T_STOP, 2160], [OP, 2160]);
    const wheel = (c, nm) => group(nm, [path([[-8, 0], [8, 0]]), stroke(YELLOW, 3), ellipse([0, 0], 24), fill(ink)], { p: c, r: wheelSpin });

    // Brand mark on the tail fin, from the lockup vectors.
    const markShapes = BRAND.mark.filter((sh) => sh.alpha === 1);
    const markPts = markShapes.flatMap((sh) => sh.contours.flatMap((c) => c.v));
    const mx = markPts.map((p) => p[0]);
    const my = markPts.map((p) => p[1]);
    const markCenter = [(Math.min(...mx) + Math.max(...mx)) / 2, (Math.min(...my) + Math.max(...my)) / 2];
    const mk = 32 / (Math.max(...my) - Math.min(...my));
    const MARK_AT = [110, 166];
    const toTail = ([x, y]) => [MARK_AT[0] + (x - markCenter[0]) * mk, MARK_AT[1] + (y - markCenter[1]) * mk];
    const tailMark = group("Tail mark", [
        ...markShapes.flatMap((sh) =>
            sh.contours.map((c) => ({ ty: "sh", nm: "Mark", ks: val({ c: c.c, v: c.v.map(toTail), i: c.i.map((p) => mul(p, mk)), o: c.o.map((p) => mul(p, mk)) }) })),
        ),
        fill(ink),
    ]);

    const fanSpin = track([0, 0], [240, 720, EASE.in], [T_GONE, 4320], [T_GONE + 1, 4320, EASE.out], [OP, 5040]);
    // The plane squashes a little as it swallows each bag, shuts the door and lands.
    const bounce = (t, amount) => [[t, 100, EASE.out], [t + 5, [100 + amount, 100 - amount * 1.2], EASE.inOut], [t + 11, [98, 102], EASE.inOut], [t + 16, 100]];
    const planeS = scaleTrack([0, 100], ...gulps.flatMap((t) => bounce(t, 4)), ...bounce(T_CLOSE[1], 3), ...bounce(T_TOUCH, 4), [OP, 100]);
    const BEACON = [236, 187];
    const beaconTimes = [20, 80, 140, 200, T_CLOSE[1], 300];

    const speedLine = (y, len, delay) =>
        group(`Speed ${y}`, [
            path([[60, y], [60 - len, y]]),
            trim(track([T_ROTATE - 10 + delay, 0, EASE.out], [T_GONE - 4, 100]), track([T_ROTATE - 20 + delay, 0, EASE.out], [T_ROTATE + delay, 100])),
            stroke(ink, 4, { o: 50 }),
        ]);
    const puff = (i) => {
        const t0 = T_TAXI + 4 + i * 5;
        return layer(`Dust ${i}`, [group("Puff", [ellipse([0, 0], 20), fill(ink, 14)])], {
            parent: "Scene",
            p: motion([t0, [196 - i * 6, GROUND - 6], EASE.out], [t0 + 30, [150 - i * 22, GROUND - 18 - i * 6]]),
            s: scaleTrack([t0, 30, EASE.out], [t0 + 30, 190]),
            o: track([t0 - 1, 0], [t0, 100], [t0 + 30, 0]),
        });
    };
    const cloud = (nm, pos, drift, s) =>
        layer(nm, [group("Cloud", [ellipse([0, 0], 44), ellipse([-26, 8], 30), ellipse([26, 8], 30), rect([0, 14], [80, 18], 9), fill(ink, 10)])], {
            p: motion([0, pos], [OP, add(pos, [drift, 0])]),
            s,
            o: track([0, 0], [40, 100], [OP - 40, 100], [OP, 0]),
        });
    const birdWings = (down) =>
        pathData([[-9, down ? 4 : -5], [0, 1], [9, down ? 4 : -5]], { i: [[0, 0], [-4, -3], [0, 0]], o: [[0, 0], [4, -3], [0, 0]] });
    const bird = layer(
        "Bird",
        [group("Bird", [{ ty: "sh", nm: "Wings", ks: track(...Array.from({ length: 46 }, (_, k) => [k * 8, birdWings(k % 2), EASE.inOut])) }, stroke(ink, 2.5)])],
        { p: motion([0, [430, 96]], [OP, [-30, 64]]) },
    );

    return comp("Empty trips", {
        op: OP,
        layers: [
            bird,
            nullLayer("Scene", { a: [200, 250], p: [200, 246], s: 86 }),
            nullLayer("Plane", { a: PIVOT, p: planeP, r: planeR, s: planeS, parent: "Scene" }),
            nullLayer("Loader rig", {
                parent: "Scene",
                p: track(
                    [0, [0, 0, 0]],
                    [T_LOADER_OUT[0], [0, 0, 0], EASE.in],
                    [T_LOADER_OUT[1], [-260, 0, 0]],
                    [T_LOADER_IN[0], [-260, 0, 0], EASE.out],
                    [T_LOADER_IN[1], [0, 0, 0]],
                    [OP, [0, 0, 0]],
                ),
            }),
            layer("Speed lines", [speedLine(206, 70, 0), speedLine(230, 100, 4), speedLine(254, 60, 8)], { parent: "Plane" }),
            puff(0),
            puff(1),
            puff(2),
            layer("Beacon glow", [group("Glow", [ellipse(BEACON, 12), stroke(YELLOW, 3)])], {
                parent: "Plane",
                a: BEACON,
                p: BEACON,
                s: scaleTrack(...beaconTimes.flatMap((t) => [[t, 60, EASE.out], [t + 16, 260]])),
                o: track(...beaconTimes.flatMap((t) => [[t, 0], [t + 1, 90], [t + 16, 0]])),
            }),
            layer("Door", [group("Door", [rect(DOOR, DOOR_SIZE, 6), stroke(ink, 4), fill(YELLOW)], {
                p: track([0, [0, -DOOR_LIFT]], [T_CLOSE[0], [0, -DOOR_LIFT], EASE.inOut], [T_CLOSE[1], [0, 0]], [T_STOP, [0, 0], EASE.inOut], [T_STOP + 12, [0, -DOOR_LIFT]], [OP, [0, -DOOR_LIFT]]),
            })], { parent: "Plane" }),
            layer("Engine", [
                group("Spinner", [path([[-6, 0], [6, 0]]), stroke(ink, 2.5), ellipse([0, 0], 14), stroke(ink, 2.5), fill(YELLOW)], { p: [282, 282], r: fanSpin }),
                group("Pod", [rect([254, 282], [58, 24], 12), stroke(ink, 4), fill(YELLOW)]),
                group("Pylon", [path([[244, 262], [250, 272]]), stroke(ink, 5)]),
            ], { parent: "Plane" }),
            layer("Wing", [group("Wing", [path([[262, 258], [212, 258], [176, 298], [198, 298]], { closed: true }), stroke(ink, 4), fill(YELLOW)])], { parent: "Plane" }),
            layer("Fuselage", [
                group("Beacon", [ellipse(BEACON, 9), stroke(ink, 2), fill(YELLOW)]),
                tailMark,
                group("Windows", [...[192, 214, 236, 258, 280, 302].map((x) => ellipse([x, 216], [10, 13])), rect([358, 212], [24, 12], 5), fill(ink)]),
                group("Cheatline", [path([[172, 238], [372, 238]]), stroke(ink, 2, { o: 25 })]),
                group("Door frame", [rect(DOOR, DOOR_SIZE, 6), stroke(ink, 4)]),
                // Even-odd fill turns the door rectangle into a hole.
                group("Body", [rect([230, 230], [300, 78], 39), rect(DOOR, DOOR_SIZE, 6), stroke(ink, 5), { ...fill(YELLOW), r: 2 }]),
                group("Stabilizer", [path([[96, 220], [50, 208], [58, 222], [108, 230]], { closed: true }), stroke(ink, 4), fill(YELLOW)]),
                group("Fin", [path([[100, 198], [74, 126], [106, 126], [152, 198]], { closed: true }), stroke(ink, 5), fill(YELLOW)]),
            ], { parent: "Plane" }),
            bagLayer("Bag 1", suitcase, 36, DROP[0]),
            bagLayer("Bag 2", duffel, 28, DROP[1]),
            bagLayer("Bag 3", box, 34, DROP[2]),
            layer("Belt", [
                ...[0.18, 0.4, 0.62, 0.84].map(roller),
                group("Stripes", [path([S, E]), beltStripes]),
                group("Belt", [path([S, E]), stroke(ink, BELT_W, { cap: 2 })]),
            ], { parent: "Loader rig" }),
            layer("Interior", [group("Interior", [rect(DOOR, DOOR_SIZE, 6), fill(INTERIOR)])], { parent: "Plane" }),
            layer("Gear", [
                wheel([200, 318], "Main wheel"),
                wheel([340, 318], "Nose wheel"),
                group("Struts", [path([[200, 266], [200, 314]]), path([[340, 264], [340, 314]]), stroke(ink, 6)]),
            ], { parent: "Plane" }),
            layer("Loader", [
                group("Struts", [path([add(S, mul(d, 0.5)), [64, 312]]), path([add(S, mul(d, 0.2)), [30, 312]]), stroke(ink, 5)]),
                group("Wheels", [ellipse([26, 324], 12), ellipse([78, 324], 12), fill(ink)]),
                group("Base", [rect([52, 314], [92, 14], 6), stroke(ink, 4), fill(YELLOW)]),
            ], { parent: "Loader rig" }),
            layer("Ground", [
                group("Markings", [path([[-80, 348], [480, 348]]), stroke(ink, 3, { o: 14, cap: 1, dash: [26, 22] })]),
                group("Ground", [path([[-80, GROUND], [480, GROUND]]), stroke(ink, 3, { o: 25 })]),
            ], { parent: "Scene" }),
            cloud("Cloud 1", [80, 82], -60, 100),
            cloud("Cloud 2", [310, 62], -40, 70),
            cloud("Cloud 3", [220, 128], -26, 50),
        ],
    });
}

// ── 7. Loader mark (loop) ───────────────────────────────────────────────────
// Stroke centerlines of the mark, traced in the 2000px icon space (same trace
// as scripts/build-splash-lottie.mjs).
const P_SEGS = [
    [[791, 1460], [900, 1280], [1010, 1020], [1000, 860]],
    [[1000, 860], [995, 760], [930, 698], [845, 698]],
    [[845, 698], [757, 698], [686, 770], [686, 855]],
    [[686, 855], [686, 950], [760, 1010], [856, 1050]],
];
// The mark draws itself, pops, erases — while a little comet orbits it.
function loaderMark(ink) {
    const OP = 120;
    const C = [100, 100];
    const k = 120 / 1051; // mark height → 120px of a 200px canvas
    const M = ([x, y]) => [C[0] + (x - 965) * k, C[1] + (y - 965.5) * k];
    const pSegs = P_SEGS.map((seg) => seg.map(M));
    const arc = arcSegs(M([959, 787]), 285.5 * k, -90, 84);
    const W = 123 * k;
    const drawErase = (t0) => trim(track([t0 + 62, 0, EASE.inOut], [t0 + 100, 100]), track([t0, 0, EASE.inOut], [t0 + 38, 100]));
    const ORBIT_R = 88;
    const TRAIL = 24; // % of the orbit

    return comp("Loader mark", {
        op: OP,
        w: 200,
        h: 200,
        layers: [
            layer("Comet", [group("Comet", [ellipse([C[0], C[1] - ORBIT_R], 12), stroke(ink, 2), fill(YELLOW)], { a: C, p: C, r: track([0, 0], [OP, 360]) })]),
            layer("Trail", [group("Trail", [ellipse(C, 2 * ORBIT_R), trim(0, TRAIL, track([0, -3.6 * TRAIL], [OP, 360 - 3.6 * TRAIL])), stroke(ink, 3, { o: 30 })])]),
            nullLayer("Mark", { a: C, p: C, s: scaleTrack([0, 100], [44, 100, EASE.out], [50, 110, EASE.inOut], [58, 100]) }),
            layer("P", [group("P", [curve(pSegs), drawErase(0), stroke(YELLOW, W, { cap: 1 })])], { parent: "Mark" }),
            layer("Arc", [group("Arc", [curve(arc), drawErase(8), stroke(YELLOW, W, { cap: 1 })])], { parent: "Mark" }),
        ],
    });
}

// ── Write ───────────────────────────────────────────────────────────────────
const ANIMATIONS = {
    "trip-generating": tripGenerating,
    "trip-ready": tripReady,
    "premium-unlocked": premiumUnlocked,
    "achievement-badge": achievementBadge,
    "radar-scan": radarScan,
    "empty-trips": emptyTrips,
    "loader-mark": loaderMark,
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of Object.entries(ANIMATIONS)) {
    for (const [theme, ink] of Object.entries(INKS)) {
        const data = build(ink);
        writeFileSync(join(OUT_DIR, `${name}.${theme}.json`), JSON.stringify(data));
    }
    const { op } = build(INKS.light);
    console.log(`${name.padEnd(18)} ${(op / FPS).toFixed(2)}s`);
}
console.log(`wrote ${Object.keys(ANIMATIONS).length * 2} files to ${OUT_DIR}`);
