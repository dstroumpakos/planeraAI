/**
 * React Hook for Apple In-App Purchases
 * 
 * Provides easy access to IAP functionality in React components.
 */

import { useState, useEffect, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import {
    iapService,
    IAPProduct,
    PurchaseResult,
    PRODUCT_IDS,
    SUBSCRIPTION_PRODUCT_IDS,
} from './iap';

export interface UseIAPReturn {
    // State
    isLoading: boolean;
    isInitialized: boolean;
    products: IAPProduct[];
    error: string | null;
    
    // Products by type
    yearlySubscription: IAPProduct | null;
    monthlySubscription: IAPProduct | null;
    singleTrip: IAPProduct | null;
    
    // Actions
    purchaseYearly: () => Promise<PurchaseResult>;
    purchaseMonthly: () => Promise<PurchaseResult>;
    purchaseSingleTrip: () => Promise<PurchaseResult>;
    restorePurchases: () => Promise<PurchaseResult[]>;
    refreshProducts: () => Promise<void>;
}

export function useIAP(): UseIAPReturn {
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [products, setProducts] = useState<IAPProduct[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Initialize IAP on mount
    useEffect(() => {
        let mounted = true;

        const init = async () => {
            if (Platform.OS !== 'ios') {
                // Use mock products for non-iOS
                const mockProducts = await iapService.getProducts();
                if (mounted) {
                    setProducts(mockProducts);
                    setIsInitialized(true);
                }
                return;
            }

            setIsLoading(true);
            try {
                const initialized = await iapService.initialize();
                if (mounted && initialized) {
                    setIsInitialized(true);
                    const fetchedProducts = await iapService.getProducts();
                    if (mounted) {
                        setProducts(fetchedProducts);
                    }
                }
            } catch (err: any) {
                console.error('[useIAP] Initialization error:', err);
                if (mounted) {
                    setError(err.message || 'Failed to initialize IAP');
                }
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        };

        init();

        return () => {
            mounted = false;
        };
    }, []);

    // Get products by type
    const yearlySubscription = products.find(p => p.productId === PRODUCT_IDS.YEARLY_SUBSCRIPTION) || null;
    const monthlySubscription = products.find(p => p.productId === PRODUCT_IDS.MONTHLY_SUBSCRIPTION) || null;
    const singleTrip = products.find(p => p.productId === PRODUCT_IDS.SINGLE_TRIP) || null;

    // Refresh products
    const refreshProducts = useCallback(async () => {
        setIsLoading(true);
        try {
            const fetchedProducts = await iapService.getProducts();
            setProducts(fetchedProducts);
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch products');
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Purchase yearly subscription
    const purchaseYearly = useCallback(async (): Promise<PurchaseResult> => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await iapService.purchaseSubscription(PRODUCT_IDS.YEARLY_SUBSCRIPTION);
            if (!result.success && result.error !== 'cancelled') {
                setError(result.error || 'Purchase failed');
            }
            return result;
        } catch (err: any) {
            const errorMsg = err.message || 'Purchase failed';
            setError(errorMsg);
            return { success: false, error: errorMsg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Purchase monthly subscription
    const purchaseMonthly = useCallback(async (): Promise<PurchaseResult> => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await iapService.purchaseSubscription(PRODUCT_IDS.MONTHLY_SUBSCRIPTION);
            if (!result.success && result.error !== 'cancelled') {
                setError(result.error || 'Purchase failed');
            }
            return result;
        } catch (err: any) {
            const errorMsg = err.message || 'Purchase failed';
            setError(errorMsg);
            return { success: false, error: errorMsg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Purchase single trip
    const purchaseSingleTrip = useCallback(async (): Promise<PurchaseResult> => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await iapService.purchaseProduct(PRODUCT_IDS.SINGLE_TRIP);
            if (!result.success && result.error !== 'cancelled') {
                setError(result.error || 'Purchase failed');
            }
            return result;
        } catch (err: any) {
            const errorMsg = err.message || 'Purchase failed';
            setError(errorMsg);
            return { success: false, error: errorMsg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Restore purchases
    const restorePurchasesHandler = useCallback(async (): Promise<PurchaseResult[]> => {
        setIsLoading(true);
        setError(null);
        try {
            const results = await iapService.restorePurchases();
            return results;
        } catch (err: any) {
            const errorMsg = err.message || 'Restore failed';
            setError(errorMsg);
            return [{ success: false, error: errorMsg }];
        } finally {
            setIsLoading(false);
        }
    }, []);

    return {
        isLoading,
        isInitialized,
        products,
        error,
        yearlySubscription,
        monthlySubscription,
        singleTrip,
        purchaseYearly,
        purchaseMonthly,
        purchaseSingleTrip,
        restorePurchases: restorePurchasesHandler,
        refreshProducts,
    };
}

export { PRODUCT_IDS, SUBSCRIPTION_PRODUCT_IDS };
