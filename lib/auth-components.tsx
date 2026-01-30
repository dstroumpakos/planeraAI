// Platform-specific auth components
//
// Re-export from native implementation which works on all platforms
// This avoids importing convex/react auth components which may pull
// in better-auth dependencies

export {
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useConvexAuth,
} from "./ConvexAuthProvider.native";
