import { v } from "convex/values";
import { query } from "./_generated/server";
import { authMutation, authQuery } from "./functions";

// Simple token validation query for actions
export const validateToken = query({
    args: {
        token: v.string(),
    },
    handler: async (ctx, args) => {
        // Look up the session in the database
        const sessions = await ctx.db
            .query("sessions")
            .filter((q) => q.eq(q.field("token"), args.token))
            .collect();
        
        if (!sessions || sessions.length === 0) {
            return null;
        }
        
        const session = sessions[0];
        
        // Get the user from userSettings
        const userSettings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", session.userId))
            .unique();
        
        return userSettings;
    },
});

export const getPlan = authQuery({
    args: {
        token: v.string(),
    },
    handler: async (ctx: any) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (!userPlan) {
            return { 
                plan: "free", 
                tripsGenerated: 0,
                tripCredits: 0,
                subscriptionExpiresAt: null,
                isSubscriptionActive: false,
            };
        }

        const isSubscriptionActive = userPlan.plan === "premium" && 
            userPlan.subscriptionExpiresAt && 
            userPlan.subscriptionExpiresAt > Date.now();

        return {
            ...userPlan,
            tripCredits: userPlan.tripCredits ?? 0,
            isSubscriptionActive,
        };
    },
});

export const upgradeToPremium = authMutation({
    args: {
        token: v.string(),
        planType: v.optional(v.union(v.literal("monthly"), v.literal("yearly"))),
    },
    handler: async (ctx: any, args: any) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        // Set subscription duration based on plan type
        const planType = args.planType ?? "monthly";
        const durationDays = planType === "yearly" ? 365 : 30;
        const subscriptionExpiresAt = Date.now() + (durationDays * 24 * 60 * 60 * 1000);

        if (userPlan) {
            await ctx.db.patch(userPlan._id, { 
                plan: "premium",
                subscriptionExpiresAt,
                subscriptionType: planType,
            });
        } else {
            await ctx.db.insert("userPlans", {
                userId: ctx.user._id,
                plan: "premium",
                tripsGenerated: 0,
                tripCredits: 0,
                subscriptionExpiresAt,
                subscriptionType: planType,
            });
        }
    },
});

// Purchase trip packs
export const purchaseTripPack = authMutation({
    args: {
        token: v.string(),
        pack: v.union(v.literal("single"), v.literal("triple"), v.literal("ten")),
    },
    handler: async (ctx: any, args: any) => {
        const creditsToAdd = args.pack === "single" ? 1 : args.pack === "triple" ? 3 : 10;

        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (userPlan) {
            const currentCredits = userPlan.tripCredits ?? 0;
            await ctx.db.patch(userPlan._id, { 
                tripCredits: currentCredits + creditsToAdd,
            });
        } else {
            await ctx.db.insert("userPlans", {
                userId: ctx.user._id,
                plan: "free",
                tripsGenerated: 0,
                tripCredits: creditsToAdd,
            });
        }

        return { creditsAdded: creditsToAdd };
    },
});

// Check if user can generate a trip
export const canGenerateTrip = authQuery({
    args: {
        token: v.string(),
    },
    handler: async (ctx: any) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (!userPlan) {
            // New user gets 1 free trip
            return { canGenerate: true, reason: "free_trial" };
        }

        // Premium subscribers with active subscription
        const isSubscriptionActive = userPlan.plan === "premium" && 
            userPlan.subscriptionExpiresAt && 
            userPlan.subscriptionExpiresAt > Date.now();

        if (isSubscriptionActive) {
            return { canGenerate: true, reason: "premium" };
        }

        // Has trip credits
        const tripCredits = userPlan.tripCredits ?? 0;
        if (tripCredits > 0) {
            return { canGenerate: true, reason: "credits", creditsRemaining: tripCredits };
        }

        // Free users get 1 free trip
        if (userPlan.tripsGenerated < 1) {
            return { canGenerate: true, reason: "free_trial" };
        }

        return { canGenerate: false, reason: "no_credits" };
    },
});

