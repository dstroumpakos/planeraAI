"use node";

/**
 * Password Reset Actions (Node.js)
 * 
 * Enables users to reset their password entirely in-app using a 6-digit code.
 * Uses crypto module for secure code generation and hashing.
 * 
 * Database operations are in passwordResetDb.ts (mutations can't be in Node files).
 */

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import * as crypto from "crypto";

// Constants
const CODE_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 3;
const MIN_SECONDS_BETWEEN_REQUESTS = 60;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Hash a string using SHA-256
 */
function hashString(str: string): string {
    return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * Generate a cryptographically secure 6-digit code
 */
function generateSecureCode(): string {
    const bytes = crypto.randomBytes(4);
    const num = bytes.readUInt32BE(0);
    const code = 100000 + (num % 900000);
    return code.toString();
}

/**
 * Hash a password for storage
 */
function hashPassword(password: string): string {
    const salt = crypto.createHash("sha256").update(password.slice(0, 4)).digest("hex").slice(0, 16);
    return crypto.createHash("sha256").update(salt + password).digest("hex");
}

/**
 * Request a password reset code
 * Always returns success to prevent account enumeration
 */
export const requestPasswordResetCode = action({
    args: {
        email: v.string(),
    },
    returns: v.object({
        ok: v.boolean(),
        message: v.optional(v.string()),
    }),
    handler: async (ctx, args): Promise<{ ok: boolean; message?: string }> => {
        const email = args.email.toLowerCase().trim();
        console.log("[PasswordReset] requestPasswordResetCode called for:", email);
        
        const neutralResponse = { ok: true };
        
        try {
            // Check if user exists with email/password auth
            const userSettings = await ctx.runMutation(internal.passwordResetDb.getUserByEmail, { email });
            
            if (!userSettings) {
                console.log("[PasswordReset] No email/password user found for:", email);
                return neutralResponse;
            }
            
            // Check if user is an OAuth-only user (Apple/Google)
            if (userSettings.authProvider && userSettings.authProvider !== "email") {
                console.log("[PasswordReset] User is OAuth-only, cannot reset password:", userSettings.authProvider);
                return neutralResponse;
            }
            
            // Check rate limiting
            const recentCodes = await ctx.runMutation(internal.passwordResetDb.getRecentResetCodes, { 
                email,
                sinceTimestamp: Date.now() - (60 * 60 * 1000),
            });
            
            if (recentCodes.length >= MAX_REQUESTS_PER_HOUR) {
                console.log("[PasswordReset] Rate limit exceeded for:", email);
                return { ok: false, message: "Too many reset requests. Please try again later." };
            }
            
            // Check cooldown (60 seconds since last request)
            if (recentCodes.length > 0) {
                const lastRequest = recentCodes[0];
                const timeSinceLastRequest = (Date.now() - lastRequest.createdAt) / 1000;
                if (timeSinceLastRequest < MIN_SECONDS_BETWEEN_REQUESTS) {
                    const waitTime = Math.ceil(MIN_SECONDS_BETWEEN_REQUESTS - timeSinceLastRequest);
                    console.log("[PasswordReset] Cooldown active, wait:", waitTime, "seconds");
                    return { ok: false, message: `Please wait ${waitTime} seconds before requesting another code.` };
                }
            }
            
            // Generate secure 6-digit code
            const code = generateSecureCode();
            const codeHash = hashString(code);
            const expiresAt = Date.now() + (CODE_EXPIRY_MINUTES * 60 * 1000);
            
            console.log("[PasswordReset] Generated code for:", email, "expires in:", CODE_EXPIRY_MINUTES, "minutes");
            
            // Store hashed code
            await ctx.runMutation(internal.passwordResetDb.storeResetCode, {
                email,
                codeHash,
                expiresAt,
            });
            
            // Send email via Postmark
            const emailResult = await ctx.runAction(internal.postmark.sendTemplateEmail, {
                to: email,
                templateAlias: "password_reset_code",
                templateModel: {
                    product_name: "Planera",
                    code: code,
                    expiry_minutes: CODE_EXPIRY_MINUTES.toString(),
                    support_email: "support@planeraai.app",
                },
            });
            
            if (!emailResult.success) {
                console.error("[PasswordReset] Failed to send email:", emailResult.error);
            } else {
                console.log("[PasswordReset] Reset code email sent successfully");
            }
            
            return neutralResponse;
            
        } catch (error) {
            console.error("[PasswordReset] Error in requestPasswordResetCode:", error);
            return neutralResponse;
        }
    },
});

/**
 * Verify a password reset code
 */
export const verifyPasswordResetCode = action({
    args: {
        email: v.string(),
        code: v.string(),
    },
    returns: v.object({
        success: v.boolean(),
        error: v.optional(v.string()),
    }),
    handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
        const email = args.email.toLowerCase().trim();
        const code = args.code.trim();
        
        console.log("[PasswordReset] verifyPasswordResetCode called for:", email);
        
        try {
            const resetCode = await ctx.runMutation(internal.passwordResetDb.getLatestResetCode, { email });
            
            if (!resetCode) {
                console.log("[PasswordReset] No reset code found for:", email);
                return { success: false, error: "Invalid or expired code. Please request a new one." };
            }
            
            if (Date.now() > resetCode.expiresAt) {
                console.log("[PasswordReset] Code expired for:", email);
                await ctx.runMutation(internal.passwordResetDb.markCodeUsed, { codeId: resetCode._id });
                return { success: false, error: "Code has expired. Please request a new one." };
            }
            
            if (resetCode.used) {
                console.log("[PasswordReset] Code already used for:", email);
                return { success: false, error: "Code has already been used. Please request a new one." };
            }
            
            if (resetCode.attempts >= MAX_ATTEMPTS) {
                console.log("[PasswordReset] Too many attempts for:", email);
                await ctx.runMutation(internal.passwordResetDb.markCodeUsed, { codeId: resetCode._id });
                return { success: false, error: "Too many attempts. Please request a new code." };
            }
            
            const inputCodeHash = hashString(code);
            if (inputCodeHash !== resetCode.codeHash) {
                console.log("[PasswordReset] Invalid code for:", email);
                await ctx.runMutation(internal.passwordResetDb.incrementAttempts, { codeId: resetCode._id });
                const remainingAttempts = MAX_ATTEMPTS - resetCode.attempts - 1;
                return { 
                    success: false, 
                    error: `Invalid code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.` 
                };
            }
            
            console.log("[PasswordReset] Code verified successfully for:", email);
            await ctx.runMutation(internal.passwordResetDb.markCodeVerified, { codeId: resetCode._id });
            
            return { success: true };
            
        } catch (error) {
            console.error("[PasswordReset] Error in verifyPasswordResetCode:", error);
            return { success: false, error: "An error occurred. Please try again." };
        }
    },
});

