// Offline trip cache — persists Convex query snapshots to disk so trips stay
// readable with no connection (airplane mode, roaming, dead spots).
//
// Storage: JSON files under <documentDirectory>/offline-cache/ via the
// expo-file-system File/Directory API (no new native dependency, OTA-safe).
// Web falls back to localStorage. Every operation is wrapped so a cache
// failure can never break the live app — worst case we behave as before.

import { Platform } from "react-native";
import { File, Directory, Paths } from "expo-file-system";

const DIR_NAME = "offline-cache";
const WEB_PREFIX = "offlineCache:";
const CACHE_VERSION = 1;

export interface CacheEntry<T> {
    data: T;
    savedAt: number;
}

interface StoredEntry<T> {
    v: number;
    savedAt: number;
    data: T;
}

// Keys used across the app — centralized so prune logic can reason about them
export const tripCacheKey = (tripId: string) => `trip-${tripId}`;
export const sightsCacheKey = (tripId: string) => `sights-${tripId}`;
export const TRIPS_LIST_CACHE_KEY = "trips-list";

const sanitizeKey = (key: string) => key.replace(/[^a-zA-Z0-9_-]/g, "_");

// Directory handle is created lazily — native APIs must not run at module scope
function getCacheDir(): Directory | null {
    try {
        const dir = new Directory(Paths.document, DIR_NAME);
        if (!dir.exists) {
            dir.create({ idempotent: true });
        }
        return dir;
    } catch (e) {
        console.warn("[OfflineCache] Cache directory unavailable:", e);
        return null;
    }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
    try {
        const payload: StoredEntry<T> = { v: CACHE_VERSION, savedAt: Date.now(), data };
        const serialized = JSON.stringify(payload);

        if (Platform.OS === "web") {
            globalThis.localStorage?.setItem(WEB_PREFIX + sanitizeKey(key), serialized);
            return;
        }

        const dir = getCacheDir();
        if (!dir) return;
        const file = new File(dir, `${sanitizeKey(key)}.json`);
        if (!file.exists) file.create({ intermediates: true, overwrite: true });
        file.write(serialized);
    } catch (e) {
        console.warn(`[OfflineCache] Failed to write "${key}":`, e);
    }
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
        let serialized: string | null = null;

        if (Platform.OS === "web") {
            serialized = globalThis.localStorage?.getItem(WEB_PREFIX + sanitizeKey(key)) ?? null;
        } else {
            const dir = getCacheDir();
            if (!dir) return null;
            const file = new File(dir, `${sanitizeKey(key)}.json`);
            if (!file.exists) return null;
            serialized = await file.text();
        }

        if (!serialized) return null;
        const parsed: StoredEntry<T> = JSON.parse(serialized);
        if (parsed?.v !== CACHE_VERSION || parsed.data === undefined) return null;
        return { data: parsed.data, savedAt: parsed.savedAt };
    } catch (e) {
        console.warn(`[OfflineCache] Failed to read "${key}":`, e);
        return null;
    }
}

export async function deleteCache(key: string): Promise<void> {
    try {
        if (Platform.OS === "web") {
            globalThis.localStorage?.removeItem(WEB_PREFIX + sanitizeKey(key));
            return;
        }
        const dir = getCacheDir();
        if (!dir) return;
        const file = new File(dir, `${sanitizeKey(key)}.json`);
        if (file.exists) file.delete();
    } catch (e) {
        console.warn(`[OfflineCache] Failed to delete "${key}":`, e);
    }
}

/**
 * Removes per-trip snapshots (trip-* / sights-*) for trips the user no longer
 * has, so deleted trips don't reappear offline and storage doesn't grow forever.
 */
export async function pruneTripCaches(keepTripIds: string[]): Promise<void> {
    try {
        const keep = new Set(keepTripIds.map(sanitizeKey));
        const shouldKeep = (baseName: string) => {
            const match = baseName.match(/^(?:trip|sights)-(.+)$/);
            if (!match) return true; // not a per-trip entry — leave it alone
            return keep.has(match[1]);
        };

        if (Platform.OS === "web") {
            const storage = globalThis.localStorage;
            if (!storage) return;
            const stale: string[] = [];
            for (let i = 0; i < storage.length; i++) {
                const fullKey = storage.key(i);
                if (fullKey?.startsWith(WEB_PREFIX) && !shouldKeep(fullKey.slice(WEB_PREFIX.length))) {
                    stale.push(fullKey);
                }
            }
            stale.forEach((k) => storage.removeItem(k));
            return;
        }

        const dir = getCacheDir();
        if (!dir) return;
        for (const item of dir.list()) {
            if (item instanceof File && item.name.endsWith(".json")) {
                const baseName = item.name.slice(0, -".json".length);
                if (!shouldKeep(baseName)) item.delete();
            }
        }
    } catch (e) {
        console.warn("[OfflineCache] Prune failed:", e);
    }
}

/** Clears the entire offline cache (e.g. on sign-out). */
export async function clearOfflineCache(): Promise<void> {
    try {
        if (Platform.OS === "web") {
            const storage = globalThis.localStorage;
            if (!storage) return;
            const mine: string[] = [];
            for (let i = 0; i < storage.length; i++) {
                const fullKey = storage.key(i);
                if (fullKey?.startsWith(WEB_PREFIX)) mine.push(fullKey);
            }
            mine.forEach((k) => storage.removeItem(k));
            return;
        }
        const dir = new Directory(Paths.document, DIR_NAME);
        if (dir.exists) dir.delete();
    } catch (e) {
        console.warn("[OfflineCache] Clear failed:", e);
    }
}
