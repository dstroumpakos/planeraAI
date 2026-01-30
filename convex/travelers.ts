import { v } from "convex/values";
import { authMutation, authQuery } from "./functions";

// List all travelers for the current user
export const list = authQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("travelers"),
      _creationTime: v.number(),
      userId: v.string(),
      firstName: v.string(),
      lastName: v.string(),
      dateOfBirth: v.string(),
      gender: v.union(v.literal("male"), v.literal("female")),
      passportNumber: v.string(),
      passportIssuingCountry: v.string(),
      passportExpiryDate: v.string(),
      email: v.optional(v.string()),
      phoneCountryCode: v.optional(v.string()),
      phoneNumber: v.optional(v.string()),
      isDefault: v.optional(v.boolean()),
      createdAt: v.float64(),
      updatedAt: v.optional(v.float64()),
    })
  ),
  handler: async (ctx) => {
    const travelers = await ctx.db
      .query("travelers")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .collect();
    return travelers;
  },
});

// Get a single traveler by ID
export const get = authQuery({
  args: { id: v.id("travelers") },
  returns: v.union(
    v.object({
      _id: v.id("travelers"),
      _creationTime: v.number(),
      userId: v.string(),
      firstName: v.string(),
      lastName: v.string(),
      dateOfBirth: v.string(),
      gender: v.union(v.literal("male"), v.literal("female")),
      passportNumber: v.string(),
      passportIssuingCountry: v.string(),
      passportExpiryDate: v.string(),
      email: v.optional(v.string()),
      phoneCountryCode: v.optional(v.string()),
      phoneNumber: v.optional(v.string()),
      isDefault: v.optional(v.boolean()),
      createdAt: v.float64(),
      updatedAt: v.optional(v.float64()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const traveler = await ctx.db.get(args.id);
    if (!traveler || traveler.userId !== ctx.user._id) {
      return null;
    }
    return traveler;
  },
});

// Create a new traveler profile
export const create = authMutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    dateOfBirth: v.string(),
    gender: v.union(v.literal("male"), v.literal("female")),
    passportNumber: v.string(),
    passportIssuingCountry: v.string(),
    passportExpiryDate: v.string(),
    email: v.optional(v.string()),
    phoneCountryCode: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.id("travelers"),
  handler: async (ctx, args) => {
    // If this is marked as default, unmark any existing defaults
    if (args.isDefault) {
      const existingTravelers = await ctx.db
        .query("travelers")
        .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
        .collect();
      
      for (const traveler of existingTravelers) {
        if (traveler.isDefault) {
          await ctx.db.patch(traveler._id, { isDefault: false });
        }
      }
    }

    // Check if this is the first traveler - make it default
    const existingCount = await ctx.db
      .query("travelers")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .collect();
    
    const isFirstTraveler = existingCount.length === 0;

    const id = await ctx.db.insert("travelers", {
      userId: ctx.user._id,
      firstName: args.firstName,
      lastName: args.lastName,
      dateOfBirth: args.dateOfBirth,
      gender: args.gender,
      passportNumber: args.passportNumber,
      passportIssuingCountry: args.passportIssuingCountry,
      passportExpiryDate: args.passportExpiryDate,
      email: args.email,
      phoneCountryCode: args.phoneCountryCode,
      phoneNumber: args.phoneNumber,
      isDefault: args.isDefault || isFirstTraveler,
      createdAt: Date.now(),
    });

    return id;
  },
});

// Update an existing traveler profile
export const update = authMutation({
  args: {
    id: v.id("travelers"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
    passportNumber: v.optional(v.string()),
    passportIssuingCountry: v.optional(v.string()),
    passportExpiryDate: v.optional(v.string()),
    email: v.optional(v.string()),
    phoneCountryCode: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const traveler = await ctx.db.get(args.id);
    if (!traveler || traveler.userId !== ctx.user._id) {
      throw new Error("Traveler not found");
    }

    // If marking as default, unmark others
    if (args.isDefault) {
      const existingTravelers = await ctx.db
        .query("travelers")
        .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
        .collect();
      
      for (const t of existingTravelers) {
        if (t._id !== args.id && t.isDefault) {
          await ctx.db.patch(t._id, { isDefault: false });
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _unusedId, ...updateData } = args;
    await ctx.db.patch(args.id, {
      ...updateData,
      updatedAt: Date.now(),
    });

    return null;
  },
});

// Delete a traveler profile
export const remove = authMutation({
  args: { id: v.id("travelers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const traveler = await ctx.db.get(args.id);
    if (!traveler || traveler.userId !== ctx.user._id) {
      throw new Error("Traveler not found");
    }

    await ctx.db.delete(args.id);
    return null;
  },
});

// Helper: Check if a traveler profile is complete (booking-ready)
export const isBookingReady = authQuery({
  args: { id: v.id("travelers") },
  returns: v.object({
    ready: v.boolean(),
    missingFields: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const traveler = await ctx.db.get(args.id);
    if (!traveler || traveler.userId !== ctx.user._id) {
      return { ready: false, missingFields: ["Traveler not found"] };
    }

    const missingFields: string[] = [];
    
    if (!traveler.firstName) missingFields.push("First Name");
    if (!traveler.lastName) missingFields.push("Last Name");
    if (!traveler.dateOfBirth) missingFields.push("Date of Birth");
    if (!traveler.gender) missingFields.push("Gender");
    if (!traveler.passportNumber) missingFields.push("Passport Number");
    if (!traveler.passportIssuingCountry) missingFields.push("Passport Country");
    if (!traveler.passportExpiryDate) missingFields.push("Passport Expiry");

    // Check passport hasn't expired
    if (traveler.passportExpiryDate) {
      const expiryDate = new Date(traveler.passportExpiryDate);
      const today = new Date();
      if (expiryDate < today) {
        missingFields.push("Passport has expired");
      }
    }

    return {
      ready: missingFields.length === 0,
      missingFields,
    };
  },
});

// Get travelers with computed ages for a specific departure date
export const getWithAges = authQuery({
  args: { 
    travelerIds: v.array(v.id("travelers")),
    departureDate: v.string(), // YYYY-MM-DD
  },
  returns: v.array(
    v.object({
      _id: v.id("travelers"),
      firstName: v.string(),
      lastName: v.string(),
      dateOfBirth: v.string(),
      gender: v.union(v.literal("male"), v.literal("female")),
      passportNumber: v.string(),
      passportIssuingCountry: v.string(),
      passportExpiryDate: v.string(),
      email: v.optional(v.string()),
      phoneCountryCode: v.optional(v.string()),
      phoneNumber: v.optional(v.string()),
      // Computed fields
      age: v.number(),
      passengerType: v.union(v.literal("adult"), v.literal("child"), v.literal("infant")),
    })
  ),
  handler: async (ctx, args) => {
    const travelers = [];
    const departureDate = new Date(args.departureDate);

    for (const id of args.travelerIds) {
      const traveler = await ctx.db.get(id);
      if (!traveler || traveler.userId !== ctx.user._id) continue;

      // Calculate age at departure date
      const birthDate = new Date(traveler.dateOfBirth);
      let age = departureDate.getFullYear() - birthDate.getFullYear();
      const monthDiff = departureDate.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && departureDate.getDate() < birthDate.getDate())) {
        age--;
      }

      // Determine passenger type
      let passengerType: "adult" | "child" | "infant";
      if (age < 2) {
        passengerType = "infant";
      } else if (age < 12) {
        passengerType = "child";
      } else {
        passengerType = "adult";
      }

      travelers.push({
        _id: traveler._id,
        firstName: traveler.firstName,
        lastName: traveler.lastName,
        dateOfBirth: traveler.dateOfBirth,
        gender: traveler.gender,
        passportNumber: traveler.passportNumber,
        passportIssuingCountry: traveler.passportIssuingCountry,
        passportExpiryDate: traveler.passportExpiryDate,
        email: traveler.email,
        phoneCountryCode: traveler.phoneCountryCode,
        phoneNumber: traveler.phoneNumber,
        age,
        passengerType,
      });
    }

    return travelers;
  },
});