// Use a trip credit (called when generating a trip)
export const useTripCredit = authMutation({
    args: {
        token: v.string(),
    },
    handler: async (ctx: any) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (!userPlan) {
            // Create new user plan with 1 trip used
            await ctx.db.insert("userPlans", {
                userId: ctx.user._id,
                plan: "free",
                tripsGenerated: 1,
                tripCredits: 0,
            });
            return;
        }

        // Premium subscribers don't use credits
        const isSubscriptionActive = userPlan.plan === "premium" && 
            userPlan.subscriptionExpiresAt && 
            userPlan.subscriptionExpiresAt > Date.now();

        if (isSubscriptionActive) {
            // Just increment trips generated for stats
            await ctx.db.patch(userPlan._id, { 
                tripsGenerated: userPlan.tripsGenerated + 1,
            });
            return;
        }

        // Use trip credit if available
        const tripCredits = userPlan.tripCredits ?? 0;
        if (tripCredits > 0) {
            await ctx.db.patch(userPlan._id, { 
                tripCredits: tripCredits - 1,
                tripsGenerated: userPlan.tripsGenerated + 1,
            });
            return;
        }

        // Free trial
        if (userPlan.tripsGenerated < 1) {
            await ctx.db.patch(userPlan._id, { 
                tripsGenerated: 1,
            });
            return;
        }

        throw new Error("No trip credits available");
    },
});

export const getSettings = authQuery({
    args: {
        token: v.string(),
    },
    returns: v.object({
      homeAirport: v.optional(v.string()),
      defaultBudget: v.optional(v.number()),
      defaultTravelers: v.optional(v.number()),
      interests: v.optional(v.array(v.string())),
      flightTimePreference: v.optional(v.string()),
      skipFlights: v.optional(v.boolean()),
      skipHotels: v.optional(v.boolean()),
      pushNotifications: v.optional(v.boolean()),
      emailNotifications: v.optional(v.boolean()),
      currency: v.optional(v.string()),
      language: v.optional(v.string()),
      theme: v.optional(v.string()),
      onboardingCompleted: v.optional(v.boolean()),
      // Additional fields used by other parts of the app
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      dateOfBirth: v.optional(v.string()),
      profilePicture: v.optional(v.id("_storage")),
      profilePictureUrl: v.optional(v.union(v.string(), v.null())),
      darkMode: v.optional(v.boolean()),
      dealAlerts: v.optional(v.boolean()),
      tripReminders: v.optional(v.boolean()),
    }),
    handler: async (ctx: any) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (!settings) {
            // Return defaults if no settings exist yet
            return {
                homeAirport: undefined,
                defaultBudget: undefined,
                defaultTravelers: undefined,
                interests: undefined,
                flightTimePreference: undefined,
                skipFlights: undefined,
                skipHotels: undefined,
                pushNotifications: undefined,
                emailNotifications: undefined,
                currency: undefined,
                language: undefined,
                theme: undefined,
                onboardingCompleted: false,
                name: undefined,
                email: undefined,
                phone: undefined,
                dateOfBirth: undefined,
                profilePicture: undefined,
                profilePictureUrl: undefined,
                darkMode: undefined,
                dealAlerts: undefined,
                tripReminders: undefined,
            };
        }

        // Get profile picture URL if exists
        let profilePictureUrl: string | null | undefined = undefined;
        if (settings.profilePicture) {
            profilePictureUrl = await ctx.storage.getUrl(settings.profilePicture);
        }

        return {
            homeAirport: settings.homeAirport,
            defaultBudget: undefined, // Not stored in userSettings
            defaultTravelers: settings.defaultTravelers,
            interests: settings.defaultInterests,
            flightTimePreference: settings.defaultPreferredFlightTime,
            skipFlights: settings.defaultSkipFlights,
            skipHotels: settings.defaultSkipHotel,
            pushNotifications: settings.pushNotifications,
            emailNotifications: settings.emailNotifications,
            currency: settings.currency,
            language: settings.language,
            theme: undefined,
            onboardingCompleted: settings.onboardingCompleted,
            name: settings.name,
            email: settings.email,
            phone: settings.phone,
            dateOfBirth: settings.dateOfBirth,
            profilePicture: settings.profilePicture,
            profilePictureUrl,
            darkMode: settings.darkMode,
            dealAlerts: settings.dealAlerts,
            tripReminders: settings.tripReminders,
        };
    },
});

export const completeOnboarding = authMutation({
  args: {
    token: v.string(),
  },
  returns: v.null(),
  handler: async (ctx: any) => {
    const settings = await ctx.db
        .query("userSettings")
        .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
        .unique();

    if (settings) {
      await ctx.db.patch(settings._id, {
        onboardingCompleted: true,
      });
    } else {
      await ctx.db.insert("userSettings", {
        userId: ctx.user._id,
        onboardingCompleted: true,
      });
    }
    return null;
  },
});

