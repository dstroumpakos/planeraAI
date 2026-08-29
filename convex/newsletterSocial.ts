/**
 * Newsletter → Instagram / TikTok slide decks.
 *
 * A campaign is already STRUCTURED content (heading, CTA, live Low-Fare Radar
 * deals), so the same record that renders an email can render a stack of
 * vertical social cards. This module turns a campaign into a "deck": an
 * ordered list of slides plus a ready-to-paste caption.
 *
 * It deliberately stops at DATA. The pixels are drawn by the website
 * (`/api/social/newsletter/*`), which owns fonts, layout and ffmpeg — Convex
 * has no canvas. Everything language-dependent is resolved here though, so the
 * renderer never re-implements price formatting or the price badges, and a
 * card can never claim something the email wouldn't.
 *
 * Photos: the cover reuses the SAME cached Unsplash hero as the email
 * (`imageCache`, keyed `hero:<city>`), so a destination looks identical across
 * the channels. Every LATER slide of the same place takes a different frame,
 * cached under its own social-only key — a campaign about one destination
 * would otherwise show the identical photo three slides running, which reads
 * as a broken renderer rather than as a set.
 */

import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { api as _api, internal as _internal } from "./_generated/api";
import { assertAdmin } from "./admin";
import {
  dealSocialCopy,
  destinationFocusFrom,
  destinationHeroCacheKey,
  heroSearchQuery,
  isCuratedHero,
  normalizeLang,
  pickTopDeals,
  queryCachedHeroByKey,
  queryDestinationHero,
  queryFeaturedDeals,
  queryCampaignRouteFares,
  routeFareToDeal,
  type DealForEmail,
  type DestinationFocus,
  type DestinationHero,
  type Lang,
} from "./newsletter";

// Cross-file internal/public references hit the type-inference wall until
// `convex dev` regenerates types — the same `as any` escape hatch the rest of
// the newsletter modules use. Results stay hand-annotated.
const internal = _internal as any;
const api = _api as any;

// A deck longer than this stops being a carousel and starts being a slideshow
// nobody swipes through. Instagram caps carousels at 20; we cap the deal run
// far below that on purpose.
const MAX_DEAL_SLIDES = 6;
const DEFAULT_DEAL_SLIDES = 3;

// Unsplash results get noticeably less on-topic past the first handful, so
// asking for more alternate frames than a deck can use just buys worse ones.
const MAX_PHOTO_VARIANTS = 8;

// ---------------------------------------------------------------------------
// Localized chrome
// ---------------------------------------------------------------------------

/**
 * Where the deck is going to be posted.
 *
 * The cards are the same pixels either way, but the ONE instruction a card
 * carries only works on one surface: a carousel is swiped, a story is tapped
 * (swiping there leaves for the next account), and a reel plays on its own.
 * Telling a story viewer to swipe — or a reel viewer to save "this post" — is
 * an ask that does nothing, so the prompts are chosen per surface.
 */
export type SocialSurface = "feed" | "story" | "reel";

/** The asks that change with the surface. Everything else reads the same. */
interface SurfaceLabels {
  /** Cover prompt when the deck carries more than one fare; "{n}" is the count. */
  swipeAll: string;
  /** Cover prompt for a single-fare deck. */
  swipe: string;
  /** Deal-card prompt: how a viewer reaches the link from HERE. */
  linkPrompt: string;
  /** End-card sub-line: where the link lives. */
  tapLink: string;
  /** End-card prompt: the ask that costs the viewer nothing. */
  savePost: string;
}

interface SocialLabels {
  /** Kicker above the route on a deal card. */
  liveFare: string;
  /** Cover kicker. */
  deals: string;
  /** Caption line introducing the deal list. */
  captionIntro: string;
  /** Photo credit prefix in the caption. */
  photos: string;
  /** Small print on every deal card. */
  pricesChange: string;
  /** End-card value props, three short lines. */
  bullets: string[];
  /** Caption opener — the only line Instagram shows before "more". */
  captionHook: string;
  /** Caption line asking for the save, the cheapest engagement there is. */
  captionSave: string;
  /** Prompts, per surface. */
  surfaces: Record<SocialSurface, SurfaceLabels>;
}

