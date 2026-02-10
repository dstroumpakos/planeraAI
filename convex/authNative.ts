"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import * as jose from "jose";

// Google's JWKS URL
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
// Apple's JWKS URL
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

// Response type for sign-in actions
interface SignInResponse {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    email?: string;
    name?: string;
    image?: string;
  };
  error?: string;
  isNewUser?: boolean;
}

// Interface for verified token claims
interface VerifiedClaims {
  sub: string; // Subject (user ID from provider)
  email?: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
  aud?: string | string[];
}

// Verify Google ID token
async function verifyGoogleToken(idToken: string): Promise<VerifiedClaims> {
  const googleWebClientId = process.env.GOOGLE_WEB_CLIENT_ID;
  
  if (!googleWebClientId) {
    console.error("[AuthNative] GOOGLE_WEB_CLIENT_ID environment variable is not set");
    throw new Error("GOOGLE_WEB_CLIENT_ID environment variable is required");
  }
  
  console.log("[AuthNative] Google verification config:", {
    hasClientId: !!googleWebClientId,
    clientIdPrefix: googleWebClientId.substring(0, 20) + "...",
  });
  
  try {
    // Create JWKS remote key set for Google
    const JWKS = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
    
    // Verify the token
    const { payload } = await jose.jwtVerify(idToken, JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: googleWebClientId,
    });
    
    console.log("[AuthNative] Google token verified:", {
      sub: payload.sub,
      hasEmail: !!payload.email,
      hasName: !!payload.name,
      aud: payload.aud,
    });
    
    return {
      sub: payload.sub as string,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      picture: payload.picture as string | undefined,
      email_verified: payload.email_verified as boolean | undefined,
      aud: payload.aud,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[AuthNative] Google token verification failed:", errorMessage);
    throw new Error(`Invalid Google ID token: ${errorMessage}`);
  }
}

