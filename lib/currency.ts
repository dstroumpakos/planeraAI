/**
 * Currency display helpers.
 *
 * Flight fares are stored in whatever currency the search ran in (see
 * `trips.createFromFlight` / `createFromDeal`, which persist `currency` on the
 * locked flight option). Anywhere that renders one of those figures must read
 * that field rather than assume euros — a "€420" label on a USD fare is a
 * silently wrong price, not a cosmetic slip.
 *
 * Note this is presentation only: it never converts between currencies.
 */

const SYMBOLS: Record<string, string> = {
    EUR: "€",
    USD: "$",
    GBP: "£",
    CHF: "CHF ",
    SEK: "kr",
    NOK: "kr",
    DKK: "kr",
};

/**
 * Symbol for an ISO 4217 code, falling back to the code itself so an unmapped
 * currency still renders an honest (if less pretty) "PLN450".
 */
export function currencySymbol(code?: string | null): string {
    if (!code) return SYMBOLS.EUR;
    return SYMBOLS[code.toUpperCase()] ?? code.toUpperCase();
}

/** Format a rounded amount with its currency symbol, e.g. `formatFare(419.6, "USD")` → `"$420"`. */
export function formatFare(amount: number, code?: string | null): string {
    return `${currencySymbol(code)}${Math.round(amount)}`;
}