const LABELS: Record<Lang, SocialLabels> = {
  en: {
    liveFare: "Live fare",
    deals: "Flight deals",
    captionIntro: "Live fares right now:",
    photos: "Photos",
    pricesChange: "Fares change fast — checked today",
    bullets: [
      "Free AI trip planner",
      "Live fares, checked every day",
      "A full itinerary in 60 seconds",
    ],
    captionHook: "Cheap flights our radar found overnight ✈️",
    captionSave: "📌 Save this before the fares move.",
    surfaces: {
      feed: {
        swipeAll: "Swipe — {n} fares inside",
        swipe: "Swipe for the fare",
        linkPrompt: "Link in bio",
        tapLink: "Link in bio",
        savePost: "Save this post",
      },
      story: {
        swipeAll: "Tap through — {n} fares",
        swipe: "Tap for the fare",
        linkPrompt: "Tap the link",
        tapLink: "Link in this story",
        savePost: "Send it to your travel buddy",
      },
      reel: {
        swipeAll: "Watch — {n} fares",
        swipe: "Watch to the end",
        linkPrompt: "Link in bio",
        tapLink: "Link in bio",
        savePost: "Save this reel",
      },
    },
  },
  el: {
    liveFare: "Ζωντανή τιμή",
    deals: "Προσφορές πτήσεων",
    captionIntro: "Ζωντανές τιμές τώρα:",
    photos: "Φωτογραφίες",
    pricesChange: "Οι τιμές αλλάζουν γρήγορα — έλεγχος σήμερα",
    bullets: [
      "Δωρεάν AI σχεδιασμός ταξιδιού",
      "Ζωντανές τιμές, έλεγχος κάθε μέρα",
      "Πλήρες πρόγραμμα σε 60 δευτερόλεπτα",
    ],
    captionHook: "Φθηνά εισιτήρια που βρήκε το radar μας απόψε ✈️",
    captionSave: "📌 Αποθήκευσέ το πριν αλλάξουν οι τιμές.",
    surfaces: {
      feed: {
        swipeAll: "Swipe — {n} τιμές μέσα",
        swipe: "Swipe για την τιμή",
        linkPrompt: "Link στο bio",
        tapLink: "Link στο bio",
        savePost: "Αποθήκευσε το post",
      },
      story: {
        swipeAll: "Πάτα — {n} τιμές",
        swipe: "Πάτα για την τιμή",
        linkPrompt: "Πάτα το link",
        tapLink: "Link σε αυτό το story",
        savePost: "Στείλε το στην παρέα σου",
      },
      reel: {
        swipeAll: "Δες — {n} τιμές",
        swipe: "Δες μέχρι το τέλος",
        linkPrompt: "Link στο bio",
        tapLink: "Link στο bio",
        savePost: "Αποθήκευσε το reel",
      },
    },
  },
  es: {
    liveFare: "Tarifa en directo",
    deals: "Ofertas de vuelos",
    captionIntro: "Tarifas en directo ahora:",
    photos: "Fotos",
    pricesChange: "Las tarifas cambian rápido — comprobado hoy",
    bullets: [
      "Planificador de viajes con IA, gratis",
      "Tarifas en directo, revisadas cada día",
      "Un itinerario completo en 60 segundos",
    ],
    captionHook: "Vuelos baratos que nuestro radar encontró esta noche ✈️",
    captionSave: "📌 Guárdalo antes de que suban las tarifas.",
    surfaces: {
      feed: {
        swipeAll: "Desliza — {n} tarifas dentro",
        swipe: "Desliza para ver la tarifa",
        linkPrompt: "Link en la bio",
        tapLink: "Link en la bio",
        savePost: "Guarda este post",
      },
      story: {
        swipeAll: "Toca — {n} tarifas",
        swipe: "Toca para ver la tarifa",
        linkPrompt: "Toca el enlace",
        tapLink: "Enlace en esta historia",
        savePost: "Envíaselo a quien viaja contigo",
      },
      reel: {
        swipeAll: "Mira — {n} tarifas",
        swipe: "Mira hasta el final",
        linkPrompt: "Link en la bio",
        tapLink: "Link en la bio",
        savePost: "Guarda este reel",
      },
    },
  },
  fr: {
    liveFare: "Tarif en direct",
    deals: "Bons plans vols",
    captionIntro: "Tarifs en direct maintenant :",
    photos: "Photos",
    pricesChange: "Les tarifs changent vite — vérifié aujourd'hui",
    bullets: [
      "Planificateur de voyage IA, gratuit",
      "Tarifs en direct, vérifiés chaque jour",
      "Un itinéraire complet en 60 secondes",
    ],
    captionHook: "Des vols pas chers repérés cette nuit par notre radar ✈️",
    captionSave: "📌 Enregistre avant que les tarifs bougent.",
    surfaces: {
      feed: {
        swipeAll: "Balaye — {n} tarifs à l'intérieur",
        swipe: "Balaye pour voir le tarif",
        linkPrompt: "Lien en bio",
        tapLink: "Lien en bio",
        savePost: "Enregistre ce post",
      },
      story: {
        swipeAll: "Appuie — {n} tarifs",
        swipe: "Appuie pour voir le tarif",
        linkPrompt: "Appuie sur le lien",
        tapLink: "Lien dans cette story",
        savePost: "Envoie-le à ton binôme de voyage",
      },
      reel: {
        swipeAll: "Regarde — {n} tarifs",
        swipe: "Regarde jusqu'au bout",
        linkPrompt: "Lien en bio",
        tapLink: "Lien en bio",
        savePost: "Enregistre ce reel",
      },
    },
  },
  de: {
    liveFare: "Aktueller Preis",
    deals: "Flug-Deals",
    captionIntro: "Aktuelle Preise jetzt:",
    photos: "Fotos",
    pricesChange: "Preise ändern sich schnell — heute geprüft",
    bullets: [
      "Kostenloser KI-Reiseplaner",
      "Aktuelle Preise, täglich geprüft",
      "Ein ganzer Reiseplan in 60 Sekunden",
    ],
    captionHook: "Günstige Flüge, über Nacht von unserem Radar gefunden ✈️",
    captionSave: "📌 Speichern, bevor die Preise steigen.",
    surfaces: {
      feed: {
        swipeAll: "Wischen — {n} Preise drin",
        swipe: "Wischen für den Preis",
        linkPrompt: "Link in Bio",
        tapLink: "Link in Bio",
        savePost: "Post speichern",
      },
      story: {
        swipeAll: "Tippen — {n} Preise",
        swipe: "Tippen für den Preis",
        linkPrompt: "Auf den Link tippen",
        tapLink: "Link in dieser Story",
        savePost: "Schick es deiner Reisecrew",
      },
      reel: {
        swipeAll: "Ansehen — {n} Preise",
        swipe: "Bis zum Ende ansehen",
        linkPrompt: "Link in Bio",
        tapLink: "Link in Bio",
        savePost: "Reel speichern",
      },
    },
  },
  ar: {
    liveFare: "سعر مباشر",
    deals: "عروض الطيران",
    captionIntro: "أسعار مباشرة الآن:",
    photos: "الصور",
    pricesChange: "الأسعار تتغير بسرعة — تم التحقق اليوم",
    bullets: [
      "مخطط رحلات بالذكاء الاصطناعي، مجاناً",
      "أسعار مباشرة، تُراجع يومياً",
      "برنامج رحلة كامل في 60 ثانية",
    ],
    captionHook: "رحلات رخيصة رصدها الرادار الليلة ✈️",
    captionSave: "📌 احفظ المنشور قبل أن تتغير الأسعار.",
    surfaces: {
      feed: {
        swipeAll: "اسحب — {n} أسعار بالداخل",
        swipe: "اسحب لرؤية السعر",
        linkPrompt: "الرابط في البايو",
        tapLink: "الرابط في البايو",
        savePost: "احفظ المنشور",
      },
      story: {
        swipeAll: "اضغط — {n} أسعار",
        swipe: "اضغط لرؤية السعر",
        linkPrompt: "اضغط على الرابط",
        tapLink: "الرابط في هذه الستوري",
        savePost: "أرسله لرفيق سفرك",
      },
      reel: {
        swipeAll: "شاهد — {n} أسعار",
        swipe: "شاهد حتى النهاية",
        linkPrompt: "الرابط في البايو",
        tapLink: "الرابط في البايو",
        savePost: "احفظ الريل",
      },
    },
  },
};

