/**
 * In-App Purchase Service (Apple StoreKit + Google Play Billing)
 *
 * Handles all IAP operations for the Planera app.
 *
 * Products (same identifiers on both stores):
 * - com.planeraaitravelplanner.pro.yearly (Auto-renewable subscription)
 * - com.planeraaitravelplanner.pro.monthly (Auto-renewable subscription)
 * - com.planeraaitravelplanner.trip.single (Consumable - 1 trip credit)
 *
 * On Play these must exist in Play Console as two subscriptions (each with a
 * base plan) and one one-time product, matching the IDs above.
 *
 * NOTE: expo-iap requires a native build. In Expo Go or development without
 * native modules, mock products will be used instead.
 */

import { Platform } from 'react-native';

// Lazy load expo-iap to avoid crashes in Expo Go
let ExpoIAP: any = null;
let iapAvailable = false;

/** Platforms with a real store connection behind expo-iap. */
const STORE_PLATFORMS = ['ios', 'android'];
const hasStore = STORE_PLATFORMS.includes(Platform.OS);

if (hasStore) {
    try {
        ExpoIAP = require('expo-iap');
        iapAvailable = true;
        console.log('[IAP] expo-iap module loaded successfully');
    } catch (e) {
        console.log('[IAP] expo-iap not available (running in Expo Go or dev mode)');
        iapAvailable = false;
    }
}

// Product IDs (must match App Store Connect)
export const PRODUCT_IDS = {
    YEARLY_SUBSCRIPTION: 'com.planeraaitravelplanner.pro.yearly',
    MONTHLY_SUBSCRIPTION: 'com.planeraaitravelplanner.pro.monthly',
    SINGLE_TRIP: 'com.planeraaitravelplanner.trip.single',
} as const;

export const ALL_PRODUCT_IDS = [
    PRODUCT_IDS.YEARLY_SUBSCRIPTION,
    PRODUCT_IDS.MONTHLY_SUBSCRIPTION,
    PRODUCT_IDS.SINGLE_TRIP,
];

export const SUBSCRIPTION_PRODUCT_IDS = [
    PRODUCT_IDS.YEARLY_SUBSCRIPTION,
    PRODUCT_IDS.MONTHLY_SUBSCRIPTION,
];

// Types
export interface IAPProduct {
    productId: string;
    title: string;
    description: string;
    price: string;
    priceAmountMicros?: string;
    priceCurrencyCode?: string;
    subscriptionPeriod?: string;
}

export interface PurchaseResult {
    success: boolean;
    productId?: string;
    transactionId?: string;
    receipt?: string;
    error?: string;
    /** Which store produced the receipt, so the server picks the right verifier. */
    platform?: 'ios' | 'android';
}

/**
 * Stable per-transaction identifier used for server-side idempotency.
 * StoreKit always populates `transactionId`; on Play it is nullable and the
 * unified `id` (Google's order id) is the reliable key.
 */
function transactionIdOf(purchase: any): string | undefined {
    return purchase?.transactionId || purchase?.id || undefined;
}

/** Normalized comparison key for a store error (code or message). */
function errorKey(error: any): string {
    return `${error?.code ?? ''} ${error?.message ?? ''}`
        .toLowerCase()
        .replace(/[_-]/g, ' ');
}

/**
 * expo-iap v3 normalizes store errors to kebab-case codes ("user-cancelled",
 * "already-owned") rather than the legacy StoreKit `E_*` constants, and Play
 * reports its own numeric codes. Match on a punctuation-flattened key so all
 * three spellings resolve the same way.
 */
function isCancelledError(error: any): boolean {
    return errorKey(error).includes('cancel');
}

function isAlreadyOwnedError(error: any): boolean {
    const key = errorKey(error);
    return (
        key.includes('already owned') ||
        // Play BillingResponseCode.ITEM_ALREADY_OWNED
        error?.code === 7 ||
        error?.code === 6778003
    );
}

// IAP Service class
class IAPService {
    private isInitialized = false;
    private products: Map<string, IAPProduct> = new Map();
    /**
     * Play requires an offer token identifying which base plan / offer of a
     * subscription is being bought; StoreKit has no equivalent. Captured during
     * fetchProducts and replayed at purchase time.
     */
    private androidOfferTokens: Map<string, string> = new Map();