// Save travel preferences directly to userSettings table
export const saveTravelPreferences = authMutation({
  args: {
    token: v.string(),
    homeAirport: v.optional(v.string()),
    defaultBudget: v.optional(v.number()),
    defaultTravelers: v.optional(v.number()),
    interests: v.optional(v.array(v.string())),
    flightTimePreference: v.optional(v.string()),
    skipFlights: v.optional(v.boolean()),
    skipHotels: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx: any, args: any) => {
    const settings = await ctx.db
        .query("userSettings")
        .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
        .unique();

    const updateData = {
      homeAirport: args.homeAirport,
      defaultTravelers: args.defaultTravelers,
      defaultInterests: args.interests,
      defaultPreferredFlightTime: args.flightTimePreference,
      defaultSkipFlights: args.skipFlights,
      defaultSkipHotel: args.skipHotels,
    };

    if (settings) {
      await ctx.db.patch(settings._id, updateData);
    } else {
      await ctx.db.insert("userSettings", {
        userId: ctx.user._id,
        ...updateData,
      });
    }
    return null;
  },
});

export const updatePersonalInfo = authMutation({
    args: {
        token: v.string(),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        dateOfBirth: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (settings) {
            await ctx.db.patch(settings._id, args);
        } else {
            await ctx.db.insert("userSettings", {
                userId: ctx.user._id,
                ...args,
            });
        }

        return null;
    },
});

export const updateTravelPreferences = authMutation({
    args: {
        token: v.string(),
        // Travel preference fields only (no budget)
        homeAirport: v.optional(v.string()),
        defaultInterests: v.optional(v.array(v.string())),
        defaultSkipFlights: v.optional(v.boolean()),
        defaultSkipHotel: v.optional(v.boolean()),
        defaultPreferredFlightTime: v.optional(v.string()),

        // Legacy fields
        preferredAirlines: v.optional(v.array(v.string())),
        seatPreference: v.optional(v.string()),
        mealPreference: v.optional(v.string()),
        hotelStarRating: v.optional(v.float64()),
        budgetRange: v.optional(v.string()),
        travelStyle: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const { token, ...updates } = args;
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (settings) {
            await ctx.db.patch(settings._id, updates);
        } else {
            await ctx.db.insert("userSettings", {
                userId: ctx.user._id,
                ...updates,
            });
        }

        return null;
    },
});

export const updateAppSettings = authMutation({
    args: {
        token: v.string(),
        language: v.optional(v.string()),
        currency: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const { token, ...updates } = args;
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (settings) {
            await ctx.db.patch(settings._id, updates);
        } else {
            await ctx.db.insert("userSettings", {
                userId: ctx.user._id,
                ...updates,
            });
        }

        return null;
    },
});

export const updateNotifications = authMutation({
    args: {
        token: v.string(),
        pushNotifications: v.optional(v.boolean()),
        emailNotifications: v.optional(v.boolean()),
        dealAlerts: v.optional(v.boolean()),
        tripReminders: v.optional(v.boolean()),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const { token, ...updates } = args;
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (settings) {
            await ctx.db.patch(settings._id, updates);
        } else {
            await ctx.db.insert("userSettings", {
                userId: ctx.user._id,
                ...updates,
            });
        }

        return null;
    },
});

export const updateDarkMode = authMutation({
    args: {
        token: v.string(),
        darkMode: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (settings) {
            await ctx.db.patch(settings._id, { darkMode: args.darkMode });
        } else {
            await ctx.db.insert("userSettings", {
                userId: ctx.user._id,
                darkMode: args.darkMode,
            });
        }

        return null;
    },
});

export const generateUploadUrl = authMutation({
    args: {
        token: v.string(),
    },
    returns: v.string(),
    handler: async (ctx: any) => {
        return await ctx.storage.generateUploadUrl();
    },
});

export const saveProfilePicture = authMutation({
    args: {
        token: v.string(),
        storageId: v.id("_storage"),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        // Delete old profile picture if exists
        if (settings?.profilePicture) {
            await ctx.storage.delete(settings.profilePicture);
        }

        if (settings) {
            await ctx.db.patch(settings._id, { profilePicture: args.storageId });
        } else {
            await ctx.db.insert("userSettings", {
                userId: ctx.user._id,
                profilePicture: args.storageId,
            });
        }

        return null;
    },
});

export const cancelSubscription = authMutation({
    args: {
        token: v.string(),
    },
    returns: v.object({ success: v.boolean() }),
    handler: async (ctx: any) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (!userPlan) {
            throw new Error("No subscription found");
        }

        if (userPlan.plan !== "premium") {
            throw new Error("No active subscription to cancel");
        }

        await ctx.db.patch(userPlan._id, {
            plan: "free",
            subscriptionExpiresAt: undefined,
            subscriptionType: undefined,
        });

        return { success: true };
    },
});

