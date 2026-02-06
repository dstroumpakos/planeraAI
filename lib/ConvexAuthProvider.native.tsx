import React, { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { authClient } from "./auth-client.native";

type UseAuthReturn = {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: () => Promise<string | null>;
};

// Create a context for auth state that components can subscribe to
type NativeAuthContextType = {
  isLoading: boolean;
  isAuthenticated: boolean;
};

const NativeAuthContext = createContext<NativeAuthContextType>({
  isLoading: true,
  isAuthenticated: false,
});

// Custom hook that components should use instead of Convex's useConvexAuth
export function useNativeConvexAuth() {
  const context = useContext(NativeAuthContext);
  if (!context) {
    throw new Error("useNativeConvexAuth must be used within ConvexNativeAuthProvider");
  }
  return context;
}

export const Authenticated = ({ children }: any) => <>{children}</>;
export const Unauthenticated = ({ children }: any) => <>{children}</>;
export const AuthLoading = ({ children }: any) => <>{children}</>;


export function ConvexNativeAuthProvider({
  client,
  children,
}: {
  client: ConvexReactClient;
  children: ReactNode;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        await authClient.init();
        const res = await authClient.getSession();
        if (!mounted) return;
        console.log("[ConvexAuth] Initial session check:", !!res?.data?.session);
        setHasSession(!!res?.data?.session);
      } catch {
        if (!mounted) return;
        setHasSession(false);
      } finally {
        if (!mounted) return;
        setIsLoading(false);
      }
    })();

    const unsubscribe = authClient.$store.listen((state: any) => {
      if (!mounted) return;
      const newHasSession = !!state?.session;
      console.log("[ConvexAuth] Auth state changed via listener:", newHasSession);
      setHasSession(newHasSession);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const fetchAccessToken = useCallback(async () => {
    try {
      const token = await authClient.getToken(); // SecureStore token
      console.log("[ConvexAuth] fetchAccessToken:", token ? "FOUND" : "MISSING");
      return token ?? null;
    } catch (e) {
      console.log("[ConvexAuth] fetchAccessToken error:", String(e));
      return null;
    }
  }, []);

  const useAuth = useMemo(() => {
    return function useAuthHook(): UseAuthReturn {
      return {
        isLoading,
        isAuthenticated: hasSession, // Convex will still use fetchAccessToken for actual auth
        fetchAccessToken,
      };
    };
  }, [isLoading, hasSession, fetchAccessToken]);

  // Memoize context value to avoid unnecessary re-renders
  const authContextValue = useMemo(() => ({
    isLoading,
    isAuthenticated: hasSession,
  }), [isLoading, hasSession]);

  return (
    <NativeAuthContext.Provider value={authContextValue}>
      <ConvexProviderWithAuth client={client} useAuth={useAuth}>
        {children}
      </ConvexProviderWithAuth>
    </NativeAuthContext.Provider>
  );
}
