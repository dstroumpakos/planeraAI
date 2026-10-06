// Generates assets/animations/splash.json — the "flight path" launch animation.
//
// A plane flies in from the bottom-left and traces the whole Planera logo:
// it draws the tail of the "p", goes round its loop, carries straight on into
// the outer arc (drawn from its bottom end, under the tail, up to the top),
// then flies off. The drawn strokes crossfade into the exact brand artwork, which glides
// left into the horizontal lockup while the "Planera" letters slide in.
//
// The draw-on strokes are traced centerlines of the mark from
// assets/images/appicon-1024x1024-01-9h6cls.jpg (measured in a 2000px space,
// then mapped into the 1000x1000 composition by `m()`). The final mark and
// wordmark are the exact brand vectors in scripts/planera-lockup-vectors.json
// (see extract-lockup-vectors.mjs).
//
//   node scripts/build-splash-lottie.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "assets", "animations", "splash.json");
const VECTORS = JSON.parse(readFileSync(join(HERE, "planera-lockup-vectors.json"), "utf8"));

const FPS = 60;
const YELLOW = [1, 0.898, 0, 1]; // #FFE500, from the brand file
const SHADOW = [0.71, 0.643, 0, 1]; // overlap shade where the tail crosses the arc
const CREAM = [0.98, 0.976, 0.965, 1]; // #FAF9F6
const WHITE = [1, 1, 1, 1];
const STROKE_W = 61.5;

// 2000px trace space → 1000px composition, re-centred on the logo's bbox.
const m = ([x, y]) => [(x + 35) / 2, (y + 35) / 2];
const deg = (d) => (d * Math.PI) / 180;

// ── Geometry (2000px trace space) ───────────────────────────────────────────
// Each segment: [start, ctrl1, ctrl2, end]
const ENTRY = [[60, 1900], [330, 1880], [660, 1676], [791, 1460]];
const P_SEGS = [
    [[791, 1460], [900, 1280], [1010, 1020], [1000, 860]], // tail, bottom → top
    [[1000, 860], [995, 760], [930, 698], [845, 698]], // loop: right → top
    [[845, 698], [757, 698], [686, 770], [686, 855]], // loop: top → left
    [[686, 855], [686, 950], [760, 1010], [856, 1050]], // loop: left → inner end
];
const ARC_C = [959, 787];
const ARC_R = 285.5;
const ARC_FROM = -90;
const ARC_TO = 84; // bottom end, tucked under the tail — the plane starts the arc here
const SHADOW_FROM = 66;

// ── Bezier helpers ──────────────────────────────────────────────────────────
function pointAt([p0, c1, c2, p3], t) {
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p3[k]);
}
function segLength(seg) {
    let len = 0;
    let prev = pointAt(seg, 0);
    for (let i = 1; i <= 400; i++) {
        const p = pointAt(seg, i / 400);
        len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        prev = p;
    }
    return len;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const mapSeg = (seg) => seg.map(m);
const pathLength = (segs) => segs.reduce((sum, s) => sum + segLength(s), 0);

// Circular arc (clockwise in screen space) as cubic segments of ≤ 90°.
function arcSegs(c, r, fromDeg, toDeg) {
    const segs = [];
    const n = Math.ceil((toDeg - fromDeg) / 90);
    const step = (toDeg - fromDeg) / n;
    for (let s = 0; s < n; s++) {
        const a0 = deg(fromDeg + s * step);
        const a1 = deg(fromDeg + (s + 1) * step);
        const k = (4 / 3) * Math.tan((a1 - a0) / 4) * r;
        const p0 = [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)];
        const p3 = [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)];
        segs.push([
            p0,
            [p0[0] - k * Math.sin(a0), p0[1] + k * Math.cos(a0)],
            [p3[0] + k * Math.sin(a1), p3[1] - k * Math.cos(a1)],
            p3,
        ]);
    }
    return segs;
}

