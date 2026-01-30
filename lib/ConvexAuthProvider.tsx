// Platform-specific Convex Auth Provider
//
// CRITICAL: This file must NOT import @convex-dev/better-auth directly!
// Metro parses ALL files during bundling, and better-auth contains
// webpack-style dynamic imports that crash Hermes.
//
// Solution: Re-export everything from the native implementation.
// The native implementation works on all platforms.

export {
  ConvexNativeAuthProvider,
  Authenticated,
  Unauthenticated,
  AuthLoading,
  useConvexAuth,
} from "./ConvexAuthProvider.native";
