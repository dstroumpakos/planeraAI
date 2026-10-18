/**
 * VAT rules for the supplier listing subscription (€20/month + VAT).
 *
 * Planera is a Greek business invoicing another business for a service, so
 * the treatment depends only on where the customer is established:
 *
 *   GR                      → Greek VAT 24% (ΦΠΑ), Τιμολόγιο Παροχής Υπηρεσιών
 *   other EU, VIES-valid    → 0%, reverse charge (the customer self-accounts)
 *   outside the EU          → 0%, outside the scope of Greek VAT
 *
 * Pure functions only — no Convex, no fetch — so the rules are testable and
 * the checkout and the operator's invoice email can never disagree.
 */

/** Greek standard VAT rate, percent. */
export const GREEK_VAT_RATE = 24;

/** EU member states, ISO 3166-1 alpha-2 (Greece is "GR" here, "EL" in VIES). */
export const EU_COUNTRIES = new Set([
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
    "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
    "SE", "SI", "SK",
]);

export type VatTreatment = "domestic" | "reverse_charge" | "outside_eu";

export function vatTreatment(country: string): VatTreatment {
    const cc = country.trim().toUpperCase();
    if (cc === "GR") return "domestic";
    if (EU_COUNTRIES.has(cc)) return "reverse_charge";
    return "outside_eu";
}

export function vatRateFor(country: string): number {
    return vatTreatment(country) === "domestic" ? GREEK_VAT_RATE : 0;
}

/** VIES uses "EL" for Greece; everyone else uses their ISO code. */
export function viesCountryCode(country: string): string {
    const cc = country.trim().toUpperCase();
    return cc === "GR" ? "EL" : cc;
}

/**
 * Strip spaces, dots and dashes, and a leading country prefix the user may
 * have typed ("EL 123456789", "GR123456789", "DE-123…").
 */
export function normalizeVatNumber(raw: string, country: string): string {
    let s = raw.toUpperCase().replace(/[\s.\-]/g, "");
    const prefixes = [country.trim().toUpperCase(), viesCountryCode(country)];
    for (const p of prefixes) {
        if (p && s.startsWith(p) && s.length > p.length) {
            s = s.slice(p.length);
            break;
        }
    }
    return s;
}

/**
 * Greek ΑΦΜ check digit. Nine digits; the first eight weighted by 2^8 … 2^1,
 * summed, mod 11, mod 10 must equal the ninth. Catches the typo that would
 * otherwise only surface when myDATA rejects the invoice.
 */
export function isValidGreekAfm(afm: string): boolean {
    if (!/^\d{9}$/.test(afm)) return false;
    if (afm === "000000000") return false;
    let sum = 0;
    for (let i = 0; i < 8; i++) {
        sum += Number(afm[i]) * 2 ** (8 - i);
    }
    return (sum % 11) % 10 === Number(afm[8]);
}

/** Split a net amount (minor units) into VAT and total for a country. */
export function vatBreakdown(netMinor: number, country: string) {
    const ratePct = vatRateFor(country);
    const vatMinor = Math.round((netMinor * ratePct) / 100);
    return { netMinor, ratePct, vatMinor, totalMinor: netMinor + vatMinor };
}

/** The line the invoice has to carry when no Greek VAT is charged. */
export function vatExemptionNote(country: string): string | undefined {
    switch (vatTreatment(country)) {
        case "reverse_charge":
            return "Αντίστροφη επιβάρυνση — άρθρο 14 παρ. 2α Ν.2859/2000 (Reverse charge, Art. 196 Dir. 2006/112/EC)";
        case "outside_eu":
            return "Εκτός πεδίου εφαρμογής ΦΠΑ — άρθρο 14 παρ. 2α Ν.2859/2000 (Outside the scope of EU VAT)";
        default:
            return undefined;
    }
}
