/**
 * Destination → Airport (IATA) resolver — single source of truth.
 *
 * Used by:
 *   - convex/tripsActions.ts (backend flight search)
 *   - app/flights/search.tsx (UI banner when destination has no own airport)
 *
 * Some destinations don't have their own commercial airport (e.g. Amalfi,
 * Cinque Terre, Hoi An, Cappadocia*, Petra, Machu Picchu). For those we
 * store the nearest hub plus metadata so the UI can show
 * "X doesn't have its own airport — flights are to Y, ~N km away".
 *
 * (* Cappadocia DOES have NAV right next to it, but flights to NAV are
 * scarce so we route via ASR which has more options.)
 */

import { AIRPORTS } from "./airports";
import { normalizeDestinationToEnglish } from "./destinationTranslations";

export type AirportInfo = {
  /** IATA code to actually search flights with. */
  iata: string;
  /** False when the destination itself has no commercial airport. */
  hasOwnAirport: boolean;
  /** City name of the hub airport (only when hasOwnAirport === false). */
  nearestCity?: string;
  /** Country of the hub airport. */
  nearestCountry?: string;
  /** Approximate road distance from the destination to the hub, in km. */
  distanceKm?: number;
};

/* -------------------------------------------------------------------------- */
/*  Destinations that have their own airport.                                 */
/*  Map: lowercased destination key → primary IATA code.                      */
/* -------------------------------------------------------------------------- */
const SIMPLE: Record<string, string> = {
  // Europe — Western
  "london": "LHR",
  "london heathrow": "LHR",
  "london gatwick": "LGW",
  "london stansted": "STN",
  "london luton": "LTN",
  "london city": "LCY",
  "paris": "CDG",
  "paris charles de gaulle": "CDG",
  "paris orly": "ORY",
  "rome": "FCO",
  "rome fiumicino": "FCO",
  "barcelona": "BCN",
  "madrid": "MAD",
  "lisbon": "LIS",
  "porto": "OPO",
  "faro": "FAO",
  "amsterdam": "AMS",
  "eindhoven": "EIN",
  "rotterdam": "RTM",
  "brussels": "BRU",
  "luxembourg": "LUX",
  "luxembourg city": "LUX",
  "dublin": "DUB",
  "shannon": "SNN",
  "cork": "ORK",
  "edinburgh": "EDI",
  "manchester": "MAN",
  "birmingham": "BHX",
  "glasgow": "GLA",
  "liverpool": "LPL",
  "bristol": "BRS",
  "newcastle": "NCL",
  "belfast": "BFS",
  "cardiff": "CWL",
  "berlin": "BER",
  "munich": "MUC",
  "frankfurt": "FRA",
  "hamburg": "HAM",
  "düsseldorf": "DUS",
  "dusseldorf": "DUS",
  "cologne": "CGN",
  "köln": "CGN",
  "stuttgart": "STR",
  "hannover": "HAJ",
  "nuremberg": "NUE",
  "leipzig": "LEJ",
  "bremen": "BRE",
  "vienna": "VIE",
  "wien": "VIE",
  "salzburg": "SZG",
  "innsbruck": "INN",
  "graz": "GRZ",
  "zurich": "ZRH",
  "zürich": "ZRH",
  "geneva": "GVA",
  "genève": "GVA",
  "basel": "BSL",
  "bern": "BRN",
  "nice": "NCE",
  "lyon": "LYS",
  "marseille": "MRS",
  "toulouse": "TLS",
  "bordeaux": "BOD",
  "nantes": "NTE",
  "strasbourg": "SXB",
  "milan": "MXP",
  "milan malpensa": "MXP",
  "milan linate": "LIN",
  "florence": "FLR",
  "venice": "VCE",
  "naples": "NAP",
  "verona": "VRN",
  "bologna": "BLQ",
  "pisa": "PSA",
  "turin": "TRN",
  "bari": "BRI",
  "catania": "CTA",
  "palermo": "PMO",
  "sicily": "CTA",
  "sardinia": "CAG",
  "cagliari": "CAG",
  "olbia": "OLB",
  "genoa": "GOA",
  "trieste": "TRS",
  // Iberian extras
  "malaga": "AGP",
  "málaga": "AGP",
  "valencia": "VLC",
  "bilbao": "BIO",
  "alicante": "ALC",
  "granada": "GRX",
  "santiago de compostela": "SCQ",
  "san sebastian": "EAS",
  "santander": "SDR",
  "asturias": "OVD",
  "seville": "SVQ",
  "sevilla": "SVQ",
  // Balearic Islands
  "mallorca": "PMI",
  "palma": "PMI",
  "palma de mallorca": "PMI",
  "majorca": "PMI",
  "ibiza": "IBZ",
  "menorca": "MAH",
  "minorca": "MAH",
  // Canary Islands
  "tenerife": "TFS",
  "tenerife south": "TFS",
  "tenerife north": "TFN",
  "santa cruz de tenerife": "TFN",
  "gran canaria": "LPA",
  "las palmas": "LPA",
  "lanzarote": "ACE",
  "arrecife": "ACE",
  "fuerteventura": "FUE",
  "la palma": "SPC",
  "la gomera": "GMZ",
  "el hierro": "VDE",
  // Greek islands + mainland
  "athens": "ATH",
  "thessaloniki": "SKG",
  "heraklion": "HER",
  "chania": "CHQ",
  "crete": "HER",
  "santorini": "JTR",
  "mykonos": "JMK",
  "rhodes": "RHO",
  "corfu": "CFU",
  "kos": "KGS",
  "zakynthos": "ZTH",
  "kefalonia": "EFL",
  "lesvos": "MJT",
  "mytilene": "MJT",
  "samos": "SMI",
  "skiathos": "JSI",
  "kalamata": "KLX",
  "ioannina": "IOA",
  // Greek-script aliases (diacritics stripped by normalize())
  "αθηνα": "ATH",
  "θεσσαλονικη": "SKG",
  "ηρακλειο": "HER",
  "κρητη": "HER",
  "χανια": "CHQ",
  "σαντορινη": "JTR",
  "θηρα": "JTR",
  "μυκονος": "JMK",
  "ροδος": "RHO",
  "κερκυρα": "CFU",
  "κως": "KGS",
  "ζακυνθος": "ZTH",
  "κεφαλονια": "EFL",
  // Malta
  "malta": "MLA",
  "valletta": "MLA",
  // Azores (Portugal)
  "azores": "PDL",
  "açores": "PDL",
  "acores": "PDL",
  "ponta delgada": "PDL",
  "são miguel": "PDL",
  "sao miguel": "PDL",
  "terceira": "TER",
  "horta": "HOR",
  "faial": "HOR",
  "pico": "PIX",
  "santa maria": "SMA",
  // Balkans / SE Europe
  "belgrade": "BEG",
  "serbia": "BEG",
  "zagreb": "ZAG",
  "croatia": "ZAG",
  "split": "SPU",
  "dubrovnik": "DBV",
  "zadar": "ZAD",
  "pula": "PUY",
  "rijeka": "RJK",
  "sarajevo": "SJJ",
  "bosnia": "SJJ",
  "bosnia and herzegovina": "SJJ",
  "mostar": "OMO",
  "skopje": "SKP",
  "north macedonia": "SKP",
  "macedonia": "SKP",
  "ohrid": "OHD",
  "tirana": "TIA",
  "albania": "TIA",
  "podgorica": "TGD",
  "montenegro": "TGD",
  "tivat": "TIV",
  "ljubljana": "LJU",
  "slovenia": "LJU",
  "sofia": "SOF",
  "bulgaria": "SOF",
  "varna": "VAR",
  "burgas": "BOJ",
  "plovdiv": "PDV",
  "bucharest": "OTP",
  "romania": "OTP",
  "cluj": "CLJ",
  "cluj-napoca": "CLJ",
  "timisoara": "TSR",
  "iasi": "IAS",
  "kosovo": "PRN",
  "pristina": "PRN",
  // Central / Eastern Europe
  "prague": "PRG",
  "vienna international": "VIE",
  "budapest": "BUD",
  "warsaw": "WAW",
  "krakow": "KRK",
  "gdansk": "GDN",
  "wroclaw": "WRO",
  "poznan": "POZ",
  "bratislava": "BTS",
  "tallinn": "TLL",
  "riga": "RIX",
  "vilnius": "VNO",
  "kiev": "KBP",
  "kyiv": "KBP",
  "lviv": "LWO",
  "minsk": "MSQ",
  "moscow": "SVO",
  "st petersburg": "LED",
  "st. petersburg": "LED",
  "saint petersburg": "LED",
  // Scandinavia
  "copenhagen": "CPH",
  "stockholm": "ARN",
  "oslo": "OSL",
  "helsinki": "HEL",
  "reykjavik": "KEF",
  "reykjavík": "KEF",
  "iceland": "KEF",
  "bergen": "BGO",
  "gothenburg": "GOT",
  "tromsø": "TOS",
  "tromso": "TOS",
  "aalborg": "AAL",
  "billund": "BLL",
  "stavanger": "SVG",
  // Turkey
  "istanbul": "IST",
  "antalya": "AYT",
  "ankara": "ESB",
  "izmir": "ADB",
  "dalaman": "DLM",
  "bodrum": "BJV",
  "trabzon": "TZX",
  // North America — USA
  "new york": "JFK",
  "new york city": "JFK",
  "nyc": "JFK",
  "newark": "EWR",
  "los angeles": "LAX",
  "chicago": "ORD",
  "miami": "MIA",
  "san francisco": "SFO",
  "seattle": "SEA",
  "boston": "BOS",
  "washington": "IAD",
  "washington dc": "IAD",
  "washington d.c.": "IAD",
  "denver": "DEN",
  "dallas": "DFW",
  "atlanta": "ATL",
  "las vegas": "LAS",
  "phoenix": "PHX",
  "san diego": "SAN",
  "portland": "PDX",
  "new orleans": "MSY",
  "nashville": "BNA",
  "austin": "AUS",
  "houston": "IAH",
  "philadelphia": "PHL",
  "minneapolis": "MSP",
  "detroit": "DTW",
  "orlando": "MCO",
  "tampa": "TPA",
  "fort lauderdale": "FLL",
  "san jose": "SJC",
  "salt lake city": "SLC",
  "charlotte": "CLT",
  "raleigh": "RDU",
  "pittsburgh": "PIT",
  "st louis": "STL",
  "kansas city": "MCI",
  "indianapolis": "IND",
  "cleveland": "CLE",
  "columbus": "CMH",
  "cincinnati": "CVG",
  "milwaukee": "MKE",
  "baltimore": "BWI",
  "san antonio": "SAT",
  "sacramento": "SMF",
  "oakland": "OAK",
  "anchorage": "ANC",
  // Hawaii
  "hawaii": "HNL",
  "honolulu": "HNL",
  "maui": "OGG",
  "kauai": "LIH",
  "big island": "KOA",
  "kona": "KOA",
  // Canada
  "toronto": "YYZ",
  "vancouver": "YVR",
  "montreal": "YUL",
  "calgary": "YYC",
  "edmonton": "YEG",
  "ottawa": "YOW",
  "quebec city": "YQB",
  "halifax": "YHZ",
  "winnipeg": "YWG",
  "victoria": "YYJ",
  // Mexico
  "mexico city": "MEX",
  "guadalajara": "GDL",
  "monterrey": "MTY",
  "cancun": "CUN",
  "los cabos": "SJD",
  "cabo san lucas": "SJD",
  "puerto vallarta": "PVR",
  "acapulco": "ACA",
  "oaxaca": "OAX",
  "merida": "MID",
  "cozumel": "CZM",
  // Caribbean / Central America
  "jamaica": "MBJ",
  "montego bay": "MBJ",
  "punta cana": "PUJ",
  "santo domingo": "SDQ",
  "puerto rico": "SJU",
  "san juan": "SJU",
  "aruba": "AUA",
  "curacao": "CUR",
  "st maarten": "SXM",
  "barbados": "BGI",
  "bahamas": "NAS",
  "nassau": "NAS",
  "turks and caicos": "PLS",
  "cayman islands": "GCM",
  "grand cayman": "GCM",
  "bermuda": "BDA",
  "virgin islands": "STT",
  "st thomas": "STT",
  "antigua": "ANU",
  "st lucia": "UVF",
  "trinidad": "POS",
  "martinique": "FDF",
  "guadeloupe": "PTP",
  "costa rica": "SJO",
  "san jose costa rica": "SJO",
  "panama city": "PTY",
  "panama": "PTY",
  "belize": "BZE",
  "belize city": "BZE",
  "guatemala city": "GUA",
  "guatemala": "GUA",
  "managua": "MGA",
  "nicaragua": "MGA",
  "honduras": "SAP",
  "el salvador": "SAL",
  "cuba": "HAV",
  "havana": "HAV",
  // South America
  "buenos aires": "EZE",
  "sao paulo": "GRU",
  "são paulo": "GRU",
  "rio de janeiro": "GIG",
  "rio": "GIG",
  "lima": "LIM",
  "bogota": "BOG",
  "medellin": "MDE",
  "cartagena": "CTG",
  "santiago": "SCL",
  "quito": "UIO",
  "guayaquil": "GYE",
  "cusco": "CUZ",
  "montevideo": "MVD",
  "asuncion": "ASU",
  "la paz": "LPB",
  "caracas": "CCS",
  // Africa
  "cape town": "CPT",
  "johannesburg": "JNB",
  "durban": "DUR",
  "cairo": "CAI",
  "alexandria": "HBE",
  "luxor": "LXR",
  "sharm el sheikh": "SSH",
  "hurghada": "HRG",
  "marrakech": "RAK",
  "casablanca": "CMN",
  "fez": "FEZ",
  "tunis": "TUN",
  "djerba": "DJE",
  "algiers": "ALG",
  "nairobi": "NBO",
  "mombasa": "MBA",
  "zanzibar": "ZNZ",
  "dar es salaam": "DAR",
  "addis ababa": "ADD",
  "accra": "ACC",
  "lagos": "LOS",
  "dakar": "DSS",
  "mauritius": "MRU",
  "seychelles": "SEZ",
  "reunion": "RUN",
  "madagascar": "TNR",
  "victoria falls": "VFA",
  "windhoek": "WDH",
  "namibia": "WDH",
  "botswana": "GBE",
  "gaborone": "GBE",
  "rwanda": "KGL",
  "kigali": "KGL",
  "kilimanjaro": "JRO",
  // Oceania
  "sydney": "SYD",
  "melbourne": "MEL",
  "brisbane": "BNE",
  "perth": "PER",
  "adelaide": "ADL",
  "cairns": "CNS",
  "gold coast": "OOL",
  "darwin": "DRW",
  "hobart": "HBA",
  "auckland": "AKL",
  "wellington": "WLG",
  "christchurch": "CHC",
  "queenstown": "ZQN",
  "fiji": "NAN",
  "nadi": "NAN",
  "tahiti": "PPT",
  "bora bora": "BOB",
  "new caledonia": "NOU",
  "vanuatu": "VLI",
  "samoa": "APW",
  // Island Destinations
  "maldives": "MLE",
  "male": "MLE",
  "sri lanka": "CMB",
  "colombo": "CMB",
  // Southeast Asia
  "bangkok": "BKK",
  "phuket": "HKT",
  "krabi": "KBV",
  "koh samui": "USM",
  "chiang mai": "CNX",
  "chiang rai": "CEI",
  "pattaya": "BKK",
  "hua hin": "HHQ",
  "thailand": "BKK",
  "hanoi": "HAN",
  "ho chi minh city": "SGN",
  "ho chi minh": "SGN",
  "saigon": "SGN",
  "da nang": "DAD",
  "danang": "DAD",
  "hue": "HUI",
  "nha trang": "CXR",
  "cam ranh": "CXR",
  "phu quoc": "PQC",
  "dalat": "DLI",
  "da lat": "DLI",
  "vietnam": "SGN",
  "bali": "DPS",
  "denpasar": "DPS",
  "ubud": "DPS",
  "seminyak": "DPS",
  "kuta": "DPS",
  "canggu": "DPS",
  "nusa dua": "DPS",
  "jakarta": "CGK",
  "yogyakarta": "JOG",
  "lombok": "LOP",
  "gili": "LOP",
  "indonesia": "CGK",
  "kuala lumpur": "KUL",
  "langkawi": "LGK",
  "penang": "PEN",
  "kota kinabalu": "BKI",
  "malaysia": "KUL",
  "singapore": "SIN",
  "manila": "MNL",
  "cebu": "CEB",
  "boracay": "MPH",
  "palawan": "PPS",
  "el nido": "ENI",
  "philippines": "MNL",
  "siem reap": "REP",
  "angkor wat": "REP",
  "phnom penh": "PNH",
  "cambodia": "PNH",
  "vientiane": "VTE",
  "luang prabang": "LPQ",
  "laos": "VTE",
  "yangon": "RGN",
  "myanmar": "RGN",
  // East Asia
  "tokyo": "HND",
  "tokyo haneda": "HND",
  "tokyo narita": "NRT",
  "osaka": "KIX",
  "kyoto": "KIX",
  "nara": "KIX",
  "kobe": "KIX",
  "sapporo": "CTS",
  "okinawa": "OKA",
  "naha": "OKA",
  "fukuoka": "FUK",
  "nagoya": "NGO",
  "hiroshima": "HIJ",
  "japan": "HND",
  "seoul": "ICN",
  "busan": "PUS",
  "jeju": "CJU",
  "jeju island": "CJU",
  "south korea": "ICN",
  "korea": "ICN",
  "taipei": "TPE",
  "taiwan": "TPE",
  "kaohsiung": "KHH",
  "hong kong": "HKG",
  "macau": "MFM",
  "macao": "MFM",
  "beijing": "PEK",
  "shanghai": "PVG",
  "guangzhou": "CAN",
  "shenzhen": "SZX",
  "chengdu": "CTU",
  "xi'an": "XIY",
  "xian": "XIY",
  "china": "PEK",
  // South Asia
  "delhi": "DEL",
  "new delhi": "DEL",
  "mumbai": "BOM",
  "bombay": "BOM",
  "bangalore": "BLR",
  "bengaluru": "BLR",
  "chennai": "MAA",
  "kolkata": "CCU",
  "hyderabad": "HYD",
  "goa": "GOI",
  "jaipur": "JAI",
  "kochi": "COK",
  "udaipur": "UDR",
  "varanasi": "VNS",
  "india": "DEL",
  "kathmandu": "KTM",
  "nepal": "KTM",
  "pokhara": "PKR",
  "thimphu": "PBH",
  "paro": "PBH",
  "bhutan": "PBH",
  "dhaka": "DAC",
  "bangladesh": "DAC",
  // Middle East
  "dubai": "DXB",
  "abu dhabi": "AUH",
  "doha": "DOH",
  "qatar": "DOH",
  "riyadh": "RUH",
  "jeddah": "JED",
  "muscat": "MCT",
  "oman": "MCT",
  "kuwait": "KWI",
  "manama": "BAH",
  "bahrain": "BAH",
  "amman": "AMM",
  "jordan": "AMM",
  "aqaba": "AQJ",
  "tel aviv": "TLV",
  "jerusalem": "TLV",
  "israel": "TLV",
  "beirut": "BEY",
  "lebanon": "BEY",
  // Central Asia / Caucasus
  "tbilisi": "TBS",
  "georgia": "TBS",
  "yerevan": "EVN",
  "armenia": "EVN",
  "baku": "GYD",
  "azerbaijan": "GYD",
  "almaty": "ALA",
  "astana": "NQZ",
  "nur-sultan": "NQZ",
  "kazakhstan": "ALA",
  "tashkent": "TAS",
  "samarkand": "SKD",
  "bukhara": "BHK",
  "uzbekistan": "TAS",
  "bishkek": "FRU",
  "kyrgyzstan": "FRU",
  "dushanbe": "DYU",
  "ashgabat": "ASB",
  "ulaanbaatar": "UBN",
  "mongolia": "UBN",
  // Special: Cappadocia has its own (NAV) but ASR/Kayseri has many more flights.
  // Marked as has-own (NAV exists), default code = ASR for better availability.
  "cappadocia": "ASR",
  "nevsehir": "NAV",
  "nevşehir": "NAV",
  "kapadokya": "ASR",
  "kayseri": "ASR",
  // Aspen
  "aspen": "ASE",
  // Iran (just in case)
  "tehran": "IKA",
};

