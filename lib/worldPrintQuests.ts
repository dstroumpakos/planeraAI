/**
 * WorldPrint — quest catalog.
 *
 * Quests are static, hand-curated configurations. Progress is computed per-user
 * on the fly from their verified visits — not stored as a separate table.
 *
 * Completion unlocks rewards (Pro days) tracked on the user's WorldPrint profile.
 */

import { WORLD_CITIES } from "./worldCities";

export type QuestTier = "bronze" | "silver" | "gold" | "legendary";

export type Quest = {
  id: string;
  name: string; // translation key: worldprint.quests.<id>.name
  descriptionKey: string; // worldprint.quests.<id>.description
  emoji: string;
  tier: QuestTier;
  cityIds: string[]; // Must be valid IDs from WORLD_CITIES
  /**
   * Cosmetic / status rewards only — NEVER subscription-equivalent value.
   * (Apple App Store Review Guideline 3.1.1 — IAP bypass rules.)
   *
   * - badge: emoji badge pinned to profile
   * - title: optional status title (cosmetic)
   * - globeSkin: optional cosmetic globe texture / aurora unlock
   * - expeditionId: optional exclusive itinerary template unlocked
   */
  reward: {
    badge: string;
    title?: string;
    globeSkin?: string;
    expeditionId?: string;
  };
  color: string; // aurora color shown on the globe when completed
};