/** Generic tags, then destination tags derived from the deck's cities. */
const BASE_HASHTAGS: Record<Lang, string[]> = {
  en: ["planeraai", "flightdeals", "cheapflights", "traveldeals", "traveltok"],
  el: ["planeraai", "προσφορεσπτησεων", "φθηναεισιτηρια", "ταξιδια", "traveltok"],
  es: ["planeraai", "vuelosbaratos", "ofertasdevuelos", "viajes", "traveltok"],
  fr: ["planeraai", "volspascher", "bonsplansvoyage", "voyage", "traveltok"],
  de: ["planeraai", "flugdeals", "billigfliegen", "reisen", "traveltok"],
  ar: ["planeraai", "عروض_طيران", "سفر", "traveltok"],
};

/** "Rio de Janeiro" → "riodejaneiro"; drops anything a hashtag can't carry. */
function hashtagize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0370-\u03ff\u0600-\u06ff]+/g, "");
}

/**
 * Cache key for the Nth photo of a destination.
 *
 * Variant 0 IS the email hero, so a cover keeps matching the email that went
 * out. Every later variant lives under its own social-only key and therefore
 * can never overwrite that photo — which matters, because the alternates are
 * fetched PORTRAIT for the vertical cards and would look wrong in an email's
 * landscape hero slot.
 */