export const getProfileImageUrl = authQuery({
    args: {
        token: v.string(),
        storageId: v.id("_storage"),
    },
    returns: v.union(v.string(), v.null()),
    handler: async (ctx: any, args: any) => {
        return await ctx.storage.getUrl(args.storageId);
    },
});

export const updateUserName = authMutation({
    args: {
        token: v.string(),
        name: v.string(),
    },
    handler: async (ctx: any, args: any) => {
        // Update the user's name in userSettings
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (settings) {
            await ctx.db.patch(settings._id, { 
                name: args.name,
            });
        } else {
            await ctx.db.insert("userSettings", {
                userId: ctx.user._id,
                name: args.name,
            });
        }

        return { success: true };
    },
});

// ============================================
// APPLE IN-APP PURCHASE HANDLERS
// ============================================

// Product IDs (must match App Store Connect)
const PRODUCT_IDS = {
    YEARLY: "com.planeraaitravelplanner.pro.yearly",
    MONTHLY: "com.planeraaitravelplanner.pro.monthly",
    SINGLE_TRIP: "com.planeraaitravelplanner.trip.single",
};

// Process Apple IAP purchase (called after successful StoreKit purchase)
export const processApplePurchase = authMutation({
    args: {
        token: v.string(),
        productId: v.string(),
        transactionId: v.string(),
        receipt: v.optional(v.string()),
    },
    handler: async (ctx: any, args: any) => {
        const { productId, transactionId, receipt } = args;
        
        console.log(`[IAP] Processing purchase: ${productId}, txn: ${transactionId}`);

        // Check if this transaction was already processed (idempotency)
        const existingTx = await ctx.db
            .query("iapTransactions")
            .filter((q: any) => q.eq(q.field("transactionId"), transactionId))
            .first();
        
        if (existingTx) {
            console.log(`[IAP] Transaction ${transactionId} already processed`);
            return { success: true, alreadyProcessed: true };
        }

        // Record the transaction
        await ctx.db.insert("iapTransactions", {
            userId: ctx.user._id,
            productId,
            transactionId,
            receipt: receipt || "",
            processedAt: Date.now(),
            status: "completed",
        });

        // Get or create user plan
        let userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (!userPlan) {
            // Create new user plan
            const planId = await ctx.db.insert("userPlans", {
                userId: ctx.user._id,
                plan: "free",
                tripsGenerated: 0,
                tripCredits: 0,
            });
            userPlan = await ctx.db.get(planId);
        }

        // Process based on product type
        if (productId === PRODUCT_IDS.YEARLY) {
            // Yearly subscription - 365 days
            const subscriptionExpiresAt = Date.now() + (365 * 24 * 60 * 60 * 1000);
            await ctx.db.patch(userPlan._id, {
                plan: "premium",
                subscriptionExpiresAt,
                subscriptionType: "yearly",
                lastTransactionId: transactionId,
            });
            console.log(`[IAP] Yearly subscription activated until ${new Date(subscriptionExpiresAt).toISOString()}`);
            return { success: true, type: "subscription", expiresAt: subscriptionExpiresAt };
        }
        
        if (productId === PRODUCT_IDS.MONTHLY) {
            // Monthly subscription - 30 days
            const subscriptionExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
            await ctx.db.patch(userPlan._id, {
                plan: "premium",
                subscriptionExpiresAt,
                subscriptionType: "monthly",
                lastTransactionId: transactionId,
            });
            console.log(`[IAP] Monthly subscription activated until ${new Date(subscriptionExpiresAt).toISOString()}`);
            return { success: true, type: "subscription", expiresAt: subscriptionExpiresAt };
        }
        
        if (productId === PRODUCT_IDS.SINGLE_TRIP) {
            // Consumable - add 1 trip credit
            const currentCredits = userPlan.tripCredits ?? 0;
            await ctx.db.patch(userPlan._id, {
                tripCredits: currentCredits + 1,
            });
            console.log(`[IAP] Single trip credit added. New total: ${currentCredits + 1}`);
            return { success: true, type: "credit", creditsAdded: 1, totalCredits: currentCredits + 1 };
        }

        throw new Error(`Unknown product ID: ${productId}`);
    },
});

