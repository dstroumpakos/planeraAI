import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/**
 * Meta (Facebook) SDK for ad measurement, gated behind user consent.
 *
 * The SDK ships switched off (app.json: isAutoInitEnabled / autoLogAppEvents /
 * advertiserIDCollection all false) and is only started once the user agrees:
 *   - iOS: the App Tracking Transparency prompt IS the consent. Apple rejects
 *     pre-prompts with a "no" button, so ours only has "Continue".
 *   - Android: our own Allow / Don't allow dialog (GDPR opt-in).
 * Users can withdraw from the profile menu at any time.
 *
 * Events fired before the user has decided (sign-up happens before the prompt)
 * are queued and sent on consent, or dropped on refusal. Nothing here may ever
 * throw into the UI: ad measurement must never break the app.
 *
 * NATIVE MODULE: this file must never reach an older build via OTA (see the
 * expo-widgets crash of 2026-09-15). Ship it in a new build with a version bump.
 */

const CONSENT_KEY = "metaAdConsent"; // "granted" | "denied"
const PENDING_KEY = "metaPendingEvents";
const MAX_PENDING = 10;
const TOKEN_PLACEHOLDER = "META_CLIENT_TOKEN_PENDING";

export type MetaConsent = "granted" | "denied" | "undecided";

type PendingEvent =
  | { kind: "registration"; method?: string }
  | { kind: "subscribe" | "purchase"; amount: number; currency: string; productId?: string };

// Lazy so web (and any build without the native module) never touches it.
let fbsdk: any = null;
function sdk(): any {
  if (Platform.OS === "web") return null;
  if (!fbsdk) {
    try {
      fbsdk = require("react-native-fbsdk-next");
    } catch {
      fbsdk = null;
    }
  }
  return fbsdk;
}

function att(): any {
  if (Platform.OS !== "ios") return null;
  try {
    return require("expo-tracking-transparency");
  } catch {
    return null;
  }
}

/** False until a real client token is in app.json, so a half-configured build stays inert. */
export function isMetaSdkConfigured(): boolean {
  if (Platform.OS === "web") return false;
  const plugins: any[] = (Constants.expoConfig as any)?.plugins ?? [];
  const entry = plugins.find((p) => Array.isArray(p) && p[0] === "react-native-fbsdk-next");
  const token = entry?.[1]?.clientToken;
  return typeof token === "string" && token.length > 0 && token !== TOKEN_PLACEHOLDER;
}

