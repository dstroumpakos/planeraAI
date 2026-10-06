#!/usr/bin/env node
/**
 * Production OTA rollback.
 *
 * Re-publishes an EXISTING update group to the production branch. Unlike
 * scripts/ota-prod.mjs this builds nothing: `eas update:republish` reuses the
 * bytes of the chosen group, so the DEV/PROD env trap does not apply (the
 * group was already bundle-scanned when it was first published) and the
 * runtime version stays whatever that group was built for — which is the
 * point: after a version bump in app.json a fresh `eas update` can no longer
 * reach the older runtime, but a republish can.
 *
 * Usage:
 *   node scripts/ota-rollback.mjs                 # lists recent groups, picks nothing
 *   node scripts/ota-rollback.mjs <group-id>      # republishes that group
 *   node scripts/ota-rollback.mjs --group <id>    # same
 */

import { execSync } from "node:child_process";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

// `--group <id>` or a bare positional id — npm on Windows swallows `--group`
// when it comes after `--`, so the positional form is the reliable one.
const group =
  arg("group") ??
  process.argv.slice(2).find((a) => /^[0-9a-f-]{36}$/i.test(a));
const branch = arg("branch") ?? "production";
// Both mobile repos share one EAS project + "production" branch, so groups from
// the iOS and Android repos are interleaved below. Only ever republish this
// repo's own platform -- republishing the other repo's group would hand its
// bundle to the wrong app.
const REPO_PLATFORM = "ios";

function log(msg) {
  console.log(`\n\x1b[36m[ota-rollback]\x1b[0m ${msg}`);
}

log(`Recent update groups on branch "${branch}":`);
execSync(`eas update:list --branch ${branch} --limit 5 --non-interactive`, { stdio: "inherit" });

if (!group) {
  log("Pass --group <Group ID> (from the list above) to republish it. Nothing was published.");
  process.exit(0);
}

if (!/^[0-9a-f-]{36}$/i.test(group)) {
  console.error(`\n\x1b[31m[ota-rollback] ABORT:\x1b[0m "${group}" is not an update group id.\n`);
  process.exit(1);
}

log(`Republishing group ${group} → branch=${branch}`);
execSync(
  // A group already belongs to a branch; EAS rejects `--branch` alongside `--group`.
  `eas update:republish --group ${group} --platform ${REPO_PLATFORM} --non-interactive --message ${JSON.stringify(
    `Rollback to ${group.slice(0, 8)} ${new Date().toISOString()}`,
  )}`,
  { stdio: "inherit" },
);

log("\x1b[32m✅ Republished. Devices on that runtime pick it up on next launch.\x1b[0m");
