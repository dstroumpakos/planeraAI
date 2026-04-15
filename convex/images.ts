"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

interface UnsplashPhoto {
  urls: { regular: string };
  user: { name: string; links: { html: string } };
  links: { html: string; download_location: string };
}

interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
}

interface UnsplashImage {
  url: string;
  photographer: string;
  attribution: string;
  photographerUrl?: string;
  downloadLocation?: string;
}

/**
 * Optimize an Unsplash URL for mobile by adding size/quality parameters
 */
function optimizeUnsplashUrl(url: string, width: number = 800, quality: number = 75): string {
  if (!url || !url.includes('images.unsplash.com')) {
    return url;
  }
  
  try {
    const urlObj = new URL(url);
    urlObj.searchParams.set('w', width.toString());
    urlObj.searchParams.set('q', quality.toString());
    urlObj.searchParams.set('fm', 'jpg');
    urlObj.searchParams.set('fit', 'crop');
    urlObj.searchParams.set('auto', 'format,compress');
    return urlObj.toString();
  } catch {
    return url;
  }
}

// IATA code → city name mapping for Unsplash image search fallback
// Covers all 389 destinations from create-trip + all airports from lib/airports.ts
const IATA_TO_CITY: Record<string, string> = {
  // ── USA ──
  ATL: "Atlanta", LAX: "Los Angeles", ORD: "Chicago",
  JFK: "New York", EWR: "New York", LGA: "New York",
  DFW: "Dallas", DEN: "Denver", SFO: "San Francisco", MIA: "Miami", SEA: "Seattle",
  LAS: "Las Vegas", MCO: "Orlando", CLT: "Charlotte", PHX: "Phoenix", IAH: "Houston",
  BOS: "Boston", MSP: "Minneapolis", DTW: "Detroit", FLL: "Fort Lauderdale",
  PHL: "Philadelphia", BWI: "Baltimore", SLC: "Salt Lake City", SAN: "San Diego",
  IAD: "Washington D.C.", DCA: "Washington D.C.", TPA: "Tampa", PDX: "Portland",
  HNL: "Honolulu", OGG: "Maui", MSY: "New Orleans", BNA: "Nashville",
  AUS: "Austin", SAV: "Savannah", ASE: "Aspen", EYW: "Key West",
  // ── Canada ──
  YYZ: "Toronto", YVR: "Vancouver", YUL: "Montreal",
  YQB: "Quebec City", YYC: "Calgary", YOW: "Ottawa",
  // ── UK & Ireland ──
  LHR: "London", LGW: "London", STN: "London", LTN: "London",
  EDI: "Edinburgh", MAN: "Manchester", LPL: "Liverpool",
  GLA: "Glasgow", BFS: "Belfast", BHD: "Belfast", CWL: "Cardiff",
  DUB: "Dublin", ORK: "Cork",
  // ── France ──
  CDG: "Paris", ORY: "Paris", LYS: "Lyon", NCE: "Nice", MRS: "Marseille",
  BOD: "Bordeaux", SXB: "Strasbourg", TLS: "Toulouse", MPL: "Montpellier",
  AJA: "Corsica", BIA: "Corsica",
  // ── Spain ──
  BCN: "Barcelona", MAD: "Madrid", PMI: "Palma de Mallorca", AGP: "Malaga",
  IBZ: "Ibiza", VLC: "Valencia", SVQ: "Seville", ALC: "Alicante",
  GRX: "Granada", BIO: "Bilbao", EAS: "San Sebastián",
  TFS: "Tenerife", TFN: "Tenerife", LPA: "Gran Canaria",
  ACE: "Lanzarote", FUE: "Fuerteventura", MAH: "Menorca",
  // ── Italy ──
  FCO: "Rome", MXP: "Milan", LIN: "Milan", VCE: "Venice", NAP: "Naples",
  BLQ: "Bologna", FLR: "Florence", CTA: "Catania", PSA: "Pisa", BGY: "Bergamo",
  TRN: "Turin", VRN: "Verona", GOA: "Genoa", BRI: "Bari",
  PMO: "Palermo", CAG: "Sardinia", OLB: "Sardinia",
  // ── Germany ──
  FRA: "Frankfurt", MUC: "Munich", BER: "Berlin", HAM: "Hamburg", DUS: "Dusseldorf",
  CGN: "Cologne", STR: "Stuttgart", DRS: "Dresden", NUE: "Nuremberg", LEJ: "Leipzig",
  // ── Austria ──
  VIE: "Vienna", SZG: "Salzburg", INN: "Innsbruck", GRZ: "Graz",
  // ── Switzerland ──
  ZRH: "Zurich", GVA: "Geneva", BRN: "Bern",
  // ── Benelux ──
  AMS: "Amsterdam", RTM: "Rotterdam", BRU: "Brussels", ANR: "Antwerp",
  LUX: "Luxembourg City",
  // ── Portugal ──
  LIS: "Lisbon", OPO: "Porto", FAO: "Algarve", FNC: "Madeira", PDL: "Azores",
  // ── Scandinavia ──
  CPH: "Copenhagen", ARN: "Stockholm", OSL: "Oslo", HEL: "Helsinki",
  KEF: "Reykjavik", BGO: "Bergen", GOT: "Gothenburg", TOS: "Tromsø",
  // ── Eastern Europe ──
  WAW: "Warsaw", KRK: "Kraków", GDN: "Gdańsk", WRO: "Wrocław", POZ: "Poznań",
  PRG: "Prague", BRQ: "Brno",
  BUD: "Budapest", DEB: "Debrecen",
  OTP: "Bucharest", CLJ: "Cluj-Napoca", SBZ: "Sibiu", TSR: "Timișoara",
  SOF: "Sofia", PDV: "Plovdiv", VAR: "Varna",
  BEG: "Belgrade", INI: "Niš",
  ZAG: "Zagreb", DBV: "Dubrovnik", SPU: "Split", PUY: "Pula", ZAD: "Zadar",
  LJU: "Ljubljana",
  BTS: "Bratislava", KSC: "Košice",
  TLL: "Tallinn", RIX: "Riga", VNO: "Vilnius",
  SJJ: "Sarajevo", OMO: "Mostar",
  TIA: "Tirana", TGD: "Podgorica", TIV: "Kotor",
  SKP: "Skopje", OHD: "Ohrid", PRN: "Pristina",
  // ── Malta ──
  MLA: "Valletta",
  // ── Cyprus ──
  LCA: "Larnaca", PFO: "Paphos",
  // ── Caucasus ──
  TBS: "Tbilisi", BUS: "Batumi", EVN: "Yerevan", GYD: "Baku",
  // ── Greece ──
  ATH: "Athens", SKG: "Thessaloniki", HER: "Heraklion", RHO: "Rhodes", CFU: "Corfu",
  JTR: "Santorini", JMK: "Mykonos", CHQ: "Chania", KGS: "Kos", ZTH: "Zakynthos",
  PAS: "Paros", JNX: "Naxos", MLO: "Milos", EFL: "Kefalonia",
  PVK: "Lefkada", JSI: "Skiathos", SMI: "Samos", AOK: "Karpathos",
  // ── Turkey ──
  IST: "Istanbul", SAW: "Istanbul", AYT: "Antalya", DLM: "Dalaman", BJV: "Bodrum",
  ADB: "Izmir", NAV: "Cappadocia", ASR: "Cappadocia", TZX: "Trabzon",
  DNZ: "Pamukkale",
  // ── Middle East ──
  DXB: "Dubai", DOH: "Doha", AUH: "Abu Dhabi", RUH: "Riyadh", JED: "Jeddah",
  TLV: "Tel Aviv", BAH: "Bahrain", MCT: "Muscat",
  AMM: "Amman", KWI: "Kuwait City", BEY: "Beirut",
  // ── North Africa ──
  CAI: "Cairo", HRG: "Hurghada", SSH: "Sharm El Sheikh", LXR: "Luxor", HBE: "Alexandria",
  CMN: "Casablanca", RAK: "Marrakech", FEZ: "Fez", ESU: "Essaouira",
  TUN: "Tunis", DJE: "Djerba", ALG: "Algiers",
  // ── Sub-Saharan Africa ──
  JNB: "Johannesburg", CPT: "Cape Town", DUR: "Durban",
  NBO: "Nairobi", MBA: "Mombasa",
  DAR: "Dar es Salaam", ZNZ: "Zanzibar", JRO: "Kilimanjaro",
  LOS: "Lagos", ACC: "Accra", ADD: "Addis Ababa",
  VFA: "Victoria Falls", WDH: "Windhoek", DSS: "Dakar", KGL: "Kigali",
  MRU: "Mauritius", SEZ: "Seychelles",
  // ── India ──
  DEL: "Delhi", BOM: "Mumbai", BLR: "Bangalore", MAA: "Chennai",
  CCU: "Kolkata", HYD: "Hyderabad",
  GOI: "Goa", JAI: "Jaipur", UDR: "Udaipur", VNS: "Varanasi",
  COK: "Kerala", TRV: "Kerala", AGR: "Agra", DED: "Rishikesh",
  // ── South Asia ──
  CMB: "Colombo", KTM: "Kathmandu", PKR: "Pokhara",
  MLE: "Maldives", PBH: "Bhutan",
  // ── Southeast Asia ──
  BKK: "Bangkok", HKT: "Phuket", CNX: "Chiang Mai",
  SIN: "Singapore",
  KUL: "Kuala Lumpur", PEN: "Penang", LGK: "Langkawi",
  CGK: "Jakarta", DPS: "Bali", LOP: "Lombok", JOG: "Yogyakarta",
  MNL: "Manila", CEB: "Cebu", PPS: "Palawan", MPH: "Boracay",
  SGN: "Ho Chi Minh City", HAN: "Hanoi", DAD: "Da Nang",
  REP: "Siem Reap", PNH: "Phnom Penh",
  LPQ: "Luang Prabang", RGN: "Yangon",
  // ── East Asia ──
  HND: "Tokyo", NRT: "Tokyo", KIX: "Osaka",
  HIJ: "Hiroshima", CTS: "Sapporo", OKA: "Okinawa",
  ICN: "Seoul", PUS: "Busan", CJU: "Jeju Island",
  HKG: "Hong Kong", MFM: "Macau",
  PEK: "Beijing", PVG: "Shanghai", CAN: "Guangzhou",
  CTU: "Chengdu", XIY: "Xi'an",
  TPE: "Taipei", UBN: "Ulaanbaatar",
  // ── Oceania ──
  SYD: "Sydney", MEL: "Melbourne", BNE: "Brisbane", PER: "Perth", ADL: "Adelaide",
  OOL: "Gold Coast", CNS: "Cairns",
  AKL: "Auckland", ZQN: "Queenstown", WLG: "Wellington", CHC: "Christchurch",
  NAN: "Fiji", PPT: "Tahiti", BOB: "Bora Bora",
  // ── Mexico & Central America ──
  MEX: "Mexico City", CUN: "Cancun", PVR: "Puerto Vallarta",
  GDL: "Guadalajara", OAX: "Oaxaca", SJD: "Los Cabos",
  SJO: "Costa Rica", GUA: "Guatemala City", BZE: "Belize City",
  HAV: "Havana",
  // ── Caribbean ──
  SJU: "San Juan", PUJ: "Punta Cana", NAS: "Nassau", MBJ: "Jamaica",
  AUA: "Aruba", CUR: "Curaçao", BGI: "Barbados", UVF: "St. Lucia",
  ANU: "Antigua", POS: "Trinidad", BDA: "Bermuda", GCM: "Cayman Islands",
  // ── South America ──
  GRU: "São Paulo", GIG: "Rio de Janeiro", SSA: "Salvador", FLN: "Florianópolis",
  EZE: "Buenos Aires", BRC: "Bariloche", MDZ: "Mendoza",
  BOG: "Bogota", MDE: "Medellín", CTG: "Cartagena",
  SCL: "Santiago", LIM: "Lima", CUZ: "Cusco",
  UIO: "Quito", GPS: "Galápagos Islands",
  MVD: "Montevideo", LPB: "La Paz",
  PTY: "Panama City",
  // ── Russia & Central Asia ──
  SVO: "Moscow", DME: "Moscow", LED: "St. Petersburg",
  TAS: "Tashkent", SKD: "Samarkand",
};