// Chain of cubic segments → Lottie path data (in/out tangents are relative).
function pathFromSegs(segs) {
    const v = [segs[0][0]];
    const i = [[0, 0]];
    const o = [];
    for (const [p0, c1, c2, p3] of segs) {
        o.push(sub(c1, p0));
        v.push(p3);
        i.push(sub(c2, p3));
    }
    o.push([0, 0]);
    return { a: 0, k: { c: false, v, i, o } };
}

// ── Composition-space paths ─────────────────────────────────────────────────
const entry = [mapSeg(ENTRY)];
const pSegs = P_SEGS.map(mapSeg);
// The arc is drawn counter-clockwise, bottom → top, so the plane can carry
// straight on from the end of the p's loop.
const reverseSegs = (segs) => segs.map(([p0, c1, c2, p3]) => [p3, c2, c1, p0]).reverse();
const arc = reverseSegs(arcSegs(m(ARC_C), ARC_R / 2, ARC_FROM, ARC_TO));
const unit = (v) => scale(v, 1 / Math.hypot(v[0], v[1]));
const tangentOut = ([, , c2, p3]) => unit(sub(p3, c2));
const tangentIn = ([p0, c1]) => unit(sub(c1, p0));

// Short hop from the end of the p's loop onto the arc's bottom end.
const loopEnd = pSegs[pSegs.length - 1];
const arcStart = arc[0];
const connect = [[
    loopEnd[3],
    add(loopEnd[3], scale(tangentOut(loopEnd), 25)),
    sub(arcStart[0], scale(tangentIn(arcStart), 25)),
    arcStart[0],
]];
const arcShadow = arcSegs(m(ARC_C), ARC_R / 2, SHADOW_FROM, ARC_TO);

// After the arc the plane carries on along its tangent and leaves bottom-left.
// After the arc's top end the plane carries on left and climbs away.
const arcEnd = arc[arc.length - 1][3];
const exit = [[arcEnd, add(arcEnd, scale(tangentOut(arc[arc.length - 1]), 110)), [230, 150], [90, 60]]];

// ── Timing ──────────────────────────────────────────────────────────────────
// The plane flies entry → p → arc at ONE constant speed, so each
// stroke's trim head stays glued to its nose (trim paths and spatial position
// both interpolate by arc length).
const T_START = 4;
const SPEED = 21; // composition px per frame
const legs = [entry, pSegs, connect, arc];
const legLens = legs.map(pathLength);
const T_ARC_DONE = Math.round(T_START + legLens.reduce((a, b) => a + b, 0) / SPEED);
const speed = legLens.reduce((a, b) => a + b, 0) / (T_ARC_DONE - T_START);

const legTimes = [];
let t = T_START;
for (const len of legLens) {
    legTimes.push([t, t + len / speed]);
    t += len / speed;
}
const [[T_ENTRY_0, T_ENTRY_1], [T_P_0, T_P_1], , [T_ARC_0]] = legTimes;
const T_EXIT_DONE = T_ARC_DONE + 22;
// Strokes → exact artwork, then the glide into the lockup and the wordmark.
const T_FILL_IN = [T_ARC_DONE - 2, T_ARC_DONE + 6];
const T_STROKES_OUT = [T_ARC_DONE + 6, T_ARC_DONE + 10];
const T_GLIDE = [T_ARC_DONE + 6, T_ARC_DONE + 40];
const T_LETTERS_0 = T_ARC_DONE + 22;
const LETTER_STAGGER = 4;
const LETTER_FRAMES = 18;
const OP = T_LETTERS_0 + 6 * LETTER_STAGGER + LETTER_FRAMES + 18; // hold the lockup briefly

