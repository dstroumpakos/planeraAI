/**
 * Apple In-App Purchase Service
 * 
 * Handles all IAP operations for the Planera app.
 * 
 * Products:
 * - com.planeraaitravelplanner.pro.yearly (Auto-renewable subscription)
 * - com.planeraaitravelplanner.pro.monthly (Auto-renewable subscription)
 * - com.planeraaitravelplanner.trip.single (Consumable - 1 trip credit)
 * 
 * NOTE: expo-iap requires a native build. In Expo Go or development without
 * native modules, mock products will be used instead.
 */

import { Platform } from 'react-native';

// Lazy load expo-iap to avoid crashes in Expo Go
let ExpoIAP: any = null;
let iapAvailable = false;

// Try to load expo-iap only on iOS
if (Platform.OS === 'ios') {
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
}

// IAP Service class
class IAPService {
    private isInitialized = false;
    private products: Map<string, IAPProduct> = new Map();

    /**
     * Check if IAP is available (native module loaded)
     */
    isAvailable(): boolean {
        return iapAvailable && Platform.OS === 'ios';
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
            return this.isInitialized;
        } catch (error) {
            console.error('[IAP] Failed to initialize:', error);
            return false;
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
                        productId: (sub as any).productId,
                        localizedPrice: (sub as any).localizedPrice,
                        price: (sub as any).price,
                        currency: (sub as any).currency,
                        raw: JSON.stringify(sub)
                    });
                    
                    // ALWAYS use localizedPrice from StoreKit - this is what Apple will charge
                    // Never override or format this - it includes proper currency symbol and locale
                    const localizedPrice = (sub as any).localizedPrice;
                    
                    console.log('[IAP] ✅ Using StoreKit localizedPrice for', (sub as any).productId, ':', localizedPrice);
                    
                    const product: IAPProduct = {
                        productId: (sub as any).productId || (sub as any).id || '',
                        title: (sub as any).title || (sub as any).name || '',
                        description: (sub as any).description || '',
                        price: localizedPrice || '', // Use ONLY StoreKit price, empty if not available
                        priceCurrencyCode: (sub as any).currency,
                        subscriptionPeriod: (sub as any).subscriptionPeriod,
                    };
                    this.products.set(product.productId, product);
                    allProducts.push(product);
                }
            }

            // Map consumables
            if (consumables) {
                for (const prod of consumables) {
                    // Log FULL raw product data for debugging price issues
                    console.log('[IAP] 🔍 Raw consumable data:', {
                        productId: (prod as any).productId,
                        localizedPrice: (prod as any).localizedPrice,
                        price: (prod as any).price,
                        currency: (prod as any).currency,
                    });
                    
                    // ALWAYS use localizedPrice from StoreKit - this is what Apple will charge
                    const localizedPrice = (prod as any).localizedPrice;
                    
                    console.log('[IAP] ✅ Using StoreKit localizedPrice for', (prod as any).productId, ':', localizedPrice);
                    
                    const product: IAPProduct = {
                        productId: (prod as any).productId || (prod as any).id || '',
                        title: (prod as any).title || (prod as any).name || '',
                        description: (prod as any).description || '',
                        price: localizedPrice || '', // Use ONLY StoreKit price, empty if not available
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
            return this.getMockProducts();
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
            const purchase = await ExpoIAP.requestPurchase({
                request: {
                    apple: { sku: productId },
                },
                type: 'subs',
            });
            
            // Handle array response
            const purchaseItem = Array.isArray(purchase) ? purchase[0] : purchase;
            
            if (purchaseItem) {
                console.log('[IAP] Subscription purchase successful:', (purchaseItem as any).transactionId);
                return {
                    success: true,
                    productId: (purchaseItem as any).productId,
                    transactionId: (purchaseItem as any).transactionId || undefined,
                    receipt: (purchaseItem as any).transactionReceipt || undefined,
                };
            }
            
            return { success: false, error: 'Purchase returned empty' };
        } catch (error: any) {
            console.error('[IAP] Subscription purchase failed:', error);
            
            // Handle user cancellation
            if (error.code === 'E_USER_CANCELLED' || error.message?.includes('cancelled')) {
                return { success: false, error: 'cancelled' };
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
            const purchase = await ExpoIAP.requestPurchase({
                request: {
                    apple: { sku: productId },
                },
                type: 'in-app',
            });
            
            // Handle array response
            const purchaseItem = Array.isArray(purchase) ? purchase[0] : purchase;
            
            if (purchaseItem) {
                // For consumables, we need to finish the transaction
                await ExpoIAP.finishTransaction({ purchase: purchaseItem, isConsumable: true });
                
                console.log('[IAP] Product purchase successful:', (purchaseItem as any).transactionId);
                return {
                    success: true,
                    productId: (purchaseItem as any).productId,
                    transactionId: (purchaseItem as any).transactionId || undefined,
                    receipt: (purchaseItem as any).transactionReceipt || undefined,
                };
            }
            
            return { success: false, error: 'Purchase returned empty' };
        } catch (error: any) {
            console.error('[IAP] Product purchase failed:', error);
            
            // Handle user cancellation
            if (error.code === 'E_USER_CANCELLED' || error.message?.includes('cancelled')) {
                return { success: false, error: 'cancelled' };
            }
            
            return { success: false, error: error.message || 'Purchase failed' };
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
                        transactionId: purchase.transactionId || undefined,
                        receipt: (purchase as any).transactionReceipt || undefined,
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
                    receipt: (sub as any).transactionReceipt || undefined,
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
