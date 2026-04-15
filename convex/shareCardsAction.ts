"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

/**
 * Fetch a portrait-oriented Unsplash photo for the share card.
 * Uses orientation=portrait and 1080x1920 sizing for Instagram Story format.
 */
export const fetchShareCardPhoto = action({
  args: {
    token: v.string(),
    tripId: v.id("trips"),
  },
  handler: async (ctx, args) => {
    // Get the trip (trips.get handles its own auth via token)
    const trip: any = await ctx.runQuery(api.trips.get as any, { token: args.token, tripId: args.tripId });
    if (!trip) throw new Error("Trip not found");

    // If share card photo already cached, return it
    if (trip.shareCardPhoto) {
      return trip.shareCardPhoto;
    }

    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      console.error("UNSPLASH_ACCESS_KEY not set");
      return null;
    }

    try {
      const searchQuery = `${trip.destination} travel`;
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchQuery)}&per_page=1&orientation=portrait`,
        {
          headers: {
            Authorization: `Client-ID ${accessKey}`,
          },
        }
      );

      if (!response.ok) {
        console.error("Unsplash API error:", response.status);
        return null;
      }

      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        // Fallback: try just the destination name
        const fallbackResponse = await fetch(
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(trip.destination)}&per_page=1&orientation=portrait`,
          {
            headers: {
              Authorization: `Client-ID ${accessKey}`,
            },
          }
        );
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          if (fallbackData.results?.length > 0) {
            const photo = fallbackData.results[0];
            const sharePhoto = {
              url: `${photo.urls.raw}&w=1080&h=1920&fit=crop&q=80`,
              photographer: photo.user.name,
              photographerUsername: photo.user.username || undefined,
            };

            // Trigger Unsplash download event (ToS compliance)
            if (photo.links?.download_location) {
              fetch(`${photo.links.download_location}?client_id=${accessKey}`).catch(() => {});
            }

            // Cache the photo on the trip
            await ctx.runMutation(api.shareCards.updateShareCardData as any, {
              token: args.token,
              tripId: args.tripId,
              shareCardPhoto: sharePhoto,
            });

            return sharePhoto;
          }
        }
        return null;
      }

      const photo = data.results[0];
      const sharePhoto = {
        url: `${photo.urls.raw}&w=1080&h=1920&fit=crop&q=80`,
        photographer: photo.user.name,
        photographerUsername: photo.user.username || undefined,
      };

      // Trigger Unsplash download event (ToS compliance)
      if (photo.links?.download_location) {
        fetch(`${photo.links.download_location}?client_id=${accessKey}`).catch(() => {});
      }

      // Cache the photo on the trip
      await ctx.runMutation(api.shareCards.updateShareCardData as any, {
        token: args.token,
        tripId: args.tripId,
        shareCardPhoto: sharePhoto,
      });

      return sharePhoto;
    } catch (error) {
      console.error("Error fetching share card photo:", error);
      return null;
    }
  },
});

/**
 * Fetch multiple portrait-oriented Unsplash photos for the share card photo picker.
 * Returns an array of photo options for the user to choose from.
 */
export const fetchShareCardPhotos = action({
  args: {
    token: v.string(),
    tripId: v.id("trips"),
  },
  handler: async (ctx, args) => {
    const trip: any = await ctx.runQuery(api.trips.get as any, { token: args.token, tripId: args.tripId });
    if (!trip) throw new Error("Trip not found");

    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      console.error("UNSPLASH_ACCESS_KEY not set");
      return [];
    }

    try {
      const searchQuery = `${trip.destination} travel`;
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchQuery)}&per_page=10&orientation=portrait`,
        {
          headers: {
            Authorization: `Client-ID ${accessKey}`,
          },
        }
      );

      if (!response.ok) {
        console.error("Unsplash API error:", response.status);
        return [];
      }

      const data = await response.json();
      let results = data.results || [];

      // If few results, try fallback query
      if (results.length < 3) {
        const fallbackResponse = await fetch(
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(trip.destination)}&per_page=10&orientation=portrait`,
          {
            headers: {
              Authorization: `Client-ID ${accessKey}`,
            },
          }
        );
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          if (fallbackData.results?.length > results.length) {
            results = fallbackData.results;
          }
        }
      }

      return results.map((photo: any) => ({
        url: `${photo.urls.raw}&w=1080&h=1920&fit=crop&q=80`,
        thumbnailUrl: `${photo.urls.raw}&w=200&h=356&fit=crop&q=60`,
        photographer: photo.user.name,
        photographerUsername: photo.user.username || undefined,
        downloadLocation: photo.links?.download_location || undefined,
      }));
    } catch (error) {
      console.error("Error fetching share card photos:", error);
      return [];
    }
  },
});