// ── Keyframe helpers ────────────────────────────────────────────────────────
const LINEAR = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
const kf = (t, s, ease = LINEAR) => ({ t, s: Array.isArray(s) ? s : [s], ...ease });
const last = (t, s) => ({ t, s: Array.isArray(s) ? s : [s] });
const anim = (...k) => ({ a: 1, k });
const val = (k) => ({ a: 0, k });
const ease3 = (ox, oy, ix, iy) => ({ o: { x: [ox, ox, ox], y: [oy, oy, oy] }, i: { x: [ix, ix, ix], y: [iy, iy, iy] } });

// Linear trim 0 → 100% over [t0, t1].
const drawOn = (t0, t1) => anim(kf(t0, 0), last(t1, 100));

const groupTransform = () => ({
    ty: "tr",
    p: val([0, 0]),
    a: val([0, 0]),
    s: val([100, 100]),
    r: val(0),
    o: val(100),
    sk: val(0),
    sa: val(0),
    nm: "Transform",
});

function strokeGroup(nm, path, { color = YELLOW, width = STROKE_W, trimEnd, cap = 1, dash, opacity = val(100) }) {
    const it = [{ ty: "sh", nm: "Path", ks: path }];
    if (trimEnd) it.push({ ty: "tm", nm: "Trim", s: val(0), e: trimEnd, o: val(0), m: 1 });
    const st = { ty: "st", nm: "Stroke", c: val(color), o: opacity, w: val(width), lc: cap, lj: 2, ml: 4 };
    if (dash) st.d = [
        { n: "d", nm: "dash", v: val(dash[0]) },
        { n: "g", nm: "gap", v: val(dash[1]) },
        { n: "o", nm: "offset", v: val(0) },
    ];
    it.push(st, groupTransform());
    return { ty: "gr", nm, it };
}

function layer(ind, nm, shapes, extra = {}) {
    return {
        ddd: 0,
        ind,
        ty: 4,
        nm,
        sr: 1,
        ks: {
            o: val(100),
            r: val(0),
            p: val([0, 0, 0]),
            a: val([0, 0, 0]),
            s: val([100, 100, 100]),
        },
        ao: 0,
        shapes,
        ip: 0,
        op: OP,
        st: 0,
        bm: 0,
        ...extra,
    };
}

const dottedTrail = (ind, nm, segs, t0, t1, fadeFrom) =>
    layer(ind, nm, [
        strokeGroup(nm, pathFromSegs(segs), {
            width: 10,
            cap: 2,
            dash: [0.1, 22],
            trimEnd: drawOn(t0, t1),
            opacity: anim(kf(0, 90), kf(fadeFrom, 90), last(fadeFrom + 20, 0)),
        }),
    ]);

