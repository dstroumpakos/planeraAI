// Native-specific auth client implementation
// This file is used on iOS/Android to avoid importing better-auth directly
// which contains webpack-style dynamic imports that crash Hermes

// CRITICAL: NO native module calls at module scope!
// All native API calls must happen inside functions called after React mounts.

import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

// Storage keys - these are safe at module scope (just strings)
const getStoragePrefix = () => Constants.expoConfig?.scheme || "planera";
const getSessionKey = () => `${getStoragePrefix()}_session`;
const getTokenKey = () => `${getStoragePrefix()}_token`;

// Get the base URL for auth requests
const BASE_URL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

// Types - exported for use by consumers
export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  image?: string;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  token: string;
  user?: AuthUser;
}

export interface AuthResponse<T = any> {
  data: T | null;
  error: Error | null;
}

export interface SessionData {
  session: AuthSession | null;
  user: AuthUser | null;
}

// Helper to safely access SecureStore - ONLY call after mount
async function getSecureItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    console.warn("[Auth] SecureStore read error:", error);
    return null;
  }
}

async function setSecureItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    console.warn("[Auth] SecureStore write error:", error);
  }
}

async function deleteSecureItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    console.warn("[Auth] SecureStore delete error:", error);
  }
}

// Get stored token - ONLY call after mount
async function getStoredToken(): Promise<string | null> {
  return getSecureItem(getTokenKey());
}