export const WORLDPRINT_QUESTS: Quest[] = [
  // ---- Bronze (entry-level, 3 cities) ----
  {
    id: "iberian-trio",
    name: "Iberian Trio",
    descriptionKey: "Taste the soul of Iberia — Lisbon, Madrid, Barcelona.",
    emoji: "🍷",
    tier: "bronze",
    cityIds: ["lisbon-pt", "madrid-es", "barcelona-es"],
    reward: { badge: "🥖" },
    color: "#E8804A",
  },
  {
    id: "alpine-triangle",
    name: "Alpine Triangle",
    descriptionKey: "Three Alpine capitals — Zurich, Munich, Vienna.",
    emoji: "🏔️",
    tier: "bronze",
    cityIds: ["zurich-ch", "munich-de", "vienna-at"],
    reward: { badge: "❄️" },
    color: "#7EC8E3",
  },
  {
    id: "emerald-isles",
    name: "Emerald Isles",
    descriptionKey: "Dublin, Edinburgh, London — the storyteller's circuit.",
    emoji: "☘️",
    tier: "bronze",
    cityIds: ["dublin-ie", "edinburgh-gb", "london-gb"],
    reward: { badge: "🍀" },
    color: "#4ADE80",
  },
  {
    id: "italian-classic",
    name: "Italian Classic",
    descriptionKey: "Rome, Florence, Venice — la dolce vita, three acts.",
    emoji: "🇮🇹",
    tier: "bronze",
    cityIds: ["rome-it", "florence-it", "venice-it"],
    reward: { badge: "🍝" },
    color: "#EF4444",
  },
  {
    id: "aegean-arc",
    name: "Aegean Arc",
    descriptionKey: "Athens, Santorini, Mykonos — sunset on the wine-dark sea.",
    emoji: "🏛️",
    tier: "bronze",
    cityIds: ["athens-gr", "santorini-gr", "mykonos-gr"],
    reward: { badge: "🐚" },
    color: "#60A5FA",
  },

  // ---- Silver (mid-tier, 4-5 cities) ----
  {
    id: "nordic-crown",
    name: "Nordic Crown",
    descriptionKey: "Five capitals of the north. The aurora calls.",
    emoji: "👑",
    tier: "silver",
    cityIds: ["copenhagen-dk", "stockholm-se", "oslo-no", "helsinki-fi", "reykjavik-is"],
    reward: { badge: "🧊", title: "Aurora Chaser", globeSkin: "aurora" },
    color: "#A78BFA",
  },
  {
    id: "benelux-run",
    name: "Benelux Run",
    descriptionKey: "Amsterdam, Brussels, Paris, Berlin — four cities, one week.",
    emoji: "🚆",
    tier: "silver",
    cityIds: ["amsterdam-nl", "brussels-be", "paris-fr", "berlin-de"],
    reward: { badge: "🚉" },
    color: "#F59E0B",
  },
  {
    id: "balkan-sweep",
    name: "Balkan Sweep",
    descriptionKey: "Belgrade, Sofia, Tirana, Athens — through the beating heart of the Balkans.",
    emoji: "🌄",
    tier: "silver",
    cityIds: ["belgrade-rs", "sofia-bg", "tirana-al", "athens-gr"],
    reward: { badge: "⛰️" },
    color: "#EC4899",
  },
  {
    id: "iberia-deluxe",
    name: "Iberia Deluxe",
    descriptionKey: "Porto, Lisbon, Seville, Madrid, Barcelona — the long way around.",
    emoji: "🌅",
    tier: "silver",
    cityIds: ["porto-pt", "lisbon-pt", "seville-es", "madrid-es", "barcelona-es"],
    reward: { badge: "🥐" },
    color: "#F97316",
  },

  // ---- Gold (ambitious, 5-7 cities) ----
  {
    id: "mediterranean-ring",
    name: "Mediterranean Ring",
    descriptionKey: "Six cities circling the Mediterranean, a single arc of sunlight.",
    emoji: "☀️",
    tier: "gold",
    cityIds: ["barcelona-es", "marseille-fr", "rome-it", "athens-gr", "istanbul-tr", "marrakech-ma"],
    reward: { badge: "🌊", title: "Mediterranean", globeSkin: "mediterranean" },
    color: "#06B6D4",
  },
  {
    id: "silk-road",
    name: "Silk Road",
    descriptionKey: "Istanbul to Tokyo — the old road, the new world.",
    emoji: "🐪",
    tier: "gold",
    cityIds: ["istanbul-tr", "dubai-ae", "delhi-in", "bangkok-th", "shanghai-cn", "tokyo-jp"],
    reward: { badge: "🏯", title: "Silk Traveler", globeSkin: "silk" },
    color: "#D97706",
  },
  {
    id: "capitals-europe",
    name: "Capitals of Europe",
    descriptionKey: "Seven European capitals. The classic grand tour.",
    emoji: "🏰",
    tier: "gold",
    cityIds: ["london-gb", "paris-fr", "madrid-es", "rome-it", "berlin-de", "vienna-at", "athens-gr"],
    reward: { badge: "👑", title: "Grand Tourist" },
    color: "#8B5CF6",
  },
  {
    id: "southeast-asia-sweep",
    name: "Southeast Asia Sweep",
    descriptionKey: "Bangkok, Hanoi, Bali, Singapore, Kuala Lumpur — the long, warm road.",
    emoji: "🌴",
    tier: "gold",
    cityIds: ["bangkok-th", "hanoi-vn", "bali-id", "singapore-sg", "kualalumpur-my"],
    reward: { badge: "🌺", title: "Tropical" },
    color: "#10B981",
  },
  {
    id: "coastal-americas",
    name: "Coastal Americas",
    descriptionKey: "Pacific coast, top to bottom — Vancouver to Santiago.",
    emoji: "🌊",
    tier: "gold",
    cityIds: ["vancouver-ca", "sf-us", "la-us", "mexicocity-mx", "lima-pe", "santiago-cl"],
    reward: { badge: "🏄", title: "Coastal" },
    color: "#0EA5E9",
  },

  // ---- Legendary (lifelong quests) ----
  {
    id: "seven-continents",
    name: "Seven Continents",
    descriptionKey: "Step foot on every continent. The rarest of travelers.",
    emoji: "🌍",
    tier: "legendary",
    // One landmark city per continent — Antarctica intentionally omitted (handled as special case if ever added)
    cityIds: [
      "paris-fr",       // Europe
      "nyc-us",         // North America
      "rio-br",         // South America
      "tokyo-jp",       // Asia
      "capetown-za",    // Africa
      "sydney-au",      // Oceania
    ],
    reward: { badge: "🌐", title: "Cartographer", globeSkin: "cartographer" },
    color: "#FBBF24",
  },
  {
    id: "great-capitals",
    name: "Great Capitals",
    descriptionKey: "Twelve of the world's most consequential capitals.",
    emoji: "🗽",
    tier: "legendary",
    cityIds: [
      "london-gb", "paris-fr", "berlin-de", "rome-it",
      "madrid-es", "athens-gr", "moscow-ru", "beijing-cn",
      "tokyo-jp", "delhi-in", "nyc-us", "cairo-eg",
    ].filter((id) => WORLD_CITIES.some((c) => c.id === id)),
    reward: { badge: "🏛️", title: "Diplomat" },
    color: "#F472B6",
  },
  {
    id: "wonder-circuit",
    name: "Wonders of the World",
    descriptionKey: "Petra, Rome, Agra, Cusco, Mexico City — legends in stone.",
    emoji: "🗿",
    tier: "legendary",
    cityIds: ["petra-jo", "rome-it", "agra-in", "cusco-pe", "mexicocity-mx"],
    reward: { badge: "🏛️", title: "Wonder-Seeker" },
    color: "#EAB308",
  },

  // ---- Theme / Vibe quests ----
  {
    id: "greek-islands",
    name: "Greek Islands Explorer",
    descriptionKey: "Three jewels of the Aegean.",
    emoji: "🏝️",
    tier: "bronze",
    cityIds: ["santorini-gr", "mykonos-gr", "athens-gr"],
    reward: { badge: "🌅" },
    color: "#38BDF8",
  },
  {
    id: "sakura-trail",
    name: "Sakura Trail",
    descriptionKey: "Tokyo, Kyoto, Osaka — follow the cherry blossoms.",
    emoji: "🌸",
    tier: "bronze",
    cityIds: ["tokyo-jp", "kyoto-jp", "osaka-jp"],
    reward: { badge: "🎎" },
    color: "#FB7185",
  },
  {
    id: "north-africa-ring",
    name: "North Africa Ring",
    descriptionKey: "Marrakech, Fes, Cairo, Luxor — deserts, souks, pyramids.",
    emoji: "🐫",
    tier: "silver",
    cityIds: ["marrakech-ma", "fes-ma", "cairo-eg", "luxor-eg"],
    reward: { badge: "🏜️" },
    color: "#F59E0B",
  },
];