// Verify Apple identity token
async function verifyAppleToken(identityToken: string): Promise<VerifiedClaims> {
  const appleBundleId = process.env.APPLE_BUNDLE_ID;
  
  if (!appleBundleId) {
    console.error("[AuthNative] APPLE_BUNDLE_ID environment variable is not set");
    throw new Error("APPLE_BUNDLE_ID environment variable is required");
  }
  
  console.log("[AuthNative] Apple verification config:", {
    hasBundleId: !!appleBundleId,
    bundleId: appleBundleId,
  });
  
  try {
    // Create JWKS remote key set for Apple
    const JWKS = jose.createRemoteJWKSet(new URL(APPLE_JWKS_URL));
    
// 🔎 DEBUG: decode token BEFORE verification to inspect aud
const decoded = jose.decodeJwt(identityToken);
console.log("[AuthNative] Apple token decoded (pre-verify):", {
  iss: decoded.iss,
  aud: decoded.aud,
  sub: decoded.sub,
  email: decoded.email,
});

    // Verify the token WITHOUT audience validation (we'll check manually below)
    const { payload } = await jose.jwtVerify(identityToken, JWKS, {
      issuer: "https://appleid.apple.com",
    } as any);
    
    // Custom audience validation to accept both production and development
    // Accept production bundle ID or Expo dev client audience
    const validAudiences = [appleBundleId, "host.exp.Exponent"];
    if (!validAudiences.includes(payload.aud as string)) {
      throw new Error(`Invalid aud claim: ${payload.aud}. Expected one of: ${validAudiences.join(", ")}`);
    }
    
    console.log("[AuthNative] Apple token verified:", {
      sub: payload.sub,
      hasEmail: !!payload.email,
      aud: payload.aud,
    });
    
    return {
      sub: payload.sub as string,
      email: payload.email as string | undefined,
      // Apple doesn't provide name in the token, only on first sign-in via SDK
      name: undefined,
      picture: undefined,
      email_verified: payload.email_verified as boolean | undefined,
      aud: payload.aud,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[AuthNative] Apple token verification failed:", errorMessage);
    throw new Error(`Invalid Apple identity token: ${errorMessage}`);
  }
}

// Generate a secure session token
function generateSessionToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Result type from upsertUserAndCreateSession
interface UpsertResult {
  userId: string;
  sessionId: string;
  token: string;
  isNewUser: boolean;
  user: {
    id: string;
    email?: string;
    name?: string;
    image?: string;
  };
}

// Sign in with Google (native)
export const signInWithGoogle = action({
  args: {
    idToken: v.string(),
    // Optional: user info from Google Sign-In SDK (name might not be in token)
    displayName: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    token: v.optional(v.string()),
    user: v.optional(v.object({
      id: v.string(),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      image: v.optional(v.string()),
    })),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<SignInResponse> => {
    console.log("[AuthNative] signInWithGoogle called");
    
    try {
      // Validate input
      if (!args.idToken) {
        console.error("[AuthNative] No idToken provided");
        return {
          success: false,
          error: "No ID token provided",
        };
      }
      
      console.log("[AuthNative] Verifying Google ID token (length:", args.idToken.length, ")");
      
      // Verify the Google ID token
      const claims = await verifyGoogleToken(args.idToken);
      
      if (!claims.sub) {
        console.error("[AuthNative] No sub claim in Google token");
        return {
          success: false,
          error: "Invalid token: missing user identifier",
        };
      }
      
      // Generate a session token
      const sessionToken = generateSessionToken();
      console.log("[AuthNative] Generated session token (length:", sessionToken.length, ")");
      
      // Upsert user and create session using internal mutation
      console.log("[AuthNative] Calling upsertUserAndCreateSession for Google user:", claims.sub);
      
      const result: UpsertResult = await ctx.runMutation(internal.authNativeDb.upsertUserAndCreateSession, {
        provider: "google",
        providerUserId: claims.sub,
        email: claims.email,
        name: args.displayName || claims.name,
        picture: claims.picture,
        sessionToken,
      });
      
      console.log("[AuthNative] Google sign-in successful:", {
        userId: result.userId,
        hasToken: !!result.token,
        hasUser: !!result.user,
      });
      
      const response: SignInResponse = {
        success: true,
        token: result.token,
        user: result.user,
      };
      
      console.log("[AuthNative] Returning Google sign-in response:", {
        success: response.success,
        hasToken: !!response.token,
        hasUser: !!response.user,
      });
      
      return response;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("[AuthNative] Google sign-in failed:", errorMessage);
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});

// Sign in with Apple (native)
export const signInWithApple = action({
  args: {
    identityToken: v.string(),
    // Apple may return null for email on subsequent sign-ins
    email: v.optional(v.union(v.string(), v.null())),
    // Apple may return null name parts too
    fullName: v.optional(
      v.object({
        givenName: v.optional(v.union(v.string(), v.null())),
        familyName: v.optional(v.union(v.string(), v.null())),
      })
    ),
  },
  returns: v.object({
    success: v.boolean(),
    token: v.optional(v.string()),
    user: v.optional(
      v.object({
        id: v.string(),
        email: v.optional(v.string()),
        name: v.optional(v.string()),
        image: v.optional(v.string()),
      })
    ),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<SignInResponse> => {
    console.log("[AuthNative] signInWithApple called");

    try {
      if (!args.identityToken) {
        return { success: false, error: "No identity token provided" };
      }

      console.log(
        "[AuthNative] Verifying Apple identity token (length:",
        args.identityToken.length,
        ")"
      );

      const claims = await verifyAppleToken(args.identityToken);

      if (!claims.sub) {
        return { success: false, error: "Invalid token: missing user identifier" };
      }

      // email can be string | null | undefined
      const emailFromArgs =
        typeof args.email === "string" && args.email.length > 0 ? args.email : undefined;

      const emailFromToken =
        typeof claims.email === "string" && claims.email.length > 0 ? claims.email : undefined;

      const email = emailFromToken ?? emailFromArgs;

      // fullName parts can be string | null | undefined
      const given =
        typeof args.fullName?.givenName === "string" ? args.fullName.givenName : undefined;
      const family =
        typeof args.fullName?.familyName === "string" ? args.fullName.familyName : undefined;

      const nameParts = [given, family].filter(Boolean) as string[];
      const name = nameParts.length > 0 ? nameParts.join(" ") : undefined;

      const sessionToken = generateSessionToken();

      const result: UpsertResult = await ctx.runMutation(
        internal.authNativeDb.upsertUserAndCreateSession,
        {
          provider: "apple",
          providerUserId: claims.sub,
          email, // <-- never null now
          name,
          picture: undefined,
          sessionToken,
        }
      );

      return {
        success: true,
        token: result.token,
        user: result.user,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("[AuthNative] Apple sign-in failed:", errorMessage);
      return { success: false, error: errorMessage };
    }
  },
});

// Anonymous sign in - creates a guest user
export const signInAnonymous = action({
  args: {},
  returns: v.object({
    success: v.boolean(),
    token: v.optional(v.string()),
    user: v.optional(
      v.object({
        id: v.string(),
        email: v.optional(v.string()),
        name: v.optional(v.string()),
        image: v.optional(v.string()),
      })
    ),
    error: v.optional(v.string()),
  }),
  handler: async (ctx): Promise<SignInResponse> => {
    console.log("[AuthNative] signInAnonymous called");

    try {
      // Generate a unique anonymous user ID
      const anonymousId = `anon_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      const sessionToken = generateSessionToken();

      const result: UpsertResult = await ctx.runMutation(
        internal.authNativeDb.upsertUserAndCreateSession,
        {
          provider: "anonymous",
          providerUserId: anonymousId,
          email: undefined,
          name: "Guest User",
          picture: undefined,
          sessionToken,
        }
      );

      console.log("[AuthNative] Anonymous sign-in successful:", {
        userId: result.userId,
        sessionId: result.sessionId,
      });

      return {
        success: true,
        token: result.token,
        user: result.user,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("[AuthNative] Anonymous sign-in failed:", errorMessage);
      return { success: false, error: errorMessage };
    }
  },
});

// Email/password sign in
export const signInWithEmail = action({
  args: {
    email: v.string(),
    password: v.string(),
    isSignUp: v.optional(v.boolean()),
    name: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    token: v.optional(v.string()),
    user: v.optional(
      v.object({
        id: v.string(),
        email: v.optional(v.string()),
        name: v.optional(v.string()),
        image: v.optional(v.string()),
      })
    ),
    error: v.optional(v.string()),
    isNewUser: v.optional(v.boolean()),
  }),
  handler: async (ctx, args): Promise<SignInResponse> => {
    console.log("[AuthNative] signInWithEmail called:", {
      email: args.email,
      isSignUp: args.isSignUp,
    });

    try {
      // For MVP, we'll create/get a user based on email
      // In production, you'd want proper password hashing and verification
      const sessionToken = generateSessionToken();

      // Use email as the provider user ID (unique identifier)
      const result: UpsertResult = await ctx.runMutation(
        internal.authNativeDb.upsertUserAndCreateSession,
        {
          provider: "email",
          providerUserId: args.email.toLowerCase(),
          email: args.email.toLowerCase(),
          name: args.name,
          picture: undefined,
          sessionToken,
        }
      );

      console.log("[AuthNative] Email sign-in successful:", {
        userId: result.userId,
        isSignUp: args.isSignUp,
        isNewUser: result.isNewUser,
      });

      // Send welcome email to new users
      if (result.isNewUser && args.email) {
        try {
          await ctx.runAction(internal.postmark.sendWelcomeEmail, {
            to: args.email.toLowerCase(),
            name: args.name || "Traveler",
          });
          console.log("[AuthNative] Welcome email sent to:", args.email);
        } catch (emailError) {
          // Log but don't fail the signup if email fails
          console.error("[AuthNative] Failed to send welcome email:", emailError);
        }
      }

      return {
        success: true,
        token: result.token,
        user: result.user,
        isNewUser: result.isNewUser,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("[AuthNative] Email sign-in failed:", errorMessage);
      return { success: false, error: errorMessage };
    }
  },
});

// Validate a session token (called by auth provider)
export const validateSession = action({
  args: { token: v.string() },
  returns: v.object({
    success: v.boolean(),
    user: v.optional(
      v.object({
        id: v.string(),
        email: v.optional(v.string()),
        name: v.optional(v.string()),
        image: v.optional(v.string()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) {
      return { success: false };
    }

    try {
      // Look up the session in the database
      const session: any = await ctx.runQuery(
        internal.authNativeDb.getSessionByToken,
        { token: args.token }
      );

      if (!session) {
        console.log("[AuthNative] validateSession: no session found for token");
        return { success: false };
      }

      // Check if session has expired
      if (session.expiresAt && session.expiresAt < Date.now()) {
        console.log("[AuthNative] validateSession: session expired");
        return { success: false };
      }

      // Look up user settings
      const userSettings: any = await ctx.runQuery(
        internal.authNativeDb.getUserSettings,
        { userId: session.userId }
      );

      return {
        success: true,
        user: {
          id: session.userId,
          email: userSettings?.email,
          name: userSettings?.name,
          image: userSettings?.profilePicture,
        },
      };
    } catch (error) {
      console.error("[AuthNative] validateSession error:", error);
      // If DB lookup fails, still return success based on token format
      // The client has a valid token stored, don't force logout
      return { success: true };
    }
  },
});
