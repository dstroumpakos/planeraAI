/**
 * Password Reset Database Operations
 * 
 * Internal mutations for password reset flow.
 * Separated from actions because mutations cannot be in Node.js files.
 */

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Internal mutation to store a password reset code
 */
export const storeResetCode = internalMutation({
    args: {
        email: v.string(),
        codeHash: v.string(),
        expiresAt: v.float64(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await ctx.db.insert("passwordResetCodes", {
            email: args.email.toLowerCase(),
            codeHash: args.codeHash,
            expiresAt: args.expiresAt,
            attempts: 0,
            used: false,
            verified: false,
            createdAt: Date.now(),
        });
        return null;
    },
});

/**
 * Internal mutation to increment attempts on a reset code
 */
export const incrementAttempts = internalMutation({
    args: {
        codeId: v.id("passwordResetCodes"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const code = await ctx.db.get(args.codeId);
        if (code) {
            await ctx.db.patch(args.codeId, {
                attempts: code.attempts + 1,
            });
        }
        return null;
    },
});

/**
 * Internal mutation to mark code as used/invalidated
 */
export const markCodeUsed = internalMutation({
    args: {
        codeId: v.id("passwordResetCodes"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await ctx.db.patch(args.codeId, {
            used: true,
        });
        return null;
    },
});

/**
 * Internal mutation to mark code as verified
 */
export const markCodeVerified = internalMutation({
    args: {
        codeId: v.id("passwordResetCodes"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await ctx.db.patch(args.codeId, {
            verified: true,
        });
        return null;
    },
});

/**
 * Internal mutation to update user password
 */
export const updateUserPassword = internalMutation({
    args: {
        email: v.string(),
        passwordHash: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase();
        const userId = `email:${email}`;
        
        const userSettings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .unique();
        
        if (!userSettings) {
            return false;
        }
        
        await ctx.db.patch(userSettings._id, {
            passwordHash: args.passwordHash,
        });
        
        return true;
    },
});

/**
 * Get user settings by email
 */
export const getUserByEmail = internalMutation({
    args: {
        email: v.string(),
    },
    returns: v.union(
        v.object({
            _id: v.id("userSettings"),
            userId: v.string(),
            email: v.optional(v.string()),
            authProvider: v.optional(v.string()),
            passwordHash: v.optional(v.string()),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase();
        const userId = `email:${email}`;
        
        const userSettings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .unique();
        
        if (!userSettings) {
            return null;
        }
        
        return {
            _id: userSettings._id,
            userId: userSettings.userId,
            email: userSettings.email,
            authProvider: userSettings.authProvider,
            passwordHash: userSettings.passwordHash,
        };
    },
});

/**
 * Get recent reset codes for rate limiting
 */
export const getRecentResetCodes = internalMutation({
    args: {
        email: v.string(),
        sinceTimestamp: v.float64(),
    },
    returns: v.array(v.object({
        _id: v.id("passwordResetCodes"),
        createdAt: v.float64(),
    })),
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase();
        
        const codes = await ctx.db
            .query("passwordResetCodes")
            .withIndex("by_email", (q) => q.eq("email", email))
            .filter((q) => q.gte(q.field("createdAt"), args.sinceTimestamp))
            .order("desc")
            .collect();
        
        return codes.map(code => ({
            _id: code._id,
            createdAt: code.createdAt,
        }));
    },
});

/**
 * Get the latest unused reset code for an email
 */
export const getLatestResetCode = internalMutation({
    args: {
        email: v.string(),
    },
    returns: v.union(
        v.object({
            _id: v.id("passwordResetCodes"),
            codeHash: v.string(),
            expiresAt: v.float64(),
            attempts: v.float64(),
            used: v.boolean(),
            verified: v.boolean(),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase();
        
        const codes = await ctx.db
            .query("passwordResetCodes")
            .withIndex("by_email", (q) => q.eq("email", email))
            .order("desc")
            .take(1);
        
        if (codes.length === 0) {
            return null;
        }
        
        const code = codes[0];
        return {
            _id: code._id,
            codeHash: code.codeHash,
            expiresAt: code.expiresAt,
            attempts: code.attempts,
            used: code.used,
            verified: code.verified,
        };
    },
});
