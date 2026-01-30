import { v } from "convex/values";
import { authMutation, authQuery } from "./functions";

export const getPlan = authQuery({
    args: {},
    handler: async (ctx) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
        planType: v.optional(v.union(v.literal("monthly"), v.literal("yearly"))),
    },
    handler: async (ctx, args) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
        pack: v.union(v.literal("single"), v.literal("triple"), v.literal("ten")),
    },
    handler: async (ctx, args) => {
        const creditsToAdd = args.pack === "single" ? 1 : args.pack === "triple" ? 3 : 10;

        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
    args: {},
    handler: async (ctx) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
    args: {},
    handler: async (ctx) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
    args: {},
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
    handler: async (ctx) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
                onboardingCompleted: undefined,
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
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const settings = await ctx.db
        .query("userSettings")
        .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
    homeAirport: v.optional(v.string()),
    defaultBudget: v.optional(v.number()),
    defaultTravelers: v.optional(v.number()),
    interests: v.optional(v.array(v.string())),
    flightTimePreference: v.optional(v.string()),
    skipFlights: v.optional(v.boolean()),
    skipHotels: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const settings = await ctx.db
        .query("userSettings")
        .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        dateOfBirth: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
    handler: async (ctx, args) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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

export const updateAppSettings = authMutation({
    args: {
        language: v.optional(v.string()),
        currency: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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

export const updateNotifications = authMutation({
    args: {
        pushNotifications: v.optional(v.boolean()),
        emailNotifications: v.optional(v.boolean()),
        dealAlerts: v.optional(v.boolean()),
        tripReminders: v.optional(v.boolean()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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

export const updateDarkMode = authMutation({
    args: {
        darkMode: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
    args: {},
    returns: v.string(),
    handler: async (ctx) => {
        return await ctx.storage.generateUploadUrl();
    },
});

export const saveProfilePicture = authMutation({
    args: {
        storageId: v.id("_storage"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
    args: {},
    returns: v.object({ success: v.boolean() }),
    handler: async (ctx) => {
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
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
        storageId: v.id("_storage"),
    },
    returns: v.union(v.string(), v.null()),
    handler: async (ctx, args) => {
        return await ctx.storage.getUrl(args.storageId);
    },
});
