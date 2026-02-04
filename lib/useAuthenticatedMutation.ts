import { useMutation, useQuery, useAction, FunctionReference } from "convex/react";
import { authClient } from "./auth-client.native";
import { useCallback, useEffect, useState } from "react";

/**
 * Hook that returns the current auth token
 */
export function useToken() {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let attempt = 0;

    (async () => {
      try {
        // Try to get token with retries
        while (attempt < 5) {
          const currentToken = await authClient.getToken();
          console.log("[useToken] Attempt", attempt, "- token:", currentToken ? "FOUND" : "MISSING");
          
          if (currentToken) {
            if (mounted) {
              setToken(currentToken);
              setIsLoading(false);
            }
            return;
          }
          
          attempt++;
          if (attempt < 5) {
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        
        // After retries, set as not loading even if no token
        if (mounted) {
          console.log("[useToken] No token found after retries");
          setToken(null);
          setIsLoading(false);
        }
      } catch (error) {
        console.error("[useToken] Error fetching token:", error);
        if (mounted) {
          setToken(null);
          setIsLoading(false);
        }
      }
    })();

    // Listen for auth changes
    const unsubscribe = authClient.$store.listen((state: any) => {
      if (!mounted) return;
      console.log("[useToken] Store changed, checking token...");
      // Token might have changed
      authClient.getToken().then((newToken) => {
        if (mounted) {
          console.log("[useToken] Token after store change:", newToken ? "FOUND" : "MISSING");
          setToken(newToken);
          setIsLoading(false);
        }
      });
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  return { token, isLoading };
}

/**
 * Hook for authenticated mutations
 * Automatically injects the token from authClient
 */
export function useAuthenticatedMutation<Args extends Record<string, any>>(
  mutation: FunctionReference<"mutation", "public", Args & { token: string }, any>
) {
  const { token } = useToken();
  const mutationFn = useMutation(mutation);

  return useCallback(
    async (args: Omit<Args, 'token'>) => {
      if (!token) {
        throw new Error("Authentication required - no token available");
      }
      try {
        return await mutationFn({ token, ...args } as any);
      } catch (error) {
        console.error("[useAuthenticatedMutation] Error:", error);
        throw error;
      }
    },
    [mutationFn, token]
  );
}

/**
 * Hook for authenticated actions
 * Automatically injects the token from authClient
 */
export function useAuthenticatedAction<Args extends Record<string, any>, Result>(
  actionRef: FunctionReference<"action", "public", Args & { token: string }, Result>,
  externalToken?: string | null
) {
  const { token: internalToken } = useToken();
  const token = externalToken !== undefined ? externalToken : internalToken;
  const actionFn = useAction(actionRef);

  return useCallback(
    async (args: Omit<Args, 'token'>): Promise<Result> => {
      if (!token) {
        throw new Error("Authentication required - no token available");
      }
      try {
        return await actionFn({ token, ...args } as any);
      } catch (error) {
        console.error("[useAuthenticatedAction] Error:", error);
        throw error;
      }
    },
    [actionFn, token]
  );
}

