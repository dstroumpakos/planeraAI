/**
 * Curated country reference data for Atlas.
 *
 * This replaces a live REST Countries lookup. That API's free, keyless versions
 * (v1–v4) were deprecated and now answer every request with HTTP 200 and an
 * error envelope — so a naive `response.ok` check passes and the parse fails —
 * while v5 requires an API key. Country facts of this kind barely change, so a
 * bundled table is both more reliable and faster than any network call, and it
 * matches how the rest of this codebase handles reference data (see
 * `airportCountry.ts`, `destinationSpend.ts`).
 *
 * It does NOT need to be exhaustive. `lookupCountryFacts` returns null for
 * anything not listed, and Atlas falls back to answering from the model's own
 * knowledge while flagging that the data isn't from a live source. The list
 * covers the destinations that actually come up in travel questions.
 *
 * Population is deliberately omitted: it drifts, and a hardcoded figure would
 * go stale silently. The model can supply it in prose if asked.
 */

export interface CountryFacts {
    name: string;
    cca2: string;
    capital: string;
    currencies: string;
    languages: string;
    callingCode: string;
    drivingSide: "left" | "right";
    timezones: string[];
    region: string;
}

/** [cca2, capital, currency, languages, callingCode, drivingSide, timezones, region] */
type Row = [string, string, string, string, string, "left" | "right", string, string];

