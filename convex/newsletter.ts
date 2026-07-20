/**
 * Newsletter Funnel
 *
 * Double opt-in email capture + automated drip sequence.
 *
 * Flow:
 *  1. `subscribe`   — public mutation, called from the marketing site and the
 *                     in-app opt-in card. Creates a `pending` subscriber and
 *                     schedules a confirmation ("please confirm") email.
 *  2. `confirm`     — public mutation, hit from the link in the confirmation
 *                     email. Marks the subscriber `active` and sends the
 *                     welcome email (drip stage 0).
 *  3. drip sequence — the `processNewsletterDrip` cron walks active subscribers
 *                     through the marketing sequence, one email every few days.
 *  4. `unsubscribe` — public mutation, hit from the unsubscribe link in the
 *                     footer of every email.
 *
 * Emails are delivered via the existing Postmark raw-send action
 * (`internal.postmark.sendRawEmail`).
 */

import { query, mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { iataToCountry } from "./lib/airportCountry";
import type { FlightCalendar, ExploreDestinationFlights } from "../types/flights";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE_URL = "https://planeraai.app";
const APP_STORE_URL =
  "https://apps.apple.com/us/app/planera-ai-travel-planner/id6758346139";

// All newsletter/marketing emails send from the dedicated marketing address
// (transactional emails keep support@). Replies land in the same mailbox.
export const MARKETING_EMAIL = "marketing@planeraai.app";
export const MARKETING_FROM = `Planera AI <${MARKETING_EMAIL}>`;

// How long to wait between drip emails.
const DRIP_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
// Number of drip emails after the welcome email.
const MAX_DRIP_STAGE = 3;
// Max subscribers processed per drip cron tick.
const DRIP_BATCH_SIZE = 50;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Email templates (pure helpers — safe to call from mutations and actions)
// ---------------------------------------------------------------------------

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ISO-3166-1 alpha-2, lowercase. Rejects anything that isn't a 2-letter code
// (e.g. Vercel returns "XX" for unknown / local requests).
function normalizeCountry(input?: string): string | undefined {
  if (!input) return undefined;
  const c = input.trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) && c !== "xx" ? c : undefined;
}

function randomToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  );
}

// ---- Localized copy ------------------------------------------------------

export type Lang = "en" | "el" | "es" | "fr" | "de" | "ar";
const LANGS: Lang[] = ["en", "el", "es", "fr", "de", "ar"];

export function normalizeLang(input?: string): Lang {
  const base = (input || "en").toLowerCase().split("-")[0];
  return (LANGS as string[]).includes(base) ? (base as Lang) : "en";
}

interface EmailCopy {
  subject: string;
  preheader: string;
  heading: string;
  para1: string;
  para2: string;
  cta: string;
}

type EmailKey = "confirm" | "welcome" | "drip1" | "drip2" | "drip3";