    /**
     * Check if IAP is available (native module loaded)
     */
    isAvailable(): boolean {
        return iapAvailable && hasStore;
    }

    /**
     * Initialize the IAP connection
     */
    async initialize(): Promise<boolean> {
        if (!this.isAvailable()) {
            console.log('[IAP] Not available (not iOS or no native module)');
            return false;
        }

        if (this.isInitialized) {
            return true;
        }

        try {
            const result = await ExpoIAP.initConnection();
            this.isInitialized = !!result;
            console.log('[IAP] Connection initialized:', result);
            
            // Flush any pending/unfinished transactions from previous sessions
            // This prevents "Item already owned" errors during Apple review
            if (this.isInitialized) {
                await this.flushPendingTransactions();
            }
            
            return this.isInitialized;
        } catch (error) {
            console.error('[IAP] Failed to initialize:', error);
            return false;
        }
    }

    /**
     * Flush any pending/unfinished transactions
     * This resolves "Item already owned" errors that occur when previous
     * transactions were not properly finished (common in sandbox/review)
     * 
     * IMPORTANT: Only flush consumable (in-app) purchases, NOT subscriptions.
     * Finishing a subscription transaction before the user explicitly purchases
     * will prevent StoreKit from showing the purchase confirmation dialog.
     */
    async flushPendingTransactions(): Promise<void> {
        if (!this.isAvailable()) return;

        // Play only reports purchases that are still unconsumed/unacknowledged —
        // i.e. exactly the ones the user has paid for but not yet been granted.
        // Consuming those here, before the server has verified them, would
        // destroy a paid trip credit with no way to recover it. On Play these
        // are instead recovered through restorePurchases() → verify → consume,
        // and the "already owned" branch of a repeat purchase.
        if (Platform.OS === 'android') {
            console.log('[IAP] Skipping pending-transaction flush on Play (handled via restore)');
            return;
        }

        try {
            const availablePurchases = await ExpoIAP.getAvailablePurchases();
            
            if (availablePurchases && availablePurchases.length > 0) {
                console.log(`[IAP] Found ${availablePurchases.length} available purchases, checking transactions (will only auto-finish consumables)...`);
                
                for (const purchase of availablePurchases) {
                    const productId = (purchase as any).productId || '';
                    const isSubscription = SUBSCRIPTION_PRODUCT_IDS.includes(productId);
                    
                    // Only finish consumable transactions automatically
                    // Subscriptions should NOT be auto-finished — doing so would prevent
                    // StoreKit from showing the purchase dialog on next attempt
                    if (!isSubscription) {
                        try {
                            await ExpoIAP.finishTransaction({ 
                                purchase, 
                                isConsumable: true 
                            });
                            console.log('[IAP] Finished pending consumable transaction:', productId, (purchase as any).transactionId);
                        } catch (finishErr) {
                            console.warn('[IAP] Could not finish pending transaction:', finishErr);
                        }
                    } else {
                        console.log('[IAP] Skipping subscription transaction (will not auto-finish):', productId);
                    }
                }
            } else {
                console.log('[IAP] No pending transactions to flush');
            }
        } catch (error) {
            console.warn('[IAP] Failed to flush pending transactions:', error);
        }
    }

    /**
     * End the IAP connection (call when app closes or component unmounts)
     */
    async endConnection(): Promise<void> {
        if (!this.isInitialized || !this.isAvailable()) return;

        try {
            await ExpoIAP.endConnection();
            this.isInitialized = false;
            console.log('[IAP] Connection ended');
        } catch (error) {
            console.error('[IAP] Failed to end connection:', error);
        }
    }

