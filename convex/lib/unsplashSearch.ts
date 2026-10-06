/**
 * Free-text Unsplash photo search, shared by the admin and supplier-portal
 * product-image pickers. Runs in the default Convex runtime (plain fetch).
 */

export type UnsplashPick = {
  id: string;
  thumbUrl: string;
  imageUrl: string;
  description: string | null;
  photographer: string;
  photographerUrl: string;
  downloadLocation: string;
};

export type UnsplashSearchResult = {
  total: number;
  totalPages: number;
  results: UnsplashPick[];
};

export async function searchUnsplashPhotos(
  accessKey: string,
  query: string,
  page = 1
): Promise<UnsplashSearchResult> {
  const q = query.trim();
  if (!q) return { total: 0, totalPages: 0, results: [] };
  const p = Math.max(1, Math.min(50, Math.round(page)));

  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}` +
      `&per_page=24&page=${p}&orientation=landscape&content_filter=high`,
    { headers: { Authorization: `Client-ID ${accessKey}` } }
  );
  if (!res.ok) throw new Error(`Unsplash error (${res.status}).`);
  const data = (await res.json()) as {
    total?: number;
    total_pages?: number;
    results?: Array<{
      id: string;
      description?: string | null;
      alt_description?: string | null;
      urls: { raw: string; small: string };
      user: { name: string; links: { html: string } };
      links: { download_location: string };
    }>;
  };
  return {
    total: data.total ?? 0,
    totalPages: data.total_pages ?? 0,
    results: (data.results ?? []).map((r) => ({
      id: r.id,
      thumbUrl: r.urls.small,
      // No commas in the stored URL: supplier forms split image lists on them.
      imageUrl: `${r.urls.raw}&w=1200&q=80&fm=jpg&fit=crop&auto=format`,
      description: r.alt_description ?? r.description ?? null,
      photographer: r.user.name,
      photographerUrl: `${r.user.links.html}?utm_source=planera&utm_medium=referral`,
      downloadLocation: r.links.download_location,
    })),
  };
}

/** Unsplash API terms: ping download_location when a photo is actually used. */
export async function pingUnsplashDownload(accessKey: string | undefined, downloadLocation?: string) {
  if (!accessKey || !downloadLocation) return;
  if (!downloadLocation.startsWith("https://api.unsplash.com/")) return;
  try {
    await fetch(downloadLocation, { headers: { Authorization: `Client-ID ${accessKey}` } });
  } catch (e) {
    console.error("Unsplash download ping failed:", e);
  }
}