// ── Lockup geometry ─────────────────────────────────────────────────────────
function bbox(shapes) {
    const pts = shapes.flatMap((sh) => sh.contours.flatMap((c) => c.v));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
// The exact mark, placed over the traced strokes (both centred on 500,500).
const [mx0, my0, mx1, my1] = bbox(VECTORS.mark);
const MARK_CENTER = [(mx0 + mx1) / 2, (my0 + my1) / 2];
const DRAWN_MARK_H = m([0, 1491])[1] - m([0, 440])[1];
const kMark = DRAWN_MARK_H / (my1 - my0);
const toMarkSpace = ([x, y]) => [500 + (x - MARK_CENTER[0]) * kMark, 500 + (y - MARK_CENTER[1]) * kMark];

// The finished lockup spans 86% of the composition width, centred.
const [lx0, ly0, lx1, ly1] = VECTORS.lockup;
const LOCKUP_W = 860;
const kLockup = LOCKUP_W / (lx1 - lx0);
const toLockup = ([x, y]) => [(1000 - LOCKUP_W) / 2 + (x - lx0) * kLockup, 500 + (y - (ly0 + ly1) / 2) * kLockup];
const MARK_END = toLockup(MARK_CENTER);
const MARK_END_SCALE = (100 * kLockup) / kMark;

// Brand shapes → filled Lottie groups. Illustrator paints later shapes on top;
// Lottie paints earlier group items on top, hence the reverse().
const fillGroups = (shapes, map, k, color) =>
    shapes
        .map((sh, si) => ({
            ty: "gr",
            nm: `Shape ${si}`,
            it: [
                ...sh.contours.map((c, ci) => ({
                    ty: "sh",
                    nm: `Contour ${ci}`,
                    ks: { a: 0, k: { c: c.c, v: c.v.map(map), i: c.i.map((p) => scale(p, k)), o: c.o.map((p) => scale(p, k)) } },
                })),
                { ty: "fl", nm: "Fill", c: val(color ?? [...sh.color, 1]), o: val(Math.round(sh.alpha * 100)), r: sh.rule },
                groupTransform(),
            ],
        }))
        .reverse();

const GLIDE_EASE = { o: { x: 0.65, y: 0 }, i: { x: 0.35, y: 1 } };

// ── Layers ──────────────────────────────────────────────────────────────────
const NULL_IND = 1;

// Parent for everything that makes up the mark: glides it from the centre
// into its place in the lockup.
const logoNull = {
    ddd: 0,
    ind: NULL_IND,
    ty: 3,
    nm: "Logo",
    sr: 1,
    ks: {
        o: val(0),
        r: val(0),
        p: anim(
            { t: T_GLIDE[0], s: [500, 500, 0], to: [0, 0, 0], ti: [0, 0, 0], ...GLIDE_EASE },
            { t: T_GLIDE[1], s: [...MARK_END, 0] },
        ),
        a: val([500, 500, 0]),
        s: anim(
            kf(T_GLIDE[0], [100, 100, 100], ease3(0.65, 0, 0.35, 1)),
            last(T_GLIDE[1], [MARK_END_SCALE, MARK_END_SCALE, 100]),
        ),
    },
    ao: 0,
    ip: 0,
    op: OP,
    st: 0,
    bm: 0,
};

// Plane silhouette pointing along +x (auto-orient turns it along the path).
const PLANE_PTS = [
    [30, 0], [22, -3.5], [4, -3.5], [-8, -24], [-15, -24], [-7, -3.5], [-20, -3.5], [-26, -12],
    [-31, -12], [-27, 0], [-31, 12], [-26, 12], [-20, 3.5], [-7, 3.5], [-15, 24], [-8, 24], [4, 3.5], [22, 3.5],
].map(([x, y]) => [x * 1.8, y * 1.8]);

// One spatial position keyframe per segment node, timed by cumulative length.
const POS_LINEAR = { o: { x: 0, y: 0 }, i: { x: 1, y: 1 } };
const posKeys = [];
legs.forEach((segs, li) => {
    let tSeg = legTimes[li][0];
    for (const seg of segs) {
        const [p0, c1, c2, p3] = seg;
        posKeys.push({ t: tSeg, s: [...p0, 0], to: [...sub(c1, p0), 0], ti: [...sub(c2, p3), 0], ...POS_LINEAR });
        tSeg += segLength(seg) / speed;
    }
});
{
    const [p0, c1, c2, p3] = exit[0];
    posKeys.push({ t: T_ARC_DONE, s: [...p0, 0], to: [...sub(c1, p0), 0], ti: [...sub(c2, p3), 0], o: { x: 0.3, y: 0.3 }, i: { x: 0.7, y: 1 } });
    posKeys.push({ t: T_EXIT_DONE, s: [...p3, 0] });
}

const plane = layer(
    10,
    "Plane",
    [
        {
            ty: "gr",
            nm: "Plane",
            it: [
                {
                    ty: "sh",
                    nm: "Body",
                    ks: { a: 0, k: { c: true, v: PLANE_PTS, i: PLANE_PTS.map(() => [0, 0]), o: PLANE_PTS.map(() => [0, 0]) } },
                },
                { ty: "fl", nm: "Fill", c: val(CREAM), o: val(100), r: 1 },
                groupTransform(),
            ],
        },
    ],
    { ao: 1 },
);
plane.ks.p = anim(...posKeys);
plane.ks.o = anim(kf(T_START, 0), kf(T_START + 8, 100), kf(T_ARC_DONE + 6, 100), last(T_EXIT_DONE, 0));
plane.ks.s = anim(kf(T_ARC_DONE, [100, 100, 100], ease3(0.4, 0, 1, 1)), last(T_EXIT_DONE, [50, 50, 100]));

const entryTrail = dottedTrail(20, "Entry trail", entry, T_ENTRY_0, T_ENTRY_1, T_ENTRY_1 + 10);

const pLetter = layer(30, "P", [strokeGroup("P stroke", pathFromSegs(pSegs), { trimEnd: drawOn(T_P_0, T_P_1) })], {
    parent: NULL_IND,
});

const shadow = layer(35, "Arc shadow", [strokeGroup("Shadow", pathFromSegs(arcShadow), { color: SHADOW })], {
    parent: NULL_IND,
});
shadow.ks.o = anim(kf(T_ARC_DONE - 4, 0), kf(T_STROKES_OUT[0], 100), last(T_STROKES_OUT[1], 0));

const arcLayer = layer(40, "Arc", [strokeGroup("Arc stroke", pathFromSegs(arc), { trimEnd: drawOn(T_ARC_0, T_ARC_DONE) })], {
    parent: NULL_IND,
});
const strokesOut = () => anim(kf(T_STROKES_OUT[0], 100), last(T_STROKES_OUT[1], 0));
pLetter.ks.o = strokesOut();
arcLayer.ks.o = strokesOut();

// The exact brand mark fades in over the drawn strokes, which then drop away.
const brandMark = layer(25, "Mark (brand)", fillGroups(VECTORS.mark, toMarkSpace, kMark), { parent: NULL_IND });
brandMark.ks.o = anim(kf(T_FILL_IN[0], 0), last(T_FILL_IN[1], 100));

// "Planera", letter by letter, sliding out from behind the mark.
const LETTER_EASE = { o: { x: 0.2, y: 0 }, i: { x: 0.2, y: 1 } };
const letters = VECTORS.letters.map((sh, i) => {
    const t0 = T_LETTERS_0 + i * LETTER_STAGGER;
    const t1 = t0 + LETTER_FRAMES;
    const l = layer(50 + i, `Letter ${i + 1}`, fillGroups([sh], toLockup, kLockup, WHITE));
    l.ks.o = anim(kf(t0, 0, { o: { x: [0.3], y: [0] }, i: { x: [0.6], y: [1] } }), last(t1 - 6, 100));
    l.ks.p = anim({ t: t0, s: [-38, 0, 0], to: [0, 0, 0], ti: [0, 0, 0], ...LETTER_EASE }, { t: t1, s: [0, 0, 0] });
    return l;
});

// Layers draw top → bottom: plane over everything, p over the arc (the tail crosses it).
const lottie = {
    v: "5.7.4",
    fr: FPS,
    ip: 0,
    op: OP,
    w: 1000,
    h: 1000,
    nm: "Planera splash — flight path",
    ddd: 0,
    assets: [],
    layers: [plane, entryTrail, brandMark, pLetter, shadow, arcLayer, ...letters, logoNull],
    markers: [],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(lottie));
const f = (n) => `f${n.toFixed(0)}`;
console.log(`wrote ${OUT}`);
console.log(
    `entry ${f(T_ENTRY_0)}–${f(T_ENTRY_1)}, p ${f(T_P_0)}–${f(T_P_1)}, ` +
        `arc ${f(T_ARC_0)}–${f(T_ARC_DONE)}, glide ${f(T_GLIDE[0])}–${f(T_GLIDE[1])}, end ${f(OP)} (${(OP / FPS).toFixed(2)}s)`,
);