const EMAIL_COPY: Record<EmailKey, Record<Lang, EmailCopy>> = {
  confirm: {
    en: {
      subject: "Confirm your Planera newsletter subscription",
      preheader: "One quick tap to confirm and start getting smarter travel tips.",
      heading: "Confirm your subscription",
      para1: "Thanks for signing up! Tap the button below to confirm your email and start receiving AI travel tips, flight deals, and destination inspiration.",
      para2: "If you didn't request this, you can safely ignore this email.",
      cta: "Confirm my email",
    },
    el: {
      subject: "Επιβεβαιώστε την εγγραφή σας στο newsletter της Planera",
      preheader: "Ένα γρήγορο πάτημα για επιβεβαίωση και ξεκινήστε να λαμβάνετε έξυπνες ταξιδιωτικές συμβουλές.",
      heading: "Επιβεβαιώστε την εγγραφή σας",
      para1: "Ευχαριστούμε για την εγγραφή! Πατήστε το κουμπί παρακάτω για να επιβεβαιώσετε το email σας και να αρχίσετε να λαμβάνετε ταξιδιωτικές συμβουλές με AI, προσφορές πτήσεων και έμπνευση για προορισμούς.",
      para2: "Αν δεν το ζητήσατε εσείς, μπορείτε να αγνοήσετε αυτό το email.",
      cta: "Επιβεβαίωση email",
    },
    es: {
      subject: "Confirma tu suscripción al boletín de Planera",
      preheader: "Un toque rápido para confirmar y empezar a recibir consejos de viaje más inteligentes.",
      heading: "Confirma tu suscripción",
      para1: "¡Gracias por registrarte! Toca el botón de abajo para confirmar tu correo y empezar a recibir consejos de viaje con IA, ofertas de vuelos e inspiración de destinos.",
      para2: "Si no lo solicitaste, puedes ignorar este correo con tranquilidad.",
      cta: "Confirmar mi correo",
    },
    fr: {
      subject: "Confirmez votre inscription à la newsletter Planera",
      preheader: "Un simple clic pour confirmer et commencer à recevoir des conseils de voyage plus malins.",
      heading: "Confirmez votre inscription",
      para1: "Merci de votre inscription ! Cliquez sur le bouton ci-dessous pour confirmer votre e-mail et commencer à recevoir des conseils de voyage avec l'IA, des offres de vols et de l'inspiration de destinations.",
      para2: "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail.",
      cta: "Confirmer mon e-mail",
    },
    de: {
      subject: "Bestätige dein Planera-Newsletter-Abo",
      preheader: "Ein kurzer Tipp zum Bestätigen – und du bekommst clevere Reisetipps.",
      heading: "Bestätige dein Abo",
      para1: "Danke für deine Anmeldung! Tippe auf den Button unten, um deine E-Mail zu bestätigen und KI-Reisetipps, Flugangebote und Reiseinspiration zu erhalten.",
      para2: "Wenn du das nicht angefordert hast, kannst du diese E-Mail einfach ignorieren.",
      cta: "E-Mail bestätigen",
    },
    ar: {
      subject: "أكّد اشتراكك في نشرة Planera",
      preheader: "نقرة سريعة للتأكيد وابدأ بتلقّي نصائح سفر أذكى.",
      heading: "أكّد اشتراكك",
      para1: "شكرًا لتسجيلك! اضغط على الزر أدناه لتأكيد بريدك الإلكتروني والبدء في تلقّي نصائح سفر بالذكاء الاصطناعي وعروض طيران وإلهام لوجهاتك.",
      para2: "إذا لم تطلب هذا، يمكنك تجاهل هذه الرسالة بأمان.",
      cta: "تأكيد بريدي الإلكتروني",
    },
  },
  welcome: {
    en: {
      subject: "Welcome to Planera ✨",
      preheader: "You're in. Here's how to plan your next trip in seconds.",
      heading: "Welcome aboard!",
      para1: "You're officially on the list. From now on you'll get the good stuff: AI-planned itineraries, flight deals from our Low-Fare Radar, and hand-picked destination guides.",
      para2: "Ready to plan something? Open Planera and let AI build a full itinerary for you in seconds.",
      cta: "Start planning",
    },
    el: {
      subject: "Καλώς ήρθατε στην Planera ✨",
      preheader: "Είστε μέσα. Δείτε πώς να σχεδιάσετε το επόμενο ταξίδι σας σε δευτερόλεπτα.",
      heading: "Καλώς ήρθατε!",
      para1: "Είστε επίσημα στη λίστα. Από τώρα θα λαμβάνετε τα καλύτερα: δρομολόγια σχεδιασμένα με AI, προσφορές πτήσεων από το Low-Fare Radar και επιλεγμένους οδηγούς προορισμών.",
      para2: "Έτοιμοι να σχεδιάσετε κάτι; Ανοίξτε την Planera και αφήστε το AI να δημιουργήσει ένα πλήρες δρομολόγιο για εσάς σε δευτερόλεπτα.",
      cta: "Ξεκινήστε τον σχεδιασμό",
    },
    es: {
      subject: "Te damos la bienvenida a Planera ✨",
      preheader: "Ya estás dentro. Así puedes planificar tu próximo viaje en segundos.",
      heading: "¡Bienvenido a bordo!",
      para1: "Ya estás oficialmente en la lista. A partir de ahora recibirás lo mejor: itinerarios creados con IA, ofertas de vuelos de nuestro Low-Fare Radar y guías de destinos seleccionadas.",
      para2: "¿Listo para planificar algo? Abre Planera y deja que la IA cree un itinerario completo para ti en segundos.",
      cta: "Empezar a planificar",
    },
    fr: {
      subject: "Bienvenue sur Planera ✨",
      preheader: "Vous y êtes. Voici comment planifier votre prochain voyage en quelques secondes.",
      heading: "Bienvenue à bord !",
      para1: "Vous êtes officiellement inscrit. Désormais, vous recevrez le meilleur : des itinéraires conçus par l'IA, des offres de vols de notre Low-Fare Radar et des guides de destinations sélectionnés.",
      para2: "Prêt à planifier quelque chose ? Ouvrez Planera et laissez l'IA créer un itinéraire complet pour vous en quelques secondes.",
      cta: "Commencer à planifier",
    },
    de: {
      subject: "Willkommen bei Planera ✨",
      preheader: "Du bist dabei. So planst du deine nächste Reise in Sekunden.",
      heading: "Willkommen an Bord!",
      para1: "Du stehst jetzt offiziell auf der Liste. Ab sofort bekommst du das Beste: KI-geplante Reiserouten, Flugangebote aus unserem Low-Fare Radar und handverlesene Reiseführer.",
      para2: "Bereit, etwas zu planen? Öffne Planera und lass die KI in Sekunden eine komplette Reiseroute für dich erstellen.",
      cta: "Jetzt planen",
    },
    ar: {
      subject: "مرحبًا بك في Planera ✨",
      preheader: "أنت الآن معنا. إليك كيف تخطّط لرحلتك القادمة في ثوانٍ.",
      heading: "مرحبًا بك على متننا!",
      para1: "أنت الآن على القائمة رسميًا. من الآن فصاعدًا ستحصل على الأفضل: خطط رحلات بالذكاء الاصطناعي، وعروض طيران من Low-Fare Radar، وأدلة وجهات مختارة بعناية.",
      para2: "مستعد للتخطيط؟ افتح Planera ودع الذكاء الاصطناعي يبني لك خطة رحلة كاملة في ثوانٍ.",
      cta: "ابدأ التخطيط",
    },
  },
  drip1: {
    en: {
      subject: "Plan your first trip in seconds",
      preheader: "Tell us where you're going — we'll handle the rest.",
      heading: "Your AI travel planner",
      para1: "Planera builds complete, day-by-day itineraries tailored to your budget, dates, and interests — no more juggling ten browser tabs.",
      para2: "Pick a destination and watch a full plan come together in seconds.",
      cta: "Plan a trip",
    },
    el: {
      subject: "Σχεδιάστε το πρώτο σας ταξίδι σε δευτερόλεπτα",
      preheader: "Πείτε μας πού πηγαίνετε — εμείς αναλαμβάνουμε τα υπόλοιπα.",
      heading: "Ο ταξιδιωτικός σας σχεδιαστής με AI",
      para1: "Η Planera δημιουργεί πλήρη, ημέρα προς ημέρα δρομολόγια προσαρμοσμένα στον προϋπολογισμό, τις ημερομηνίες και τα ενδιαφέροντά σας — τέλος στις δέκα ανοιχτές καρτέλες.",
      para2: "Επιλέξτε έναν προορισμό και δείτε ένα πλήρες πλάνο να δημιουργείται σε δευτερόλεπτα.",
      cta: "Σχεδιάστε ένα ταξίδι",
    },
    es: {
      subject: "Planifica tu primer viaje en segundos",
      preheader: "Dinos adónde vas — nosotros nos encargamos del resto.",
      heading: "Tu planificador de viajes con IA",
      para1: "Planera crea itinerarios completos, día a día, adaptados a tu presupuesto, fechas e intereses — se acabó tener diez pestañas abiertas.",
      para2: "Elige un destino y observa cómo se arma un plan completo en segundos.",
      cta: "Planificar un viaje",
    },
    fr: {
      subject: "Planifiez votre premier voyage en quelques secondes",
      preheader: "Dites-nous où vous allez — on s'occupe du reste.",
      heading: "Votre planificateur de voyage IA",
      para1: "Planera crée des itinéraires complets, jour par jour, adaptés à votre budget, vos dates et vos centres d'intérêt — fini les dix onglets ouverts.",
      para2: "Choisissez une destination et regardez un plan complet se construire en quelques secondes.",
      cta: "Planifier un voyage",
    },
    de: {
      subject: "Plane deine erste Reise in Sekunden",
      preheader: "Sag uns, wohin es geht — den Rest übernehmen wir.",
      heading: "Dein KI-Reiseplaner",
      para1: "Planera erstellt komplette Reiserouten Tag für Tag, abgestimmt auf dein Budget, deine Daten und Interessen — Schluss mit zehn offenen Browser-Tabs.",
      para2: "Wähle ein Ziel und sieh zu, wie in Sekunden ein kompletter Plan entsteht.",
      cta: "Reise planen",
    },
    ar: {
      subject: "خطّط لرحلتك الأولى في ثوانٍ",
      preheader: "أخبرنا إلى أين تذهب — وسنتولّى الباقي.",
      heading: "مخطّط السفر بالذكاء الاصطناعي",
      para1: "تنشئ Planera خطط رحلات كاملة يومًا بيوم مصمّمة حسب ميزانيتك وتواريخك واهتماماتك — لا مزيد من عشر علامات تبويب مفتوحة.",
      para2: "اختر وجهة وشاهد خطة كاملة تتكوّن في ثوانٍ.",
      cta: "خطّط لرحلة",
    },
  },
  drip2: {
    en: {
      subject: "Never overpay for flights again",
      preheader: "Our Low-Fare Radar tracks prices so you don't have to.",
      heading: "Meet Low-Fare Radar",
      para1: "Our Low-Fare Radar watches fares to the places you love and surfaces the best deals the moment prices drop.",
      para2: "Book flights in-app in a couple of taps once you spot a fare you like.",
      cta: "See today's deals",
    },
    el: {
      subject: "Μην ξαναπληρώσετε παραπάνω για πτήσεις",
      preheader: "Το Low-Fare Radar παρακολουθεί τις τιμές ώστε να μην χρειάζεται εσείς.",
      heading: "Γνωρίστε το Low-Fare Radar",
      para1: "Το Low-Fare Radar παρακολουθεί τους ναύλους για τα μέρη που αγαπάτε και αναδεικνύει τις καλύτερες προσφορές τη στιγμή που πέφτουν οι τιμές.",
      para2: "Κλείστε πτήσεις μέσα στην εφαρμογή με λίγα πατήματα μόλις εντοπίσετε έναν ναύλο που σας αρέσει.",
      cta: "Δείτε τις σημερινές προσφορές",
    },
    es: {
      subject: "No vuelvas a pagar de más por los vuelos",
      preheader: "Nuestro Low-Fare Radar vigila los precios para que tú no tengas que hacerlo.",
      heading: "Descubre Low-Fare Radar",
      para1: "Nuestro Low-Fare Radar vigila las tarifas de los lugares que te gustan y muestra las mejores ofertas en cuanto bajan los precios.",
      para2: "Reserva vuelos en la app con un par de toques cuando encuentres una tarifa que te guste.",
      cta: "Ver ofertas de hoy",
    },
    fr: {
      subject: "Ne payez plus jamais trop cher vos vols",
      preheader: "Notre Low-Fare Radar surveille les prix pour vous.",
      heading: "Découvrez Low-Fare Radar",
      para1: "Notre Low-Fare Radar surveille les tarifs vers les endroits que vous aimez et fait remonter les meilleures offres dès que les prix baissent.",
      para2: "Réservez des vols dans l'app en quelques clics dès que vous repérez un tarif qui vous plaît.",
      cta: "Voir les offres du jour",
    },
    de: {
      subject: "Zahle nie wieder zu viel für Flüge",
      preheader: "Unser Low-Fare Radar behält die Preise im Blick, damit du es nicht musst.",
      heading: "Lerne Low-Fare Radar kennen",
      para1: "Unser Low-Fare Radar beobachtet die Preise für deine Lieblingsziele und zeigt die besten Angebote, sobald die Preise fallen.",
      para2: "Buche Flüge mit ein paar Tipps direkt in der App, sobald du einen Preis findest, der dir gefällt.",
      cta: "Heutige Angebote ansehen",
    },
    ar: {
      subject: "لا تدفع أكثر من اللازم للرحلات الجوية مجددًا",
      preheader: "يراقب Low-Fare Radar الأسعار نيابةً عنك.",
      heading: "تعرّف على Low-Fare Radar",
      para1: "يراقب Low-Fare Radar أسعار الرحلات إلى الأماكن التي تحبها ويُظهر أفضل العروض لحظة انخفاض الأسعار.",
      para2: "احجز الرحلات داخل التطبيق بنقرات قليلة بمجرد أن تجد سعرًا يعجبك.",
      cta: "شاهد عروض اليوم",
    },
  },
  drip3: {
    en: {
      subject: "Get inspired — explore the community",
      preheader: "Real trips, real tips, from real travelers.",
      heading: "Explore where others are going",
      para1: "Discover trending destinations and community insights from travelers just like you. Every guide is grounded in real trips.",
      para2: "Find your next adventure and start planning today.",
      cta: "Explore destinations",
    },
    el: {
      subject: "Εμπνευστείτε — εξερευνήστε την κοινότητα",
      preheader: "Πραγματικά ταξίδια, πραγματικές συμβουλές, από πραγματικούς ταξιδιώτες.",
      heading: "Εξερευνήστε πού πηγαίνουν οι άλλοι",
      para1: "Ανακαλύψτε δημοφιλείς προορισμούς και πληροφορίες από ταξιδιώτες σαν εσάς. Κάθε οδηγός βασίζεται σε πραγματικά ταξίδια.",
      para2: "Βρείτε την επόμενη περιπέτειά σας και ξεκινήστε τον σχεδιασμό σήμερα.",
      cta: "Εξερευνήστε προορισμούς",
    },
    es: {
      subject: "Inspírate — explora la comunidad",
      preheader: "Viajes reales, consejos reales, de viajeros reales.",
      heading: "Descubre adónde van los demás",
      para1: "Descubre destinos populares e ideas de viajeros como tú. Cada guía se basa en viajes reales.",
      para2: "Encuentra tu próxima aventura y empieza a planificar hoy.",
      cta: "Explorar destinos",
    },
    fr: {
      subject: "Inspirez-vous — explorez la communauté",
      preheader: "De vrais voyages, de vrais conseils, de vrais voyageurs.",
      heading: "Découvrez où vont les autres",
      para1: "Découvrez des destinations tendance et les conseils de voyageurs comme vous. Chaque guide s'appuie sur de vrais voyages.",
      para2: "Trouvez votre prochaine aventure et commencez à planifier dès aujourd'hui.",
      cta: "Explorer les destinations",
    },
    de: {
      subject: "Lass dich inspirieren — entdecke die Community",
      preheader: "Echte Reisen, echte Tipps, von echten Reisenden.",
      heading: "Entdecke, wohin andere reisen",
      para1: "Entdecke angesagte Reiseziele und Tipps von Reisenden wie dir. Jeder Guide basiert auf echten Reisen.",
      para2: "Finde dein nächstes Abenteuer und beginne noch heute mit der Planung.",
      cta: "Reiseziele entdecken",
    },
    ar: {
      subject: "استلهم — استكشف المجتمع",
      preheader: "رحلات حقيقية، ونصائح حقيقية، من مسافرين حقيقيين.",
      heading: "استكشف وجهات الآخرين",
      para1: "اكتشف الوجهات الرائجة ورؤى مسافرين مثلك. كل دليل مبني على رحلات حقيقية.",
      para2: "اعثر على مغامرتك القادمة وابدأ التخطيط اليوم.",
      cta: "استكشف الوجهات",
    },
  },
};

export const FOOTER_COPY: Record<Lang, { note: string; unsubscribe: string; disclosure: string; contact: string }> = {
  en: {
    note: "You're receiving this because you signed up for travel tips and deals from Planera.",
    unsubscribe: "Unsubscribe",
    disclosure: "Some links are partner links — Planera may earn a commission at no extra cost to you.",
    contact: "Hit reply — a real human reads every email. Or write to us at",
  },
  el: {
    note: "Λαμβάνετε αυτό το email επειδή εγγραφήκατε για ταξιδιωτικές συμβουλές και προσφορές από την Planera.",
    unsubscribe: "Διαγραφή",
    disclosure: "Ορισμένοι σύνδεσμοι είναι συνεργατικοί — η Planera μπορεί να λάβει προμήθεια χωρίς επιπλέον κόστος για εσάς.",
    contact: "Απαντήστε σε αυτό το email — το διαβάζει πραγματικός άνθρωπος. Ή γράψτε μας στο",
  },
  es: {
    note: "Recibes este correo porque te suscribiste para recibir consejos y ofertas de viaje de Planera.",
    unsubscribe: "Cancelar suscripción",
    disclosure: "Algunos enlaces son de socios — Planera puede ganar una comisión sin coste adicional para ti.",
    contact: "Responde a este correo — lo lee una persona real. O escríbenos a",
  },
  fr: {
    note: "Vous recevez cet e-mail car vous vous êtes inscrit pour recevoir des conseils et des offres de voyage de Planera.",
    unsubscribe: "Se désabonner",
    disclosure: "Certains liens sont des liens partenaires — Planera peut percevoir une commission sans frais supplémentaires pour vous.",
    contact: "Répondez à cet e-mail — une vraie personne le lit. Ou écrivez-nous à",
  },
  de: {
    note: "Du erhältst diese E-Mail, weil du dich für Reisetipps und Angebote von Planera angemeldet hast.",
    unsubscribe: "Abmelden",
    disclosure: "Einige Links sind Partnerlinks — Planera kann eine Provision erhalten, ohne dass dir zusätzliche Kosten entstehen.",
    contact: "Antworte einfach — ein echter Mensch liest jede E-Mail. Oder schreib uns an",
  },
  ar: {
    note: "تتلقى هذه الرسالة لأنك اشتركت للحصول على نصائح وعروض السفر من Planera.",
    unsubscribe: "إلغاء الاشتراك",
    disclosure: "بعض الروابط هي روابط شركاء — قد تحصل Planera على عمولة دون أي تكلفة إضافية عليك.",
    contact: "رد على هذه الرسالة — يقرأها شخص حقيقي. أو راسلنا على",
  },
};