function socialPhotoCacheKey(focus: DestinationFocus, variant: number): string {
  const base = destinationHeroCacheKey(focus);
  return variant <= 0 ? base : `${base}:social${variant}`;
}

// ---------------------------------------------------------------------------
// Wire shape (mirrored by `src/lib/social/types.ts` on the website)
// ---------------------------------------------------------------------------

const surfaceValidator = v.union(
  v.literal("feed"),
  v.literal("story"),
  v.literal("reel"),
);

const slideValidator = v.object({
  kind: v.union(v.literal("cover"), v.literal("deal"), v.literal("cta")),
  /** Largest line on the card. */
  headline: v.string(),
  /** Supporting line under the headline, when the slide has one. */
  sub: v.optional(v.string()),
  /** Small uppercase kicker above the headline. */
  kicker: v.optional(v.string()),
  // --- deal slides ---
  originCode: v.optional(v.string()),
  destinationCode: v.optional(v.string()),
  /**
   * The fare's real dates and destination, unformatted.
   *
   * `dates` above is display copy ("12 Oct – 19 Oct"); these are what a LINK
   * needs — the website builds the share URLs for this exact flight out of
   * them, so a viewer who taps the story lands on the fare the card showed
   * rather than on a generic search.
   */
  outboundISO: v.optional(v.string()),
  returnISO: v.optional(v.string()),
  destinationCity: v.optional(v.string()),
  price: v.optional(v.string()),
  priceWas: v.optional(v.string()),
  perPerson: v.optional(v.string()),
  dates: v.optional(v.string()),
  tripType: v.optional(v.string()),
  badge: v.optional(v.string()),
  badgeKind: v.optional(v.string()),
  footnote: v.optional(v.string()),
  // --- marketing chrome ---
  /** "Save €125" — the discount stated as money, next to the price. */
  saveLabel: v.optional(v.string()),
  /** The one thing to do next: swipe, tap the bio link, save the post. */
  prompt: v.optional(v.string()),
  /** End-card value props, one short line each. */
  bullets: v.optional(v.array(v.string())),
  // --- artwork ---
  /**
   * Resolved photo URL. Absent when nothing could be found — the renderer then
   * falls back to the brand gradient, which is a fine card on its own.
   */
  image: v.optional(v.string()),
  /** Destination to search if `image` is empty (filled in by the action). */
  imageQuery: v.optional(v.string()),
  imageIata: v.optional(v.string()),
  /**
   * Which frame of that destination this slide wants: 0 is the email's hero,
   * 1+ are social-only alternates, so two slides about one place never land on
   * the same photo.
   */
  imageVariant: v.optional(v.float64()),
  credit: v.optional(v.string()),
  creditUrl: v.optional(v.string()),
});

const deckValidator = v.object({
  campaignId: v.string(),
  subject: v.string(),
  lang: v.string(),
  ctaUrl: v.string(),
  /** Ready-to-paste caption (deals + link + hashtags + photo credits). */
  caption: v.string(),
  /** Unsplash attributions used on the deck — required by the licence. */
  credits: v.array(v.object({ name: v.string(), url: v.optional(v.string()) })),
  slides: v.array(slideValidator),
});

