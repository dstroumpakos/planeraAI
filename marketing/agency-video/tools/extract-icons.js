// Pulls the exact lucide icon geometry the agency portal uses (from the website's
// own node_modules) into assets/icons.js, so the film's icons match the product.
const fs = require("fs");
const path = require("path");
const DIR = "C:/Users/nioni/planeraai-web/node_modules/lucide-react/dist/esm/icons";
const NAMES = [
  "plane", "bed-double", "ticket", "bus", "mail", "sparkles", "search", "layout-dashboard", "file-text", "cable",
  "settings", "users", "calendar-days", "sliders-horizontal", "arrow-left-right", "arrow-right", "send", "eye", "eye-off",
  "file-down", "refresh-cw", "clock", "check", "link-2", "pencil", "log-out", "utensils", "copy", "loader-2",
  "chevron-down", "user-round", "map-pin", "x", "info", "phone", "inbox", "paperclip", "reply",
];
const out = {};
for (const n of NAMES) {
  let src = fs.readFileSync(path.join(DIR, `${n}.js`), "utf8");
  // some names are aliases that re-export another icon file (loader-2 → loader-circle)
  const alias = !src.includes("createLucideIcon(") && src.match(/from '\.\/([a-z0-9-]+)\.js'/);
  if (alias) src = fs.readFileSync(path.join(DIR, `${alias[1]}.js`), "utf8");
  const m = src.match(/createLucideIcon\("[^"]+", (\[[\s\S]*\])\);\n/);
  if (!m) throw new Error("no iconNode in " + n);
  const node = Function(`"use strict"; return ${m[1]};`)();
  out[n] = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
}
fs.writeFileSync(path.join(__dirname, "../assets/icons.js"), "window.LUCIDE=" + JSON.stringify(out) + ";\n");
console.log("wrote", Object.keys(out).length, "icons");
