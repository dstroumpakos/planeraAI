"use node";

/**
 * Fetch images from Unsplash API
 * Requires UNSPLASH_ACCESS_KEY and UNSPLASH_SECRET_KEY environment variables
 * 
 * To get these keys:
 * 1. Go to https://unsplash.com/oauth/applications
 * 2. Create a new application
 * 3. Copy the Access Key and Secret Key
 * 4. Add them to your Convex dashboard environment variables:
 *    - UNSPLASH_ACCESS_KEY: Your application's access key
 *    - UNSPLASH_SECRET_KEY: Your application's secret key
 */

interface UnsplashImage {
  id: string;
  url: string;
  description: string | null;
  photographer: string;
  photographerUrl: string;
  attribution: string;
  downloadLocation?: string;
}

function validateUnsplashKeys(): { accessKey: string; secretKey: string } {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  const secretKey = process.env.UNSPLASH_SECRET_KEY;

  if (!accessKey) {
    throw new Error(
      "UNSPLASH_ACCESS_KEY environment variable is required but not set. " +
      "Please configure it in your Convex dashboard. " +
      "Get it from: https://unsplash.com/oauth/applications"
    );
  }

  if (!secretKey) {
    throw new Error(
      "UNSPLASH_SECRET_KEY environment variable is required but not set. " +
      "Please configure it in your Convex dashboard. " +
      "Get it from: https://unsplash.com/oauth/applications"
    );
  }

  return { accessKey, secretKey };
}

export async function fetchUnsplashImage(query: string): Promise<UnsplashImage | null> {
  try {
    const { accessKey } = validateUnsplashKeys();

    const response = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&client_id=${accessKey}&orientation=landscape`
    );

    if (!response.ok) {
      console.error(`❌ Unsplash API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    return {
      id: data.id,
      url: data.urls.regular,
      description: data.description || data.alt_description,
      photographer: data.user.name,
      photographerUrl: data.user.links.html,
      attribution: `Photo by ${data.user.name} on Unsplash`,
      downloadLocation: data.links.download_location,
    };
  } catch (error) {
    console.error("❌ Error fetching from Unsplash:", error);
    return null;
  }
}

export async function fetchUnsplashImages(query: string, count: number = 5): Promise<UnsplashImage[]> {
  try {
    const { accessKey } = validateUnsplashKeys();

    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&client_id=${accessKey}&per_page=${count}&orientation=landscape`
    );

    if (!response.ok) {
      console.error(`❌ Unsplash API error: ${response.status}`);
      return [];
    }

    const data = await response.json();

    interface UnsplashPhotoResult {
      id: string;
      urls: { regular: string };
      description: string | null;
      alt_description: string | null;
      user: { name: string; links: { html: string } };
      links: { download_location: string };
    }

    return data.results.map((photo: UnsplashPhotoResult) => ({
      id: photo.id,
      url: photo.urls.regular,
      description: photo.description || photo.alt_description,
      photographer: photo.user.name,
      photographerUrl: photo.user.links.html,
      attribution: `Photo by ${photo.user.name} on Unsplash`,
      downloadLocation: photo.links.download_location,
    }));
  } catch (error) {
    console.error("❌ Error fetching from Unsplash:", error);
    return [];
  }
}