export type SocialSlide = {
  kind: "cover" | "deal" | "cta";
  headline: string;
  sub?: string;
  kicker?: string;
  originCode?: string;
  destinationCode?: string;
  /** Real dates + destination behind the display copy, for building links. */
  outboundISO?: string;
  returnISO?: string;
  destinationCity?: string;
  price?: string;
  priceWas?: string;
  perPerson?: string;
  dates?: string;
  tripType?: string;
  badge?: string;
  badgeKind?: string;
  footnote?: string;
  saveLabel?: string;
  prompt?: string;
  bullets?: string[];
  image?: string;
  imageQuery?: string;
  imageIata?: string;
  imageVariant?: number;
  credit?: string;
  creditUrl?: string;
};

export type SocialDeck = {
  campaignId: string;
  subject: string;
  lang: string;
  ctaUrl: string;
  caption: string;
  credits: Array<{ name: string; url?: string }>;
  slides: SocialSlide[];
};

/** The artwork half of a slide: either resolved, or a request for the action. */
type SlideArt = Pick<
  SocialSlide,
  "image" | "credit" | "creditUrl" | "imageQuery" | "imageIata" | "imageVariant"
>;

// ---------------------------------------------------------------------------
// Auth (token → admin), mirroring newsletterCampaigns.ts
// ---------------------------------------------------------------------------

async function requireAdmin(ctx: any, token: string): Promise<string> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) throw new Error("Unauthorized");
  await assertAdmin(ctx, session.userId);
  return session.userId;
}

// ---------------------------------------------------------------------------
// Deck assembly
// ---------------------------------------------------------------------------

function clampDealCount(n: number | undefined): number {
  const raw = Math.round(
    Number.isFinite(n as number) ? (n as number) : DEFAULT_DEAL_SLIDES,
  );
  return Math.min(MAX_DEAL_SLIDES, Math.max(0, raw));
}

/** First sentence of the campaign's body copy — the cover's supporting line. */
function firstSentence(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const cut = clean.match(/^[^.!?·]{10,}?[.!?·]/)?.[0] ?? clean;
  return cut.length > max
    ? `${cut.slice(0, max - 1).trimEnd()}…`
    : cut.replace(/[.·]$/, "");
}

function buildCaption(opts: {
  lang: Lang;
  heading: string;
  intro: string;
  deals: Array<{ route: string; price: string; dates: string; saving?: string }>;
  ctaText: string;
  ctaUrl: string;
  hashtags: string[];
  credits: Array<{ name: string; url?: string }>;
}): string {
  const L = LABELS[opts.lang];
  // Hook first, campaign heading second: the first line is all Instagram shows
  // before "more", so it has to earn the tap on its own rather than repeat the
  // subject line the reader can already see on the cover.
  const parts: string[] = [L.captionHook, opts.heading];
  if (opts.intro) parts.push(opts.intro);
  if (opts.deals.length) {
    parts.push(
      [
        L.captionIntro,
        ...opts.deals.map(
          (d) =>
            `✈️ ${d.route} — ${d.price} · ${d.dates}${d.saving ? ` · ${d.saving}` : ""}`,
        ),
      ].join("\n"),
    );
  }
  parts.push(L.captionSave);
  parts.push(`${opts.ctaText} 👉 ${opts.ctaUrl}`);
  parts.push(opts.hashtags.map((h) => `#${h}`).join(" "));
  if (opts.credits.length) {
    parts.push(`${L.photos}: ${opts.credits.map((c) => c.name).join(", ")} / Unsplash`);
  }
  return parts.join("\n\n");
}

/**
 * Everything reachable from the database alone: the campaign, its deals, and
 * whatever destination photos previous sends already cached. Slides that still
 * have no photo carry an `imageQuery` — and the variant they want — for the
 * action to resolve.
 */
