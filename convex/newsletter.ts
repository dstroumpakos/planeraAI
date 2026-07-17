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
interface CjBanner {
  img: string;
  click: string;
  alt: string;
}
const CJ_BANNERS: Record<"tripcom" | "kiwi" | "welcome", CjBanner> = {
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
  originCity: string;
  destinationCity: string;
  price: number;
  originalPrice?: number;
  currency: string;
  outboundDate: string;
  returnDate?: string;
  dealTag?: string;
  isRecommended?: boolean;
}

const DEALS_LABELS: Record<
  Lang,
  { heading: string; viewAll: string; perPerson: string; roundTrip: string; oneWay: string }
> = {
  en: { heading: "Live fares right now", viewAll: "See all deals", perPerson: "per person", roundTrip: "Round trip", oneWay: "One way" },
  el: { heading: "Ζωντανές τιμές τώρα", viewAll: "Δείτε όλες τις προσφορές", perPerson: "ανά άτομο", roundTrip: "Μετ' επιστροφής", oneWay: "Απλή μετάβαση" },
  es: { heading: "Tarifas en directo", viewAll: "Ver todas las ofertas", perPerson: "por persona", roundTrip: "Ida y vuelta", oneWay: "Solo ida" },
  fr: { heading: "Tarifs en direct", viewAll: "Voir toutes les offres", perPerson: "par personne", roundTrip: "Aller-retour", oneWay: "Aller simple" },
  de: { heading: "Aktuelle Preise", viewAll: "Alle Angebote ansehen", perPerson: "pro Person", roundTrip: "Hin & zurück", oneWay: "Nur Hinflug" },
  ar: { heading: "أسعار مباشرة الآن", viewAll: "عرض كل العروض", perPerson: "للشخص", roundTrip: "ذهاب وعودة", oneWay: "ذهاب فقط" },
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
      return `
        <a href="${dealsUrl}" target="_blank" style="text-decoration:none;display:block;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:12px;margin-bottom:10px;">
            <tr>
              <td style="padding:14px 16px;vertical-align:middle;direction:${dir};text-align:${align};">
                ${tag}
                <p style="margin:${tag ? "6px" : "0"} 0 2px;font-size:16px;font-weight:700;color:#1A1A1A;">${route}</p>
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
}): string {
  const year = new Date().getFullYear();
  const rtl = opts.lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const footer = FOOTER_COPY[opts.lang];

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
      </td></tr>${opts.dealsBlock ?? ""}${bannerRow}
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
          .map(
            (d) =>
              `${d.originCity} → ${d.destinationCity}: ${formatDealPrice(d.price, d.currency, lang)}`,
          )
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
    }),
    text:
      `${c.heading}\n\n${c.para1}\n\n${c.para2}${dealsText}\n\n` +
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
    originCity: d.originCity,
    destinationCity: d.destinationCity,
    price: d.price,
    originalPrice: d.originalPrice,
    currency: d.currency,
    outboundDate: d.outboundDate,
    returnDate: d.returnDate,
    dealTag: d.dealTag,
    isRecommended: d.isRecommended,
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