/* -------------------------------------------------------------------------- */
/*  Destinations WITHOUT their own airport — route via nearest hub.           */
/* -------------------------------------------------------------------------- */
const VIA_HUB: Record<string, AirportInfo> = {
  // Italy — Amalfi Coast & Gulf of Naples → Naples (NAP)
  "amalfi": { iata: "NAP", hasOwnAirport: false, nearestCity: "Naples", nearestCountry: "Italy", distanceKm: 60 },
  "amalfi coast": { iata: "NAP", hasOwnAirport: false, nearestCity: "Naples", nearestCountry: "Italy", distanceKm: 60 },
  "positano": { iata: "NAP", hasOwnAirport: false, nearestCity: "Naples", nearestCountry: "Italy", distanceKm: 57 },
  "sorrento": { iata: "NAP", hasOwnAirport: false, nearestCity: "Naples", nearestCountry: "Italy", distanceKm: 50 },
  "capri": { iata: "NAP", hasOwnAirport: false, nearestCity: "Naples", nearestCountry: "Italy", distanceKm: 40 },
  "ischia": { iata: "NAP", hasOwnAirport: false, nearestCity: "Naples", nearestCountry: "Italy", distanceKm: 30 },
  "pompeii": { iata: "NAP", hasOwnAirport: false, nearestCity: "Naples", nearestCountry: "Italy", distanceKm: 27 },
  // Italy — other no-airport areas
  "cinque terre": { iata: "PSA", hasOwnAirport: false, nearestCity: "Pisa", nearestCountry: "Italy", distanceKm: 95 },
  "portofino": { iata: "GOA", hasOwnAirport: false, nearestCity: "Genoa", nearestCountry: "Italy", distanceKm: 35 },
  "tuscany": { iata: "FLR", hasOwnAirport: false, nearestCity: "Florence", nearestCountry: "Italy", distanceKm: 0 },
  "siena": { iata: "FLR", hasOwnAirport: false, nearestCity: "Florence", nearestCountry: "Italy", distanceKm: 75 },
  "lake como": { iata: "MXP", hasOwnAirport: false, nearestCity: "Milan", nearestCountry: "Italy", distanceKm: 60 },
  "como": { iata: "MXP", hasOwnAirport: false, nearestCity: "Milan", nearestCountry: "Italy", distanceKm: 60 },
  // Spain
  "formentera": { iata: "IBZ", hasOwnAirport: false, nearestCity: "Ibiza", nearestCountry: "Spain", distanceKm: 30 },
  // UK — small historic cities
  "bath": { iata: "BRS", hasOwnAirport: false, nearestCity: "Bristol", nearestCountry: "United Kingdom", distanceKm: 25 },
  "oxford": { iata: "LHR", hasOwnAirport: false, nearestCity: "London", nearestCountry: "United Kingdom", distanceKm: 80 },
  "cambridge": { iata: "STN", hasOwnAirport: false, nearestCity: "London Stansted", nearestCountry: "United Kingdom", distanceKm: 50 },
  "york": { iata: "MAN", hasOwnAirport: false, nearestCity: "Manchester", nearestCountry: "United Kingdom", distanceKm: 105 },
  // Ireland
  "galway": { iata: "SNN", hasOwnAirport: false, nearestCity: "Shannon", nearestCountry: "Ireland", distanceKm: 90 },
  // Switzerland — mountain resorts
  "interlaken": { iata: "ZRH", hasOwnAirport: false, nearestCity: "Zurich", nearestCountry: "Switzerland", distanceKm: 130 },
  "lucerne": { iata: "ZRH", hasOwnAirport: false, nearestCity: "Zurich", nearestCountry: "Switzerland", distanceKm: 60 },
  "zermatt": { iata: "GVA", hasOwnAirport: false, nearestCity: "Geneva", nearestCountry: "Switzerland", distanceKm: 240 },
  // Slovenia
  "lake bled": { iata: "LJU", hasOwnAirport: false, nearestCity: "Ljubljana", nearestCountry: "Slovenia", distanceKm: 55 },
  "bled": { iata: "LJU", hasOwnAirport: false, nearestCity: "Ljubljana", nearestCountry: "Slovenia", distanceKm: 55 },
  // Andorra
  "andorra": { iata: "BCN", hasOwnAirport: false, nearestCity: "Barcelona", nearestCountry: "Spain", distanceKm: 200 },
  "andorra la vella": { iata: "BCN", hasOwnAirport: false, nearestCity: "Barcelona", nearestCountry: "Spain", distanceKm: 200 },
  // Monaco
  "monaco": { iata: "NCE", hasOwnAirport: false, nearestCity: "Nice", nearestCountry: "France", distanceKm: 30 },
  "monte carlo": { iata: "NCE", hasOwnAirport: false, nearestCity: "Nice", nearestCountry: "France", distanceKm: 30 },
  // Vatican
  "vatican": { iata: "FCO", hasOwnAirport: false, nearestCity: "Rome", nearestCountry: "Italy", distanceKm: 30 },
  "vatican city": { iata: "FCO", hasOwnAirport: false, nearestCity: "Rome", nearestCountry: "Italy", distanceKm: 30 },
  // Malta — Gozo has no airport, accessed via ferry from Malta International (MLA)
  "gozo": { iata: "MLA", hasOwnAirport: false, nearestCity: "Malta", nearestCountry: "Malta", distanceKm: 30 },
  "comino": { iata: "MLA", hasOwnAirport: false, nearestCity: "Malta", nearestCountry: "Malta", distanceKm: 25 },
  // Mexico — Riviera Maya area → Cancún
  "tulum": { iata: "CUN", hasOwnAirport: false, nearestCity: "Cancún", nearestCountry: "Mexico", distanceKm: 130 },
  "playa del carmen": { iata: "CUN", hasOwnAirport: false, nearestCity: "Cancún", nearestCountry: "Mexico", distanceKm: 70 },
  "riviera maya": { iata: "CUN", hasOwnAirport: false, nearestCity: "Cancún", nearestCountry: "Mexico", distanceKm: 80 },
  // Vietnam
  "hoi an": { iata: "DAD", hasOwnAirport: false, nearestCity: "Da Nang", nearestCountry: "Vietnam", distanceKm: 30 },
  "halong": { iata: "HAN", hasOwnAirport: false, nearestCity: "Hanoi", nearestCountry: "Vietnam", distanceKm: 165 },
  "ha long": { iata: "HAN", hasOwnAirport: false, nearestCity: "Hanoi", nearestCountry: "Vietnam", distanceKm: 165 },
  "halong bay": { iata: "HAN", hasOwnAirport: false, nearestCity: "Hanoi", nearestCountry: "Vietnam", distanceKm: 165 },
  "ha long bay": { iata: "HAN", hasOwnAirport: false, nearestCity: "Hanoi", nearestCountry: "Vietnam", distanceKm: 165 },
  "sapa": { iata: "HAN", hasOwnAirport: false, nearestCity: "Hanoi", nearestCountry: "Vietnam", distanceKm: 320 },
  "ninh binh": { iata: "HAN", hasOwnAirport: false, nearestCity: "Hanoi", nearestCountry: "Vietnam", distanceKm: 95 },
  // Japan — mountain/rail destinations
  "hakone": { iata: "HND", hasOwnAirport: false, nearestCity: "Tokyo", nearestCountry: "Japan", distanceKm: 90 },
  "mount fuji": { iata: "HND", hasOwnAirport: false, nearestCity: "Tokyo", nearestCountry: "Japan", distanceKm: 100 },
  "fuji": { iata: "HND", hasOwnAirport: false, nearestCity: "Tokyo", nearestCountry: "Japan", distanceKm: 100 },
  // Peru
  "machu picchu": { iata: "CUZ", hasOwnAirport: false, nearestCity: "Cusco", nearestCountry: "Peru", distanceKm: 75 },
  // Jordan
  "petra": { iata: "AQJ", hasOwnAirport: false, nearestCity: "Aqaba", nearestCountry: "Jordan", distanceKm: 130 },
  "wadi rum": { iata: "AQJ", hasOwnAirport: false, nearestCity: "Aqaba", nearestCountry: "Jordan", distanceKm: 70 },
  "dead sea": { iata: "AMM", hasOwnAirport: false, nearestCity: "Amman", nearestCountry: "Jordan", distanceKm: 55 },
  // Morocco
  "essaouira": { iata: "RAK", hasOwnAirport: false, nearestCity: "Marrakech", nearestCountry: "Morocco", distanceKm: 190 },
  "chefchaouen": { iata: "FEZ", hasOwnAirport: false, nearestCity: "Fez", nearestCountry: "Morocco", distanceKm: 200 },
  "merzouga": { iata: "RAK", hasOwnAirport: false, nearestCity: "Marrakech", nearestCountry: "Morocco", distanceKm: 560 },
  "sahara": { iata: "RAK", hasOwnAirport: false, nearestCity: "Marrakech", nearestCountry: "Morocco", distanceKm: 500 },
  // India — gateway-only spiritual towns
  "rishikesh": { iata: "DED", hasOwnAirport: false, nearestCity: "Dehradun", nearestCountry: "India", distanceKm: 35 },
  "agra": { iata: "DEL", hasOwnAirport: false, nearestCity: "Delhi", nearestCountry: "India", distanceKm: 230 },
  "taj mahal": { iata: "DEL", hasOwnAirport: false, nearestCity: "Delhi", nearestCountry: "India", distanceKm: 230 },
  "ella": { iata: "CMB", hasOwnAirport: false, nearestCity: "Colombo", nearestCountry: "Sri Lanka", distanceKm: 230 },
  "kandy": { iata: "CMB", hasOwnAirport: false, nearestCity: "Colombo", nearestCountry: "Sri Lanka", distanceKm: 115 },
  // Canada — mountain resorts
  "banff": { iata: "YYC", hasOwnAirport: false, nearestCity: "Calgary", nearestCountry: "Canada", distanceKm: 130 },
  "lake louise": { iata: "YYC", hasOwnAirport: false, nearestCity: "Calgary", nearestCountry: "Canada", distanceKm: 180 },
  "jasper": { iata: "YEG", hasOwnAirport: false, nearestCity: "Edmonton", nearestCountry: "Canada", distanceKm: 365 },
  "whistler": { iata: "YVR", hasOwnAirport: false, nearestCity: "Vancouver", nearestCountry: "Canada", distanceKm: 125 },
  // Oceania
  "great barrier reef": { iata: "CNS", hasOwnAirport: false, nearestCity: "Cairns", nearestCountry: "Australia", distanceKm: 0 },
  "uluru": { iata: "AYQ", hasOwnAirport: true }, // Ayers Rock actually has its own
  // Africa
  "serengeti": { iata: "ARK", hasOwnAirport: false, nearestCity: "Arusha", nearestCountry: "Tanzania", distanceKm: 320 },
  "ngorongoro": { iata: "ARK", hasOwnAirport: false, nearestCity: "Arusha", nearestCountry: "Tanzania", distanceKm: 180 },
  "masai mara": { iata: "NBO", hasOwnAirport: false, nearestCity: "Nairobi", nearestCountry: "Kenya", distanceKm: 270 },
  // South America
  "iguazu": { iata: "IGR", hasOwnAirport: true },
  "iguazu falls": { iata: "IGR", hasOwnAirport: true },
  "galapagos": { iata: "GPS", hasOwnAirport: true },
  "patagonia": { iata: "FTE", hasOwnAirport: false, nearestCity: "El Calafate", nearestCountry: "Argentina", distanceKm: 0 },
  // Regions handled as cities
  "kerala": { iata: "COK", hasOwnAirport: false, nearestCity: "Kochi", nearestCountry: "India", distanceKm: 0 },
  "rajasthan": { iata: "JAI", hasOwnAirport: false, nearestCity: "Jaipur", nearestCountry: "India", distanceKm: 0 },
};