// Make authenticated fetch request
async function authFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<AuthResponse<T>> {
  try {
    if (!BASE_URL) {
      console.error("[Auth] EXPO_PUBLIC_CONVEX_SITE_URL is not set");
      return { data: null, error: new Error("Auth URL not configured") };
    }

    const token = await getStoredToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const url = `${BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Auth] Request failed:", response.status, errorText);
      return { data: null, error: new Error(errorText || `HTTP ${response.status}`) };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.error("[Auth] Fetch error:", error);
    return { data: null, error: error as Error };
  }
}

// Create the auth client with Better Auth compatible API
function createNativeAuthClient() {
  // Session state listeners
  const listeners: Set<(session: SessionData | null) => void> = new Set();
  let currentSession: SessionData | null = null;
  let initialized = false;
  let initPromise: Promise<void> | null = null;

  const notifyListeners = (session: SessionData | null) => {
    currentSession = session;
    listeners.forEach((listener) => listener(session));
  };

  // Store session data
  const storeSession = async (session: AuthSession, user: AuthUser) => {
    await setSecureItem(getSessionKey(), JSON.stringify({ session, user }));
    if (session.token) {
      await setSecureItem(getTokenKey(), session.token);
    }
    notifyListeners({ session, user });
  };

  // Clear session data
  const clearSession = async () => {
    await deleteSecureItem(getSessionKey());
    await deleteSecureItem(getTokenKey());
    notifyListeners(null);
  };

  // Load stored session - ONLY called after explicit init or first use
  const loadStoredSession = async () => {
    if (initialized) return;
    initialized = true;
    
    try {
      console.log("[Auth] Loading stored session...");
      const stored = await getSecureItem(getSessionKey());
      if (stored) {
        const parsed = JSON.parse(stored);
        currentSession = parsed;
        notifyListeners(parsed);
        console.log("[Auth] Restored session from storage");
      } else {
        console.log("[Auth] No stored session found");
      }
    } catch (error) {
      console.warn("[Auth] Failed to load stored session:", error);
    }
  };

  // Ensure initialized before any operation
  const ensureInit = async () => {
    if (!initPromise) {
      initPromise = loadStoredSession();
    }
    await initPromise;
  };

  // Explicit init function - call from useEffect in root component
  const init = async () => {
    console.log("[Auth] Explicit init called");
    await ensureInit();
  };

  // DO NOT call loadStoredSession() here at module scope!
  // It will be called lazily on first use or via explicit init()

  return {
    // Explicit initialization - call from useEffect
    init,

    // Sign in with email/password
    signIn: {
      email: async ({
        email,
        password,
      }: {
        email: string;
        password: string;
      }): Promise<AuthResponse<SessionData>> => {
        await ensureInit();
        const response = await authFetch<any>("/api/auth/sign-in/email", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });

        if (response.data?.session && response.data?.user) {
          await storeSession(response.data.session, response.data.user);
          return { data: { session: response.data.session, user: response.data.user }, error: null };
        }

        return { data: null, error: response.error };
      },

      // Social sign in (Google, Apple, etc.)
      social: async ({
        provider,
        callbackURL,
      }: {
        provider: string;
        callbackURL?: string;
      }): Promise<AuthResponse<{ url: string }>> => {
        await ensureInit();
        const scheme = Constants.expoConfig?.scheme || "planera";
        const redirectURL = callbackURL || `${scheme}://`;
        
        const response = await authFetch<any>("/api/auth/sign-in/social", {
          method: "POST",
          body: JSON.stringify({ 
            provider, 
            callbackURL: redirectURL,
            mode: "expo",
          }),
        });

        if (response.data?.url) {
          return { data: { url: response.data.url }, error: null };
        }

        return { data: null, error: response.error };
      },

      // Anonymous sign in
      anonymous: async (): Promise<AuthResponse<SessionData>> => {
        await ensureInit();
        const response = await authFetch<any>("/api/auth/sign-in/anonymous", {
          method: "POST",
          body: JSON.stringify({}),
        });

        if (response.data?.session && response.data?.user) {
          await storeSession(response.data.session, response.data.user);
          return { data: { session: response.data.session, user: response.data.user }, error: null };
        }

        return { data: null, error: response.error };
      },
    },

    // Sign up with email/password
    signUp: {
      email: async ({
        email,
        password,
        name,
      }: {
        email: string;
        password: string;
        name?: string;
      }): Promise<AuthResponse<SessionData>> => {
        await ensureInit();
        const response = await authFetch<any>("/api/auth/sign-up/email", {
          method: "POST",
          body: JSON.stringify({ email, password, name }),
        });

        if (response.data?.session && response.data?.user) {
          await storeSession(response.data.session, response.data.user);
          return { data: { session: response.data.session, user: response.data.user }, error: null };
        }

        return { data: null, error: response.error };
      },
    },

    // Sign out
    signOut: async (): Promise<AuthResponse<null>> => {
      await ensureInit();
      try {
        await authFetch("/api/auth/sign-out", { method: "POST" });
      } catch (error) {
        console.warn("[Auth] Sign out request failed:", error);
      }
      await clearSession();
      return { data: null, error: null };
    },

    // Get current session
    getSession: async (): Promise<AuthResponse<SessionData>> => {
      await ensureInit();
      const response = await authFetch<SessionData>("/api/auth/get-session", {
        method: "GET",
      });

      if (response.data?.session) {
        await storeSession(response.data.session, response.data.user!);
        return response;
      }

      // If no valid session from server, clear local storage
      if (!response.error) {
        await clearSession();
      }

      return { data: { session: null, user: null }, error: response.error };
    },

    // React hook for session (returns current state)
    useSession: () => {
      // This is a simplified version - in the real implementation,
      // this would be a proper React hook with useState/useEffect
      // The actual hook behavior is handled by ConvexBetterAuthProvider
      return {
        data: currentSession,
        isPending: false,
        error: null,
      };
    },

    // Fetch wrapper for authenticated requests
    $fetch: authFetch,

    // Store for session state
    $store: {
      listen: (callback: (session: SessionData | null) => void) => {
        listeners.add(callback);
        // Immediately call with current state
        callback(currentSession);
        return () => listeners.delete(callback);
      },
      get: () => currentSession,
      set: (value: SessionData | null) => notifyListeners(value),
      notify: () => notifyListeners(currentSession),
    },

    // For Convex integration
    getToken: getStoredToken,
  };
}

// Export the auth client singleton
// CRITICAL: createNativeAuthClient() no longer calls SecureStore at import time
export const authClient = createNativeAuthClient();
