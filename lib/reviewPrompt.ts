import * as StoreReview from "expo-store-review";
import * as SecureStore from "expo-secure-store";

const ASKED_KEY = "reviewPromptAsked";
const COUNT_KEY = "reviewReadyTripCount";
// Don't ask until the user has reached at least this many ready itineraries —
// asking on the first one is too early (Apple's own guidance).
const MIN_BEFORE_ASK = 2;

/**
 * Ask for an App Store review at a positive moment (a finished itinerary), using
 * Apple's native in-app prompt. Gated so it's only ever shown once, and not
 * before the user's Nth ready trip. iOS additionally rate-limits the native
 * prompt, so it can never feel spammy. Never throws — a review prompt must never
 * disrupt the app.
 */
export async function maybeAskForReview(): Promise<void> {
  try {
    const alreadyAsked = await SecureStore.getItemAsync(ASKED_KEY);
    if (alreadyAsked) return;

    const raw = await SecureStore.getItemAsync(COUNT_KEY);
    const count = (parseInt(raw ?? "0", 10) || 0) + 1;
    await SecureStore.setItemAsync(COUNT_KEY, String(count));
    if (count < MIN_BEFORE_ASK) return;

    if (!(await StoreReview.hasAction())) return;

    // Mark asked *before* requesting so a failure can't cause repeated prompts.
    await SecureStore.setItemAsync(ASKED_KEY, String(Date.now()));
    await StoreReview.requestReview();
  } catch {
    // swallow — never let a review prompt break a flow
  }
}