// Restore purchases (called when user taps Restore Purchases)
export const restoreApplePurchases = authMutation({
    args: {
        token: v.string(),
        purchases: v.array(v.object({
            productId: v.string(),
            transactionId: v.string(),
            receipt: v.optional(v.string()),
        })),
    },
    handler: async (ctx: any, args: any) => {
        const { purchases } = args;
        console.log(`[IAP] Restoring ${purchases.length} purchases`);

        let restoredSubscription = false;
        let restoredCredits = 0;

        for (const purchase of purchases) {
            // Check if transaction already processed
            const existingTx = await ctx.db
                .query("iapTransactions")
                .filter((q: any) => q.eq(q.field("transactionId"), purchase.transactionId))
                .first();

            if (existingTx) {
                console.log(`[IAP] Transaction ${purchase.transactionId} already processed, skipping`);
                continue;
            }

            // Record the restored transaction
            await ctx.db.insert("iapTransactions", {
                userId: ctx.user._id,
                productId: purchase.productId,
                transactionId: purchase.transactionId,
                receipt: purchase.receipt || "",
                processedAt: Date.now(),
                status: "restored",
            });

            // Only restore subscriptions (not consumables that were already used)
            if (purchase.productId === PRODUCT_IDS.YEARLY || purchase.productId === PRODUCT_IDS.MONTHLY) {
                restoredSubscription = true;
            }
        }

        if (restoredSubscription) {
            // Get or create user plan
            let userPlan = await ctx.db
                .query("userPlans")
                .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
                .unique();

            if (!userPlan) {
                const planId = await ctx.db.insert("userPlans", {
                    userId: ctx.user._id,
                    plan: "free",
                    tripsGenerated: 0,
                    tripCredits: 0,
                });
                userPlan = await ctx.db.get(planId);
            }

            // Find the latest subscription purchase
            const subscriptionPurchase = purchases.find(
                (p: { productId: string; transactionId: string; receipt?: string }) => 
                    p.productId === PRODUCT_IDS.YEARLY || p.productId === PRODUCT_IDS.MONTHLY
            );

            if (subscriptionPurchase) {
                const isYearly = subscriptionPurchase.productId === PRODUCT_IDS.YEARLY;
                const durationDays = isYearly ? 365 : 30;
                const subscriptionExpiresAt = Date.now() + (durationDays * 24 * 60 * 60 * 1000);

                await ctx.db.patch(userPlan._id, {
                    plan: "premium",
                    subscriptionExpiresAt,
                    subscriptionType: isYearly ? "yearly" : "monthly",
                    lastTransactionId: subscriptionPurchase.transactionId,
                });
                console.log(`[IAP] Subscription restored until ${new Date(subscriptionExpiresAt).toISOString()}`);
            }
        }

        return {
            success: true,
            restoredSubscription,
            restoredCredits,
            message: restoredSubscription 
                ? "Your subscription has been restored!" 
                : "No active subscriptions found to restore.",
        };
    },
});

// Check entitlements (can user generate a trip?)
export const checkEntitlements = authQuery({
    args: {
        token: v.string(),
    },
    handler: async (ctx: any) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
            .unique();

        if (!userPlan) {
            // New user - gets 1 free trip
            return {
                canGenerate: true,
                reason: "free_trial",
                isSubscriber: false,
                tripCredits: 0,
                tripsGenerated: 0,
                freeTrialRemaining: 1,
            };
        }

        // Check subscription status
        const isSubscriptionActive = userPlan.plan === "premium" && 
            userPlan.subscriptionExpiresAt && 
            userPlan.subscriptionExpiresAt > Date.now();

        if (isSubscriptionActive) {
            return {
                canGenerate: true,
                reason: "subscription",
                isSubscriber: true,
                subscriptionType: userPlan.subscriptionType,
                expiresAt: userPlan.subscriptionExpiresAt,
                tripCredits: userPlan.tripCredits ?? 0,
                tripsGenerated: userPlan.tripsGenerated ?? 0,
            };
        }

        // Check trip credits
        const tripCredits = userPlan.tripCredits ?? 0;
        if (tripCredits > 0) {
            return {
                canGenerate: true,
                reason: "credits",
                isSubscriber: false,
                tripCredits,
                tripsGenerated: userPlan.tripsGenerated ?? 0,
            };
        }

        // Check free trial
        const tripsGenerated = userPlan.tripsGenerated ?? 0;
        if (tripsGenerated < 1) {
            return {
                canGenerate: true,
                reason: "free_trial",
                isSubscriber: false,
                tripCredits: 0,
                tripsGenerated,
                freeTrialRemaining: 1,
            };
        }

        // No entitlements - show paywall
        return {
            canGenerate: false,
            reason: "no_entitlements",
            isSubscriber: false,
            tripCredits: 0,
            tripsGenerated,
        };
    },
});