/**
 * Confirm password reset (set new password)
 */
export const confirmPasswordReset = action({
    args: {
        email: v.string(),
        code: v.string(),
        newPassword: v.string(),
    },
    returns: v.object({
        success: v.boolean(),
        error: v.optional(v.string()),
    }),
    handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
        const email = args.email.toLowerCase().trim();
        const code = args.code.trim();
        const newPassword = args.newPassword;
        
        console.log("[PasswordReset] confirmPasswordReset called for:", email);
        
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            return { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
        }
        
        try {
            const resetCode = await ctx.runMutation(internal.passwordResetDb.getLatestResetCode, { email });
            
            if (!resetCode) {
                console.log("[PasswordReset] No reset code found for:", email);
                return { success: false, error: "Invalid reset session. Please start over." };
            }
            
            if (resetCode.used) {
                console.log("[PasswordReset] Code already used for:", email);
                return { success: false, error: "Reset session has expired. Please start over." };
            }
            
            if (!resetCode.verified) {
                const inputCodeHash = hashString(code);
                if (inputCodeHash !== resetCode.codeHash) {
                    console.log("[PasswordReset] Code verification failed for:", email);
                    return { success: false, error: "Invalid code. Please verify your code first." };
                }
            }
            
            if (Date.now() > resetCode.expiresAt) {
                console.log("[PasswordReset] Code expired for:", email);
                await ctx.runMutation(internal.passwordResetDb.markCodeUsed, { codeId: resetCode._id });
                return { success: false, error: "Reset session has expired. Please start over." };
            }
            
            const passwordHash = hashPassword(newPassword);
            
            const updated = await ctx.runMutation(internal.passwordResetDb.updateUserPassword, {
                email,
                passwordHash,
            });
            
            if (!updated) {
                console.log("[PasswordReset] Failed to update password for:", email);
                return { success: false, error: "Failed to update password. Please try again." };
            }
            
            await ctx.runMutation(internal.passwordResetDb.markCodeUsed, { codeId: resetCode._id });
            
            console.log("[PasswordReset] Password reset successful for:", email);
            return { success: true };
            
        } catch (error) {
            console.error("[PasswordReset] Error in confirmPasswordReset:", error);
            return { success: false, error: "An error occurred. Please try again." };
        }
    },
});