/**
 * Resolve an IATA code to a city name if the query looks like an IATA code.
 * Returns the original query if no mapping found.
 */
function resolveIataInQuery(query: string): string {
  const trimmed = query.trim();

  // Pure IATA code (e.g. "BCN")
  if (/^[A-Z]{3}$/.test(trimmed)) {
    return IATA_TO_CITY[trimmed] || trimmed;
  }

  // "IATA, Country" pattern (e.g. "BCN, Spain") — replace IATA part with city
  const iataCountryMatch = trimmed.match(/^([A-Z]{3}),\s*(.+)$/);
  if (iataCountryMatch) {
    const city = IATA_TO_CITY[iataCountryMatch[1]];
    if (city) return `${city}, ${iataCountryMatch[2]}`;
  }

  // ", Country" pattern (empty city, e.g. ", Spain") — return just the country
  if (trimmed.startsWith(",")) {
    const country = trimmed.slice(1).trim();
    if (country) return country;
  }

  // "City, IATA" pattern (e.g. "Bologna, BLG") — handled by the existing comma fallback
  return trimmed;
}

async function fetchUnsplashImage(query: string): Promise<UnsplashImage | null> {
  try {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      console.error("UNSPLASH_ACCESS_KEY not set");
      return null;
    }

    // Resolve IATA codes to city names before searching
    const resolvedQuery = resolveIataInQuery(query);

    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(resolvedQuery)}&per_page=1&orientation=landscape`,
      {
        headers: {
          "Authorization": `Client-ID ${accessKey}`,
        },
      }
    );

    if (!response.ok) {
      console.error("Unsplash API error:", response.status);
      return null;
    }

    const data = await response.json() as UnsplashSearchResponse;
    if (!data.results || data.results.length === 0) {
      // Fallback: if query contains a comma (e.g. "Bologna, BLG"), retry with just the city name
      if (resolvedQuery.includes(",")) {
        const cityOnly = resolvedQuery.split(",")[0].trim();
        if (cityOnly) {
          return fetchUnsplashImage(cityOnly);
        }
      }
      return null;
    }

    const photo = data.results[0];
    // Return optimized URL instead of raw regular URL
    return {
      url: optimizeUnsplashUrl(photo.urls.regular, 800, 75),
      photographer: photo.user.name,
      attribution: photo.links.html,
      photographerUrl: photo.user.links.html,
      downloadLocation: photo.links.download_location,
    };
  } catch (error) {
    console.error("Error fetching Unsplash image:", error);
    return null;
  }
}

export const getDestinationImage = action({
  args: { destination: v.string() },
  returns: v.union(
    v.object({
      url: v.string(),
      photographer: v.string(),
      attribution: v.string(),
      photographerUrl: v.optional(v.string()),
      downloadLocation: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    return await fetchUnsplashImage(args.destination);
  },
});

export const getDestinationImages = action({
  args: { destination: v.string(), count: v.optional(v.number()) },
  returns: v.array(
    v.object({
      url: v.string(),
      photographer: v.string(),
      attribution: v.string(),
      photographerUrl: v.optional(v.string()),
      downloadLocation: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    try {
      const accessKey = process.env.UNSPLASH_ACCESS_KEY;
      if (!accessKey) {
        console.error("UNSPLASH_ACCESS_KEY not set");
        return [];
      }

      const count = args.count || 5;
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(args.destination)}&per_page=${count}&orientation=landscape`,
        {
          headers: {
            "Authorization": `Client-ID ${accessKey}`,
          },
        }
      );

      if (!response.ok) {
        console.error("Unsplash API error:", response.status);
        return [];
      }

      const data = await response.json() as UnsplashSearchResponse;
      if (!data.results) {
        return [];
      }

      return data.results.map((photo: UnsplashPhoto) => ({
        url: optimizeUnsplashUrl(photo.urls.regular, 800, 75),
        photographer: photo.user.name,
        attribution: photo.links.html,
        photographerUrl: photo.user.links.html,
        downloadLocation: photo.links.download_location,
      }));
    } catch (error) {
      console.error("Error fetching Unsplash images:", error);
      return [];
    }
  },
});

export const getActivityImage = action({
  args: { activity: v.string(), destination: v.string() },
  returns: v.union(
    v.object({
      url: v.string(),
      photographer: v.string(),
      attribution: v.string(),
      photographerUrl: v.optional(v.string()),
      downloadLocation: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const query = `${args.activity} ${args.destination}`;
    return await fetchUnsplashImage(query);
  },
});

export const getRestaurantImage = action({
  args: { cuisine: v.string(), destination: v.string() },
  returns: v.union(
    v.object({
      url: v.string(),
      photographer: v.string(),
      attribution: v.string(),
      photographerUrl: v.optional(v.string()),
      downloadLocation: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const query = `${args.cuisine} restaurant ${args.destination}`;
    return await fetchUnsplashImage(query);
  },
});

export const trackUnsplashDownload = action({
  args: { downloadLocation: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Make a request to the download_location URL to track the download
      // This is required by Unsplash API for proper attribution tracking
      await fetch(args.downloadLocation);
    } catch (error) {
      console.error("Error tracking Unsplash download:", error);
      // Don't throw - this is just for tracking and shouldn't break the app
    }
    return null;
  },
});
