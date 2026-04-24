/**
 * WorldPrint — Convex backend.
 *
 * - getMyWorldPrint: returns profile + visits + quest progress
 * - ensureProfile: creates profile + auto-imports visits from completed trips
 * - addVisit / removeVisit: manual user-controlled city management
 * - claimQuestReward: award Pro days on quest completion
 * - setSignatureColor: user customization
 * - getPublicWorldPrint: share-link endpoint (no auth)
 */

import { v, ConvexError } from "convex/values";
import { authQuery, authMutation } from "./functions";
import { query, mutation } from "./_generated/server";
import {
  matchCityFromDestination,
  getCityById,
  WORLD_CITIES,
} from "../lib/worldCities";
import {
  WORLDPRINT_QUESTS,
  computeQuestProgress,
  deterministicSignatureColor,
  SIGNATURE_COLORS,
  getQuestById,
} from "../lib/worldPrintQuests";

// ---- Helpers ----

function genPublicCode(): string {
  // 6-char base32-ish code, URL-safe
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

async function getOrCreateProfileDoc(ctx: any, userId: string) {
  let profile = await ctx.db
    .query("worldPrintProfile")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();

  if (!profile) {
    // Ensure unique public code
    let code = genPublicCode();
    let exists = await ctx.db
      .query("worldPrintProfile")
      .withIndex("by_public_code", (q: any) => q.eq("publicCode", code))
      .unique();
    while (exists) {
      code = genPublicCode();
      exists = await ctx.db
        .query("worldPrintProfile")
        .withIndex("by_public_code", (q: any) => q.eq("publicCode", code))
        .unique();
    }

    const id = await ctx.db.insert("worldPrintProfile", {
      userId,
      signatureColor: deterministicSignatureColor(userId),
      claimedQuestIds: [],
      lifetimeQuestsCompleted: 0,
      lastActivityAt: Date.now(),
      publicCode: code,
      createdAt: Date.now(),
    });
    profile = await ctx.db.get(id);
  }

  return profile;
}

function extractCityIdsFromTrip(trip: any): string[] {
  const ids: string[] = [];

  // Multi-city trips have a `destinations` array
  if (trip.isMultiCity && Array.isArray(trip.destinations)) {
    for (const d of trip.destinations) {
      const label = [d.city, d.country].filter(Boolean).join(", ");
      const match = matchCityFromDestination(label);
      if (match) ids.push(match.id);
    }
  }

  // Primary destination
  if (typeof trip.destination === "string") {
    const match = matchCityFromDestination(trip.destination);
    if (match) ids.push(match.id);
  }

  // Dedupe
  return Array.from(new Set(ids));
}

// ---- Profile + visits bootstrap ----

/**
 * Called once on WorldPrint screen mount.
 *
 * - Creates profile if missing.
 * - Scans user's completed trips and auto-adds verified visits for any matched
 *   cities not already tracked.
 * - Updates lastActivityAt.
 */
export const ensureProfile = authMutation({
  args: {},
  handler: async (ctx: any, _args: any) => {
    const userId: string = ctx.user.userId;
    const profile = await getOrCreateProfileDoc(ctx, userId);

    // Auto-import visits from completed trips
    const existingVisits = await ctx.db
      .query("worldPrintVisits")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    const existingByCity = new Map<string, any>();
    for (const v of existingVisits) existingByCity.set(v.cityId, v);

    const trips = await ctx.db
      .query("trips")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();

    let addedCount = 0;
    for (const trip of trips) {
      if (trip.status !== "completed") continue;
      const cityIds = extractCityIdsFromTrip(trip);
      const now = Date.now();
      const isPast = typeof trip.endDate === "number" && trip.endDate < now;

      for (const cityId of cityIds) {
        const city = getCityById(cityId);
        if (!city) continue;
        const existing = existingByCity.get(cityId);
        const desiredStatus: "planned" | "verified" = isPast
          ? "verified"
          : "planned";

        if (!existing) {
          await ctx.db.insert("worldPrintVisits", {
            userId,
            cityId,
            countryCode: city.countryCode,
            status: desiredStatus,
            tripId: trip._id,
            verifiedAt: now,
          });
          addedCount++;
        } else if (
          existing.status === "planned" &&
          desiredStatus === "verified"
        ) {
          // Upgrade planned → verified if the trip has now ended
          await ctx.db.patch(existing._id, {
            status: "verified",
            verifiedAt: now,
          });
        }
      }
    }

    await ctx.db.patch(profile._id, { lastActivityAt: Date.now() });

    return { profileId: profile._id, addedCount, publicCode: profile.publicCode };
  },
});

// ---- Main query: returns everything the globe screen needs ----

export const getMyWorldPrint = authQuery({
  args: {},
  handler: async (ctx: any, _args: any) => {
    const userId: string = ctx.user.userId;

    const profile = await ctx.db
      .query("worldPrintProfile")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .unique();

    const visits = await ctx.db
      .query("worldPrintVisits")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();

    // Attach city metadata
    const visitsWithCity = visits
      .map((v: any) => {
        const city = getCityById(v.cityId);
        if (!city) return null;
        return {
          _id: v._id,
          cityId: v.cityId,
          city: {
            id: city.id,
            name: city.name,
            country: city.country,
            countryCode: city.countryCode,
            lat: city.lat,
            lng: city.lng,
          },
          status: v.status,
          tripId: v.tripId ?? null,
          verifiedAt: v.verifiedAt,
        };
      })
      .filter(Boolean);

    // Country-level aggregation
    const countryCounts: Record<string, number> = {};
    for (const v of visitsWithCity as any[]) {
      countryCounts[v.city.countryCode] =
        (countryCounts[v.city.countryCode] ?? 0) + 1;
    }
    const verifiedCityIds = new Set<string>(
      (visitsWithCity as any[])
        .filter((v) => v.status === "verified" || v.status === "holographic")
        .map((v) => v.cityId as string)
    );

    // Compute quest progress for every quest
    const quests = WORLDPRINT_QUESTS.map((q) => {
      const progress = computeQuestProgress(q, verifiedCityIds);
      const isClaimed = profile?.claimedQuestIds?.includes(q.id) ?? false;
      return {
        id: q.id,
        name: q.name,
        descriptionKey: q.descriptionKey,
        emoji: q.emoji,
        tier: q.tier,
        color: q.color,
        cityIds: q.cityIds,
        reward: q.reward,
        ...progress,
        isClaimed,
        isClaimable: progress.isComplete && !isClaimed,
      };
    });

    // Dimming state (days since last activity)
    const lastActivity = profile?.lastActivityAt ?? Date.now();
    const daysSinceActivity = Math.floor(
      (Date.now() - lastActivity) / (24 * 60 * 60 * 1000)
    );
    const dimLevel =
      daysSinceActivity < 7 ? 0 : daysSinceActivity < 14 ? 0.3 : daysSinceActivity < 30 ? 0.55 : 0.75;

    return {
      profile: profile
        ? {
            signatureColor: profile.signatureColor,
            publicCode: profile.publicCode,
            lifetimeQuestsCompleted: profile.lifetimeQuestsCompleted,
            claimedQuestIds: profile.claimedQuestIds,
            createdAt: profile.createdAt,
          }
        : null,
      visits: visitsWithCity,
      stats: {
        totalCities: verifiedCityIds.size,
        totalCountries: Object.keys(countryCounts).filter((code) =>
          (visitsWithCity as any[]).some(
            (v) =>
              v.city.countryCode === code &&
              (v.status === "verified" || v.status === "holographic")
          )
        ).length,
        totalPlanned: (visitsWithCity as any[]).filter(
          (v) => v.status === "planned"
        ).length,
      },
      quests,
      dimLevel,
      daysSinceActivity,
    };
  },
});

// ---- Manual visit management ----

export const addVisit = authMutation({
  args: {
    cityId: v.string(),
    status: v.union(
      v.literal("claimed"),
      v.literal("planned"),
      v.literal("verified")
    ),
  },
  handler: async (ctx: any, args: any) => {
    const userId: string = ctx.user.userId;
    const city = getCityById(args.cityId);
    if (!city) throw new ConvexError("Unknown city");

    // Ensure profile exists
    await getOrCreateProfileDoc(ctx, userId);

    const existing = await ctx.db
      .query("worldPrintVisits")
      .withIndex("by_user_and_city", (q: any) =>
        q.eq("userId", userId).eq("cityId", args.cityId)
      )
      .unique();

    if (existing) {
      // Only allow upgrading the status (claimed → planned → verified)
      const rank: Record<string, number> = {
        claimed: 0,
        planned: 1,
        verified: 2,
        holographic: 3,
      };
      if (rank[args.status] > rank[existing.status]) {
        await ctx.db.patch(existing._id, {
          status: args.status,
          verifiedAt: Date.now(),
        });
      }
      return { visitId: existing._id, wasNew: false };
    }

    const id = await ctx.db.insert("worldPrintVisits", {
      userId,
      cityId: args.cityId,
      countryCode: city.countryCode,
      status: args.status,
      verifiedAt: Date.now(),
    });

    // Touch lastActivityAt
    const profile = await ctx.db
      .query("worldPrintProfile")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .unique();
    if (profile) {
      await ctx.db.patch(profile._id, { lastActivityAt: Date.now() });
    }

    return { visitId: id, wasNew: true };
  },
});

export const removeVisit = authMutation({
  args: { visitId: v.id("worldPrintVisits") },
  handler: async (ctx: any, args: any) => {
    const userId: string = ctx.user.userId;
    const visit = await ctx.db.get(args.visitId);
    if (!visit) throw new ConvexError("Visit not found");
    if (visit.userId !== userId) throw new ConvexError("Not authorized");
    // Only allow removal of claimed (self-added, unverified) visits — verified
    // ones are anchored to real trips and should not be silently removed.
    if (visit.status !== "claimed") {
      throw new ConvexError("Only self-claimed cities can be removed");
    }
    await ctx.db.delete(args.visitId);
    return { success: true };
  },
});

// ---- Quest reward claiming ----
// IMPORTANT: Rewards are cosmetic / status only (badges, titles, globe skins,
// exclusive itinerary templates). We do NOT award Pro subscription value here,
// to comply with Apple App Store Review Guideline 3.1.1 (IAP bypass rules).

export const claimQuestReward = authMutation({
  args: { questId: v.string() },
  handler: async (ctx: any, args: any) => {
    const userId: string = ctx.user.userId;
    const quest = getQuestById(args.questId);
    if (!quest) throw new ConvexError("Unknown quest");

    const profile = await getOrCreateProfileDoc(ctx, userId);
    if (profile.claimedQuestIds.includes(args.questId)) {
      throw new ConvexError("Already claimed");
    }

    // Verify completion server-side
    const visits = await ctx.db
      .query("worldPrintVisits")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    const verifiedCityIds = new Set<string>(
      visits
        .filter(
          (v: any) => v.status === "verified" || v.status === "holographic"
        )
        .map((v: any) => v.cityId as string)
    );
    const progress = computeQuestProgress(quest, verifiedCityIds);
    if (!progress.isComplete) {
      throw new ConvexError("Quest not yet complete");
    }

    const now = Date.now();
    await ctx.db.patch(profile._id, {
      claimedQuestIds: [...profile.claimedQuestIds, args.questId],
      lifetimeQuestsCompleted: (profile.lifetimeQuestsCompleted ?? 0) + 1,
      lastActivityAt: now,
    });

    return {
      success: true,
      badge: quest.reward.badge,
      title: quest.reward.title ?? null,
      globeSkin: quest.reward.globeSkin ?? null,
      expeditionId: quest.reward.expeditionId ?? null,
    };
  },
});

// ---- Signature color customization ----

export const setSignatureColor = authMutation({
  args: { colorHex: v.string() },
  handler: async (ctx: any, args: any) => {
    const userId: string = ctx.user.userId;
    // Validate against palette
    const valid = SIGNATURE_COLORS.some((c) => c.hex === args.colorHex);
    if (!valid) throw new ConvexError("Invalid signature color");

    const profile = await getOrCreateProfileDoc(ctx, userId);
    await ctx.db.patch(profile._id, {
      signatureColor: args.colorHex,
      lastActivityAt: Date.now(),
    });
    return { success: true };
  },
});

// ---- Public share endpoint (unauthenticated) ----

export const getPublicWorldPrint = query({
  args: { publicCode: v.string() },
  handler: async (ctx: any, args: any) => {
    const profile = await ctx.db
      .query("worldPrintProfile")
      .withIndex("by_public_code", (q: any) => q.eq("publicCode", args.publicCode))
      .unique();
    if (!profile) return null;

    const visits = await ctx.db
      .query("worldPrintVisits")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.userId))
      .collect();

    const verifiedVisits = visits.filter(
      (v: any) => v.status === "verified" || v.status === "holographic"
    );
    const verifiedCityIds = new Set<string>(verifiedVisits.map((v: any) => v.cityId as string));

    // Get display name (best-effort, no sensitive info)
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.userId))
      .unique();

    const cities = verifiedVisits
      .map((v: any) => {
        const city = getCityById(v.cityId);
        if (!city) return null;
        return {
          id: city.id,
          name: city.name,
          country: city.country,
          countryCode: city.countryCode,
          lat: city.lat,
          lng: city.lng,
        };
      })
      .filter(Boolean);

    const completedQuests = WORLDPRINT_QUESTS.filter((q) => {
      const progress = computeQuestProgress(q, verifiedCityIds);
      return progress.isComplete;
    }).map((q) => ({
      id: q.id,
      name: q.name,
      emoji: q.emoji,
      tier: q.tier,
    }));

    return {
      publicCode: profile.publicCode,
      signatureColor: profile.signatureColor,
      displayName: settings?.name ?? "Traveler",
      createdAt: profile.createdAt,
      stats: {
        totalCities: verifiedCityIds.size,
        totalCountries: new Set(verifiedVisits.map((v: any) => v.countryCode))
          .size,
        completedQuests: completedQuests.length,
      },
      cities,
      completedQuests,
    };
  },
});

// ---- City catalog query (for autocomplete search in UI) ----
// Not auth-gated — just returns static data we already ship client-side.
// Kept for consistency and for the public web app.

export const getCityCatalog = query({
  args: {},
  handler: async () => {
    return WORLD_CITIES.map((c) => ({
      id: c.id,
      name: c.name,
      country: c.country,
      countryCode: c.countryCode,
      lat: c.lat,
      lng: c.lng,
      region: c.region,
    }));
  },
});
