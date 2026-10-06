// Extracts the Planera lockup vectors (mark + "Planera" wordmark) from the
// brand Illustrator source into scripts/planera-lockup-vectors.json, which
// build-splash-lottie.mjs turns into the launch animation.
//
// .ai files saved with PDF compatibility are PDFs: this reads the page's
// content stream and the shadow form XObject, and converts the path
// operators into Lottie-style contours ({ v, i, o, c }) in y-down page units.
//
//   node scripts/extract-lockup-vectors.mjs "<path>/Logo Files/Source AI Files/AI File.ai"

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const src = process.argv[2];
if (!src) {
    console.error("usage: node scripts/extract-lockup-vectors.mjs <AI File.ai>");
    process.exit(1);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), "planera-lockup-vectors.json");

const buf = readFileSync(src);
const text = buf.toString("latin1");

function objectDict(num) {
    const m = new RegExp(`(?:^|\\s)${num} 0 obj\\s*<<`).exec(text);
    if (!m) throw new Error(`object ${num} not found`);
    return m.index + m[0].length;
}
function streamOf(num) {
    const start = objectDict(num);
    const streamAt = text.indexOf("stream", start);
    const dict = text.slice(start, streamAt);
    const len = Number(/\/Length (\d+)/.exec(dict)[1]);
    let dataStart = streamAt + "stream".length;
    if (text[dataStart] === "\r") dataStart++;
    if (text[dataStart] === "\n") dataStart++;
    const raw = buf.subarray(dataStart, dataStart + len);
    return (dict.includes("FlateDecode") ? inflateSync(raw) : raw).toString("latin1");
}

// Page: /Contents of the single page object; the shadow is form /Fm0.
const contentsNum = /\/Contents (\d+) 0 R/.exec(text)[1];
const formNum = /\/Fm0 (\d+) 0 R/.exec(text)[1];
const PAGE_H = Number(/\/MediaBox\s*\[\s*[\d.]+ [\d.]+ [\d.]+ ([\d.]+)/.exec(text)[1]);
const artBox = /\/ArtBox\s*\[([^\]]+)\]/.exec(text)[1].trim().split(/\s+/).map(Number);

// Graphics-state alpha per /GSn name.
const gsAlpha = {};
for (const [, name, num] of text.matchAll(/\/(GS\d+) (\d+) 0 R/g)) {
    const at = objectDict(num);
    const ca = /\/ca ([\d.]+)/.exec(text.slice(at, at + 400));
    gsAlpha[name] = ca ? Number(ca[1]) : 1;
}

const mul = (a, b) => [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], PAGE_H - (m[1] * x + m[3] * y + m[5])];
const round = (n) => Math.round(n * 1000) / 1000;

const shapes = []; // { color: [r,g,b], alpha, rule, contours }

function run(content, ctm0, alpha0) {
    const tokens = content.match(/\/[^\s/\[\]<>()]+|[-+]?\d*\.?\d+|[A-Za-z*'"]+/g) ?? [];
    let stack = [];
    let state = { ctm: ctm0, color: [0, 0, 0], alpha: alpha0 };
    const saved = [];
    let contours = [];
    let cur = null;

    const point = (x, y) => apply(state.ctm, x, y);
    const startContour = (p) => {
        cur = { v: [p], i: [[0, 0]], o: [[0, 0]], c: false };
        contours.push(cur);
    };
    const lineTo = (p) => {
        cur.v.push(p);
        cur.i.push([0, 0]);
        cur.o.push([0, 0]);
    };
    const curveTo = (c1, c2, p) => {
        const prev = cur.v[cur.v.length - 1];
        cur.o[cur.o.length - 1] = [c1[0] - prev[0], c1[1] - prev[1]];
        cur.v.push(p);
        cur.i.push([c2[0] - p[0], c2[1] - p[1]]);
        cur.o.push([0, 0]);
    };
    const close = () => {
        if (!cur) return;
        const n = cur.v.length;
        const [a, b] = [cur.v[0], cur.v[n - 1]];
        if (n > 1 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3) {
            cur.i[0] = cur.i[n - 1];
            cur.v.pop();
            cur.i.pop();
            cur.o.pop();
        }
        cur.c = true;
    };
    const fill = (rule) => {
        contours.forEach(close);
        const clean = contours.map((c) => ({
            c: c.c,
            v: c.v.map((p) => p.map(round)),
            i: c.i.map((p) => p.map(round)),
            o: c.o.map((p) => p.map(round)),
        }));
        shapes.push({ color: state.color, alpha: state.alpha, rule, contours: clean });
        contours = [];
        cur = null;
    };

    for (const tok of tokens) {
        if (/^[-+]?\d*\.?\d+$/.test(tok) || tok.startsWith("/")) {
            stack.push(tok);
            continue;
        }
        const n = stack.map(Number);
        switch (tok) {
            case "q": saved.push({ ...state }); break;
            case "Q": state = saved.pop(); break;
            case "cm": state.ctm = mul(n.slice(-6), state.ctm); break;
            case "rg": state.color = n.slice(-3); break;
            case "gs": state.alpha = alpha0 * (gsAlpha[stack[stack.length - 1].slice(1)] ?? 1); break;
            case "m": startContour(point(n[0], n[1])); break;
            case "l": lineTo(point(n[0], n[1])); break;
            case "c": curveTo(point(n[0], n[1]), point(n[2], n[3]), point(n[4], n[5])); break;
            case "v": curveTo(cur.v[cur.v.length - 1], point(n[0], n[1]), point(n[2], n[3])); break;
            case "y": curveTo(point(n[0], n[1]), point(n[2], n[3]), point(n[2], n[3])); break;
            case "h": close(); break;
            case "re": {
                const [x, y, w, h] = n;
                startContour(point(x, y));
                lineTo(point(x + w, y));
                lineTo(point(x + w, y + h));
                lineTo(point(x, y + h));
                close();
                break;
            }
            case "f": case "F": fill(1); break;
            case "f*": fill(2); break;
            case "n": contours = []; cur = null; break; // clip path, ignored
            case "Do": run(streamOf(formNum), state.ctm, state.alpha); break;
        }
        stack = [];
    }
}

run(streamOf(contentsNum), [1, 0, 0, 1, 0, 0], 1);

// Split into the wordmark (dark letters) and the mark (yellow + shadow).
const isYellow = (s) => s.color[0] > 0.9 && s.color[1] > 0.8 && s.color[2] < 0.2;
const isShadow = (s) => s.alpha < 1;
const letters = shapes.filter((s) => !isYellow(s) && !isShadow(s));
const mark = shapes.filter((s) => isYellow(s) || isShadow(s));

const out = {
    source: "Final/Logo Files/Source AI Files/AI File.ai",
    // Lockup bounds in y-down page units: [x0, y0, x1, y1]
    lockup: [artBox[0], PAGE_H - artBox[3], artBox[2], PAGE_H - artBox[1]].map(round),
    mark,
    letters: letters.sort((a, b) => a.contours[0].v[0][0] - b.contours[0].v[0][0]),
};
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`wrote ${OUT}: ${mark.length} mark shapes, ${letters.length} letters`);
