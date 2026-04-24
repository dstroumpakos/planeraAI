/**
 * WorldPrint — canonical city database for the globe.
 *
 * Each city has a stable `id` that is used across quests and user visits.
 * Coordinates are approximate city centers (good enough for globe rendering).
 */

export type WorldCity = {
  id: string; // stable slug, e.g. "paris-fr"
  name: string;
  country: string;
  countryCode: string; // ISO 3166-1 alpha-2
  region: string; // macro-region for filtering (europe, asia, americas, etc.)
  lat: number;
  lng: number;
  // Optional: common alternate names / translations to help matching trips
  aliases?: string[];
};

export const WORLD_CITIES: WorldCity[] = [
  // ---- Europe ----
  { id: "london-gb", name: "London", country: "United Kingdom", countryCode: "GB", region: "europe", lat: 51.5074, lng: -0.1278, aliases: ["london uk", "londres"] },
  { id: "paris-fr", name: "Paris", country: "France", countryCode: "FR", region: "europe", lat: 48.8566, lng: 2.3522 },
  { id: "rome-it", name: "Rome", country: "Italy", countryCode: "IT", region: "europe", lat: 41.9028, lng: 12.4964, aliases: ["roma"] },
  { id: "madrid-es", name: "Madrid", country: "Spain", countryCode: "ES", region: "europe", lat: 40.4168, lng: -3.7038 },
  { id: "barcelona-es", name: "Barcelona", country: "Spain", countryCode: "ES", region: "europe", lat: 41.3851, lng: 2.1734 },
  { id: "lisbon-pt", name: "Lisbon", country: "Portugal", countryCode: "PT", region: "europe", lat: 38.7223, lng: -9.1393, aliases: ["lisboa"] },
  { id: "porto-pt", name: "Porto", country: "Portugal", countryCode: "PT", region: "europe", lat: 41.1579, lng: -8.6291 },
  { id: "berlin-de", name: "Berlin", country: "Germany", countryCode: "DE", region: "europe", lat: 52.5200, lng: 13.4050 },
  { id: "munich-de", name: "Munich", country: "Germany", countryCode: "DE", region: "europe", lat: 48.1351, lng: 11.5820, aliases: ["münchen"] },
  { id: "amsterdam-nl", name: "Amsterdam", country: "Netherlands", countryCode: "NL", region: "europe", lat: 52.3676, lng: 4.9041 },
  { id: "brussels-be", name: "Brussels", country: "Belgium", countryCode: "BE", region: "europe", lat: 50.8503, lng: 4.3517 },
  { id: "vienna-at", name: "Vienna", country: "Austria", countryCode: "AT", region: "europe", lat: 48.2082, lng: 16.3738, aliases: ["wien"] },
  { id: "prague-cz", name: "Prague", country: "Czech Republic", countryCode: "CZ", region: "europe", lat: 50.0755, lng: 14.4378, aliases: ["praha"] },
  { id: "budapest-hu", name: "Budapest", country: "Hungary", countryCode: "HU", region: "europe", lat: 47.4979, lng: 19.0402 },
  { id: "warsaw-pl", name: "Warsaw", country: "Poland", countryCode: "PL", region: "europe", lat: 52.2297, lng: 21.0122, aliases: ["warszawa"] },
  { id: "krakow-pl", name: "Kraków", country: "Poland", countryCode: "PL", region: "europe", lat: 50.0647, lng: 19.9450, aliases: ["krakow"] },
  { id: "athens-gr", name: "Athens", country: "Greece", countryCode: "GR", region: "europe", lat: 37.9838, lng: 23.7275, aliases: ["athina"] },
  { id: "santorini-gr", name: "Santorini", country: "Greece", countryCode: "GR", region: "europe", lat: 36.3932, lng: 25.4615 },
  { id: "mykonos-gr", name: "Mykonos", country: "Greece", countryCode: "GR", region: "europe", lat: 37.4467, lng: 25.3289 },
  { id: "thessaloniki-gr", name: "Thessaloniki", country: "Greece", countryCode: "GR", region: "europe", lat: 40.6401, lng: 22.9444 },
  { id: "istanbul-tr", name: "Istanbul", country: "Turkey", countryCode: "TR", region: "europe", lat: 41.0082, lng: 28.9784 },
  { id: "dublin-ie", name: "Dublin", country: "Ireland", countryCode: "IE", region: "europe", lat: 53.3498, lng: -6.2603 },
  { id: "edinburgh-gb", name: "Edinburgh", country: "United Kingdom", countryCode: "GB", region: "europe", lat: 55.9533, lng: -3.1883 },
  { id: "copenhagen-dk", name: "Copenhagen", country: "Denmark", countryCode: "DK", region: "europe", lat: 55.6761, lng: 12.5683, aliases: ["københavn"] },
  { id: "stockholm-se", name: "Stockholm", country: "Sweden", countryCode: "SE", region: "europe", lat: 59.3293, lng: 18.0686 },
  { id: "oslo-no", name: "Oslo", country: "Norway", countryCode: "NO", region: "europe", lat: 59.9139, lng: 10.7522 },
  { id: "helsinki-fi", name: "Helsinki", country: "Finland", countryCode: "FI", region: "europe", lat: 60.1699, lng: 24.9384 },
  { id: "reykjavik-is", name: "Reykjavík", country: "Iceland", countryCode: "IS", region: "europe", lat: 64.1466, lng: -21.9426, aliases: ["reykjavik"] },
  { id: "zurich-ch", name: "Zurich", country: "Switzerland", countryCode: "CH", region: "europe", lat: 47.3769, lng: 8.5417, aliases: ["zürich"] },
  { id: "geneva-ch", name: "Geneva", country: "Switzerland", countryCode: "CH", region: "europe", lat: 46.2044, lng: 6.1432, aliases: ["genève"] },
  { id: "milan-it", name: "Milan", country: "Italy", countryCode: "IT", region: "europe", lat: 45.4642, lng: 9.1900, aliases: ["milano"] },
  { id: "venice-it", name: "Venice", country: "Italy", countryCode: "IT", region: "europe", lat: 45.4408, lng: 12.3155, aliases: ["venezia"] },
  { id: "florence-it", name: "Florence", country: "Italy", countryCode: "IT", region: "europe", lat: 43.7696, lng: 11.2558, aliases: ["firenze"] },
  { id: "naples-it", name: "Naples", country: "Italy", countryCode: "IT", region: "europe", lat: 40.8518, lng: 14.2681, aliases: ["napoli"] },
  { id: "seville-es", name: "Seville", country: "Spain", countryCode: "ES", region: "europe", lat: 37.3891, lng: -5.9845, aliases: ["sevilla"] },
  { id: "valencia-es", name: "Valencia", country: "Spain", countryCode: "ES", region: "europe", lat: 39.4699, lng: -0.3763 },
  { id: "nice-fr", name: "Nice", country: "France", countryCode: "FR", region: "europe", lat: 43.7102, lng: 7.2620 },
  { id: "marseille-fr", name: "Marseille", country: "France", countryCode: "FR", region: "europe", lat: 43.2965, lng: 5.3698 },
  { id: "lyon-fr", name: "Lyon", country: "France", countryCode: "FR", region: "europe", lat: 45.7640, lng: 4.8357 },
  { id: "dubrovnik-hr", name: "Dubrovnik", country: "Croatia", countryCode: "HR", region: "europe", lat: 42.6507, lng: 18.0944 },
  { id: "split-hr", name: "Split", country: "Croatia", countryCode: "HR", region: "europe", lat: 43.5081, lng: 16.4402 },
  { id: "zagreb-hr", name: "Zagreb", country: "Croatia", countryCode: "HR", region: "europe", lat: 45.8150, lng: 15.9819 },
  { id: "ljubljana-si", name: "Ljubljana", country: "Slovenia", countryCode: "SI", region: "europe", lat: 46.0569, lng: 14.5058 },
  { id: "sofia-bg", name: "Sofia", country: "Bulgaria", countryCode: "BG", region: "europe", lat: 42.6977, lng: 23.3219 },
  { id: "bucharest-ro", name: "Bucharest", country: "Romania", countryCode: "RO", region: "europe", lat: 44.4268, lng: 26.1025, aliases: ["bucurești"] },
  { id: "belgrade-rs", name: "Belgrade", country: "Serbia", countryCode: "RS", region: "europe", lat: 44.7866, lng: 20.4489, aliases: ["beograd"] },
  { id: "tirana-al", name: "Tirana", country: "Albania", countryCode: "AL", region: "europe", lat: 41.3275, lng: 19.8187, aliases: ["tiranë"] },
  { id: "malta-mt", name: "Valletta", country: "Malta", countryCode: "MT", region: "europe", lat: 35.8997, lng: 14.5147 },
  { id: "nicosia-cy", name: "Nicosia", country: "Cyprus", countryCode: "CY", region: "europe", lat: 35.1856, lng: 33.3823 },

  // ---- Americas ----
  { id: "nyc-us", name: "New York", country: "United States", countryCode: "US", region: "americas", lat: 40.7128, lng: -74.0060, aliases: ["new york city", "nyc"] },
  { id: "la-us", name: "Los Angeles", country: "United States", countryCode: "US", region: "americas", lat: 34.0522, lng: -118.2437, aliases: ["los angeles"] },
  { id: "sf-us", name: "San Francisco", country: "United States", countryCode: "US", region: "americas", lat: 37.7749, lng: -122.4194 },
  { id: "chicago-us", name: "Chicago", country: "United States", countryCode: "US", region: "americas", lat: 41.8781, lng: -87.6298 },
  { id: "miami-us", name: "Miami", country: "United States", countryCode: "US", region: "americas", lat: 25.7617, lng: -80.1918 },
  { id: "seattle-us", name: "Seattle", country: "United States", countryCode: "US", region: "americas", lat: 47.6062, lng: -122.3321 },
  { id: "boston-us", name: "Boston", country: "United States", countryCode: "US", region: "americas", lat: 42.3601, lng: -71.0589 },
  { id: "dc-us", name: "Washington", country: "United States", countryCode: "US", region: "americas", lat: 38.9072, lng: -77.0369, aliases: ["washington dc", "washington d.c."] },
  { id: "vegas-us", name: "Las Vegas", country: "United States", countryCode: "US", region: "americas", lat: 36.1699, lng: -115.1398 },
  { id: "neworleans-us", name: "New Orleans", country: "United States", countryCode: "US", region: "americas", lat: 29.9511, lng: -90.0715 },
  { id: "honolulu-us", name: "Honolulu", country: "United States", countryCode: "US", region: "americas", lat: 21.3099, lng: -157.8581, aliases: ["hawaii"] },
  { id: "toronto-ca", name: "Toronto", country: "Canada", countryCode: "CA", region: "americas", lat: 43.6532, lng: -79.3832 },
  { id: "vancouver-ca", name: "Vancouver", country: "Canada", countryCode: "CA", region: "americas", lat: 49.2827, lng: -123.1207 },
  { id: "montreal-ca", name: "Montréal", country: "Canada", countryCode: "CA", region: "americas", lat: 45.5019, lng: -73.5674, aliases: ["montreal"] },
  { id: "mexicocity-mx", name: "Mexico City", country: "Mexico", countryCode: "MX", region: "americas", lat: 19.4326, lng: -99.1332, aliases: ["cdmx", "ciudad de méxico"] },
  { id: "cancun-mx", name: "Cancún", country: "Mexico", countryCode: "MX", region: "americas", lat: 21.1619, lng: -86.8515, aliases: ["cancun"] },
  { id: "tulum-mx", name: "Tulum", country: "Mexico", countryCode: "MX", region: "americas", lat: 20.2114, lng: -87.4654 },
  { id: "oaxaca-mx", name: "Oaxaca", country: "Mexico", countryCode: "MX", region: "americas", lat: 17.0732, lng: -96.7266 },
  { id: "havana-cu", name: "Havana", country: "Cuba", countryCode: "CU", region: "americas", lat: 23.1136, lng: -82.3666, aliases: ["la habana"] },
  { id: "sanjuan-pr", name: "San Juan", country: "Puerto Rico", countryCode: "PR", region: "americas", lat: 18.4655, lng: -66.1057 },
  { id: "rio-br", name: "Rio de Janeiro", country: "Brazil", countryCode: "BR", region: "americas", lat: -22.9068, lng: -43.1729, aliases: ["rio"] },
  { id: "saopaulo-br", name: "São Paulo", country: "Brazil", countryCode: "BR", region: "americas", lat: -23.5505, lng: -46.6333, aliases: ["sao paulo"] },
  { id: "buenosaires-ar", name: "Buenos Aires", country: "Argentina", countryCode: "AR", region: "americas", lat: -34.6037, lng: -58.3816 },
  { id: "santiago-cl", name: "Santiago", country: "Chile", countryCode: "CL", region: "americas", lat: -33.4489, lng: -70.6693 },
  { id: "lima-pe", name: "Lima", country: "Peru", countryCode: "PE", region: "americas", lat: -12.0464, lng: -77.0428 },
  { id: "cusco-pe", name: "Cusco", country: "Peru", countryCode: "PE", region: "americas", lat: -13.5319, lng: -71.9675, aliases: ["cuzco"] },
  { id: "bogota-co", name: "Bogotá", country: "Colombia", countryCode: "CO", region: "americas", lat: 4.7110, lng: -74.0721, aliases: ["bogota"] },
  { id: "cartagena-co", name: "Cartagena", country: "Colombia", countryCode: "CO", region: "americas", lat: 10.3910, lng: -75.4794 },
  { id: "quito-ec", name: "Quito", country: "Ecuador", countryCode: "EC", region: "americas", lat: -0.1807, lng: -78.4678 },

  // ---- Asia ----
  { id: "tokyo-jp", name: "Tokyo", country: "Japan", countryCode: "JP", region: "asia", lat: 35.6762, lng: 139.6503, aliases: ["東京"] },
  { id: "kyoto-jp", name: "Kyoto", country: "Japan", countryCode: "JP", region: "asia", lat: 35.0116, lng: 135.7681 },
  { id: "osaka-jp", name: "Osaka", country: "Japan", countryCode: "JP", region: "asia", lat: 34.6937, lng: 135.5023 },
  { id: "seoul-kr", name: "Seoul", country: "South Korea", countryCode: "KR", region: "asia", lat: 37.5665, lng: 126.9780 },
  { id: "busan-kr", name: "Busan", country: "South Korea", countryCode: "KR", region: "asia", lat: 35.1796, lng: 129.0756 },
  { id: "beijing-cn", name: "Beijing", country: "China", countryCode: "CN", region: "asia", lat: 39.9042, lng: 116.4074, aliases: ["北京"] },
  { id: "shanghai-cn", name: "Shanghai", country: "China", countryCode: "CN", region: "asia", lat: 31.2304, lng: 121.4737 },
  { id: "hongkong-hk", name: "Hong Kong", country: "Hong Kong", countryCode: "HK", region: "asia", lat: 22.3193, lng: 114.1694 },
  { id: "taipei-tw", name: "Taipei", country: "Taiwan", countryCode: "TW", region: "asia", lat: 25.0330, lng: 121.5654 },
  { id: "singapore-sg", name: "Singapore", country: "Singapore", countryCode: "SG", region: "asia", lat: 1.3521, lng: 103.8198 },
  { id: "bangkok-th", name: "Bangkok", country: "Thailand", countryCode: "TH", region: "asia", lat: 13.7563, lng: 100.5018 },
  { id: "chiangmai-th", name: "Chiang Mai", country: "Thailand", countryCode: "TH", region: "asia", lat: 18.7883, lng: 98.9853 },
  { id: "phuket-th", name: "Phuket", country: "Thailand", countryCode: "TH", region: "asia", lat: 7.8804, lng: 98.3923 },
  { id: "hanoi-vn", name: "Hanoi", country: "Vietnam", countryCode: "VN", region: "asia", lat: 21.0285, lng: 105.8542, aliases: ["hà nội"] },
  { id: "hcmc-vn", name: "Ho Chi Minh City", country: "Vietnam", countryCode: "VN", region: "asia", lat: 10.8231, lng: 106.6297, aliases: ["saigon"] },
  { id: "kualalumpur-my", name: "Kuala Lumpur", country: "Malaysia", countryCode: "MY", region: "asia", lat: 3.1390, lng: 101.6869 },
  { id: "jakarta-id", name: "Jakarta", country: "Indonesia", countryCode: "ID", region: "asia", lat: -6.2088, lng: 106.8456 },
  { id: "bali-id", name: "Bali", country: "Indonesia", countryCode: "ID", region: "asia", lat: -8.3405, lng: 115.0920, aliases: ["denpasar", "ubud"] },
  { id: "manila-ph", name: "Manila", country: "Philippines", countryCode: "PH", region: "asia", lat: 14.5995, lng: 120.9842 },
  { id: "delhi-in", name: "Delhi", country: "India", countryCode: "IN", region: "asia", lat: 28.6139, lng: 77.2090, aliases: ["new delhi"] },
  { id: "mumbai-in", name: "Mumbai", country: "India", countryCode: "IN", region: "asia", lat: 19.0760, lng: 72.8777 },
  { id: "jaipur-in", name: "Jaipur", country: "India", countryCode: "IN", region: "asia", lat: 26.9124, lng: 75.7873 },
  { id: "agra-in", name: "Agra", country: "India", countryCode: "IN", region: "asia", lat: 27.1767, lng: 78.0081 },
  { id: "goa-in", name: "Goa", country: "India", countryCode: "IN", region: "asia", lat: 15.2993, lng: 74.1240 },
  { id: "colombo-lk", name: "Colombo", country: "Sri Lanka", countryCode: "LK", region: "asia", lat: 6.9271, lng: 79.8612 },
  { id: "kathmandu-np", name: "Kathmandu", country: "Nepal", countryCode: "NP", region: "asia", lat: 27.7172, lng: 85.3240 },

  // ---- Middle East ----
  { id: "dubai-ae", name: "Dubai", country: "United Arab Emirates", countryCode: "AE", region: "middle-east", lat: 25.2048, lng: 55.2708 },
  { id: "abudhabi-ae", name: "Abu Dhabi", country: "United Arab Emirates", countryCode: "AE", region: "middle-east", lat: 24.4539, lng: 54.3773 },
  { id: "doha-qa", name: "Doha", country: "Qatar", countryCode: "QA", region: "middle-east", lat: 25.2854, lng: 51.5310 },
  { id: "riyadh-sa", name: "Riyadh", country: "Saudi Arabia", countryCode: "SA", region: "middle-east", lat: 24.7136, lng: 46.6753 },
  { id: "amman-jo", name: "Amman", country: "Jordan", countryCode: "JO", region: "middle-east", lat: 31.9454, lng: 35.9284 },
  { id: "petra-jo", name: "Petra", country: "Jordan", countryCode: "JO", region: "middle-east", lat: 30.3285, lng: 35.4444 },
  { id: "telaviv-il", name: "Tel Aviv", country: "Israel", countryCode: "IL", region: "middle-east", lat: 32.0853, lng: 34.7818 },
  { id: "jerusalem-il", name: "Jerusalem", country: "Israel", countryCode: "IL", region: "middle-east", lat: 31.7683, lng: 35.2137 },
  { id: "beirut-lb", name: "Beirut", country: "Lebanon", countryCode: "LB", region: "middle-east", lat: 33.8938, lng: 35.5018 },
  { id: "muscat-om", name: "Muscat", country: "Oman", countryCode: "OM", region: "middle-east", lat: 23.5880, lng: 58.3829 },

  // ---- Africa ----
  { id: "cairo-eg", name: "Cairo", country: "Egypt", countryCode: "EG", region: "africa", lat: 30.0444, lng: 31.2357 },
  { id: "luxor-eg", name: "Luxor", country: "Egypt", countryCode: "EG", region: "africa", lat: 25.6872, lng: 32.6396 },
  { id: "marrakech-ma", name: "Marrakech", country: "Morocco", countryCode: "MA", region: "africa", lat: 31.6295, lng: -7.9811, aliases: ["marrakesh"] },
  { id: "casablanca-ma", name: "Casablanca", country: "Morocco", countryCode: "MA", region: "africa", lat: 33.5731, lng: -7.5898 },
  { id: "fes-ma", name: "Fes", country: "Morocco", countryCode: "MA", region: "africa", lat: 34.0181, lng: -5.0078, aliases: ["fez"] },
  { id: "capetown-za", name: "Cape Town", country: "South Africa", countryCode: "ZA", region: "africa", lat: -33.9249, lng: 18.4241 },
  { id: "johannesburg-za", name: "Johannesburg", country: "South Africa", countryCode: "ZA", region: "africa", lat: -26.2041, lng: 28.0473 },
  { id: "nairobi-ke", name: "Nairobi", country: "Kenya", countryCode: "KE", region: "africa", lat: -1.2921, lng: 36.8219 },
  { id: "zanzibar-tz", name: "Zanzibar", country: "Tanzania", countryCode: "TZ", region: "africa", lat: -6.1659, lng: 39.2026 },
  { id: "addisababa-et", name: "Addis Ababa", country: "Ethiopia", countryCode: "ET", region: "africa", lat: 9.0320, lng: 38.7469 },
  { id: "lagos-ng", name: "Lagos", country: "Nigeria", countryCode: "NG", region: "africa", lat: 6.5244, lng: 3.3792 },
  { id: "accra-gh", name: "Accra", country: "Ghana", countryCode: "GH", region: "africa", lat: 5.6037, lng: -0.1870 },
  { id: "tunis-tn", name: "Tunis", country: "Tunisia", countryCode: "TN", region: "africa", lat: 36.8065, lng: 10.1815 },

  // ---- Oceania ----
  { id: "sydney-au", name: "Sydney", country: "Australia", countryCode: "AU", region: "oceania", lat: -33.8688, lng: 151.2093 },
  { id: "melbourne-au", name: "Melbourne", country: "Australia", countryCode: "AU", region: "oceania", lat: -37.8136, lng: 144.9631 },
  { id: "brisbane-au", name: "Brisbane", country: "Australia", countryCode: "AU", region: "oceania", lat: -27.4698, lng: 153.0251 },
  { id: "perth-au", name: "Perth", country: "Australia", countryCode: "AU", region: "oceania", lat: -31.9505, lng: 115.8605 },
  { id: "auckland-nz", name: "Auckland", country: "New Zealand", countryCode: "NZ", region: "oceania", lat: -36.8485, lng: 174.7633 },
  { id: "queenstown-nz", name: "Queenstown", country: "New Zealand", countryCode: "NZ", region: "oceania", lat: -45.0312, lng: 168.6626 },
  { id: "nadi-fj", name: "Nadi", country: "Fiji", countryCode: "FJ", region: "oceania", lat: -17.7765, lng: 177.4356 },
];