// ---- Marketing visuals -----------------------------------------------------

// Full-width hero images (hosted on planeraai.app) used at the top of the
// marketing (drip) emails — one bright travel photo per stage.
/**
 * Hero images available to broadcast campaigns, by key. Campaigns (and the AI
 * generator) pick a key rather than an arbitrary URL, so a hallucinated or
 * broken image can never reach a subscriber.
 */
export const HERO_IMAGES: Record<string, string> = {
  welcome: `${BASE_URL}/nl-hero-welcome.jpg`,
  plan: `${BASE_URL}/nl-hero-plan.jpg`,
  flights: `${BASE_URL}/nl-hero-flights.jpg`,
  explore: `${BASE_URL}/nl-hero-explore.jpg`,
};

const STAGE_HERO_IMG: Record<EmailKey, string | null> = {
  confirm: null,
  welcome: `${BASE_URL}/nl-hero-welcome.jpg`,
  drip1: `${BASE_URL}/nl-hero-plan.jpg`,
  drip2: `${BASE_URL}/nl-hero-flights.jpg`,
  drip3: `${BASE_URL}/nl-hero-explore.jpg`,
};

// CJ (Commission Junction, publisher 101641262) banner creatives. `img` is the
// hosted creative; `click` is the commission-tracked redirect. Mirrors the
// DEALS_BANNERS in the website's affiliates.ts.
export interface CjBanner {
  img: string;
  click: string;
  alt: string;
}
export const CJ_BANNERS: Record<"tripcom" | "kiwi" | "welcome" | "lot" | "airserbia", CjBanner> = {
  tripcom: {
    img: "https://www.ftjcfx.com/image-101641262-15425634",
    click: "https://www.anrdoezrs.net/click-101641262-15425634",
    alt: "Trip.com — save on flights and hotels",
  },
  kiwi: {
    img: "https://www.ftjcfx.com/image-101641262-13236165",
    click: "https://www.kqzyfj.com/click-101641262-13236165",
    alt: "Kiwi.com — find cheap flights",
  },
  welcome: {
    img: "https://www.lduhtrp.net/image-101641262-17270340",
    click: "https://www.dpbolvw.net/click-101641262-17270340",
    alt: "Welcome Pickups — fixed-price airport transfers",
  },
  lot: {
    img: "https://www.awltovhc.com/image-101641262-16943091",
    click: "https://www.jdoqocy.com/click-101641262-16943091",
    alt: "LOT Polish Airlines — fly via Warsaw worldwide",
  },
  airserbia: {
    img: "https://www.awltovhc.com/image-101641262-14070094",
    click: "https://www.kqzyfj.com/click-101641262-14070094",
    alt: "Air Serbia — direct flights via Belgrade",
  },
};

// Which CJ banner (if any) each email stage shows. Drip emails are the
// marketing surface; confirm/welcome stay clean.
const STAGE_BANNER: Record<EmailKey, CjBanner | null> = {
  confirm: null,
  welcome: null,
  drip1: CJ_BANNERS.tripcom, // "plan a trip" → flights + hotels + packages
  drip2: CJ_BANNERS.kiwi, // "never overpay" → cheap flights
  drip3: CJ_BANNERS.welcome, // "explore / arrive" → airport transfers
};

// ---- Low-Fare Radar deal cards (shown inside the drip2 email) --------------

export interface DealForEmail {
  origin: string; // IATA departure code, used to derive the deal's country
  destination: string; // IATA arrival code (route blocks key off this)
  originCity: string;
  destinationCity: string;
  price: number;
  originalPrice?: number;
  currency: string;
  outboundDate: string;
  returnDate?: string;
  dealTag?: string;
  isRecommended?: boolean;
  // Route's typical fare from the last radar refresh. Powers the honest
  // urgency signals: "X% below typical" when well under it, "may not last"
  // when the fare has crept close to the auto-expiry ceiling.
  typicalPrice?: number;
}

// A deal must be at least this far under the typical fare before we brag about
// it — a 3% saving as a badge would read as noise.
const BELOW_TYPICAL_MIN_PCT = 8;
// Fares within this fraction of the typical price are one refresh away from
// the low-fare ceiling (ratio 1.0 in lowFareRadarRefresh.ts) auto-expiring
// them — flag them as unlikely to last. Genuine scarcity, never invented.
const ENDING_SOON_RATIO = 0.92;

/**
 * Honest price context for a deal card: percentage below the route's typical
 * fare, or an "about to expire" warning — never both, and nothing at all when
 * the deal has no measured typical price yet.
 */
export function dealPriceSignal(
  d: Pick<DealForEmail, "price" | "typicalPrice">,
): { kind: "below_typical"; pct: number } | { kind: "ending_soon" } | null {
  if (!d.typicalPrice || d.typicalPrice <= 0 || d.price <= 0) return null;
  const pct = Math.round((1 - d.price / d.typicalPrice) * 100);
  if (pct >= BELOW_TYPICAL_MIN_PCT) return { kind: "below_typical", pct };
  if (d.price >= d.typicalPrice * ENDING_SOON_RATIO) return { kind: "ending_soon" };
  return null;
}

const DEALS_LABELS: Record<
  Lang,
  {
    heading: string; viewAll: string; perPerson: string; roundTrip: string; oneWay: string;
    // "{pct}" is replaced with the rounded percentage.
    belowTypical: string; endingSoon: string;
  }
> = {
  en: { heading: "Live fares right now", viewAll: "See all deals", perPerson: "per person", roundTrip: "Round trip", oneWay: "One way", belowTypical: "{pct}% below typical", endingSoon: "May not last" },
  el: { heading: "Ζωντανές τιμές τώρα", viewAll: "Δείτε όλες τις προσφορές", perPerson: "ανά άτομο", roundTrip: "Μετ' επιστροφής", oneWay: "Απλή μετάβαση", belowTypical: "{pct}% κάτω από τη συνήθη τιμή", endingSoon: "Ίσως δεν κρατήσει" },
  es: { heading: "Tarifas en directo", viewAll: "Ver todas las ofertas", perPerson: "por persona", roundTrip: "Ida y vuelta", oneWay: "Solo ida", belowTypical: "{pct}% por debajo de lo habitual", endingSoon: "Puede agotarse" },
  fr: { heading: "Tarifs en direct", viewAll: "Voir toutes les offres", perPerson: "par personne", roundTrip: "Aller-retour", oneWay: "Aller simple", belowTypical: "{pct}% sous le prix habituel", endingSoon: "Risque de disparaître" },
  de: { heading: "Aktuelle Preise", viewAll: "Alle Angebote ansehen", perPerson: "pro Person", roundTrip: "Hin & zurück", oneWay: "Nur Hinflug", belowTypical: "{pct}% unter dem üblichen Preis", endingSoon: "Bald wohl weg" },
  ar: { heading: "أسعار مباشرة الآن", viewAll: "عرض كل العروض", perPerson: "للشخص", roundTrip: "ذهاب وعودة", oneWay: "ذهاب فقط", belowTypical: "أقل بنسبة {pct}% من السعر المعتاد", endingSoon: "قد لا يدوم" },
};