async function getStored(): Promise<"granted" | "denied" | null> {
  try {
    const v = await SecureStore.getItemAsync(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

async function setStored(v: "granted" | "denied") {
  try {
    await SecureStore.setItemAsync(CONSENT_KEY, v);
  } catch {
    // ignore
  }
}

async function attStatus(): Promise<"granted" | "denied" | "undetermined"> {
  const mod = att();
  if (!mod) return "denied";
  try {
    const { status } = await mod.getTrackingPermissionsAsync();
    return status === "granted" ? "granted" : status === "undetermined" ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

/** The user's effective choice on this device. */
export async function getMetaConsent(): Promise<MetaConsent> {
  const stored = await getStored();
  if (Platform.OS === "ios") {
    if (stored === "denied") return "denied";
    const status = await attStatus();
    if (status === "undetermined") return "undecided";
    return status;
  }
  return stored ?? "undecided";
}

let started = false;

async function start() {
  const fb = sdk();
  if (!fb || !isMetaSdkConfigured()) return;
  try {
    if (!started) {
      if (Platform.OS === "ios") {
        await fb.Settings.setAdvertiserTrackingEnabled(true);
      }
      fb.Settings.setAdvertiserIDCollectionEnabled(true);
      fb.Settings.setAutoLogAppEventsEnabled(true);
      fb.Settings.initializeSDK();
      started = true;
    } else {
      fb.Settings.setAutoLogAppEventsEnabled(true);
      fb.Settings.setAdvertiserIDCollectionEnabled(true);
    }
    await flushPending();
  } catch (e) {
    console.warn("[metaSdk] start failed:", e);
  }
}

function stop() {
  const fb = sdk();
  if (!fb || !started) return;
  try {
    fb.Settings.setAutoLogAppEventsEnabled(false);
    fb.Settings.setAdvertiserIDCollectionEnabled(false);
    if (Platform.OS === "ios") void fb.Settings.setAdvertiserTrackingEnabled(false);
  } catch {
    // ignore
  }
}

/** Call once at boot: starts the SDK if this device already said yes. */
export async function initMetaSdkFromStoredConsent() {
  if (!isMetaSdkConfigured()) return;
  if ((await getMetaConsent()) === "granted") await start();
}

/**
 * Record the user's answer.
 * iOS: `granted` shows the ATT prompt (if not answered yet) and the ATT answer wins.
 * If ATT was already refused, turning it on can only happen in iOS Settings.
 */
export async function setMetaConsent(granted: boolean): Promise<MetaConsent> {
  if (!granted) {
    await setStored("denied");
    await clearPending();
    stop();
    return "denied";
  }

  if (Platform.OS === "ios") {
    let status = await attStatus();
    if (status === "undetermined") {
      try {
        const res = await att()?.requestTrackingPermissionsAsync();
        status = res?.status === "granted" ? "granted" : "denied";
      } catch {
        status = "denied";
      }
    } else if (status === "denied") {
      Linking.openSettings().catch(() => {});
      return "denied";
    }
    if (status !== "granted") {
      await clearPending();
      return "denied";
    }
  }

  await setStored("granted");
  await start();
  return "granted";
}

async function readPending(): Promise<PendingEvent[]> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingEvent[]) : [];
  } catch {
    return [];
  }
}

async function clearPending() {
  try {
    await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch {
    // ignore
  }
}

function send(event: PendingEvent) {
  const fb = sdk();
  if (!fb) return;
  const { AppEventsLogger } = fb;
  const P = AppEventsLogger.AppEventParams;
  if (event.kind === "registration") {
    AppEventsLogger.logEvent(AppEventsLogger.AppEvents.CompletedRegistration, {
      [P.RegistrationMethod]: event.method ?? "app",
    });
  } else if (event.kind === "subscribe") {
    AppEventsLogger.logEvent(AppEventsLogger.AppEvents.Subscribe, event.amount, {
      [P.Currency]: event.currency,
      ...(event.productId ? { [P.ContentID]: event.productId } : {}),
    });
  } else {
    AppEventsLogger.logPurchase(event.amount, event.currency, event.productId ? { [P.ContentID]: event.productId } : {});
  }
}

async function flushPending() {
  const pending = await readPending();
  if (!pending.length) return;
  await clearPending();
  for (const e of pending) {
    try {
      send(e);
    } catch {
      // ignore
    }
  }
}

async function track(event: PendingEvent) {
  if (!isMetaSdkConfigured()) return;
  try {
    const consent = await getMetaConsent();
    if (consent === "denied") return;
    if (consent === "granted") {
      if (!started) await start();
      send(event);
      return;
    }
    const pending = await readPending();
    pending.push(event);
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending.slice(-MAX_PENDING)));
  } catch (e) {
    console.warn("[metaSdk] track failed:", e);
  }
}

/** A new account finished onboarding. */
export function trackMetaRegistration(method?: string) {
  void track({ kind: "registration", method });
}

/** A store purchase was verified. `price` is the store's IAPProduct. */
export function trackMetaPurchase(
  plan: "yearly" | "monthly" | "single",
  product?: { productId?: string; price?: string; priceAmountMicros?: string; priceCurrencyCode?: string } | null,
) {
  const micros = Number(product?.priceAmountMicros);
  const parsed = Number(String(product?.price ?? "").replace(/[^0-9.,]/g, "").replace(",", "."));
  const amount = Number.isFinite(micros) && micros > 0 ? micros / 1_000_000 : Number.isFinite(parsed) ? parsed : 0;
  const currency = product?.priceCurrencyCode || "EUR";
  void track({
    kind: plan === "single" ? "purchase" : "subscribe",
    amount,
    currency,
    productId: product?.productId,
  });
}
