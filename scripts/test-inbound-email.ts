/**
 * Unit checks for the Reservation Inbox inbound-email helpers.
 *
 * These cover the security-critical decisions: which account a message is
 * credited to (extractAlias) and whether a sender passed DKIM/SPF. No test
 * framework needed - run it directly:
 *
 *   npx tsx scripts/test-inbound-email.ts
 *
 * Exits non-zero on failure, so it drops into CI as-is.
 */
import { extractAlias, isSenderVerified, htmlToText, toTimestamp } from "../convex/helpers/inboundEmail";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`); }
}

const ALIAS = "a8f3c2b9ad4e17f0";
const DOMAIN = "in.planeraai.app";

console.log("\nextractAlias - decides which account a message writes into");
check("bare alias", extractAlias(`${ALIAS}@${DOMAIN}`), ALIAS);
check("plus addressing", extractAlias(`trips+${ALIAS}@${DOMAIN}`), ALIAS);
check("display name form", extractAlias(`Planera <${ALIAS}@${DOMAIN}>`), ALIAS);
// Mail is case-insensitive in the local part for our purposes; a user pasting
// the address from a mail client that upper-cased it must still resolve.
check("uppercase normalized", extractAlias("A8F3C2B9AD4E17F0@IN.PLANERAAI.APP"), ALIAS);
check("mixed case normalized", extractAlias(`A8f3C2b9Ad4E17f0@${DOMAIN}`), ALIAS);
check("whitespace tolerated", extractAlias(`  ${ALIAS}@${DOMAIN}  `), ALIAS);
// Postmark's own inbound address with plus-addressing - the pre-DNS test path.
check("postmark server address + alias", extractAlias(`6a3218566b0ce9e326f2f060b8a336df+${ALIAS}@inbound.postmarkapp.com`), ALIAS);
check("role address rejected", extractAlias(`postmaster@${DOMAIN}`), null);
check("bare postmark address rejected", extractAlias("6a3218566b0ce9e326f2f060b8a336df@inbound.postmarkapp.com"), null);
check("too short rejected", extractAlias(`abc123@${DOMAIN}`), null);
check("too long rejected", extractAlias(`${ALIAS}cd@${DOMAIN}`), null);
check("non-hex rejected", extractAlias(`zzzzzzzzzzzzzzzz@${DOMAIN}`), null);
check("no domain rejected", extractAlias(ALIAS), null);
check("undefined rejected", extractAlias(undefined), null);
check("empty rejected", extractAlias(""), null);
check("injection attempt rejected", extractAlias(`${ALIAS}@evil.com<script>`), null);

console.log("\nisSenderVerified - trust flag only, never auto-approval");
check("dkim pass", isSenderVerified([{ Name: "Authentication-Results", Value: "mx.google.com; dkim=pass header.i=@aegean.gr" }]), true);
check("spf pass", isSenderVerified([{ Name: "Received-SPF", Value: "Pass (protection.outlook.com)" }]), true);
check("dkim fail", isSenderVerified([{ Name: "Authentication-Results", Value: "mx.google.com; dkim=fail" }]), false);
check("fail wins over pass", isSenderVerified([{ Name: "Authentication-Results", Value: "spf=pass; dkim=fail" }]), false);
check("no headers", isSenderVerified(undefined), false);
check("empty array", isSenderVerified([]), false);
check("irrelevant headers", isSenderVerified([{ Name: "Subject", Value: "dkim=pass" }]), false);

console.log("\ntoTimestamp - a bad date mis-files a booking against the wrong trip");
check("iso with offset", toTimestamp("2026-06-12T08:35:00+03:00"), Date.parse("2026-06-12T08:35:00+03:00"));
check("typo'd year 0202 rejected", toTimestamp("0202-06-12T08:35:00Z"), undefined);
check("year 20255 rejected", toTimestamp("20255-06-12T08:35:00Z"), undefined);
check("garbage rejected", toTimestamp("next tuesday"), undefined);
check("undefined rejected", toTimestamp(undefined), undefined);

console.log("\nhtmlToText");
check("strips tags + entities", htmlToText("<p>Flight <b>A3&nbsp;700</b></p><script>evil()</script>"), "Flight A3 700");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