function formatDealPrice(amount: number, currency: string, lang: Lang): string {
  try {
    return new Intl.NumberFormat(lang, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

function formatDealDate(dateStr: string, lang: Lang): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  try {
    return new Intl.DateTimeFormat(lang, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return dateStr;
  }
}

/** Builds a full email row (<tr>) showcasing live Low-Fare Radar deals. */
export function renderDealsBlock(deals: DealForEmail[], lang: Lang): string {
  if (!deals.length) return "";
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const priceAlign = rtl ? "left" : "right";
  const L = DEALS_LABELS[lang];
  const dealsUrl = `${BASE_URL}/deals`;

  const cards = deals
    .map((d) => {
      const route = `${d.originCity} → ${d.destinationCity}`;
      const price = formatDealPrice(d.price, d.currency, lang);
      const orig =
        d.originalPrice && d.originalPrice > d.price
          ? formatDealPrice(d.originalPrice, d.currency, lang)
          : "";
      const dates = d.returnDate
        ? `${formatDealDate(d.outboundDate, lang)} – ${formatDealDate(d.returnDate, lang)}`
        : formatDealDate(d.outboundDate, lang);
      const tag = d.dealTag
        ? `<span style="display:inline-block;background:#FFF6C2;color:#7A6A00;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;padding:3px 8px;border-radius:6px;">${d.dealTag}</span>`
        : "";
      // Price-context badge from real refresh data: green "X% below typical"
      // when the fare is genuinely under the route's usual price, amber
      // "may not last" when it's close to the auto-expiry ceiling.
      const signal = dealPriceSignal(d);
      const signalTag =
        signal?.kind === "below_typical"
          ? `<span style="display:inline-block;background:#E4F6E9;color:#1E7A3C;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;padding:3px 8px;border-radius:6px;${tag ? `margin-${rtl ? "right" : "left"}:6px;` : ""}">${L.belowTypical.replace("{pct}", String(signal.pct))}</span>`
          : signal?.kind === "ending_soon"
            ? `<span style="display:inline-block;background:#FDEEDC;color:#B4610E;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;padding:3px 8px;border-radius:6px;${tag ? `margin-${rtl ? "right" : "left"}:6px;` : ""}">${L.endingSoon}</span>`
            : "";
      const tags = `${tag}${signalTag}`;
      return `
        <a href="${dealsUrl}" target="_blank" style="text-decoration:none;display:block;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:12px;margin-bottom:10px;">
            <tr>
              <td style="padding:14px 16px;vertical-align:middle;direction:${dir};text-align:${align};">
                ${tags}
                <p style="margin:${tags ? "6px" : "0"} 0 2px;font-size:16px;font-weight:700;color:#1A1A1A;">${route}</p>
                <p style="margin:0;font-size:12px;color:#8A8A8A;">${dates} · ${d.returnDate ? L.roundTrip : L.oneWay}</p>
              </td>
              <td width="96" style="padding:14px 16px;vertical-align:middle;text-align:${priceAlign};white-space:nowrap;">
                ${orig ? `<p style="margin:0;font-size:12px;color:#B0B0B0;text-decoration:line-through;">${orig}</p>` : ""}
                <p style="margin:0;font-size:20px;font-weight:800;color:#1A1A1A;">${price}</p>
                <p style="margin:0;font-size:10px;color:#8A8A8A;">${L.perPerson}</p>
              </td>
            </tr>
          </table>
        </a>`;
    })
    .join("");

  return `
      <tr><td style="padding:4px 40px 20px;direction:${dir};text-align:${align};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#8A8A8A;">${L.heading}</p>
        ${cards}
        <a href="${dealsUrl}" target="_blank" style="display:inline-block;margin-top:2px;font-size:14px;font-weight:700;color:#1A1A1A;text-decoration:underline;">${L.viewAll}</a>
      </td></tr>`;
}

/**
 * Shared branded email shell. Returns a full HTML document, localized and
 * direction-aware (RTL for Arabic).
 */
export function renderEmail(opts: {
  lang: Lang;
  preheader: string;
  heading: string;
  para1: string;
  para2: string;
  ctaText: string;
  ctaUrl: string;
  unsubscribeUrl: string;
  heroImg?: string;
  banner?: CjBanner | null;
  dealsBlock?: string;
  // Marketing emails show a small invite-your-travel-buddies nudge above the
  // footer; transactional emails (confirm) leave it off.
  invite?: boolean;
}): string {
  const year = new Date().getFullYear();
  const rtl = opts.lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const footer = FOOTER_COPY[opts.lang];
  const invite = INVITE_COPY[opts.lang];

  const inviteRow = opts.invite
    ? `
      <tr><td style="padding:0 40px 24px;direction:${dir};text-align:${align};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:12px;">
          <tr><td style="padding:14px 16px;direction:${dir};text-align:${align};">
            <p style="margin:0;font-size:13px;line-height:1.55;color:#4A4A4A;">${invite.text} <a href="${BASE_URL}" target="_blank" style="color:#1A1A1A;font-weight:700;text-decoration:underline;">${invite.link}</a></p>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const heroRow = opts.heroImg
    ? `
      <tr><td style="padding:20px 40px 0;">
        <img src="${opts.heroImg}" alt="" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:14px;outline:none;text-decoration:none;" />
      </td></tr>`
    : "";

  const bannerRow = opts.banner
    ? `
      <tr><td align="center" style="padding:8px 40px 28px;">
        <a href="${opts.banner.click}" target="_blank" style="text-decoration:none;display:inline-block;">
          <img src="${opts.banner.img}" alt="${opts.banner.alt}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:10px;outline:none;text-decoration:none;" />
        </a>
        <p style="margin:10px 0 0;font-size:11px;line-height:1.5;color:#B0B0B0;direction:${dir};text-align:${align};">${footer.disclosure}</p>
      </td></tr>`
    : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" dir="${dir}" lang="${opts.lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${opts.heading}</title>
<!--[if mso]><style>table,td,div,h1,p{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body dir="${dir}" style="margin:0;padding:0;background:#FAF9F6;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;font-size:1px;color:#FAF9F6;line-height:1px;">
${opts.preheader}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:20px;box-shadow:0 4px 24px rgba(26,26,26,0.06);overflow:hidden;">
      <tr><td align="${align}" style="padding:32px 40px 0;">
        <a href="${BASE_URL}" style="text-decoration:none;display:inline-block;"><img src="${BASE_URL}/logo.png" alt="Planera" width="140" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;text-decoration:none;" /></a>
      </td></tr>${heroRow}
      <tr><td style="padding:24px 40px 8px;direction:${dir};text-align:${align};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;font-weight:800;color:#1A1A1A;letter-spacing:-0.6px;">${opts.heading}</h1>
        <div style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#4A4A4A;">
          <p style="margin:0 0 12px;">${opts.para1}</p>
          <p style="margin:0;">${opts.para2}</p>
        </div>
      </td></tr>
      <tr><td align="${align}" style="padding:0 40px 28px;direction:${dir};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:12px;background:#FFE500;">
          <a href="${opts.ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#1A1A1A;text-decoration:none;border-radius:12px;">${opts.ctaText}</a>
        </td></tr></table>
      </td></tr>${opts.dealsBlock ?? ""}${inviteRow}${bannerRow}
      <tr><td style="padding:24px 40px 32px;border-top:1px solid #F0EEE9;direction:${dir};text-align:${align};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#4A4A4A;">${footer.contact} <a href="mailto:${MARKETING_EMAIL}" style="color:#1A1A1A;font-weight:600;text-decoration:underline;">${MARKETING_EMAIL}</a></p>
        <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#9A9A9A;">${footer.note}</p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#9A9A9A;">© ${year} Planera · <a href="${opts.unsubscribeUrl}" style="color:#9A9A9A;text-decoration:underline;">${footer.unsubscribe}</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function confirmEmail(
  language: string | undefined,
  confirmToken: string,
  unsubscribeToken: string,
): {
  subject: string;
  html: string;
  text: string;
} {
  const lang = normalizeLang(language);
  const c = EMAIL_COPY.confirm[lang];
  const confirmUrl = `${BASE_URL}/newsletter/confirm?token=${confirmToken}`;
  const unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?token=${unsubscribeToken}`;
  return {
    subject: c.subject,
    html: renderEmail({
      lang,
      preheader: c.preheader,
      heading: c.heading,
      para1: c.para1,
      para2: c.para2,
      ctaText: c.cta,
      ctaUrl: confirmUrl,
      unsubscribeUrl,
    }),
    text:
      `${c.heading}\n\n${c.para1}\n\n${c.para2}\n\n` +
      `${c.cta}: ${confirmUrl}\n\n` +
      `${FOOTER_COPY[lang].contact} ${MARKETING_EMAIL}\n\n` +
      `${FOOTER_COPY[lang].unsubscribe}: ${unsubscribeUrl}`,
  };
}

/**
 * Welcome email (drip stage 0) + the ongoing drip sequence (stages 1..N).
 * `stage` 0 = welcome, 1..MAX_DRIP_STAGE = drip emails.
 */
const STAGE_KEYS: EmailKey[] = ["welcome", "drip1", "drip2", "drip3"];
const STAGE_CTA_URL: Record<EmailKey, string> = {
  confirm: `${BASE_URL}/newsletter/confirm`,
  welcome: APP_STORE_URL,
  drip1: APP_STORE_URL,
  drip2: `${BASE_URL}/explore`,
  drip3: `${BASE_URL}/explore`,
};

function dripEmail(
  stage: number,
  language: string | undefined,
  unsubscribeToken: string,
  deals?: DealForEmail[],
): { subject: string; html: string; text: string } {
  const lang = normalizeLang(language);
  const key = STAGE_KEYS[stage] ?? "welcome";
  const c = EMAIL_COPY[key][lang];
  const ctaUrl = STAGE_CTA_URL[key];
  const unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?token=${unsubscribeToken}`;

  // Low-Fare Radar deal cards appear in the welcome email (the signup promise:
  // "this week's top deals in your first email") and the drip2 ("Low-Fare
  // Radar") email.
  const showDeals = key === "welcome" || key === "drip2";
  const dealsBlock =
    showDeals && deals && deals.length
      ? renderDealsBlock(deals, lang)
      : undefined;

  const dealsText =
    showDeals && deals && deals.length
      ? "\n\n" +
        deals
          .map((d) => {
            const signal = dealPriceSignal(d);
            const note =
              signal?.kind === "below_typical"
                ? ` (${DEALS_LABELS[lang].belowTypical.replace("{pct}", String(signal.pct))})`
                : "";
            return `${d.originCity} → ${d.destinationCity}: ${formatDealPrice(d.price, d.currency, lang)}${note}`;
          })
          .join("\n")
      : "";

  return {
    subject: c.subject,
    html: renderEmail({
      lang,
      preheader: c.preheader,
      heading: c.heading,
      para1: c.para1,
      para2: c.para2,
      ctaText: c.cta,
      ctaUrl,
      unsubscribeUrl,
      heroImg: STAGE_HERO_IMG[key] ?? undefined,
      banner: STAGE_BANNER[key],
      dealsBlock,
      // Marketing sequence gets the invite nudge; stage 0 (welcome) included.
      invite: true,
    }),
    text:
      `${c.heading}\n\n${c.para1}\n\n${c.para2}${dealsText}\n\n` +
      `${INVITE_COPY[lang].text} ${BASE_URL}\n\n` +
      `${c.cta}: ${ctaUrl}\n\n` +
      `${FOOTER_COPY[lang].contact} ${MARKETING_EMAIL}\n\n` +
      `${FOOTER_COPY[lang].unsubscribe}: ${unsubscribeUrl}`,
  };
}

// ---------------------------------------------------------------------------
// Public mutations
// ---------------------------------------------------------------------------

/**
 * Public social-proof counter for the marketing site's signup card.
 * Returns the confirmed-subscriber count rounded DOWN (nearest 50 under 1000,
 * nearest 100 above), and 0 while under 100 so the site can hide the line
 * until the number is worth showing.
 */
export const subscriberCount = query({
  args: {},
  returns: v.object({ count: v.float64() }),
  handler: async (ctx) => {
    const subs = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const n = subs.length;
    if (n < 100) return { count: 0 };
    const step = n >= 1000 ? 100 : 50;
    return { count: Math.floor(n / step) * step };
  },
});

/**
 * Capture an email into the newsletter funnel (double opt-in).
 * Idempotent per email: already-active subscribers are left untouched.
 */
export const subscribe = mutation({
  args: {
    email: v.string(),
    source: v.optional(v.string()),
    language: v.optional(v.string()),
    country: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    status: v.union(
      v.literal("pending"),
      v.literal("already_active"),
    ),
  }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!EMAIL_REGEX.test(email)) {
      throw new ConvexError("Please enter a valid email address.");
    }

    const existing = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    // Already subscribed & confirmed — nothing to do (don't leak status, just succeed).
    if (existing && existing.status === "active") {
      return { success: true, status: "already_active" as const };
    }

    const now = Date.now();
    const confirmToken = randomToken();
    const unsubscribeToken = existing?.unsubscribeToken ?? randomToken();
    const country = normalizeCountry(args.country);

    if (existing) {
      // Re-arm a pending / previously-unsubscribed row.
      await ctx.db.patch(existing._id, {
        status: "pending",
        source: args.source ?? existing.source,
        language: args.language ?? existing.language,
        country: country ?? existing.country,
        userId: args.userId ?? existing.userId,
        confirmToken,
        unsubscribeToken,
        dripStage: 0,
        confirmedAt: undefined,
        unsubscribedAt: undefined,
      });
    } else {
      await ctx.db.insert("newsletterSubscribers", {
        email,
        status: "pending",
        source: args.source,
        language: args.language,
        country,
        userId: args.userId,
        confirmToken,
        unsubscribeToken,
        dripStage: 0,
        createdAt: now,
      });
    }

    // Send the double opt-in confirmation email.
    const mail = confirmEmail(
      args.language ?? existing?.language,
      confirmToken,
      unsubscribeToken,
    );
    await ctx.scheduler.runAfter(0, internal.postmark.sendRawEmail, {
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      from: MARKETING_FROM,
      replyTo: MARKETING_EMAIL,
    });

    return { success: true, status: "pending" as const };
  },
});

/**
 * Confirm a subscription via the double opt-in token, then send the welcome email.
 */
export const confirm = mutation({
  args: { token: v.string() },
  returns: v.object({
    success: v.boolean(),
    alreadyConfirmed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_confirm_token", (q) => q.eq("confirmToken", args.token))
      .unique();

    if (!sub) {
      throw new ConvexError("This confirmation link is invalid or has expired.");
    }

    if (sub.status === "active") {
      return { success: true, alreadyConfirmed: true };
    }

    const now = Date.now();
    await ctx.db.patch(sub._id, {
      status: "active",
      confirmedAt: now,
      unsubscribedAt: undefined,
      dripStage: 0,
      lastEmailSentAt: now,
    });

    // Send the welcome email (drip stage 0) with this week's featured deals —
    // the "lead magnet" promised on the signup form. Prefer deals departing
    // from the subscriber's own country.
    const allDeals = await queryFeaturedDeals(ctx.db);
    const featuredDeals = pickTopDeals(allDeals, sub.country);
    const mail = dripEmail(0, sub.language, sub.unsubscribeToken, featuredDeals);
    await ctx.scheduler.runAfter(0, internal.postmark.sendRawEmail, {
      to: sub.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      from: MARKETING_FROM,
      replyTo: MARKETING_EMAIL,
    });

    return { success: true, alreadyConfirmed: false };
  },
});

/**
 * Unsubscribe via the token embedded in every email footer.
 */
export const unsubscribe = mutation({
  args: { token: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_unsubscribe_token", (q) =>
        q.eq("unsubscribeToken", args.token),
      )
      .unique();

    // Always report success to avoid leaking whether an address is on the list.
    if (!sub) {
      return { success: true };
    }

    if (sub.status !== "unsubscribed") {
      await ctx.db.patch(sub._id, {
        status: "unsubscribed",
        unsubscribedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Drip sequence (internal)
// ---------------------------------------------------------------------------

/**
 * Active subscribers due for their next drip email.
 */
export const getDueDripSubscribers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DRIP_INTERVAL_MS;
    const active = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    return active
      .filter(
        (s) =>
          s.dripStage < MAX_DRIP_STAGE &&
          (s.lastEmailSentAt ?? 0) <= cutoff,
      )
      .slice(0, DRIP_BATCH_SIZE)
      .map((s) => ({
        _id: s._id,
        email: s.email,
        dripStage: s.dripStage,
        language: s.language,
        country: s.country,
        unsubscribeToken: s.unsubscribeToken,
      }));
  },
});

/**
 * Advance a subscriber to the next drip stage after their email was sent.
 */
export const advanceDripStage = internalMutation({
  args: { subscriberId: v.id("newsletterSubscribers"), nextStage: v.float64() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriberId);
    // Guard against races / mid-flight unsubscribes.
    if (!sub || sub.status !== "active") return null;
    await ctx.db.patch(args.subscriberId, {
      dripStage: args.nextStage,
      lastEmailSentAt: Date.now(),
    });
    return null;
  },
});

/**
 * Top live Low-Fare Radar deals to feature in the drip2 email.
 * Recommended deals first, then cheapest. Max 3.
 */
export const getFeaturedDeals = internalQuery({
  args: {},
  handler: async (ctx): Promise<DealForEmail[]> => {
    return await queryFeaturedDeals(ctx.db);
  },
});

/**
 * All active Low-Fare Radar deals, sorted recommended-first then cheapest,
 * mapped to the email shape (incl. `origin` so a deal's country can be
 * derived). Callers slice/geo-filter via `pickTopDeals`.
 */
export async function queryFeaturedDeals(db: {
  query: (table: "lowFareRadar") => any;
}): Promise<DealForEmail[]> {
  const now = Date.now();
  const deals = await db
    .query("lowFareRadar")
    .withIndex("by_active", (q: any) => q.eq("active", true))
    .collect();

  const activeDeals = deals.filter(
    (d: any) =>
      d.active && !d.deletedAt && (!d.expiresAt || d.expiresAt > now),
  );

  activeDeals.sort((a: any, b: any) => {
    if (!!a.isRecommended !== !!b.isRecommended) return a.isRecommended ? -1 : 1;
    return a.price - b.price;
  });

  return activeDeals.map((d: any) => ({
    origin: d.origin,
    destination: d.destination,
    originCity: d.originCity,
    destinationCity: d.destinationCity,
    price: d.price,
    originalPrice: d.originalPrice,
    currency: d.currency,
    outboundDate: d.outboundDate,
    returnDate: d.returnDate,
    dealTag: d.dealTag,
    isRecommended: d.isRecommended,
    typicalPrice: d.typicalPrice,
  }));
}

/**
 * Pick the top `max` deals for a subscriber's country. Deals departing from
 * that country (by origin IATA) are preferred; if none exist we fall back to
 * the global-cheapest list so an email is never left without deals. `deals`
 * must already be sorted (recommended-first, price asc) — as returned by
 * `queryFeaturedDeals`.
 */
export function pickTopDeals(
  deals: DealForEmail[],
  country?: string,
  max = 3,
): DealForEmail[] {
  if (country) {
    const local = deals.filter((d) => iataToCountry(d.origin) === country);
    if (local.length) return local.slice(0, max);
  }
  return deals.slice(0, max);
}

// ---------------------------------------------------------------------------
// Enrichment content for marketing campaigns
//
// The AI newsletter generator and manual composer can add optional sections
// beyond the flight-deals block. Each source has a `queryFeatured*` helper
// (shared with the internalQuery so a query context can call it directly) and
// a matching `render*Block` HTML renderer. All blocks:
//   - take an already-picked, already-sorted list — the caller decides how
//     many and for whom, so the renderer stays pure and testable;
//   - collapse to "" when the list is empty, so a missing block never leaves
//     an orphan heading or an empty grey box;
//   - are RTL-aware and use the same table markup as `renderDealsBlock` for
//     consistent rendering across Gmail / Outlook / Apple Mail.
// ---------------------------------------------------------------------------

export interface ItineraryForEmail {
  slug: string;
  destination: string;
  country: string;
  countryCode?: string; // ISO-2 lowercase, when we could infer one
  durationDays: number;
  title: string;
  metaDescription: string;
  budgetLevel: string;
  bestSeason?: string;
  heroImage?: string;
}

export interface SightForEmail {
  destinationKey: string;   // "paris-france" — used to build the /explore link
  destinationLabel: string; // "Paris, France" — human display
  name: string;
  shortDescription: string;
  neighborhoodOrArea?: string;
  bestTimeToVisit?: string;
}

export interface AttractionForEmail {
  displayTitle: string;
  destinationCity: string;
  destinationCountry?: string;
  price?: number;
  currency?: string;
  affiliateUrl: string;
  topSite?: boolean;
}

export interface PackageForEmail {
  title: string;
  subtitle?: string;
  destinationCity?: string;
  destinationCountry: string;
  durationDays: number;
  priceFrom: number;
  priceCurrency: string;
  priceUnit?: "per_person" | "per_couple" | "total";
  includes: string[];
  heroImageUrl?: string;
  externalUrl?: string;
  badge?: string;
}

// Labels for the enrichment section headings + CTAs, in every supported
// language. Keeping them in one place makes it trivial to add a language and
// obvious when a translation is missing.
const ITIN_LABELS: Record<Lang, { heading: string; viewAll: string; days: string }> = {
  en: { heading: "Fresh itineraries to steal", viewAll: "Browse more itineraries", days: "days" },
  el: { heading: "Έτοιμα προγράμματα ταξιδιού", viewAll: "Δείτε κι άλλα προγράμματα", days: "ημέρες" },
  es: { heading: "Itinerarios para inspirarte", viewAll: "Ver más itinerarios", days: "días" },
  fr: { heading: "Des itinéraires à piquer", viewAll: "Voir plus d'itinéraires", days: "jours" },
  de: { heading: "Reiserouten zum Nachreisen", viewAll: "Mehr Reiserouten ansehen", days: "Tage" },
  ar: { heading: "برامج جاهزة للاقتباس", viewAll: "تصفح المزيد من البرامج", days: "أيام" },
};

const SIGHTS_LABELS: Record<Lang, { heading: string; viewAll: string }> = {
  en: { heading: "Sights worth planning around", viewAll: "Explore destinations" },
  el: { heading: "Αξιοθέατα που αξίζουν", viewAll: "Εξερευνήστε προορισμούς" },
  es: { heading: "Lugares imprescindibles", viewAll: "Explora destinos" },
  fr: { heading: "Des sites à ne pas manquer", viewAll: "Explorer les destinations" },
  de: { heading: "Sehenswertes für die Route", viewAll: "Reiseziele entdecken" },
  ar: { heading: "معالم تستحق التخطيط لها", viewAll: "استكشف الوجهات" },
};

const ATTR_LABELS: Record<Lang, { heading: string; from: string; book: string }> = {
  en: { heading: "Book something to look forward to", from: "from", book: "Book now" },
  el: { heading: "Κλείστε κάτι που περιμένετε", from: "από", book: "Κράτηση τώρα" },
  es: { heading: "Reserva algo que esperar con ilusión", from: "desde", book: "Reservar ahora" },
  fr: { heading: "Réservez quelque chose à attendre", from: "à partir de", book: "Réserver" },
  de: { heading: "Reservieren, worauf du dich freuen kannst", from: "ab", book: "Jetzt buchen" },
  ar: { heading: "احجز شيئًا تتطلع إليه", from: "ابتداءً من", book: "احجز الآن" },
};

const PKG_LABELS: Record<Lang, { heading: string; from: string; details: string; nights: string }> = {
  en: { heading: "All-in-one holiday packages", from: "from", details: "See package", nights: "nights" },
  el: { heading: "Ολοκληρωμένα πακέτα διακοπών", from: "από", details: "Δείτε το πακέτο", nights: "διανυκτερεύσεις" },
  es: { heading: "Paquetes de vacaciones todo en uno", from: "desde", details: "Ver paquete", nights: "noches" },
  fr: { heading: "Séjours tout compris", from: "à partir de", details: "Voir le séjour", nights: "nuits" },
  de: { heading: "All-inclusive-Reisepakete", from: "ab", details: "Paket ansehen", nights: "Nächte" },
  ar: { heading: "باقات إجازة متكاملة", from: "ابتداءً من", details: "عرض الباقة", nights: "ليالٍ" },
};

/** Rough number formatting, currency-safe, falling back if Intl chokes. */
function formatMoney(amount: number, currency: string, lang: Lang): string {
  try {
    return new Intl.NumberFormat(lang, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

/** Section header (uppercase, muted) — reused by every enrichment block. */
function sectionHeader(text: string, dir: string, align: string): string {
  return `<p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#8A8A8A;direction:${dir};text-align:${align};">${text}</p>`;
}

/** Section wrapper (<tr><td>…</td></tr>) with the block's shared padding. */
function sectionShell(inner: string, dir: string, align: string): string {
  return `<tr><td style="padding:4px 40px 20px;direction:${dir};text-align:${align};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${inner}</td></tr>`;
}

/**
 * Cards linking to /explore/[slug]. If an itinerary has a heroImage we render
 * an image-left layout; otherwise a text-only card, so a partially-populated
 * itinerary still looks intentional rather than broken.
 */
export function renderItinerariesBlock(items: ItineraryForEmail[], lang: Lang): string {
  if (!items.length) return "";
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const L = ITIN_LABELS[lang];

  const cards = items
    .map((i) => {
      const href = `${BASE_URL}/explore/${encodeURIComponent(i.slug)}`;
      const meta = `${i.destination} · ${Math.round(i.durationDays)} ${L.days}`;
      const image = i.heroImage
        ? `<td width="112" style="padding:0;vertical-align:middle;"><img src="${i.heroImage}" alt="" width="112" style="display:block;width:112px;height:88px;object-fit:cover;border:0;outline:none;border-radius:12px 0 0 12px;" /></td>`
        : "";
      return `
        <a href="${href}" target="_blank" style="text-decoration:none;display:block;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:12px;margin-bottom:10px;overflow:hidden;">
            <tr>
              ${image}
              <td style="padding:14px 16px;vertical-align:middle;direction:${dir};text-align:${align};">
                <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1A1A1A;">${i.title}</p>
                <p style="margin:0 0 4px;font-size:12px;color:#8A8A8A;">${meta}</p>
                <p style="margin:0;font-size:12px;color:#5A5A5A;line-height:1.4;">${truncate(i.metaDescription, 110)}</p>
              </td>
            </tr>
          </table>
        </a>`;
    })
    .join("");

  return sectionShell(
    `${sectionHeader(L.heading, dir, align)}${cards}<a href="${BASE_URL}/explore" target="_blank" style="display:inline-block;margin-top:2px;font-size:14px;font-weight:700;color:#1A1A1A;text-decoration:underline;">${L.viewAll}</a>`,
    dir, align,
  );
}

/**
 * Compact bullet list of top sights. No CTA per row — sights are inspiration,
 * not affiliate content; one CTA at the bottom points at /explore.
 */
export function renderSightsBlock(items: SightForEmail[], lang: Lang): string {
  if (!items.length) return "";
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const L = SIGHTS_LABELS[lang];

  const rows = items
    .map((s) => {
      const sub = [s.neighborhoodOrArea, s.bestTimeToVisit].filter(Boolean).join(" · ");
      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #F0EFE9;direction:${dir};text-align:${align};">
            <p style="margin:0;font-size:15px;font-weight:700;color:#1A1A1A;">${s.name}</p>
            ${sub ? `<p style="margin:2px 0 0;font-size:11px;color:#8A8A8A;">${sub}</p>` : ""}
            <p style="margin:4px 0 0;font-size:13px;color:#5A5A5A;line-height:1.45;">${truncate(s.shortDescription, 140)}</p>
          </td>
        </tr>`;
    })
    .join("");

  return sectionShell(
    `${sectionHeader(L.heading, dir, align)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table><a href="${BASE_URL}/explore" target="_blank" style="display:inline-block;margin-top:14px;font-size:14px;font-weight:700;color:#1A1A1A;text-decoration:underline;">${L.viewAll}</a>`,
    dir, align,
  );
}

/**
 * Bookable-attraction cards. Each row is its own affiliate link; the
 * unsubscribe / brand voice stays intact even if the partner site changes,
 * because we don't inline their branding.
 */
export function renderAttractionsBlock(items: AttractionForEmail[], lang: Lang): string {
  if (!items.length) return "";
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const priceAlign = rtl ? "left" : "right";
  const L = ATTR_LABELS[lang];

  const cards = items
    .map((a) => {
      const price =
        a.price != null && a.currency
          ? `<p style="margin:0;font-size:11px;color:#8A8A8A;">${L.from}</p>
             <p style="margin:0;font-size:18px;font-weight:800;color:#1A1A1A;">${formatMoney(a.price, a.currency, lang)}</p>`
          : "";
      return `
        <a href="${a.affiliateUrl}" target="_blank" rel="sponsored noopener" style="text-decoration:none;display:block;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:12px;margin-bottom:10px;">
            <tr>
              <td style="padding:14px 16px;vertical-align:middle;direction:${dir};text-align:${align};">
                <p style="margin:0;font-size:15px;font-weight:700;color:#1A1A1A;">${a.displayTitle}</p>
                <p style="margin:2px 0 0;font-size:11px;color:#8A8A8A;">${a.destinationCity}</p>
              </td>
              <td width="96" style="padding:14px 16px;vertical-align:middle;text-align:${priceAlign};white-space:nowrap;">
                ${price}
              </td>
            </tr>
          </table>
        </a>`;
    })
    .join("");

  return sectionShell(`${sectionHeader(L.heading, dir, align)}${cards}`, dir, align);
}

/**
 * Partner-package cards. `externalUrl` opens the partner's booking site; if a
 * package has no URL (unlikely, but the schema allows it) we drop the whole
 * card rather than link to nowhere.
 */
export function renderPackagesBlock(items: PackageForEmail[], lang: Lang): string {
  const linkable = items.filter((p) => p.externalUrl);
  if (!linkable.length) return "";
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const priceAlign = rtl ? "left" : "right";
  const L = PKG_LABELS[lang];

  const cards = linkable
    .map((p) => {
      const dest = [p.destinationCity, p.destinationCountry].filter(Boolean).join(", ");
      const nights = Math.max(1, Math.round(p.durationDays - 1));
      const includes = p.includes.slice(0, 4).map(
        (t) => `<span style="display:inline-block;background:#FFF6C2;color:#7A6A00;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;padding:3px 8px;border-radius:6px;margin:2px 4px 0 0;">${t}</span>`,
      ).join("");
      const badge = p.badge
        ? `<span style="display:inline-block;background:#1A1A1A;color:#FFE500;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;padding:3px 8px;border-radius:6px;">${p.badge}</span>`
        : "";
      const image = p.heroImageUrl
        ? `<td width="112" style="padding:0;vertical-align:middle;"><img src="${p.heroImageUrl}" alt="" width="112" style="display:block;width:112px;height:112px;object-fit:cover;border:0;outline:none;border-radius:12px 0 0 12px;" /></td>`
        : "";
      return `
        <a href="${p.externalUrl}" target="_blank" rel="sponsored noopener" style="text-decoration:none;display:block;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:12px;margin-bottom:10px;overflow:hidden;">
            <tr>
              ${image}
              <td style="padding:14px 16px;vertical-align:top;direction:${dir};text-align:${align};">
                ${badge}
                <p style="margin:${badge ? "6px" : "0"} 0 2px;font-size:15px;font-weight:700;color:#1A1A1A;">${p.title}</p>
                <p style="margin:0 0 6px;font-size:11px;color:#8A8A8A;">${dest} · ${nights} ${L.nights}</p>
                ${includes}
              </td>
              <td width="110" style="padding:14px 16px;vertical-align:middle;text-align:${priceAlign};white-space:nowrap;">
                <p style="margin:0;font-size:11px;color:#8A8A8A;">${L.from}</p>
                <p style="margin:0;font-size:18px;font-weight:800;color:#1A1A1A;">${formatMoney(p.priceFrom, p.priceCurrency, lang)}</p>
              </td>
            </tr>
          </table>
        </a>`;
    })
    .join("");

  return sectionShell(`${sectionHeader(L.heading, dir, align)}${cards}`, dir, align);
}

// ---------------------------------------------------------------------------
// Guides block — the bilingual /guides SEO landing pages on the website.
//
// These pages are static content in the web repo (src/data/landingPages.ts),
// so the backend can't query them; the list below is a hand-kept mirror of the
// live slugs. KEEP IN LOCKSTEP with the web repo — a renamed slug here means a
// 404 in a sent email. Guides exist in English and Greek only; every other
// audience language links the English page.
// ---------------------------------------------------------------------------

export interface GuideForEmail {
  slug: string;
  title: string;
  description: string;
}

const GUIDE_PAGES: Array<{
  id: string;
  // Restrict a locally-relevant guide to one audience country (ISO-2). The
  // language check still applies: Greek readers always qualify for "gr".
  onlyForCountry?: string;
  en: GuideForEmail;
  el: GuideForEmail;
}> = [
  {
    id: "cheapest-dates",
    en: { slug: "cheapest-travel-dates", title: "Find the cheapest dates to travel", description: "How to spot the cheapest weeks to fly — and let the calendar do the work." },
    el: { slug: "fthinoteres-imerominies-taxidiou", title: "Βρες τις φθηνότερες ημερομηνίες για ταξίδι", description: "Πώς να εντοπίσεις τις πιο οικονομικές εβδομάδες για να πετάξεις." },
  },
  {
    id: "create-itinerary",
    en: { slug: "create-travel-itinerary", title: "Create a travel itinerary with AI", description: "From an empty form to a full day-by-day plan in seconds." },
    el: { slug: "dimiourgia-taxidiotikou-programmatos", title: "Δημιουργία ταξιδιωτικού προγράμματος με AI", description: "Από μια κενή φόρμα σε πλήρες ημερήσιο πρόγραμμα σε δευτερόλεπτα." },
  },
  {
    id: "rome-5-days",
    en: { slug: "5-days-in-rome", title: "Plan 5 perfect days in Rome", description: "A ready-made Rome itinerary you can copy, tweak and follow." },
    el: { slug: "5-imeres-sti-romi", title: "Οργάνωσε 5 τέλειες ημέρες στη Ρώμη", description: "Ένα έτοιμο πρόγραμμα για τη Ρώμη που μπορείς να προσαρμόσεις." },
  },
  {
    id: "flight-hotel-planner",
    en: { slug: "flight-and-hotel-trip-planner", title: "Flight and hotel trip planner, in one place", description: "Plan the route, the stay and the budget without ten open tabs." },
    el: { slug: "programmatismos-ptisis-ksenodocheiou", title: "Προγραμματισμός πτήσης και ξενοδοχείου, σε ένα σημείο", description: "Σχεδίασε διαδρομή, διαμονή και προϋπολογισμό χωρίς δέκα καρτέλες." },
  },
  {
    id: "greece-planner",
    onlyForCountry: "gr",
    en: { slug: "ai-travel-planner-greece", title: "AI travel planner from Greece", description: "Smart trip planning for travellers starting from Greece." },
    el: { slug: "taxidiotikos-schediastis-ai-ellada", title: "Ταξιδιωτικός σχεδιαστής AI από την Ελλάδα", description: "Έξυπνος σχεδιασμός ταξιδιών για όσους ξεκινούν από Ελλάδα." },
  },
];

/**
 * Pick `max` guides for an audience. Pure and DB-free (guides are constants).
 * The starting index rotates weekly so consecutive campaigns don't keep
 * showing the same two guides. Greek pages for Greek readers, English
 * otherwise; country-restricted guides only for their audience.
 */
export function pickGuides(
  language: string | undefined,
  max: number,
  country?: string,
): GuideForEmail[] {
  const lang = normalizeLang(language);
  const eligible = GUIDE_PAGES.filter(
    (g) => !g.onlyForCountry || g.onlyForCountry === country || (g.onlyForCountry === "gr" && lang === "el"),
  );
  if (!eligible.length) return [];
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const start = week % eligible.length;
  const picked: GuideForEmail[] = [];
  for (let i = 0; i < Math.min(max, eligible.length); i++) {
    const g = eligible[(start + i) % eligible.length];
    picked.push(lang === "el" ? g.el : g.en);
  }
  return picked;
}

const GUIDES_LABELS: Record<Lang, { heading: string; viewAll: string }> = {
  en: { heading: "Worth a read", viewAll: "Browse all guides" },
  el: { heading: "Αξίζει να διαβάσεις", viewAll: "Δείτε όλους τους οδηγούς" },
  es: { heading: "Vale la pena leer", viewAll: "Ver todas las guías" },
  fr: { heading: "À lire", viewAll: "Voir tous les guides" },
  de: { heading: "Lesenswert", viewAll: "Alle Guides ansehen" },
  ar: { heading: "يستحق القراءة", viewAll: "تصفح كل الأدلة" },
};

/** Compact reading-list cards linking to the /guides landing pages. */
export function renderGuidesBlock(items: GuideForEmail[], lang: Lang): string {
  if (!items.length) return "";
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const L = GUIDES_LABELS[lang];

  const cards = items
    .map((g) => `
        <a href="${BASE_URL}/guides/${encodeURIComponent(g.slug)}" target="_blank" style="text-decoration:none;display:block;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:12px;margin-bottom:10px;">
            <tr>
              <td style="padding:12px 16px;vertical-align:middle;direction:${dir};text-align:${align};">
                <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#1A1A1A;">${g.title}</p>
                <p style="margin:0;font-size:12px;color:#5A5A5A;line-height:1.4;">${truncate(g.description, 110)}</p>
              </td>
            </tr>
          </table>
        </a>`)
    .join("");

  return sectionShell(
    `${sectionHeader(L.heading, dir, align)}${cards}<a href="${BASE_URL}/guides" target="_blank" style="display:inline-block;margin-top:2px;font-size:14px;font-weight:700;color:#1A1A1A;text-decoration:underline;">${L.viewAll}</a>`,
    dir, align,
  );
}

// ---------------------------------------------------------------------------
// Spotlight block — one featured itinerary as a large "trip of the week" card
// (vs the compact list renderItinerariesBlock renders).
// ---------------------------------------------------------------------------

const SPOTLIGHT_LABELS: Record<Lang, { heading: string; cta: string; days: string }> = {
  en: { heading: "Trip of the week", cta: "See the full itinerary", days: "days" },
  el: { heading: "Το ταξίδι της εβδομάδας", cta: "Δείτε όλο το πρόγραμμα", days: "ημέρες" },
  es: { heading: "El viaje de la semana", cta: "Ver el itinerario completo", days: "días" },
  fr: { heading: "Le voyage de la semaine", cta: "Voir l'itinéraire complet", days: "jours" },
  de: { heading: "Reise der Woche", cta: "Ganze Reiseroute ansehen", days: "Tage" },
  ar: { heading: "رحلة الأسبوع", cta: "شاهد البرنامج الكامل", days: "أيام" },
};

/** One big feature card: full-width image, title, meta line, blurb, CTA. */
export function renderSpotlightBlock(itin: ItineraryForEmail, lang: Lang): string {
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const L = SPOTLIGHT_LABELS[lang];
  const href = `${BASE_URL}/explore/${encodeURIComponent(itin.slug)}`;
  const meta = [
    itin.destination,
    `${Math.round(itin.durationDays)} ${L.days}`,
    itin.budgetLevel,
    itin.bestSeason,
  ].filter(Boolean).join(" · ");
  const image = itin.heroImage
    ? `<tr><td style="padding:0;"><img src="${itin.heroImage}" alt="" width="520" style="display:block;width:100%;max-width:520px;height:200px;object-fit:cover;border:0;outline:none;" /></td></tr>`
    : "";

  return sectionShell(
    `${sectionHeader(L.heading, dir, align)}
        <a href="${href}" target="_blank" style="text-decoration:none;display:block;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:14px;overflow:hidden;">
            ${image}
            <tr>
              <td style="padding:16px 18px 18px;direction:${dir};text-align:${align};">
                <p style="margin:0 0 4px;font-size:19px;font-weight:800;color:#1A1A1A;letter-spacing:-0.3px;">${itin.title}</p>
                <p style="margin:0 0 8px;font-size:12px;color:#8A8A8A;">${meta}</p>
                <p style="margin:0 0 12px;font-size:13px;color:#5A5A5A;line-height:1.5;">${truncate(itin.metaDescription, 160)}</p>
                <span style="display:inline-block;font-size:14px;font-weight:700;color:#1A1A1A;text-decoration:underline;">${L.cta}</span>
              </td>
            </tr>
          </table>
        </a>`,
    dir, align,
  );
}

// ---------------------------------------------------------------------------
// Route blocks — live prices for ONE pinned route, fetched at send time.
// Two shapes: a "cheapest days to fly" calendar strip and a single
// "flights from €X" teaser card. Prices are indicative (the CTA goes to the
// deals page, never claims a bookable fare).
// ---------------------------------------------------------------------------

/** Display metadata for a route block (cities pinned on the campaign). */
export interface RouteBlockMeta {
  originCity: string;
  destinationCity: string;
}

const CALENDAR_LABELS: Record<Lang, { heading: string; note: string; viewAll: string }> = {
  en: { heading: "Cheapest days to fly", note: "Round trip, per person — indicative prices", viewAll: "See all deals" },
  el: { heading: "Οι φθηνότερες ημέρες για πτήση", note: "Μετ' επιστροφής, ανά άτομο — ενδεικτικές τιμές", viewAll: "Δείτε όλες τις προσφορές" },
  es: { heading: "Los días más baratos para volar", note: "Ida y vuelta, por persona — precios orientativos", viewAll: "Ver todas las ofertas" },
  fr: { heading: "Les jours les moins chers pour voler", note: "Aller-retour, par personne — prix indicatifs", viewAll: "Voir toutes les offres" },
  de: { heading: "Die günstigsten Flugtage", note: "Hin & zurück, pro Person — Richtpreise", viewAll: "Alle Angebote ansehen" },
  ar: { heading: "أرخص أيام الطيران", note: "ذهاب وعودة، للشخص — أسعار استرشادية", viewAll: "عرض كل العروض" },
};

// How many departure dates the calendar strip shows.
const CALENDAR_MAX_DATES = 6;

/**
 * "Cheapest days to fly ATH → LIS": one row per departure date, cheapest fare
 * highlighted. `cal.dates` comes soonest-first from the calendar engine.
 */
export function renderCalendarBlock(
  cal: FlightCalendar,
  meta: RouteBlockMeta,
  lang: Lang,
): string {
  const dates = (cal.dates ?? []).filter((d) => d.price > 0).slice(0, CALENDAR_MAX_DATES);
  if (!dates.length) return "";
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const priceAlign = rtl ? "left" : "right";
  const L = CALENDAR_LABELS[lang];
  const cheapest = Math.min(...dates.map((d) => d.price));

  const rows = dates
    .map((d) => {
      const range = d.returnDate
        ? `${formatDealDate(d.date, lang)} – ${formatDealDate(d.returnDate, lang)}`
        : formatDealDate(d.date, lang);
      const isCheapest = d.price === cheapest;
      return `
        <tr>
          <td style="padding:9px 14px;border-bottom:1px solid #F0EFE9;direction:${dir};text-align:${align};font-size:14px;color:#1A1A1A;${isCheapest ? "font-weight:700;" : ""}">${range}</td>
          <td style="padding:9px 14px;border-bottom:1px solid #F0EFE9;text-align:${priceAlign};white-space:nowrap;font-size:15px;font-weight:800;color:${isCheapest ? "#1E7A3C" : "#1A1A1A"};">${formatDealPrice(d.price, cal.currency, lang)}</td>
        </tr>`;
    })
    .join("");

  return sectionShell(
    `${sectionHeader(`${L.heading} · ${meta.originCity} → ${meta.destinationCity}`, dir, align)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:12px;overflow:hidden;">${rows}</table>
        <p style="margin:8px 0 0;font-size:11px;color:#9A9A9A;">${L.note}</p>
        <a href="${BASE_URL}/deals" target="_blank" style="display:inline-block;margin-top:8px;font-size:14px;font-weight:700;color:#1A1A1A;text-decoration:underline;">${L.viewAll}</a>`,
    dir, align,
  );
}

const TEASER_LABELS: Record<Lang, { heading: string; from: string; note: string; cta: string }> = {
  en: { heading: "Flights to {city}", from: "from", note: "Round trip, per person — indicative price", cta: "See all deals" },
  el: { heading: "Πτήσεις για {city}", from: "από", note: "Μετ' επιστροφής, ανά άτομο — ενδεικτική τιμή", cta: "Δείτε όλες τις προσφορές" },
  es: { heading: "Vuelos a {city}", from: "desde", note: "Ida y vuelta, por persona — precio orientativo", cta: "Ver todas las ofertas" },
  fr: { heading: "Vols vers {city}", from: "à partir de", note: "Aller-retour, par personne — prix indicatif", cta: "Voir toutes les offres" },
  de: { heading: "Flüge nach {city}", from: "ab", note: "Hin & zurück, pro Person — Richtpreis", cta: "Alle Angebote ansehen" },
  ar: { heading: "رحلات إلى {city}", from: "ابتداءً من", note: "ذهاب وعودة، للشخص — سعر استرشادي", cta: "عرض كل العروض" },
};

/** Single "Flights to Lisbon — from €89" price card. */
export function renderTeaserBlock(
  teaser: ExploreDestinationFlights,
  meta: RouteBlockMeta,
  lang: Lang,
): string {
  const prices = (teaser.flights ?? [])
    .map((f) => f.price)
    .filter((p): p is number => typeof p === "number" && p > 0);
  const cheapest = teaser.cheapestPrice ?? (prices.length ? Math.min(...prices) : undefined);
  if (!cheapest) return "";
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const priceAlign = rtl ? "left" : "right";
  const L = TEASER_LABELS[lang];

  return sectionShell(
    `${sectionHeader(L.heading.replace("{city}", meta.destinationCity), dir, align)}
        <a href="${BASE_URL}/deals" target="_blank" style="text-decoration:none;display:block;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:12px;">
            <tr>
              <td style="padding:16px 18px;vertical-align:middle;direction:${dir};text-align:${align};">
                <p style="margin:0 0 2px;font-size:16px;font-weight:700;color:#1A1A1A;">${meta.originCity} → ${meta.destinationCity}</p>
                <p style="margin:0;font-size:11px;color:#8A8A8A;">${L.note}</p>
              </td>
              <td width="130" style="padding:16px 18px;vertical-align:middle;text-align:${priceAlign};white-space:nowrap;">
                <p style="margin:0;font-size:11px;color:#8A8A8A;">${L.from}</p>
                <p style="margin:0;font-size:24px;font-weight:800;color:#1A1A1A;">${formatDealPrice(cheapest, teaser.currency, lang)}</p>
              </td>
            </tr>
          </table>
        </a>
        <a href="${BASE_URL}/deals" target="_blank" style="display:inline-block;margin-top:8px;font-size:14px;font-weight:700;color:#1A1A1A;text-decoration:underline;">${L.cta}</a>`,
    dir, align,
  );
}

// ---------------------------------------------------------------------------
// Invite-a-friend footer note — the app has trip sharing + companion invites;
// a quiet recurring nudge above the footer on marketing emails costs nothing.
// ---------------------------------------------------------------------------

export const INVITE_COPY: Record<Lang, { text: string; link: string }> = {
  en: { text: "Planning with someone? Invite your travel buddies from the app and build the trip together.", link: "Open Planera" },
  el: { text: "Ταξιδεύετε παρέα; Προσκαλέστε τους συνταξιδιώτες σας από την εφαρμογή και σχεδιάστε το ταξίδι μαζί.", link: "Άνοιγμα Planera" },
  es: { text: "¿Viajáis juntos? Invita a tus compañeros de viaje desde la app y planificad el viaje juntos.", link: "Abrir Planera" },
  fr: { text: "Vous partez à plusieurs ? Invitez vos compagnons de voyage depuis l'app et préparez le voyage ensemble.", link: "Ouvrir Planera" },
  de: { text: "Ihr reist zu mehreren? Lade deine Mitreisenden in der App ein und plant die Reise gemeinsam.", link: "Planera öffnen" },
  ar: { text: "تسافرون معًا؟ ادعُ رفاق سفرك من التطبيق وخطّطوا للرحلة معًا.", link: "افتح Planera" },
};

/** Bounded truncation — safe against undefined/null and never mid-emoji. */
function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// ---------------------------------------------------------------------------
// Enrichment data queries — small ranked samples, safe for a query context
// (no writes, bounded reads). Each internalQuery has a plain-function twin
// so the campaign preview (a query) can call the same code without hopping
// through runQuery.
// ---------------------------------------------------------------------------

const MAX_ITIN_SAMPLE = 6;
const MAX_SIGHTS_SAMPLE = 8;
const MAX_ATTR_SAMPLE = 8;
const MAX_PKG_SAMPLE = 6;

/**
 * Published itineraries, prioritising ones from the audience's country when
 * `country` is set. `sourceTripCount` is the closest thing we have to a
 * quality signal (guides aggregated from more trips are more trustworthy).
 */
export async function queryFeaturedItineraries(
  db: { query: (t: "publishedItineraries") => any },
  opts: { country?: string; max?: number } = {},
): Promise<ItineraryForEmail[]> {
  const rows = await db
    .query("publishedItineraries")
    .withIndex("by_status", (q: any) => q.eq("status", "published"))
    .collect();

  const scored = rows
    .filter((r: any) => r.slug && r.title)
    .map((r: any) => {
      const cc: string | undefined = typeof r.country === "string"
        ? r.country.slice(0, 2).toLowerCase() : undefined;
      const localMatch = opts.country && cc === opts.country ? 1 : 0;
      return {
        row: r,
        cc,
        score: localMatch * 10_000 + (r.sourceTripCount ?? 0),
      };
    });
  scored.sort((a: any, b: any) => b.score - a.score);

  return scored
    .slice(0, Math.max(1, Math.min(MAX_ITIN_SAMPLE, opts.max ?? MAX_ITIN_SAMPLE)))
    .map(({ row, cc }: any) => ({
      slug: row.slug,
      destination: row.destination,
      country: row.country,
      countryCode: cc,
      durationDays: row.durationDays,
      title: row.title,
      metaDescription: row.metaDescription ?? row.intro ?? "",
      budgetLevel: row.budgetLevel,
      bestSeason: row.bestSeason,
      heroImage: row.heroImage,
    }));
}

/**
 * Top sights across recently-generated destinations. We don't know per-country
 * for every row (destinationKey is "paris-france" style), so we sample the
 * newest rows and let the caller filter/pick.
 */
export async function queryFeaturedSights(
  db: { query: (t: "destinationSights") => any },
  opts: { destinationKey?: string; max?: number } = {},
): Promise<SightForEmail[]> {
  // A destination key drives a tight lookup; otherwise fall back to the most
  // recent bundles across destinations.
  let bundles: any[];
  if (opts.destinationKey) {
    bundles = await db
      .query("destinationSights")
      .withIndex("by_destination_key", (q: any) => q.eq("destinationKey", opts.destinationKey))
      .collect();
  } else {
    bundles = await db.query("destinationSights").order("desc").take(20);
  }
  if (!bundles.length) return [];

  const flat: SightForEmail[] = [];
  for (const b of bundles) {
    const label = humanizeDestinationKey(b.destinationKey);
    for (const s of (b.sights ?? []) as any[]) {
      if (!s?.name) continue;
      flat.push({
        destinationKey: b.destinationKey,
        destinationLabel: label,
        name: s.name,
        shortDescription: s.shortDescription ?? "",
        neighborhoodOrArea: s.neighborhoodOrArea,
        bestTimeToVisit: s.bestTimeToVisit,
      });
    }
  }
  // Deduplicate by name to avoid two identical "Colosseum" entries when
  // several destination bundles cover the same city.
  const seen = new Set<string>();
  const unique = flat.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, Math.max(1, Math.min(MAX_SIGHTS_SAMPLE, opts.max ?? MAX_SIGHTS_SAMPLE)));
}

/**
 * Bookable attractions, prioritising `topSite` rows and (if given) the
 * audience's country. Only active rows with a live affiliate URL are eligible.
 */
export async function queryFeaturedAttractions(
  db: { query: (t: "attractionAffiliateLinks") => any },
  opts: { country?: string; max?: number } = {},
): Promise<AttractionForEmail[]> {
  const rows = await db
    .query("attractionAffiliateLinks")
    .withIndex("by_active", (q: any) => q.eq("active", true))
    .collect();

  const scored = rows
    .filter((r: any) => r.affiliateUrl && r.displayTitle)
    .map((r: any) => {
      const localMatch = opts.country && r.destinationCountry === opts.country ? 1 : 0;
      return {
        row: r,
        score: localMatch * 10_000 + (r.topSite ? 1_000 : 0) + (r.clicks ?? 0),
      };
    });
  scored.sort((a: any, b: any) => b.score - a.score);

  return scored
    .slice(0, Math.max(1, Math.min(MAX_ATTR_SAMPLE, opts.max ?? MAX_ATTR_SAMPLE)))
    .map(({ row }: any) => ({
      displayTitle: row.displayTitle,
      destinationCity: row.destinationCity,
      destinationCountry: row.destinationCountry,
      price: row.price,
      currency: row.currency,
      affiliateUrl: row.affiliateUrl,
      topSite: row.topSite,
    }));
}

/**
 * OTA partner packages, active and (preferably) targeted at the audience's
 * country. Sorted by explicit `sortPriority` if set, then by lead-conversion
 * signal (proxy: `leadCount`), so partners see the strongest performers.
 */
export async function queryFeaturedPackages(
  db: { query: (t: "otaPackages") => any },
  opts: { country?: string; max?: number } = {},
): Promise<PackageForEmail[]> {
  let rows: any[];
  if (opts.country) {
    rows = await db
      .query("otaPackages")
      .withIndex("by_country", (q: any) => q.eq("destinationCountryCode", opts.country).eq("active", true))
      .collect();
    // Fall back to global-active if the country has none: better a generic
    // package than an empty section.
    if (!rows.length) {
      rows = await db
        .query("otaPackages")
        .withIndex("by_active", (q: any) => q.eq("active", true))
        .collect();
    }
  } else {
    rows = await db
      .query("otaPackages")
      .withIndex("by_active", (q: any) => q.eq("active", true))
      .collect();
  }

  const now = Date.now();
  const eligible = rows.filter((r: any) => {
    if (!r.title || !r.priceFrom || !r.priceCurrency) return false;
    if (r.availableFrom && r.availableFrom > now) return false;
    if (r.availableTo && r.availableTo < now) return false;
    return true;
  });
  eligible.sort((a: any, b: any) => {
    const sp = (b.sortPriority ?? 0) - (a.sortPriority ?? 0);
    if (sp !== 0) return sp;
    return (b.leadCount ?? 0) - (a.leadCount ?? 0);
  });

  return eligible
    .slice(0, Math.max(1, Math.min(MAX_PKG_SAMPLE, opts.max ?? MAX_PKG_SAMPLE)))
    .map((r: any) => ({
      title: r.title,
      subtitle: r.subtitle,
      destinationCity: r.destinationCity,
      destinationCountry: r.destinationCountry,
      durationDays: r.durationDays,
      priceFrom: r.priceFrom,
      priceCurrency: r.priceCurrency,
      priceUnit: r.priceUnit,
      includes: r.includes ?? [],
      heroImageUrl: r.heroImageUrl,
      externalUrl: r.externalUrl,
      badge: r.badge,
    }));
}

/** "paris-france" → "Paris, France". Best-effort — used only for display. */
function humanizeDestinationKey(key: string): string {
  const parts = key.split("-");
  if (parts.length < 2) return titleCase(parts[0] ?? key);
  const country = titleCase(parts.pop() as string);
  const city = parts.map(titleCase).join(" ");
  return `${city}, ${country}`;
}
function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

export const getFeaturedItineraries = internalQuery({
  args: { country: v.optional(v.string()), max: v.optional(v.float64()) },
  handler: async (ctx, args): Promise<ItineraryForEmail[]> =>
    queryFeaturedItineraries(ctx.db, args),
});

export const getFeaturedSights = internalQuery({
  args: { destinationKey: v.optional(v.string()), max: v.optional(v.float64()) },
  handler: async (ctx, args): Promise<SightForEmail[]> =>
    queryFeaturedSights(ctx.db, args),
});

export const getFeaturedAttractions = internalQuery({
  args: { country: v.optional(v.string()), max: v.optional(v.float64()) },
  handler: async (ctx, args): Promise<AttractionForEmail[]> =>
    queryFeaturedAttractions(ctx.db, args),
});

export const getFeaturedPackages = internalQuery({
  args: { country: v.optional(v.string()), max: v.optional(v.float64()) },
  handler: async (ctx, args): Promise<PackageForEmail[]> =>
    queryFeaturedPackages(ctx.db, args),
});

/**
 * Cron entry point: send the next drip email to every due subscriber.
 */
export const processNewsletterDrip = internalAction({
  args: {},
  returns: v.object({ processed: v.float64() }),
  handler: async (ctx): Promise<{ processed: number }> => {
    const due = await ctx.runQuery(internal.newsletter.getDueDripSubscribers, {});
    // Fetch the full active-deal list once per tick; only the drip2 email
    // renders deals, and each subscriber gets the top picks for their country.
    const allDeals: DealForEmail[] = await ctx.runQuery(
      internal.newsletter.getFeaturedDeals,
      {},
    );
    let processed = 0;

    for (const sub of due) {
      const nextStage = sub.dripStage + 1;
      if (nextStage > MAX_DRIP_STAGE) continue;

      const mail = dripEmail(
        nextStage,
        sub.language,
        sub.unsubscribeToken,
        pickTopDeals(allDeals, sub.country),
      );
      const result = await ctx.runAction(internal.postmark.sendRawEmail, {
        to: sub.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        from: MARKETING_FROM,
        replyTo: MARKETING_EMAIL,
      });

      if (result.success) {
        await ctx.runMutation(internal.newsletter.advanceDripStage, {
          subscriberId: sub._id,
          nextStage,
        });
        processed += 1;
      }
    }

    return { processed };
  },
});