/* -------------------------------------------------------------------------- */
/*  Merged map (single source of truth for both backend and frontend).        */
/* -------------------------------------------------------------------------- */
export const DESTINATION_AIRPORTS: Record<string, AirportInfo> = (() => {
  const merged: Record<string, AirportInfo> = {};
  for (const [k, v] of Object.entries(SIMPLE)) {
    merged[k] = { iata: v, hasOwnAirport: true };
  }
  // VIA_HUB overrides any SIMPLE entry for the same key.
  for (const [k, v] of Object.entries(VIA_HUB)) {
    merged[k] = v;
  }
  return merged;
})();

/* -------------------------------------------------------------------------- */
/*  Normalizer + resolver.                                                    */
/* -------------------------------------------------------------------------- */
function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (Latin accents + Greek tonos)
    .toLowerCase()
    .trim()
    .replace(/,\s*[\p{L}\s.-]+$/u, "") // strip ", Country" (any script)
    .replace(/\s+(airport|international|intl)$/i, "")
    .trim();
}

/**
 * Resolve a free-form destination string (e.g. "Cappadocia, Turkey",
 * "Paris (CDG)", "amalfi coast") to an AirportInfo.
 *
 * Returns null if nothing can be matched.
 */
export function resolveAirport(name: string | undefined | null): AirportInfo | null {
  if (!name) return null;
  const raw = String(name).trim();
  if (!raw) return null;

  // 1) Already an IATA code? ("ATH" or "athens (ATH)")
  if (/^[A-Z]{3}$/.test(raw.toUpperCase())) {
    return { iata: raw.toUpperCase(), hasOwnAirport: true };
  }
  const parenMatch = raw.match(/\(([A-Z]{3})\)/) || raw.match(/[-–]\s*([A-Z]{3})$/);
  if (parenMatch) {
    return { iata: parenMatch[1], hasOwnAirport: true };
  }

  // Localized names (e.g. Greek "Ρώμη", German "Mailand") won't match the
  // English-keyed maps below, so normalize to canonical English first. Falls
  // back to the original string when no translation is known.
  const english = normalizeDestinationToEnglish(raw);
  const lower = english.toLowerCase().trim();
  const cleaned = normalize(english);

  // 2) Exact match (cleaned or raw lowercased)
  if (DESTINATION_AIRPORTS[cleaned]) return DESTINATION_AIRPORTS[cleaned];
  if (DESTINATION_AIRPORTS[lower]) return DESTINATION_AIRPORTS[lower];

  // 3) Substring matches against keys
  for (const [city, info] of Object.entries(DESTINATION_AIRPORTS)) {
    if (cleaned.includes(city) || city.includes(cleaned)) return info;
  }
  for (const [city, info] of Object.entries(DESTINATION_AIRPORTS)) {
    if (lower.includes(city)) return info;
  }

  // 4) Fallback to AIRPORTS dataset (1000+ airports by city/name)
  const byCity = AIRPORTS.find(
    (a) => a.city.toLowerCase() === cleaned || a.city.toLowerCase() === lower
  );
  if (byCity) return { iata: byCity.code, hasOwnAirport: true };

  const partial = AIRPORTS.find(
    (a) =>
      cleaned.includes(a.city.toLowerCase()) ||
      a.city.toLowerCase().includes(cleaned) ||
      a.name.toLowerCase().includes(cleaned)
  );
  if (partial) return { iata: partial.code, hasOwnAirport: true };

  return null;
}

/** Convenience: just the IATA code, "" if unresolved. */
export function resolveIATA(name: string | undefined | null): string {
  return resolveAirport(name)?.iata ?? "";
}