export const deckFromDb = internalQuery({
  args: {
    token: v.string(),
    campaignId: v.id("newsletterCampaigns"),
    lang: v.optional(v.string()),
    maxDeals: v.optional(v.float64()),
    /** Where the deck is headed; decides the prompt on every card. */
    surface: v.optional(surfaceValidator),
  },
  returns: v.union(v.null(), deckValidator),
  handler: async (ctx, args): Promise<SocialDeck | null> => {
    await requireAdmin(ctx, args.token);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;

    // Arabic has no glyph coverage in the card font, so a deck asked for in
    // Arabic would render as tofu. Fall back to English copy and let the
    // composer say so.
    const requested = normalizeLang(args.lang ?? campaign.languageFilter ?? undefined);
    const lang: Lang = requested === "ar" ? "en" : requested;
    const L = LABELS[lang];
    // A carousel is the default because it is the only surface that carries a
    // caption, so an unspecified caller gets the deck the caption describes.
    const S = L.surfaces[(args.surface ?? "feed") as SocialSurface];

    const dealCount = clampDealCount(args.maxDeals ?? campaign.dealCount);

    // A campaign that pinned its own routes IS its cards. Falling through to
    // the curated radar here is how a deck for "Venice, London, Barcelona"
    // came out advertising Malta, Verona and Chisinau — the deck was reading
    // the global deal list while the email read the campaign's routes.
    const routeFares = await queryCampaignRouteFares(ctx.db, campaign);
    const routeDeals = routeFares.map(routeFareToDeal);

    const focus =
      destinationFocusFrom(campaign.routeDestinationCity, campaign.routeDestination) ??
      // No single pinned destination (a multi-route round-up): the lead route
      // dresses the cover, so the deck opens on somewhere it actually sells.
      (routeDeals.length
        ? destinationFocusFrom(routeDeals[0].destinationCity, routeDeals[0].destination)
        : null);

    const allDeals: DealForEmail[] =
      routeDeals.length || !campaign.includeDeals || dealCount <= 0
        ? []
        : await queryFeaturedDeals(ctx.db);
    // Every pinned route earns a slide unless the caller asked for fewer:
    // `dealCount` defaults from the EMAIL's curated-deal setting, which has
    // nothing to say about how many routes this campaign is about.
    const deals = routeDeals.length
      ? routeDeals.slice(0, args.maxDeals != null ? dealCount : routeDeals.length)
      : pickTopDeals(allDeals, campaign.countryFilter, dealCount, focus);

    const slides: SocialSlide[] = [];
    const credits: Array<{ name: string; url?: string }> = [];
    const addCredit = (h: { credit?: string; creditUrl?: string } | null) => {
      if (h?.credit && !credits.some((c) => c.name === h.credit)) {
        credits.push({ name: h.credit, url: h.creditUrl });
      }
    };

    // How many photos of each destination the deck has already spent, and which
    // URLs are taken. A campaign pinned to one city asks for that city three
    // times over (cover, its deal card, end card) — each ask has to come back
    // with a different frame or the carousel looks like a rendering bug.
    const variantByCity = new Map<string, number>();
    const usedUrls = new Set<string>();

    const takeArt = async (target: DestinationFocus | null): Promise<SlideArt> => {
      if (!target) return {};
      const variant = variantByCity.get(target.cityToken) ?? 0;
      variantByCity.set(target.cityToken, variant + 1);

      // Variant 0 can also come from a published itinerary's hero; the later
      // variants exist only in the social cache, so a miss falls straight
      // through to the action's Unsplash lookup.
      const cached: DestinationHero | null =
        variant === 0
          ? await queryDestinationHero(ctx.db, {
              destinationCity: target.label,
              destinationIata: target.iata,
            })
          : await queryCachedHeroByKey(ctx.db, socialPhotoCacheKey(target, variant));

      if (cached?.url && !usedUrls.has(cached.url)) {
        usedUrls.add(cached.url);
        addCredit(cached);
        return { image: cached.url, credit: cached.credit, creditUrl: cached.creditUrl };
      }
      return {
        imageQuery: target.label,
        imageIata: target.iata,
        imageVariant: variant,
      };
    };

    // Cover art: a hand-picked hero URL means that exact image and is left
    // alone. One of the curated stock photos is only a placeholder for "some
    // travel image", so a campaign that pins a destination upgrades it to a
    // photo OF that destination.
    const pinnedHero = !isCuratedHero(campaign.heroImg) ? campaign.heroImg : undefined;
    if (pinnedHero) usedUrls.add(pinnedHero);
    const coverArt: SlideArt = pinnedHero ? { image: pinnedHero } : await takeArt(focus);

    slides.push({
      kind: "cover",
      kicker: L.deals,
      headline: campaign.heading,
      sub: firstSentence(campaign.para1 || campaign.preheader || ""),
      // The cover's whole job is to buy the next card, so it says how much
      // is behind it instead of leaving the count to be discovered — in the
      // gesture this surface actually responds to.
      prompt:
        deals.length > 1 ? S.swipeAll.replace("{n}", String(deals.length)) : S.swipe,
      // Nothing found and nothing pinned still leaves the campaign's own
      // marketing photo, which is better than a bare gradient.
      ...(coverArt.image || coverArt.imageQuery
        ? coverArt
        : { image: campaign.heroImg ?? undefined }),
    });

    const captionDeals: Array<{
      route: string;
      price: string;
      dates: string;
      saving?: string;
    }> = [];
    for (const d of deals) {
      const copy = dealSocialCopy(d, lang);
      const art = await takeArt(destinationFocusFrom(d.destinationCity, d.destination));
      captionDeals.push({
        route: copy.route,
        price: copy.price,
        dates: copy.dates,
        saving: copy.saving,
      });
      slides.push({
        kind: "deal",
        kicker: L.liveFare,
        headline: copy.route,
        sub: `${copy.dates} · ${copy.tripType}`,
        originCode: d.origin,
        destinationCode: d.destination,
        outboundISO: d.outboundDate,
        returnISO: d.returnDate,
        destinationCity: d.destinationCity,
        price: copy.price,
        priceWas: copy.priceWas,
        perPerson: copy.perPerson,
        dates: copy.dates,
        tripType: copy.tripType,
        badge: copy.badge,
        badgeKind: copy.badgeKind,
        // Only ever set when `priceWas` is — the saving restates the price
        // block's own numbers, it never introduces a new claim.
        saveLabel: copy.saving,
        footnote: L.pricesChange,
        prompt: S.linkPrompt,
        ...art,
      });
    }

    // The end card used to be a flat brand panel. It is the slide that has to
    // convert, so it gets a destination photo behind it, the reasons to tap,
    // and the one ask that costs a viewer nothing.
    const ctaFocus =
      focus ??
      (deals[0]
        ? destinationFocusFrom(deals[0].destinationCity, deals[0].destination)
        : null);
    const ctaArt = await takeArt(ctaFocus);

    // No kicker on the end card: the footer already carries the domain, and a
    // second copy of it just reads as a repeat.
    slides.push({
      kind: "cta",
      headline: campaign.ctaText,
      sub: S.tapLink,
      bullets: L.bullets,
      prompt: S.savePost,
      ...ctaArt,
    });

    const hashtags = [
      ...BASE_HASHTAGS[lang],
      ...deals.map((d) => hashtagize(d.destinationCity)).filter(Boolean),
    ].filter((t, i, a) => t && a.indexOf(t) === i);

    return {
      campaignId: args.campaignId,
      subject: campaign.subject,
      lang,
      ctaUrl: campaign.ctaUrl,
      caption: buildCaption({
        lang,
        heading: campaign.heading,
        intro: firstSentence(campaign.para1 || "", 200),
        deals: captionDeals,
        ctaText: campaign.ctaText,
        ctaUrl: campaign.ctaUrl,
        hashtags,
        credits,
      }),
      credits,
      slides,
    };
  },
});

