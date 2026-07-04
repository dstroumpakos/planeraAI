// Offline-first wrapper around Convex useQuery.
//
// Cache-then-network: while the live subscription is unresolved (loading or
// offline) we serve the last snapshot persisted to disk; when live data
// arrives it replaces the snapshot and is re-persisted. Convex has no
// built-in offline persistence, so this is what keeps trips readable in
// airplane mode.

import { useEffect, useState } from "react";
import { useQuery, useConvexConnectionState } from "convex/react";
import { readCache, writeCache } from "./offlineTripCache";

export interface CachedQueryResult<T> {
    /** Live result when available, otherwise the persisted snapshot, otherwise undefined. */
    data: T | undefined;
    /** True while we're showing the disk snapshot instead of live data. */
    isFromCache: boolean;
    /** When the snapshot being shown was saved (ms epoch), if any. */
    cachedAt: number | null;
    /** True once the disk lookup finished — lets callers distinguish "still checking" from "no snapshot". */
    cacheChecked: boolean;
}

/**
 * Drop-in useQuery replacement with disk-backed fallback.
 * Pass `"skip"` as args to skip (same as useQuery); the cache is still read
 * so cached data can render before auth finishes loading the token.
 */
export function useCachedQuery<T>(
    query: any,
    args: any,
    cacheKey: string | null
): CachedQueryResult<T> {
    const live = useQuery(query, args) as T | undefined;
    const [cached, setCached] = useState<{ key: string; data: T; savedAt: number } | null>(null);
    const [checkedKey, setCheckedKey] = useState<string | null>(null);

    // Hydrate from disk once per key
    useEffect(() => {
        if (!cacheKey) return;
        let mounted = true;
        readCache<T>(cacheKey).then((entry) => {
            if (!mounted) return;
            if (entry) setCached({ key: cacheKey, data: entry.data, savedAt: entry.savedAt });
            setCheckedKey(cacheKey);
        });
        return () => {
            mounted = false;
        };
    }, [cacheKey]);

    // Persist live results. `null` means "loaded and empty/not found" — that's
    // a real answer, not a connectivity gap, so we don't snapshot it.
    useEffect(() => {
        if (cacheKey && live !== undefined && live !== null) {
            writeCache(cacheKey, live);
        }
    }, [live, cacheKey]);

    const usableCache = cached && cached.key === cacheKey ? cached : null;
    const data = live !== undefined ? live : usableCache?.data;
    const isFromCache = live === undefined && usableCache !== null;

    return {
        data,
        isFromCache,
        cachedAt: isFromCache ? usableCache!.savedAt : null,
        cacheChecked: cacheKey !== null && checkedKey === cacheKey,
    };
}

/**
 * True when the Convex WebSocket is down (offline or backend unreachable).
 * Used to distinguish "offline, showing saved copy" from a normal brief load.
 */
export function useIsOffline(): boolean {
    const state = useConvexConnectionState();
    return !state.isWebSocketConnected;
}
