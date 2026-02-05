
// Native-specific auth client implementation
// This file is used on iOS/Android to avoid importing better-auth directly
// which contains webpack-style dynamic imports that crash Hermes

// CRITICAL: NO native module calls at module scope!
// All native API calls must happen inside functions called after React mounts.

import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Storage keys - these are safe at module scope (just strings)
const getStoragePrefix = () => Constants.expoConfig?.scheme || "planera";
const getSessionKey = () => `${getStoragePrefix()}_session`;
const getTokenKey = () => `${getStoragePrefix()}_token`;
const getUserKey = () => `${getStoragePrefix()}_user`;

// Get the base URL for auth requests - MUST be EXPO_PUBLIC_CONVEX_SITE_URL
const BASE_URL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

// Convex URL for native auth actions
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL;

// Google Web Client ID for native sign-in
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

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
  isNewUser?: boolean;
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
  const token = await getSecureItem(getTokenKey());
  console.log("[Auth] getStoredToken:", token ? "FOUND" : "MISSING");
  return token;
}

// Make authenticated fetch request with detailed logging
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
    console.log("[Auth] Fetching:", options.method || "GET", url);

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    console.log("[Auth] Response status:", response.status);

    // Read body as text first for debugging
    const bodyText = await response.text();
    console.log("[Auth] Response body:", bodyText.substring(0, 500));

    if (!response.ok) {
      console.error("[Auth] Request failed:", response.status, bodyText);
      return { data: null, error: new Error(bodyText || `HTTP ${response.status}`) };
    }

    // Parse JSON from text
    const data = bodyText ? JSON.parse(bodyText) : null;
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

  // Google Sign-In instance (lazy loaded)
  let googleSignInConfigured = false;

  const notifyListeners = (session: SessionData | null) => {
    currentSession = session;
    console.log("[Auth] Notifying listeners, authenticated:", !!session?.session);
    listeners.forEach((listener) => listener(session));
  };

  // Store session data - handles Better Auth response format
  const storeSession = async (session: AuthSession, user: AuthUser) => {
    console.log("[Auth] Storing session for user:", user.id);
    await setSecureItem(getSessionKey(), JSON.stringify({ session, user }));
    await setSecureItem(getUserKey(), JSON.stringify(user));
    if (session.token) {
      await setSecureItem(getTokenKey(), session.token);
      console.log("[Auth] Token stored successfully");
    }
    notifyListeners({ session, user });
  };

  // Create session object from Better Auth token+user response
  const createSessionFromResponse = (token: string, user: AuthUser): AuthSession => {
    return {
      id: `native_${Date.now()}`,
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    };
  };

  // Clear session data
  const clearSession = async () => {
    console.log("[Auth] Clearing session");
    await deleteSecureItem(getSessionKey());
    await deleteSecureItem(getTokenKey());
    await deleteSecureItem(getUserKey());
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
        console.log("[Auth] Restored session from storage, userId:", parsed.user?.id);
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

  // Configure Google Sign-In (call once before using)
  const configureGoogleSignIn = async () => {
    if (googleSignInConfigured || Platform.OS === "web") return;
    
    try {
      const { GoogleSignin } = await import("@react-native-google-signin/google-signin");
      
      if (!GOOGLE_WEB_CLIENT_ID) {
        console.warn("[Auth] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID not set");
        return;
      }
      
      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        offlineAccess: true,
        scopes: ["profile", "email"],
      });
      
      googleSignInConfigured = true;
      console.log("[Auth] Google Sign-In configured");
    } catch (error) {
      console.warn("[Auth] Failed to configure Google Sign-In:", error);
    }
  };

  // Native Google Sign-In
  const nativeGoogleSignIn = async (): Promise<AuthResponse<SessionData>> => {
    await ensureInit();
    
    if (Platform.OS === "web") {
      return { data: null, error: new Error("Native Google Sign-In not available on web") };
    }
    
    try {
      console.log("[Auth] Starting native Google Sign-In...");
      
      // Import dynamically to avoid issues on web
      const { GoogleSignin, statusCodes } = await import("@react-native-google-signin/google-signin");
      
      // Configure if not already done
      await configureGoogleSignIn();
      
      // Check if user has previously signed in and sign out to ensure fresh sign-in
      try {
        const currentUser = GoogleSignin.getCurrentUser();
        if (currentUser) {
          await GoogleSignin.signOut();
        }
      } catch (e) {
        // Ignore errors when checking/clearing previous sign-in
      }
      
      // Sign in
      const userInfo = await GoogleSignin.signIn();
      console.log("[Auth] Google Sign-In response:", userInfo ? "Success" : "No user info");
      
      if (!userInfo.data?.idToken) {
        return { data: null, error: new Error("No ID token received from Google") };
      }
      
      // Call Convex action to verify token and create session
      console.log("[Auth] Calling Convex signInWithGoogle action...");
      const response = await fetch(`${CONVEX_URL}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "authNative:signInWithGoogle",
          args: {
            idToken: userInfo.data.idToken,
            displayName: userInfo.data.user?.name,
          },
        }),
      });
      
      const responseText = await response.text();
      console.log("[Auth] Raw Convex response status:", response.status);
      console.log("[Auth] Raw Convex response:", responseText.substring(0, 200));
      
      let result;
      try {
        const parsed = JSON.parse(responseText);
        // Convex action responses may be wrapped in a 'value' field
        result = parsed.value !== undefined ? parsed.value : parsed;
      } catch (e) {
        console.error("[Auth] Failed to parse Convex response:", e);
        return { data: null, error: new Error("Invalid response from server") };
      }
      
      console.log("[Auth] Convex signInWithGoogle result:", {
        success: result?.success,
        hasToken: !!result?.token,
        hasUser: !!result?.user,
        error: result?.error,
      });
      
      if (!result || !result.success || result.error) {
        return { data: null, error: new Error(result?.error || "Google sign-in failed") };
      }
      
      // Store session
      const session = createSessionFromResponse(result.token, result.user);
      await storeSession(session, result.user);
      
      return { data: { session, user: result.user }, error: null };
    } catch (error: any) {
      console.error("[Auth] Native Google Sign-In error:", error);
      
      // Handle specific error codes
      const { statusCodes } = await import("@react-native-google-signin/google-signin");
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        return { data: null, error: new Error("Sign-in cancelled") };
      }
      if (error.code === statusCodes.IN_PROGRESS) {
        return { data: null, error: new Error("Sign-in already in progress") };
      }
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { data: null, error: new Error("Google Play Services not available") };
      }
      
      return { data: null, error: error as Error };
    }
  };

  // Native Apple Sign-In
  const nativeAppleSignIn = async (): Promise<AuthResponse<SessionData>> => {
    await ensureInit();
    
    if (Platform.OS !== "ios") {
      return { data: null, error: new Error("Apple Sign-In is only available on iOS") };
    }
    
    try {
      console.log("[Auth] Starting native Apple Sign-In...");
      
      // Import dynamically
      let AppleAuthentication: any;
      try {
        AppleAuthentication = await import("expo-apple-authentication");
      } catch (importError) {
        console.error("[Auth] Failed to import expo-apple-authentication:", importError);
        return { data: null, error: new Error("Failed to load Apple Sign-In. Try restarting the app or clearing Metro cache with: npx expo start -c") };
      }
      
      // Check if the module loaded correctly (Metro cache issues can cause partial loads)
      if (!AppleAuthentication?.isAvailableAsync || typeof AppleAuthentication.isAvailableAsync !== 'function') {
        console.error("[Auth] AppleAuthentication.isAvailableAsync is not available - likely Metro cache issue");
        return { data: null, error: new Error("Apple Sign-In module not loaded correctly. Please restart the app or run: npx expo start -c") };
      }
      
      // Check if Apple Sign-In is available
      const isAvailable = await AppleAuthentication.isAvailableAsync();
      if (!isAvailable) {
        return { data: null, error: new Error("Apple Sign-In not available on this device") };
      }
      
      // Sign in
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

console.log("[Auth] Apple credential raw:", {
  hasIdentityToken: !!credential.identityToken,
  identityTokenType: typeof credential.identityToken,
  identityTokenLength: credential.identityToken?.length,
  email: credential.email,
  fullName: credential.fullName,
});

      
      console.log("[Auth] Apple Sign-In credential received");
      
      if (!credential.identityToken) {
        return { data: null, error: new Error("No identity token received from Apple") };
      }
      
      // Call Convex action to verify token and create session
      console.log("[Auth] Calling Convex signInWithApple action...");
      // ✅ Build args OUTSIDE JSON.stringify
const appleArgs: any = {
  identityToken: credential.identityToken,
};

// only include email if it's a real string
if (typeof credential.email === "string" && credential.email.length > 0) {
  appleArgs.email = credential.email;
}

// only include fullName if it has real values
const givenName = credential.fullName?.givenName ?? undefined;
const familyName = credential.fullName?.familyName ?? undefined;

if (givenName || familyName) {
  appleArgs.fullName = { givenName, familyName };
}

const response = await fetch(`${CONVEX_URL}/api/action`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    path: "authNative:signInWithApple",
    args: appleArgs,
  }),
});
      
      const responseText = await response.text();
      console.log("[Auth] Raw Convex response status:", response.status);
      console.log("[Auth] Raw Convex response:", responseText.substring(0, 200));
      
      let result;
      try {
        const parsed = JSON.parse(responseText);
  if (parsed?.status === "error") {
    return { data: null, error: new Error(parsed.errorMessage || "Server Error") };
  }
  result = parsed.value !== undefined ? parsed.value : parsed;
} catch (e) {
  console.error("[Auth] Failed to parse Convex response:", e);
  return { data: null, error: new Error("Invalid response from server") };
}
      
      console.log("[Auth] Convex signInWithApple result:", {
        success: result?.success,
        hasToken: !!result?.token,
        hasUser: !!result?.user,
        error: result?.error,
      });
      
      if (!result || !result.success || result.error) {
        return { data: null, error: new Error(result?.error || "Apple sign-in failed") };
      }
      
      // Store session
      const session = createSessionFromResponse(result.token, result.user);
      await storeSession(session, result.user);
      
      return { data: { session, user: result.user }, error: null };
    } catch (error: any) {
      console.error("[Auth] Native Apple Sign-In error:", error);
      
      // Handle cancellation
      if (error.code === "ERR_CANCELED") {
        return { data: null, error: new Error("Sign-in cancelled") };
      }
      
      return { data: null, error: error as Error };
    }
  };

  return {
    // Explicit initialization - call from useEffect
    init,

    // Configure Google Sign-In (call early in app lifecycle)
    configureGoogleSignIn,

    // Sign in with email/password - uses Convex action
    signIn: {
      email: async ({
        email,
        password,
      }: {
        email: string;
        password: string;
      }): Promise<AuthResponse<SessionData>> => {
        await ensureInit();
        console.log("[Auth] Signing in with email:", email);

        try {
          // Call Convex action for email sign-in
          const response = await fetch(`${CONVEX_URL}/api/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: "authNative:signInWithEmail",
              args: {
                email,
                password,
                isSignUp: false,
              },
            }),
          });

          const responseText = await response.text();
          console.log("[Auth] Raw Convex response status:", response.status);

          let result;
          try {
            const parsed = JSON.parse(responseText);
            result = parsed.value !== undefined ? parsed.value : parsed;
          } catch (e) {
            console.error("[Auth] Failed to parse Convex response:", e);
            return { data: null, error: new Error("Invalid response from server") };
          }

          if (!result || !result.success || result.error) {
            return { data: null, error: new Error(result?.error || "Sign-in failed") };
          }

          // Store session
          const session = createSessionFromResponse(result.token, result.user);
          await storeSession(session, result.user);

          return { data: { session, user: result.user }, error: null };
        } catch (error: any) {
          console.error("[Auth] Sign-in error:", error);
          return { data: null, error: error as Error };
        }
      },

      // Social sign in - NOW USES NATIVE SDK instead of OAuth redirect
      social: async ({
        provider,
        callbackURL,
      }: {
        provider: string;
        callbackURL?: string;
      }): Promise<AuthResponse<SessionData | { url: string }>> => {
        await ensureInit();
        console.log("[Auth] Starting social sign-in with provider:", provider);

        // Use native sign-in for Google and Apple on mobile
        if (provider === "google" && Platform.OS !== "web") {
          return nativeGoogleSignIn();
        }
        
        if (provider === "apple" && Platform.OS === "ios") {
          return nativeAppleSignIn();
        }

        // Fallback to OAuth redirect for web or unsupported providers
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

      // Native Google Sign-In (direct method)
      google: nativeGoogleSignIn,

      // Native Apple Sign-In (direct method)
      apple: nativeAppleSignIn,

      // Anonymous sign in - uses Convex action instead of HTTP
      anonymous: async (): Promise<AuthResponse<SessionData>> => {
        await ensureInit();
        console.log("[Auth] Starting anonymous sign-in");

        try {
          // Call Convex action to create anonymous user
          const response = await fetch(`${CONVEX_URL}/api/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: "authNative:signInAnonymous",
              args: {},
            }),
          });

          const responseText = await response.text();
          console.log("[Auth] Raw Convex response status:", response.status);
          console.log("[Auth] Raw Convex response:", responseText.substring(0, 200));

          let result;
          try {
            const parsed = JSON.parse(responseText);
            // Convex action responses may be wrapped in a 'value' field
            result = parsed.value !== undefined ? parsed.value : parsed;
          } catch (e) {
            console.error("[Auth] Failed to parse Convex response:", e);
            return { data: null, error: new Error("Invalid response from server") };
          }

          if (!result || !result.success || result.error) {
            return { data: null, error: new Error(result?.error || "Anonymous sign-in failed") };
          }

          // Store session
          const session = createSessionFromResponse(result.token, result.user);
          await storeSession(session, result.user);

          return { data: { session, user: result.user }, error: null };
        } catch (error: any) {
          console.error("[Auth] Anonymous sign-in error:", error);
          return { data: null, error: error as Error };
        }
      },
    },

    // Sign up with email/password - uses Convex action
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
        console.log("[Auth] Signing up with email:", email);

        try {
          // Call Convex action for email sign-up
          const response = await fetch(`${CONVEX_URL}/api/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: "authNative:signInWithEmail",
              args: {
                email,
                password,
                isSignUp: true,
                name,
              },
            }),
          });

          const responseText = await response.text();
          console.log("[Auth] Raw Convex response status:", response.status);

          let result;
          try {
            const parsed = JSON.parse(responseText);
            result = parsed.value !== undefined ? parsed.value : parsed;
          } catch (e) {
            console.error("[Auth] Failed to parse Convex response:", e);
            return { data: null, error: new Error("Invalid response from server") };
          }

          if (!result || !result.success || result.error) {
            return { data: null, error: new Error(result?.error || "Sign-up failed") };
          }

          // Store session
          const session = createSessionFromResponse(result.token, result.user);
          await storeSession(session, result.user);

          return { data: { session, user: result.user, isNewUser: result.isNewUser }, error: null };
        } catch (error: any) {
          console.error("[Auth] Sign-up error:", error);
          return { data: null, error: error as Error };
        }
      },
    },

    // Sign out - clear local session
    signOut: async (): Promise<AuthResponse<null>> => {
      await ensureInit();
      console.log("[Auth] Signing out");
      
      try {
        // Sign out from native providers if signed in
        if (Platform.OS !== "web") {
          try {
            const { GoogleSignin } = await import("@react-native-google-signin/google-signin");
            const currentUser = GoogleSignin.getCurrentUser();
            if (currentUser) {
              await GoogleSignin.signOut();
            }
          } catch (e) {
            // Ignore Google sign-out errors
          }
        }
      } catch (error) {
        console.warn("[Auth] Provider sign out failed:", error);
      }
      await clearSession();
      return { data: null, error: null };
    },

    // Get current session from server
    getSession: async (): Promise<AuthResponse<SessionData>> => {
  await ensureInit();
  console.log("[Auth] Getting session via authNative.validateSession");

  const token = await getStoredToken();
  if (!token) {
    await clearSession();
    return { data: { session: null, user: null }, error: null };
  }

  try {
    const response = await fetch(`${CONVEX_URL}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "authNative:validateSession",
        args: { token },
      }),
    });

    const rawText = await response.text();
    console.log("[Auth] validateSession status:", response.status);
    console.log("[Auth] validateSession body:", rawText.substring(0, 500));

    if (!response.ok) {
      await clearSession();
      return { data: { session: null, user: null }, error: new Error(rawText) };
    }

    const parsed = rawText ? JSON.parse(rawText) : null;

if (parsed?.status === "error") {
  await clearSession();
  return { data: { session: null, user: null }, error: new Error(parsed.errorMessage || "Server Error") };
}

const result = parsed?.value !== undefined ? parsed.value : parsed;


    // Expecting something like: { success: true, user: {...} }
    if (!result?.success || !result?.user) {
      await clearSession();
      return { data: { session: null, user: null }, error: null };
    }

    // Rebuild a local session object (token is your stored session token)
    const session = createSessionFromResponse(token, result.user);
    await storeSession(session, result.user);

    return { data: { session, user: result.user }, error: null };
  } catch (e: any) {
    console.warn("[Auth] validateSession fetch failed:", e);
    await clearSession();
    return { data: { session: null, user: null }, error: e };
  }
},

    // React hook for session (returns current state)
    useSession: () => {
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

    // For Convex integration - returns the stored token
    getToken: getStoredToken,
  };
}

// Export the auth client singleton
// CRITICAL: createNativeAuthClient() no longer calls SecureStore at import time
export const authClient = createNativeAuthClient();
