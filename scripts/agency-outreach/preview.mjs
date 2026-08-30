#!/usr/bin/env node
/**
 * Renders the outreach emails to local HTML so they can be read before a single
 * one is sent.
 *
 *   node scripts/agency-outreach/preview.mjs
 *   node scripts/agency-outreach/preview.mjs --lead 12   # nth lead from leads.json
 *
 * It compiles and calls the SAME `renderOutreachEmail` the sender uses
 * (`convex/agencyOutreachCopy.ts` is a pure module for exactly this reason), so
 * the preview cannot drift from what Postmark actually receives.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "scripts", "agency-outreach", "preview");
const LEADS = path.join(ROOT, "scripts", "agency-outreach", "leads.json");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const built = await esbuild.build({
  entryPoints: [path.join(ROOT, "convex", "agencyOutreachCopy.ts")],
  bundle: false,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
});
const tmp = path.join(os.tmpdir(), `outreach-copy-${Date.now()}.mjs`);
fs.writeFileSync(tmp, built.outputFiles[0].text);
const { renderOutreachEmail } = await import(pathToFileURL(tmp).href);

// A real row beats a made-up one: the personalization is only convincing if it
// survives the messiness of the actual directory export.
let lead = {
  agencyName: "Ταξιδιωτικό Γραφείο ΑΕ",
  city: "Αθήνα",
  services: "Αεροπορικά εισιτήρια, οργανωμένες εκδρομές, κρουαζιέρες",
};
if (fs.existsSync(LEADS)) {
  const all = JSON.parse(fs.readFileSync(LEADS, "utf-8"));
  const picked = all[Number(arg("lead", "1")) - 1];
  if (picked) lead = picked;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const variants = [
  { key: "el-first", lang: "el", stage: 1 },
  { key: "el-followup", lang: "el", stage: 2 },
  { key: "en-first", lang: "en", stage: 1 },
  { key: "en-followup", lang: "en", stage: 2 },
];

const cards = [];
for (const v of variants) {
  const r = renderOutreachEmail({
    agencyName: lead.agencyName,
    city: lead.city ?? undefined,
    services: lead.services ?? undefined,
    lang: v.lang,
    stage: v.stage,
    optOutUrl: "https://example.convex.site/agency-outreach/opt-out?token=preview",
    deckUrl: v.stage === 1 ? "https://planeraai.app/deck.pptx" : undefined,
  });
  fs.writeFileSync(path.join(OUT_DIR, `${v.key}.html`), r.html, "utf-8");
  fs.writeFileSync(path.join(OUT_DIR, `${v.key}.txt`), `Subject: ${r.subject}\n\n${r.text}`, "utf-8");
  cards.push(
    `<section><h2>${v.key}</h2><p class="subj">Subject: ${r.subject}</p>` +
      `<iframe src="./${v.key}.html"></iframe>` +
      `<details><summary>text/plain</summary><pre>${r.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre></details></section>`
  );
}

const index = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<title>Agency outreach preview</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f4f2;margin:0;padding:32px;}
 h1{font-size:20px;margin:0 0 4px;} .lead{color:#666;font-size:13px;margin:0 0 28px;}
 section{background:#fff;border:1px solid #e2e2e0;border-radius:12px;padding:16px;margin:0 0 24px;}
 h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:0 0 6px;}
 .subj{font-size:14px;font-weight:600;margin:0 0 12px;}
 iframe{width:100%;height:520px;border:1px solid #eee;border-radius:8px;background:#fff;}
 pre{white-space:pre-wrap;font-size:12px;color:#444;background:#fafafa;padding:12px;border-radius:8px;}
 summary{cursor:pointer;font-size:13px;color:#666;margin-top:10px;}
</style></head><body>
<h1>Agency outreach preview</h1>
<p class="lead">Rendered for: <strong>${lead.agencyName}</strong>${lead.city ? ` — ${lead.city}` : ""}</p>
${cards.join("\n")}
</body></html>`;

const indexPath = path.join(OUT_DIR, "index.html");
fs.writeFileSync(indexPath, index, "utf-8");
fs.rmSync(tmp, { force: true });

console.log(`[agency-outreach] preview written: ${indexPath}`);
