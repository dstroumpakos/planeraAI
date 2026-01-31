import React, { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { authClient } from "./auth-client.native";

type UseAuthReturn = {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: () => Promise<string | null>;
};

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
      setHasSession(!!state?.session);
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

  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
