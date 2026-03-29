import { authQuery } from "./functions";

export const getUserStats = authQuery({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;

    // Fetch all completed trips
    const allTrips = await ctx.db
      .query("trips")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    const completedTrips = allTrips.filter((t: any) => t.status === "completed");

    // Compute unique countries and cities
    const countriesSet = new Set<string>();
    const citiesSet = new Set<string>();
    for (const trip of completedTrips) {
      const dest = trip.destination || "";
      // destination format is typically "City, Country" or just "City"
      const parts = dest.split(",").map((s: string) => s.trim());
      if (parts.length >= 2) {
        citiesSet.add(parts[0]);
        countriesSet.add(parts[parts.length - 1]);
      } else if (parts.length === 1 && parts[0]) {
        citiesSet.add(parts[0]);
      }
      // Multi-city trips
      if (trip.destinations && Array.isArray(trip.destinations)) {
        for (const d of trip.destinations) {
          if (d.city) citiesSet.add(d.city);
          if (d.country) countriesSet.add(d.country);
        }
      }
    }

    // Flight bookings
    const flightBookings = await ctx.db
      .query("flightBookings")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    const confirmedBookings = flightBookings.filter((b: any) => b.status === "confirmed");
    const totalSpentOnFlights = confirmedBookings.reduce(
      (sum: number, b: any) => sum + (b.totalAmount || 0),
      0
    );
    const flightCurrency = confirmedBookings.length > 0 ? confirmedBookings[0].currency : "EUR";

    // Insights shared
    const insights = await ctx.db
      .query("insights")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    const approvedInsights = insights.filter(
      (i: any) => i.moderationStatus === "approved" || i.moderationStatus === undefined
    );
    const totalLikesReceived = insights.reduce((sum: number, i: any) => sum + (i.likes || 0), 0);

    // Top interests (frequency from trip interests arrays)
    const interestCounts: Record<string, number> = {};
    for (const trip of completedTrips) {
      if (trip.interests && Array.isArray(trip.interests)) {
        for (const interest of trip.interests) {
          interestCounts[interest] = (interestCounts[interest] || 0) + 1;
        }
      }
    }
    const topInterests = Object.entries(interestCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Longest & shortest trip (by days)
    let longestTripDays = 0;
    let shortestTripDays = Infinity;
    for (const trip of completedTrips) {
      const days = Math.ceil((trip.endDate - trip.startDate) / (1000 * 60 * 60 * 24));
      if (days > longestTripDays) longestTripDays = days;
      if (days < shortestTripDays) shortestTripDays = days;
    }
    if (completedTrips.length === 0) shortestTripDays = 0;

    // Favorite destination (most visited city)
    const cityVisits: Record<string, number> = {};
    for (const trip of completedTrips) {
      const dest = trip.destination || "";
      const city = dest.split(",")[0]?.trim();
      if (city) cityVisits[city] = (cityVisits[city] || 0) + 1;
    }
    const favoriteDestination = Object.entries(cityVisits).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Monthly trip history (last 12 months)
    const now = Date.now();
    const monthlyHistory: { month: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const year = d.getFullYear();
      const month = d.getMonth();
      const monthStart = new Date(year, month, 1).getTime();
      const monthEnd = new Date(year, month + 1, 1).getTime();
      const count = completedTrips.filter(
        (t: any) => t.startDate >= monthStart && t.startDate < monthEnd
      ).length;
      const label = `${year}-${String(month + 1).padStart(2, "0")}`;
      monthlyHistory.push({ month: label, count });
    }

    // Check if premium for gating
    const userPlan = await ctx.db
      .query("userPlans")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .unique();
    const isPremium =
      userPlan?.plan === "premium" &&
      userPlan?.subscriptionExpiresAt &&
      userPlan.subscriptionExpiresAt > Date.now();

    return {
      totalTrips: completedTrips.length,
      totalCountries: countriesSet.size,
      totalCities: citiesSet.size,
      totalFlightsBooked: confirmedBookings.length,
      insightsShared: approvedInsights.length,
      totalLikesReceived,
      longestTripDays,
      shortestTripDays,
      favoriteDestination,
      // Premium-gated fields
      totalSpentOnFlights: isPremium ? totalSpentOnFlights : null,
      flightCurrency: isPremium ? flightCurrency : null,
      topInterests: isPremium ? topInterests : topInterests.slice(0, 2),
      monthlyHistory: isPremium ? monthlyHistory : null,
      isPremium,
    };
  },
});