const RAW: Record<string, Row> = {
    // ─────────────────────────────── Europe ────────────────────────────────
    "united kingdom": ["GB", "London", "British pound (GBP, £)", "English", "+44", "left", "Europe/London", "Europe"],
    "ireland": ["IE", "Dublin", "Euro (EUR, €)", "English, Irish", "+353", "left", "Europe/Dublin", "Europe"],
    "france": ["FR", "Paris", "Euro (EUR, €)", "French", "+33", "right", "Europe/Paris", "Europe"],
    "germany": ["DE", "Berlin", "Euro (EUR, €)", "German", "+49", "right", "Europe/Berlin", "Europe"],
    "spain": ["ES", "Madrid", "Euro (EUR, €)", "Spanish", "+34", "right", "Europe/Madrid,Atlantic/Canary", "Europe"],
    "portugal": ["PT", "Lisbon", "Euro (EUR, €)", "Portuguese", "+351", "right", "Europe/Lisbon,Atlantic/Madeira,Atlantic/Azores", "Europe"],
    "italy": ["IT", "Rome", "Euro (EUR, €)", "Italian", "+39", "right", "Europe/Rome", "Europe"],
    "greece": ["GR", "Athens", "Euro (EUR, €)", "Greek", "+30", "right", "Europe/Athens", "Europe"],
    "netherlands": ["NL", "Amsterdam", "Euro (EUR, €)", "Dutch", "+31", "right", "Europe/Amsterdam", "Europe"],
    "belgium": ["BE", "Brussels", "Euro (EUR, €)", "Dutch, French, German", "+32", "right", "Europe/Brussels", "Europe"],
    "luxembourg": ["LU", "Luxembourg", "Euro (EUR, €)", "Luxembourgish, French, German", "+352", "right", "Europe/Luxembourg", "Europe"],
    "switzerland": ["CH", "Bern", "Swiss franc (CHF, Fr.)", "German, French, Italian, Romansh", "+41", "right", "Europe/Zurich", "Europe"],
    "austria": ["AT", "Vienna", "Euro (EUR, €)", "German", "+43", "right", "Europe/Vienna", "Europe"],
    "denmark": ["DK", "Copenhagen", "Danish krone (DKK, kr)", "Danish", "+45", "right", "Europe/Copenhagen", "Europe"],
    "sweden": ["SE", "Stockholm", "Swedish krona (SEK, kr)", "Swedish", "+46", "right", "Europe/Stockholm", "Europe"],
    "norway": ["NO", "Oslo", "Norwegian krone (NOK, kr)", "Norwegian", "+47", "right", "Europe/Oslo", "Europe"],
    "finland": ["FI", "Helsinki", "Euro (EUR, €)", "Finnish, Swedish", "+358", "right", "Europe/Helsinki", "Europe"],
    "iceland": ["IS", "Reykjavík", "Icelandic króna (ISK, kr)", "Icelandic", "+354", "right", "Atlantic/Reykjavik", "Europe"],
    "poland": ["PL", "Warsaw", "Polish złoty (PLN, zł)", "Polish", "+48", "right", "Europe/Warsaw", "Europe"],
    "czechia": ["CZ", "Prague", "Czech koruna (CZK, Kč)", "Czech", "+420", "right", "Europe/Prague", "Europe"],
    "slovakia": ["SK", "Bratislava", "Euro (EUR, €)", "Slovak", "+421", "right", "Europe/Bratislava", "Europe"],
    "hungary": ["HU", "Budapest", "Hungarian forint (HUF, Ft)", "Hungarian", "+36", "right", "Europe/Budapest", "Europe"],
    "romania": ["RO", "Bucharest", "Romanian leu (RON, lei)", "Romanian", "+40", "right", "Europe/Bucharest", "Europe"],
    "bulgaria": ["BG", "Sofia", "Bulgarian lev (BGN, лв)", "Bulgarian", "+359", "right", "Europe/Sofia", "Europe"],
    "croatia": ["HR", "Zagreb", "Euro (EUR, €)", "Croatian", "+385", "right", "Europe/Zagreb", "Europe"],
    "slovenia": ["SI", "Ljubljana", "Euro (EUR, €)", "Slovene", "+386", "right", "Europe/Ljubljana", "Europe"],
    "serbia": ["RS", "Belgrade", "Serbian dinar (RSD, дин)", "Serbian", "+381", "right", "Europe/Belgrade", "Europe"],
    "bosnia and herzegovina": ["BA", "Sarajevo", "Convertible mark (BAM, KM)", "Bosnian, Croatian, Serbian", "+387", "right", "Europe/Sarajevo", "Europe"],
    "montenegro": ["ME", "Podgorica", "Euro (EUR, €)", "Montenegrin", "+382", "right", "Europe/Podgorica", "Europe"],
    "albania": ["AL", "Tirana", "Albanian lek (ALL, L)", "Albanian", "+355", "right", "Europe/Tirane", "Europe"],
    "north macedonia": ["MK", "Skopje", "Macedonian denar (MKD, ден)", "Macedonian", "+389", "right", "Europe/Skopje", "Europe"],
    "estonia": ["EE", "Tallinn", "Euro (EUR, €)", "Estonian", "+372", "right", "Europe/Tallinn", "Europe"],
    "latvia": ["LV", "Riga", "Euro (EUR, €)", "Latvian", "+371", "right", "Europe/Riga", "Europe"],
    "lithuania": ["LT", "Vilnius", "Euro (EUR, €)", "Lithuanian", "+370", "right", "Europe/Vilnius", "Europe"],
    "ukraine": ["UA", "Kyiv", "Ukrainian hryvnia (UAH, ₴)", "Ukrainian", "+380", "right", "Europe/Kyiv", "Europe"],
    "turkey": ["TR", "Ankara", "Turkish lira (TRY, ₺)", "Turkish", "+90", "right", "Europe/Istanbul", "Asia"],
    "cyprus": ["CY", "Nicosia", "Euro (EUR, €)", "Greek, Turkish", "+357", "left", "Asia/Nicosia", "Europe"],
    "malta": ["MT", "Valletta", "Euro (EUR, €)", "Maltese, English", "+356", "left", "Europe/Malta", "Europe"],

    // ──────────────────────────────── Asia ─────────────────────────────────
    "japan": ["JP", "Tokyo", "Japanese yen (JPY, ¥)", "Japanese", "+81", "left", "Asia/Tokyo", "Asia"],
    "south korea": ["KR", "Seoul", "South Korean won (KRW, ₩)", "Korean", "+82", "right", "Asia/Seoul", "Asia"],
    "china": ["CN", "Beijing", "Chinese yuan (CNY, ¥)", "Mandarin Chinese", "+86", "right", "Asia/Shanghai", "Asia"],
    "hong kong": ["HK", "Hong Kong", "Hong Kong dollar (HKD, $)", "Cantonese, English", "+852", "left", "Asia/Hong_Kong", "Asia"],
    "taiwan": ["TW", "Taipei", "New Taiwan dollar (TWD, NT$)", "Mandarin Chinese", "+886", "right", "Asia/Taipei", "Asia"],
    "thailand": ["TH", "Bangkok", "Thai baht (THB, ฿)", "Thai", "+66", "left", "Asia/Bangkok", "Asia"],
    "vietnam": ["VN", "Hanoi", "Vietnamese đồng (VND, ₫)", "Vietnamese", "+84", "right", "Asia/Ho_Chi_Minh", "Asia"],
    "cambodia": ["KH", "Phnom Penh", "Cambodian riel (KHR, ៛)", "Khmer", "+855", "right", "Asia/Phnom_Penh", "Asia"],
    "laos": ["LA", "Vientiane", "Lao kip (LAK, ₭)", "Lao", "+856", "right", "Asia/Vientiane", "Asia"],
    "malaysia": ["MY", "Kuala Lumpur", "Malaysian ringgit (MYR, RM)", "Malay", "+60", "left", "Asia/Kuala_Lumpur", "Asia"],
    "singapore": ["SG", "Singapore", "Singapore dollar (SGD, $)", "English, Malay, Mandarin, Tamil", "+65", "left", "Asia/Singapore", "Asia"],
    "indonesia": ["ID", "Jakarta", "Indonesian rupiah (IDR, Rp)", "Indonesian", "+62", "left", "Asia/Jakarta,Asia/Makassar,Asia/Jayapura", "Asia"],
    "philippines": ["PH", "Manila", "Philippine peso (PHP, ₱)", "Filipino, English", "+63", "right", "Asia/Manila", "Asia"],
    "india": ["IN", "New Delhi", "Indian rupee (INR, ₹)", "Hindi, English", "+91", "left", "Asia/Kolkata", "Asia"],
    "sri lanka": ["LK", "Sri Jayawardenepura Kotte", "Sri Lankan rupee (LKR, Rs)", "Sinhala, Tamil", "+94", "left", "Asia/Colombo", "Asia"],
    "nepal": ["NP", "Kathmandu", "Nepalese rupee (NPR, Rs)", "Nepali", "+977", "left", "Asia/Kathmandu", "Asia"],
    "maldives": ["MV", "Malé", "Maldivian rufiyaa (MVR, .ރ)", "Dhivehi", "+960", "left", "Indian/Maldives", "Asia"],
    "israel": ["IL", "Jerusalem", "Israeli new shekel (ILS, ₪)", "Hebrew, Arabic", "+972", "right", "Asia/Jerusalem", "Asia"],
    "united arab emirates": ["AE", "Abu Dhabi", "UAE dirham (AED, د.إ)", "Arabic", "+971", "right", "Asia/Dubai", "Asia"],
    "qatar": ["QA", "Doha", "Qatari riyal (QAR, ر.ق)", "Arabic", "+974", "right", "Asia/Qatar", "Asia"],
    "saudi arabia": ["SA", "Riyadh", "Saudi riyal (SAR, ر.س)", "Arabic", "+966", "right", "Asia/Riyadh", "Asia"],
    "jordan": ["JO", "Amman", "Jordanian dinar (JOD, د.ا)", "Arabic", "+962", "right", "Asia/Amman", "Asia"],
    "oman": ["OM", "Muscat", "Omani rial (OMR, ر.ع.)", "Arabic", "+968", "right", "Asia/Muscat", "Asia"],
    "bahrain": ["BH", "Manama", "Bahraini dinar (BHD, .د.ب)", "Arabic", "+973", "right", "Asia/Bahrain", "Asia"],
    "kuwait": ["KW", "Kuwait City", "Kuwaiti dinar (KWD, د.ك)", "Arabic", "+965", "right", "Asia/Kuwait", "Asia"],
    "georgia": ["GE", "Tbilisi", "Georgian lari (GEL, ₾)", "Georgian", "+995", "right", "Asia/Tbilisi", "Asia"],
    "armenia": ["AM", "Yerevan", "Armenian dram (AMD, ֏)", "Armenian", "+374", "right", "Asia/Yerevan", "Asia"],
    "azerbaijan": ["AZ", "Baku", "Azerbaijani manat (AZN, ₼)", "Azerbaijani", "+994", "right", "Asia/Baku", "Asia"],
    "kazakhstan": ["KZ", "Astana", "Kazakhstani tenge (KZT, ₸)", "Kazakh, Russian", "+7", "right", "Asia/Almaty", "Asia"],
    "uzbekistan": ["UZ", "Tashkent", "Uzbekistani soʻm (UZS, so'm)", "Uzbek", "+998", "right", "Asia/Tashkent", "Asia"],

    // ─────────────────────────────── Americas ──────────────────────────────
    "united states": ["US", "Washington, D.C.", "US dollar (USD, $)", "English", "+1", "right", "America/New_York,America/Chicago,America/Denver,America/Los_Angeles", "Americas"],
    "canada": ["CA", "Ottawa", "Canadian dollar (CAD, $)", "English, French", "+1", "right", "America/Toronto,America/Winnipeg,America/Edmonton,America/Vancouver", "Americas"],
    "mexico": ["MX", "Mexico City", "Mexican peso (MXN, $)", "Spanish", "+52", "right", "America/Mexico_City,America/Cancun,America/Tijuana", "Americas"],
    "brazil": ["BR", "Brasília", "Brazilian real (BRL, R$)", "Portuguese", "+55", "right", "America/Sao_Paulo,America/Manaus", "Americas"],
    "argentina": ["AR", "Buenos Aires", "Argentine peso (ARS, $)", "Spanish", "+54", "right", "America/Argentina/Buenos_Aires", "Americas"],
    "chile": ["CL", "Santiago", "Chilean peso (CLP, $)", "Spanish", "+56", "right", "America/Santiago", "Americas"],
    "peru": ["PE", "Lima", "Peruvian sol (PEN, S/)", "Spanish, Quechua", "+51", "right", "America/Lima", "Americas"],
    "colombia": ["CO", "Bogotá", "Colombian peso (COP, $)", "Spanish", "+57", "right", "America/Bogota", "Americas"],
    "ecuador": ["EC", "Quito", "US dollar (USD, $)", "Spanish", "+593", "right", "America/Guayaquil,Pacific/Galapagos", "Americas"],
    "bolivia": ["BO", "Sucre", "Bolivian boliviano (BOB, Bs.)", "Spanish, Quechua, Aymara", "+591", "right", "America/La_Paz", "Americas"],
    "uruguay": ["UY", "Montevideo", "Uruguayan peso (UYU, $)", "Spanish", "+598", "right", "America/Montevideo", "Americas"],
    "costa rica": ["CR", "San José", "Costa Rican colón (CRC, ₡)", "Spanish", "+506", "right", "America/Costa_Rica", "Americas"],
    "panama": ["PA", "Panama City", "Panamanian balboa (PAB, B/.)", "Spanish", "+507", "right", "America/Panama", "Americas"],
    "guatemala": ["GT", "Guatemala City", "Guatemalan quetzal (GTQ, Q)", "Spanish", "+502", "right", "America/Guatemala", "Americas"],
    "cuba": ["CU", "Havana", "Cuban peso (CUP, $)", "Spanish", "+53", "right", "America/Havana", "Americas"],
    "dominican republic": ["DO", "Santo Domingo", "Dominican peso (DOP, $)", "Spanish", "+1", "right", "America/Santo_Domingo", "Americas"],
    "jamaica": ["JM", "Kingston", "Jamaican dollar (JMD, $)", "English", "+1", "left", "America/Jamaica", "Americas"],
    "bahamas": ["BS", "Nassau", "Bahamian dollar (BSD, $)", "English", "+1", "left", "America/Nassau", "Americas"],

    // ──────────────────────────────── Africa ───────────────────────────────
    "morocco": ["MA", "Rabat", "Moroccan dirham (MAD, د.م.)", "Arabic, Berber", "+212", "right", "Africa/Casablanca", "Africa"],
    "egypt": ["EG", "Cairo", "Egyptian pound (EGP, £)", "Arabic", "+20", "right", "Africa/Cairo", "Africa"],
    "tunisia": ["TN", "Tunis", "Tunisian dinar (TND, د.ت)", "Arabic", "+216", "right", "Africa/Tunis", "Africa"],
    "south africa": ["ZA", "Pretoria", "South African rand (ZAR, R)", "English, Afrikaans, Zulu, Xhosa", "+27", "left", "Africa/Johannesburg", "Africa"],
    "kenya": ["KE", "Nairobi", "Kenyan shilling (KES, Sh)", "Swahili, English", "+254", "left", "Africa/Nairobi", "Africa"],
    "tanzania": ["TZ", "Dodoma", "Tanzanian shilling (TZS, Sh)", "Swahili, English", "+255", "left", "Africa/Dar_es_Salaam", "Africa"],
    "namibia": ["NA", "Windhoek", "Namibian dollar (NAD, $)", "English", "+264", "left", "Africa/Windhoek", "Africa"],
    "botswana": ["BW", "Gaborone", "Botswana pula (BWP, P)", "English, Tswana", "+267", "left", "Africa/Gaborone", "Africa"],
    "ethiopia": ["ET", "Addis Ababa", "Ethiopian birr (ETB, Br)", "Amharic", "+251", "right", "Africa/Addis_Ababa", "Africa"],
    "ghana": ["GH", "Accra", "Ghanaian cedi (GHS, ₵)", "English", "+233", "right", "Africa/Accra", "Africa"],
    "nigeria": ["NG", "Abuja", "Nigerian naira (NGN, ₦)", "English", "+234", "right", "Africa/Lagos", "Africa"],
    "senegal": ["SN", "Dakar", "West African CFA franc (XOF, Fr)", "French", "+221", "right", "Africa/Dakar", "Africa"],
    "mauritius": ["MU", "Port Louis", "Mauritian rupee (MUR, ₨)", "English, French, Creole", "+230", "left", "Indian/Mauritius", "Africa"],
    "seychelles": ["SC", "Victoria", "Seychellois rupee (SCR, ₨)", "Seychellois Creole, English, French", "+248", "left", "Indian/Mahe", "Africa"],

    // ─────────────────────────────── Oceania ───────────────────────────────
    "australia": ["AU", "Canberra", "Australian dollar (AUD, $)", "English", "+61", "left", "Australia/Sydney,Australia/Brisbane,Australia/Adelaide,Australia/Perth", "Oceania"],
    "new zealand": ["NZ", "Wellington", "New Zealand dollar (NZD, $)", "English, Māori", "+64", "left", "Pacific/Auckland", "Oceania"],
    "fiji": ["FJ", "Suva", "Fijian dollar (FJD, $)", "English, Fijian, Hindi", "+679", "left", "Pacific/Fiji", "Oceania"],
};