/**
 * The deck the composer and the render routes both use.
 *
 * Runs `deckFromDb` first, then fills any slide the database couldn't art.
 * At most two Unsplash requests per destination cover every slide of it:
 * variant 0 goes through the shared newsletter hero lookup (landscape, cached
 * under `hero:<city>` so the next email send is free), and every alternate
 * comes out of ONE multi-photo search asked for portrait — which is the shape
 * a 9:16 card actually wants.
 */
export const buildDeck = action({
  args: {
    token: v.string(),
    campaignId: v.id("newsletterCampaigns"),
    lang: v.optional(v.string()),
    maxDeals: v.optional(v.float64()),
    /** Where the deck is headed; decides the prompt on every card. */
    surface: v.optional(surfaceValidator),
  },
  returns: v.union(v.null(), deckValidator),
  handler: async (ctx, args): Promise<SocialDeck | null> => {
    const deck: SocialDeck | null = await ctx.runQuery(
      internal.newsletterSocial.deckFromDb,
      args,
    );
    if (!deck) return null;

    // Photos the database already supplied. Nothing fetched below may repeat
    // one — that is the whole point of the variant bookkeeping.
    const usedUrls = new Set<string>(
      deck.slides.map((s) => s.image).filter(Boolean) as string[],
    );
    const addCredit = (name?: string, url?: string) => {
      if (name && !deck.credits.some((c) => c.name === name)) {
        deck.credits.push({ name, url });
      }
    };
    // Unsplash asks clients to ping the download endpoint on real use.
    const trackDownload = async (loc?: string) => {
      if (!loc) return;
      try {
        await ctx.runAction(api.images.trackUnsplashDownload, { downloadLocation: loc });
      } catch {
        /* tracking only */
      }
    };

    type UnsplashResult = {
      url: string;
      photographer: string;
      photographerUrl?: string;
      attribution: string;
      downloadLocation?: string;
      unsplashId: string;
    };

    const applyPhoto = (slide: SocialSlide, photo: UnsplashResult) => {
      usedUrls.add(photo.url);
      slide.image = photo.url;
      slide.credit = photo.photographer;
      slide.creditUrl = photo.photographerUrl ?? photo.attribution;
      slide.imageQuery = undefined;
      slide.imageIata = undefined;
      slide.imageVariant = undefined;
      addCredit(photo.photographer, photo.photographerUrl ?? photo.attribution);
    };

    // Group by destination, not by slide: three Lisbon slides are one lookup.
    const pending = new Map<string, { iata?: string; slides: SocialSlide[] }>();
    for (const slide of deck.slides) {
      if (slide.image || !slide.imageQuery) continue;
      const key = slide.imageQuery.toLowerCase();
      const entry = pending.get(key);
      if (entry) entry.slides.push(slide);
      else pending.set(key, { iata: slide.imageIata, slides: [slide] });
    }

    for (const entry of pending.values()) {
      const query = String(entry.slides[0].imageQuery);
      const focus = destinationFocusFrom(query, entry.iata);
      // Same disambiguated search the email hero uses, so a deck and the
      // campaign it illustrates agree on what the place looks like.
      const photoQuery = focus ? heroSearchQuery(focus) : query;
      const heroSlides = entry.slides.filter((s) => !(s.imageVariant ?? 0));
      const altSlides = entry.slides.filter((s) => (s.imageVariant ?? 0) > 0);

      // --- variant 0: the email's own hero, landscape, shared cache key -----
      if (heroSlides.length) {
        try {
          const photo: UnsplashResult | null = await ctx.runAction(
            api.images.getNewsletterHeroImage,
            { destination: photoQuery, width: 1440 },
          );
          if (photo?.url) {
            if (focus) {
              await ctx.runMutation(internal.newsletter.cacheDestinationHero, {
                cacheKey: destinationHeroCacheKey(focus),
                url: photo.url,
                photographer: photo.photographer,
                photographerUrl: photo.photographerUrl,
                attribution: photo.attribution,
                unsplashId: photo.unsplashId,
              });
            }
            await trackDownload(photo.downloadLocation);
            for (const slide of heroSlides) applyPhoto(slide, photo);
          }
        } catch (e) {
          // A missing photo costs a gradient background, never the deck.
          console.error("social deck hero fetch failed:", e);
        }
      }

      // --- variants 1+: alternate frames of the same place ------------------
      if (!altSlides.length) continue;
      try {
        // Over-ask a little: some results come back already used by an earlier
        // slide (or by the hero above), and a short page would leave the last
        // card sitting on the gradient.
        const want = Math.min(MAX_PHOTO_VARIANTS, altSlides.length + 2);
        const photos: UnsplashResult[] = await ctx.runAction(
          api.images.getDestinationPhotoSet,
          { destination: photoQuery, count: want, width: 1440, orientation: "portrait" },
        );

        const fresh = photos.filter((p) => p.url && !usedUrls.has(p.url));
        for (let i = 0; i < altSlides.length && i < fresh.length; i++) {
          const slide = altSlides[i];
          const photo = fresh[i];
          if (focus) {
            await ctx.runMutation(internal.newsletter.cacheDestinationHero, {
              cacheKey: socialPhotoCacheKey(focus, slide.imageVariant ?? i + 1),
              url: photo.url,
              photographer: photo.photographer,
              photographerUrl: photo.photographerUrl,
              attribution: photo.attribution,
              unsplashId: photo.unsplashId,
            });
          }
          await trackDownload(photo.downloadLocation);
          applyPhoto(slide, photo);
        }
      } catch (e) {
        console.error("social deck photo set fetch failed:", e);
      }
    }

    return deck;
  },
});
