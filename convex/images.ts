"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

interface UnsplashPhoto {
  urls: { regular: string };
  user: { name: string; links: { html: string } };
  links: { html: string; download_location: string };
}

interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
}

interface UnsplashImage {
  url: string;
  photographer: string;
  attribution: string;
  photographerUrl?: string;
  downloadLocation?: string;
}

async function fetchUnsplashImage(query: string): Promise<UnsplashImage | null> {
  try {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      console.error("UNSPLASH_ACCESS_KEY not set");
      return null;
    }

    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      {
        headers: {
          "Authorization": `Client-ID ${accessKey}`,
        },
      }
    );

    if (!response.ok) {
      console.error("Unsplash API error:", response.status);
      return null;
    }

    const data = await response.json() as UnsplashSearchResponse;
    if (!data.results || data.results.length === 0) {
      return null;
    }

    const photo = data.results[0];
    return {
      url: photo.urls.regular,
      photographer: photo.user.name,
      attribution: photo.links.html,
      photographerUrl: photo.user.links.html,
      downloadLocation: photo.links.download_location,
    };
  } catch (error) {
    console.error("Error fetching Unsplash image:", error);
    return null;
  }
}

export const getDestinationImage = action({
  args: { destination: v.string() },
  returns: v.union(
    v.object({
      url: v.string(),
      photographer: v.string(),
      attribution: v.string(),
      photographerUrl: v.optional(v.string()),
      downloadLocation: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    return await fetchUnsplashImage(args.destination);
  },
});

export const getDestinationImages = action({
  args: { destination: v.string(), count: v.optional(v.number()) },
  returns: v.array(
    v.object({
      url: v.string(),
      photographer: v.string(),
      attribution: v.string(),
      photographerUrl: v.optional(v.string()),
      downloadLocation: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    try {
      const accessKey = process.env.UNSPLASH_ACCESS_KEY;
      if (!accessKey) {
        console.error("UNSPLASH_ACCESS_KEY not set");
        return [];
      }

      const count = args.count || 5;
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(args.destination)}&per_page=${count}&orientation=landscape`,
        {
          headers: {
            "Authorization": `Client-ID ${accessKey}`,
          },
        }
      );

      if (!response.ok) {
        console.error("Unsplash API error:", response.status);
        return [];
      }

      const data = await response.json() as UnsplashSearchResponse;
      if (!data.results) {
        return [];
      }

      return data.results.map((photo: UnsplashPhoto) => ({
        url: photo.urls.regular,
        photographer: photo.user.name,
        attribution: photo.links.html,
        photographerUrl: photo.user.links.html,
        downloadLocation: photo.links.download_location,
      }));
    } catch (error) {
      console.error("Error fetching Unsplash images:", error);
      return [];
    }
  },
});

export const getActivityImage = action({
  args: { activity: v.string(), destination: v.string() },
  returns: v.union(
    v.object({
      url: v.string(),
      photographer: v.string(),
      attribution: v.string(),
      photographerUrl: v.optional(v.string()),
      downloadLocation: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const query = `${args.activity} ${args.destination}`;
    return await fetchUnsplashImage(query);
  },
});

export const getRestaurantImage = action({
  args: { cuisine: v.string(), destination: v.string() },
  returns: v.union(
    v.object({
      url: v.string(),
      photographer: v.string(),
      attribution: v.string(),
      photographerUrl: v.optional(v.string()),
      downloadLocation: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const query = `${args.cuisine} restaurant ${args.destination}`;
    return await fetchUnsplashImage(query);
  },
});

export const trackUnsplashDownload = action({
  args: { downloadLocation: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Make a request to the download_location URL to track the download
      // This is required by Unsplash API for proper attribution tracking
      await fetch(args.downloadLocation);
    } catch (error) {
      console.error("Error tracking Unsplash download:", error);
      // Don't throw - this is just for tracking and shouldn't break the app
    }
    return null;
  },
});
