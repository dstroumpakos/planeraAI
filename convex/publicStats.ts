import { query } from "./_generated/server";

/** Public (no auth) stats for the landing page */
export const getLandingStats = query({
  args: {},
  handler: async (ctx) => {
    const allTrips = await ctx.db.query("trips").collect();
    const allUsers = await ctx.db.query("userSettings").collect();

    // Unique destinations
    const destinations = new Set<string>();
    for (const trip of allTrips) {
      if (trip.destination) {
        // Normalise "City, Country" → country
        const parts = (trip.destination as string).split(",").map((s) => s.trim());
        if (parts.length >= 2) destinations.add(parts[parts.length - 1]);
        else if (parts[0]) destinations.add(parts[0]);
      }
    }

    return {
      tripsCount: allTrips.length,
      usersCount: allUsers.length,
      destinationsCount: destinations.size,
    };
  },
});
