#!/usr/bin/env node
/**
 * Loads the extracted agency leads and the partnership deck into Convex.
 *
 *   node scripts/agency-outreach/import.mjs --leads scripts/agency-outreach/leads.json
 *   node scripts/agency-outreach/import.mjs --deck "C:\\path\\Planera_Deck.pptx"
 *   node scripts/agency-outreach/import.mjs --status
 *
 * Auth comes from the Convex CLI, which is already logged in as an admin of the
 * deployment. That matters because the operator signs in to the app with
 * Google and therefore has no password a script could log in with — and because
 * deployment credentials are a stricter gate than a user session token anyway.
 *
 * Importing does NOT start sending. The campaign is created paused; a human has
 * to run `agencyOutreach:startCampaignAdmin`, which is the point — a list this
 * size should never begin mailing as a side effect of a data load.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PROD = process.argv.includes("--dev") ? [] : ["--prod"];
// Node 20 refuses to spawn .cmd shims (CVE-2024-27980), so call the CLI's JS
// entry point directly instead of going through `npx`.
const CONVEX_CLI = path.resolve("node_modules/convex/bin/main.js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(msg) {
  console.error(`\x1b[31m[agency-outreach] ${msg}\x1b[0m`);
  process.exit(1);
}

/**
 * Args go through execFileSync as a single argv entry rather than a shell
 * string: Greek agency names and quotes in the JSON would otherwise have to
 * survive PowerShell quoting, which they do not.
 */
function convexRun(fn, args) {
  const out = execFileSync(
    process.execPath,
    [CONVEX_CLI, "run", ...PROD, fn, JSON.stringify(args)],
    { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }
  );
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  return start !== -1 && end > start ? JSON.parse(out.slice(start, end + 1)) : null;
}

// --- Leads -----------------------------------------------------------------
const leadsPath = arg("leads");
if (leadsPath) {
  const leads = JSON.parse(fs.readFileSync(leadsPath, "utf-8"));
  if (!Array.isArray(leads) || leads.length === 0) fail("leads file is empty");

  // Small batches: the CLI passes arguments on the command line, and Windows
  // caps a process argument at 32 KB.
  const BATCH = 25;
  const totals = { inserted: 0, updated: 0, skipped: 0 };
  for (let i = 0; i < leads.length; i += BATCH) {
    const rows = leads.slice(i, i + BATCH).map((l) => {
      const row = { email: String(l.email), agencyName: String(l.agencyName ?? "") };
      for (const k of [
        "city", "website", "phone", "agencyType", "services", "sourceName", "sourceUrl",
      ]) {
        if (l[k]) row[k] = String(l[k]);
      }
      row.language = l.language === "en" ? "en" : "el";
      return row;
    });
    const res = convexRun("agencyOutreach:importLeadsAdmin", { rows });
    totals.inserted += res.inserted;
    totals.updated += res.updated;
    totals.skipped += res.skipped;
    process.stdout.write(
      `\r  ${Math.min(i + BATCH, leads.length)}/${leads.length} ` +
        `(+${totals.inserted} ~${totals.updated} !${totals.skipped})   `
    );
  }
  console.log(
    `\n[agency-outreach] ${totals.inserted} new, ${totals.updated} updated, ${totals.skipped} skipped`
  );
}

// --- Deck ------------------------------------------------------------------
const deckPath = arg("deck");
if (deckPath) {
  if (!fs.existsSync(deckPath)) fail(`deck not found: ${deckPath}`);
  const bytes = fs.readFileSync(deckPath);
  // Recipients see this as the attachment name, so allow an ASCII override:
  // non-ASCII filenames still render as mojibake in some older mail clients.
  const name = arg("deck-name", path.basename(deckPath));
  const mb = bytes.length / 1048576;
  console.log(`[agency-outreach] uploading ${name} (${mb.toFixed(1)} MB)`);
  if (mb > 7) {
    console.warn(
      `  ! ${mb.toFixed(1)} MB exceeds the 7 MB attachment budget (Postmark caps a message at ` +
        `10 MB AFTER base64). It will be linked from the email, never attached.`
    );
  }

  const uploadUrl = execFileSync(
    process.execPath,
    [CONVEX_CLI, "run", ...PROD, "agencyOutreach:generateDeckUploadUrlAdmin", "{}"],
    { encoding: "utf-8" }
  )
    .match(/https?:\/\/\S+/)?.[0]
    ?.replace(/["'\s]+$/, "");
  if (!uploadUrl) fail("could not obtain an upload URL");

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
    body: bytes,
  });
  if (!res.ok) fail(`upload failed: HTTP ${res.status}`);
  const { storageId } = await res.json();

  const stored = convexRun("agencyOutreach:setDeckAdmin", {
    storageId,
    fileName: name,
    deckPolicy: arg("deck-policy", "followup"),
  });
  console.log(`[agency-outreach] deck stored. Public link: ${stored?.url}`);
}

console.log("\n[agency-outreach] state:");
console.log(JSON.stringify(convexRun("agencyOutreach:overviewAdmin", {}), null, 2));