/**
 * Common alternative names and demonyms → canonical key. Users say "the UK"
 * and "Holland"; the model passes through whatever they typed.
 */
const ALIASES: Record<string, string> = {
    "uk": "united kingdom",
    "great britain": "united kingdom",
    "britain": "united kingdom",
    "england": "united kingdom",
    "scotland": "united kingdom",
    "wales": "united kingdom",
    "northern ireland": "united kingdom",
    "usa": "united states",
    "us": "united states",
    "u.s.": "united states",
    "u.s.a.": "united states",
    "america": "united states",
    "united states of america": "united states",
    "holland": "netherlands",
    "the netherlands": "netherlands",
    "czech republic": "czechia",
    "uae": "united arab emirates",
    "emirates": "united arab emirates",
    "dubai": "united arab emirates",
    "abu dhabi": "united arab emirates",
    "korea": "south korea",
    "republic of korea": "south korea",
    "macedonia": "north macedonia",
    "bosnia": "bosnia and herzegovina",
    "türkiye": "turkey",
    "turkiye": "turkey",
};

function normalize(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/^the\s+/, "")
        .replace(/\s+/g, " ");
}

/**
 * Resolve a free-text country name to curated facts, or null when unknown.
 * Callers must treat null as "answer from general knowledge", never as an error.
 */
export function lookupCountryFacts(name: string): CountryFacts | null {
    if (!name) return null;
    const key = normalize(name);
    const canonical = ALIASES[key] ?? key;
    const row = RAW[canonical];
    if (!row) return null;

    const [cca2, capital, currencies, languages, callingCode, drivingSide, timezones, region] = row;
    return {
        // Title-case the canonical key for display.
        name: canonical.replace(/(^|\s)\S/g, (c) => c.toUpperCase()),
        cca2,
        capital,
        currencies,
        languages,
        callingCode,
        drivingSide,
        timezones: timezones.split(","),
        region,
    };
}

/** Country name → ISO 3166-1 alpha-2, used to key the public-holiday lookup. */
export function lookupCountryCode(name: string): string | null {
    return lookupCountryFacts(name)?.cca2 ?? null;
}