// ---- Lookup helpers ----

const BY_ID: Record<string, WorldCity> = {};
for (const c of WORLD_CITIES) BY_ID[c.id] = c;

export function getCityById(id: string): WorldCity | undefined {
  return BY_ID[id];
}

/**
 * Best-effort fuzzy match of a destination string (e.g. "Paris, France") to a
 * city in our catalog. Returns null if no confident match.
 */
export function matchCityFromDestination(destination: string): WorldCity | null {
  if (!destination) return null;
  const normalized = destination
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics

  // Tokens: "paris, france" -> ["paris", "france"]
  const tokens = normalized.split(/[,;\-/|]/).map((s) => s.trim()).filter(Boolean);
  const firstToken = tokens[0] || normalized;

  // First pass: exact name or alias match on first token
  for (const city of WORLD_CITIES) {
    const cityName = city.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (cityName === firstToken) return city;
    if (city.aliases?.some((a) => a === firstToken)) return city;
  }

  // Second pass: contains match
  for (const city of WORLD_CITIES) {
    const cityName = city.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalized.includes(cityName)) return city;
    if (city.aliases?.some((a) => normalized.includes(a))) return city;
  }

  return null;
}

/**
 * All cities in a given region.
 */
export function getCitiesByRegion(region: string): WorldCity[] {
  return WORLD_CITIES.filter((c) => c.region === region);
}

/**
 * All unique country codes from visits.
 */
export function countriesFromVisits(cityIds: string[]): string[] {
  const codes = new Set<string>();
  for (const id of cityIds) {
    const c = BY_ID[id];
    if (c) codes.add(c.countryCode);
  }
  return Array.from(codes);
}