// Validate all city IDs at module load (defensive — catches typos fast).
for (const q of WORLDPRINT_QUESTS) {
  for (const cityId of q.cityIds) {
    if (!WORLD_CITIES.some((c) => c.id === cityId)) {
      // eslint-disable-next-line no-console
      console.warn(`[WorldPrint quests] Unknown cityId "${cityId}" in quest "${q.id}"`);
    }
  }
}

export function getQuestById(id: string): Quest | undefined {
  return WORLDPRINT_QUESTS.find((q) => q.id === id);
}

/**
 * Compute progress for a quest given a set of verified city IDs.
 * Returns completion ratio, completed flag, and which cities are still missing.
 */
export function computeQuestProgress(quest: Quest, verifiedCityIds: Set<string>) {
  const completed = quest.cityIds.filter((id) => verifiedCityIds.has(id));
  const missing = quest.cityIds.filter((id) => !verifiedCityIds.has(id));
  return {
    questId: quest.id,
    completedCount: completed.length,
    totalCount: quest.cityIds.length,
    isComplete: missing.length === 0,
    progress: completed.length / quest.cityIds.length,
    missingCityIds: missing,
    completedCityIds: completed,
  };
}

// ---- Signature color palette (24 distinct hues) ----
// Deterministically assigned to each user based on their userId hash.

export const SIGNATURE_COLORS: { id: string; hex: string; name: string }[] = [
  { id: "amber",    hex: "#F59E0B", name: "Amber" },
  { id: "rose",     hex: "#F43F5E", name: "Rose" },
  { id: "violet",   hex: "#8B5CF6", name: "Violet" },
  { id: "sky",      hex: "#0EA5E9", name: "Sky" },
  { id: "emerald",  hex: "#10B981", name: "Emerald" },
  { id: "crimson",  hex: "#DC2626", name: "Crimson" },
  { id: "gold",     hex: "#FBBF24", name: "Gold" },
  { id: "mint",     hex: "#4ADE80", name: "Mint" },
  { id: "coral",    hex: "#FB7185", name: "Coral" },
  { id: "indigo",   hex: "#6366F1", name: "Indigo" },
  { id: "teal",     hex: "#14B8A6", name: "Teal" },
  { id: "magenta",  hex: "#D946EF", name: "Magenta" },
  { id: "ember",    hex: "#F97316", name: "Ember" },
  { id: "jade",     hex: "#059669", name: "Jade" },
  { id: "cyan",     hex: "#06B6D4", name: "Cyan" },
  { id: "plum",     hex: "#A21CAF", name: "Plum" },
  { id: "lime",     hex: "#84CC16", name: "Lime" },
  { id: "ocean",    hex: "#3B82F6", name: "Ocean" },
  { id: "peach",    hex: "#FDBA74", name: "Peach" },
  { id: "fuchsia",  hex: "#E879F9", name: "Fuchsia" },
  { id: "sunflower",hex: "#EAB308", name: "Sunflower" },
  { id: "azure",    hex: "#38BDF8", name: "Azure" },
  { id: "sakura",   hex: "#F9A8D4", name: "Sakura" },
  { id: "forest",   hex: "#16A34A", name: "Forest" },
];

export function deterministicSignatureColor(userId: string): string {
  // Simple, stable string hash (djb2)
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash) + userId.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  const idx = Math.abs(hash) % SIGNATURE_COLORS.length;
  return SIGNATURE_COLORS[idx].hex;
}