    /**
     * Fetch products from App Store
     */
    async getProducts(): Promise<IAPProduct[]> {
        if (!this.isAvailable()) {
            return this.getMockProducts();
        }

        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // Fetch subscriptions
            const subscriptions = await ExpoIAP.fetchProducts({
                skus: SUBSCRIPTION_PRODUCT_IDS,
                type: 'subs',
            });
            
            // Fetch consumables (single trip)
            const consumables = await ExpoIAP.fetchProducts({
                skus: [PRODUCT_IDS.SINGLE_TRIP],
                type: 'in-app',
            });

            const allProducts: IAPProduct[] = [];

            // Map subscriptions
            if (subscriptions) {
                for (const sub of subscriptions) {
                    // Log FULL raw subscription data for debugging price issues
                    console.log('[IAP] 🔍 Raw subscription data:', {
                        productId: (sub as any).productId || (sub as any).id,
                        displayPrice: (sub as any).displayPrice,
                        price: (sub as any).price,
                        currency: (sub as any).currency,
                        raw: JSON.stringify(sub)
                    });
                    
                    // ALWAYS use displayPrice from StoreKit - this is what Apple will charge
                    // Never override or format this - it includes proper currency symbol and locale
                    const displayPrice = (sub as any).displayPrice;
                    
                    console.log('[IAP] ✅ Using StoreKit displayPrice for', (sub as any).productId || (sub as any).id, ':', displayPrice);
                    
                    const product: IAPProduct = {
                        productId: (sub as any).productId || (sub as any).id || '',
                        title: (sub as any).title || (sub as any).displayName || (sub as any).name || '',
                        description: (sub as any).description || '',
                        price: displayPrice || '', // Use ONLY store price, empty if not available
                        priceCurrencyCode: (sub as any).currency,
                        subscriptionPeriod: (sub as any).subscriptionPeriod,
                    };

                    // Play: remember the offer token for this subscription. The
                    // first entry is the one Google ranks highest for this user
                    // (promotional offer if they qualify, else the base plan).
                    const offers = (sub as any).subscriptionOfferDetailsAndroid;
                    if (Array.isArray(offers) && offers.length > 0 && offers[0]?.offerToken) {
                        this.androidOfferTokens.set(product.productId, offers[0].offerToken);
                    }

                    this.products.set(product.productId, product);
                    allProducts.push(product);
                }
            }

            // Map consumables
            if (consumables) {
                for (const prod of consumables) {
                    // Log FULL raw product data for debugging price issues
                    console.log('[IAP] 🔍 Raw consumable data:', {
                        productId: (prod as any).productId || (prod as any).id,
                        displayPrice: (prod as any).displayPrice,
                        price: (prod as any).price,
                        currency: (prod as any).currency,
                    });
                    
                    // ALWAYS use displayPrice from StoreKit - this is what Apple will charge
                    const displayPrice = (prod as any).displayPrice;
                    
                    console.log('[IAP] ✅ Using StoreKit displayPrice for', (prod as any).productId || (prod as any).id, ':', displayPrice);
                    
                    const product: IAPProduct = {
                        productId: (prod as any).productId || (prod as any).id || '',
                        title: (prod as any).title || (prod as any).displayName || (prod as any).name || '',
                        description: (prod as any).description || '',
                        price: displayPrice || '', // Use ONLY StoreKit price, empty if not available
                        priceCurrencyCode: (prod as any).currency,
                    };
                    this.products.set(product.productId, product);
                    allProducts.push(product);
                }
            }

            console.log('[IAP] Products fetched:', allProducts.length);
            return allProducts;
        } catch (error) {
            console.error('[IAP] Failed to fetch products:', error);
            // Mock products are a development convenience only. On a real store
            // platform return an empty array so the UI shows a proper error
            // rather than a price the store never quoted.
            if (!hasStore) {
                return this.getMockProducts();
            }
            return [];
        }
    }

    /**
     * Get a specific product by ID
     */
    getProduct(productId: string): IAPProduct | undefined {
        return this.products.get(productId);
    }

    /**
     * Purchase a subscription
     */
    async purchaseSubscription(productId: string): Promise<PurchaseResult> {
        if (!this.isAvailable()) {
            return { success: false, error: 'IAP not available (requires native build)' };
        }

        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            console.log('[IAP] Purchasing subscription:', productId);

            // Play needs the subscription's offer token; StoreKit takes the sku
            // alone. Send only the current platform's block so the native module
            // never falls back to a half-populated request.
            const request: Record<string, unknown> = {};
            if (Platform.OS === 'android') {
                const offerToken = this.androidOfferTokens.get(productId);
                if (!offerToken) {
                    return {
                        success: false,
                        error: 'Subscription offer unavailable. Please try again.',
                    };
                }
                request.google = {
                    skus: [productId],
                    subscriptionOffers: [{ sku: productId, offerToken }],
                };
            } else {
                request.apple = { sku: productId };
            }

            const purchase = await ExpoIAP.requestPurchase({ request, type: 'subs' });

            // Handle array response
            const purchaseItem = Array.isArray(purchase) ? purchase[0] : purchase;

            if (purchaseItem) {
                // Finish the transaction for subscriptions too. On Play this is
                // the acknowledgement Google requires within 3 days, or the
                // purchase is automatically refunded.
                try {
                    await ExpoIAP.finishTransaction({ purchase: purchaseItem, isConsumable: false });
                } catch (finishErr) {
                    console.warn('[IAP] Failed to finish subscription transaction:', finishErr);
                }

                console.log('[IAP] Subscription purchase successful:', (purchaseItem as any).transactionId);
                return {
                    success: true,
                    productId: (purchaseItem as any).productId,
                    transactionId: transactionIdOf(purchaseItem),
                    receipt: (purchaseItem as any).purchaseToken || undefined,
                    platform: Platform.OS === 'android' ? 'android' : 'ios',
                };
            }

            return { success: false, error: 'Purchase returned empty' };
        } catch (error: any) {
            console.error('[IAP] Subscription purchase failed:', error);
            
            // Handle user cancellation
            if (isCancelledError(error)) {
                return { success: false, error: 'cancelled' };
            }

            // Handle "Item already owned" - the user already has this subscription.
            // Routine on Play when re-buying, and on Apple in sandbox/review when
            // previous transactions weren't finished.
            if (isAlreadyOwnedError(error)) {
                console.log('[IAP] Item already owned, attempting to restore...');
                return { success: false, error: 'already_owned' };
            }
            
            return { success: false, error: error.message || 'Purchase failed' };
        }
    }

    /**
     * Purchase a consumable product (single trip)
     */
    async purchaseProduct(productId: string): Promise<PurchaseResult> {
        if (!this.isAvailable()) {
            return { success: false, error: 'IAP not available (requires native build)' };
        }

        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            console.log('[IAP] Purchasing product:', productId);
            const request: Record<string, unknown> =
                Platform.OS === 'android'
                    ? { google: { skus: [productId] } }
                    : { apple: { sku: productId } };

            const purchase = await ExpoIAP.requestPurchase({ request, type: 'in-app' });

            // Handle array response
            const purchaseItem = Array.isArray(purchase) ? purchase[0] : purchase;

            if (purchaseItem) {
                // For consumables, we need to finish the transaction. On Play
                // this consumes the purchase so the trip credit can be bought
                // again; without it Google reports "already owned" next time.
                await ExpoIAP.finishTransaction({ purchase: purchaseItem, isConsumable: true });

                console.log('[IAP] Product purchase successful:', (purchaseItem as any).transactionId);
                return {
                    success: true,
                    productId: (purchaseItem as any).productId,
                    transactionId: transactionIdOf(purchaseItem),
                    receipt: (purchaseItem as any).purchaseToken || undefined,
                    platform: Platform.OS === 'android' ? 'android' : 'ios',
                };
            }
            
            return { success: false, error: 'Purchase returned empty' };
        } catch (error: any) {
            console.error('[IAP] Product purchase failed:', error);

            // Handle user cancellation
            if (isCancelledError(error)) {
                return { success: false, error: 'cancelled' };
            }

            // An unconsumed trip credit blocks re-purchase on Play; surface it
            // so the caller can restore rather than showing a raw store error.
            if (isAlreadyOwnedError(error)) {
                return { success: false, error: 'already_owned' };
            }

            return { success: false, error: error.message || 'Purchase failed' };
        }
    }

    /**
     * Finish a purchase that was recovered through restore rather than bought
     * in this session. Play requires every purchase to be acknowledged
     * (subscriptions) or consumed (credits) once the entitlement is granted —
     * anything still pending after 3 days is automatically refunded by Google.
     * Call this only after the server has verified the purchase.
     */
    async finishRestoredPurchase(productId: string, purchaseToken: string): Promise<void> {
        if (!this.isAvailable()) return;

        try {
            const purchases = await ExpoIAP.getAvailablePurchases();
            const match = (purchases || []).find(
                (p: any) => (p?.purchaseToken || '') === purchaseToken
            );
            if (!match) return;

            const isSubscription = (SUBSCRIPTION_PRODUCT_IDS as readonly string[]).includes(productId);
            await ExpoIAP.finishTransaction({ purchase: match, isConsumable: !isSubscription });
            console.log('[IAP] Finished restored purchase:', productId);
        } catch (e) {
            console.warn('[IAP] Could not finish restored purchase:', e);
        }
    }

    /**
     * Restore previous purchases
     */
    async restorePurchases(): Promise<PurchaseResult[]> {
        if (!this.isAvailable()) {
            return [];
        }

        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            console.log('[IAP] Restoring purchases...');
            
            // Trigger restore flow
            await ExpoIAP.restorePurchases();
            
            // Get available purchases
            const purchases = await ExpoIAP.getAvailablePurchases();
            
            const results: PurchaseResult[] = [];
            
            if (purchases) {
                for (const purchase of purchases) {
                    results.push({
                        success: true,
                        productId: purchase.productId,
                        transactionId: transactionIdOf(purchase),
                        receipt: (purchase as any).purchaseToken || undefined,
                        platform: Platform.OS === 'android' ? 'android' : 'ios',
                    });
                }
            }
            
            console.log('[IAP] Restored purchases:', results.length);
            return results;
        } catch (error: any) {
            console.error('[IAP] Failed to restore purchases:', error);
            return [{ success: false, error: error.message || 'Restore failed' }];
        }
    }

    /**
     * Get current subscription status
     */
    async getActiveSubscription(): Promise<PurchaseResult | null> {
        if (!this.isAvailable()) {
            return null;
        }

        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // Use the native active subscriptions check
            const subscriptions = await ExpoIAP.getActiveSubscriptions(SUBSCRIPTION_PRODUCT_IDS);
            
            if (subscriptions && subscriptions.length > 0) {
                const sub = subscriptions[0];
                return {
                    success: true,
                    productId: sub.productId,
                    transactionId: sub.transactionId || undefined,
                    receipt: (sub as any).purchaseToken || undefined,
                };
            }
            
            return null;
        } catch (error) {
            console.error('[IAP] Failed to get active subscription:', error);
            return null;
        }
    }

    /**
     * Finish a transaction (required for consumables)
     */
    async finishTransaction(purchase: any): Promise<void> {
        if (!this.isAvailable()) {
            console.log('[IAP] Skipping finishTransaction - native module not available');
            return;
        }
        
        try {
            await ExpoIAP.finishTransaction({ purchase, isConsumable: true });
            console.log('[IAP] Transaction finished:', purchase.transactionId);
        } catch (error) {
            console.error('[IAP] Failed to finish transaction:', error);
        }
    }

    /**
     * Mock products for development/non-iOS
     */
    private getMockProducts(): IAPProduct[] {
        return [
            {
                productId: PRODUCT_IDS.YEARLY_SUBSCRIPTION,
                title: 'Planera Pro - Yearly',
                description: 'Unlimited AI trip planning for a year',
                price: '€29.99',
                priceCurrencyCode: 'EUR',
                subscriptionPeriod: 'P1Y',
            },
            {
                productId: PRODUCT_IDS.MONTHLY_SUBSCRIPTION,
                title: 'Planera Pro - Monthly',
                description: 'Unlimited AI trip planning',
                price: '€4.99',
                priceCurrencyCode: 'EUR',
                subscriptionPeriod: 'P1M',
            },
            {
                productId: PRODUCT_IDS.SINGLE_TRIP,
                title: 'Single Trip',
                description: 'One AI-generated trip plan',
                price: '€4.99',
                priceCurrencyCode: 'EUR',
            },
        ];
    }
}

// Export singleton instance
export const iapService = new IAPService();

// Export convenience functions
export const initializeIAP = () => iapService.initialize();
export const endIAPConnection = () => iapService.endConnection();
export const getIAPProducts = () => iapService.getProducts();
export const purchaseSubscription = (productId: string) => iapService.purchaseSubscription(productId);
export const purchaseProduct = (productId: string) => iapService.purchaseProduct(productId);
export const restorePurchases = () => iapService.restorePurchases();
export const getActiveSubscription = () => iapService.getActiveSubscription();
export const finishRestoredPurchase = (productId: string, purchaseToken: string) =>
    iapService.finishRestoredPurchase(productId, purchaseToken);
