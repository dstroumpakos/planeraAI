// Platform-specific auth client
//
// CRITICAL: This file must NOT import better-auth directly!
// Metro parses ALL files during bundling, even if they're meant for web only.
// The .native.ts file is preferred by Metro on iOS/Android, but this file
// is still parsed and any imports here will be resolved.
//
// Solution: Re-export everything from the native implementation.
// On web, Metro shims will replace the native-specific imports.

export { authClient } from "./auth-client.native";

// Re-export types for consumers
export type { AuthUser, AuthSession, SessionData, AuthResponse } from "./auth-client.native";
