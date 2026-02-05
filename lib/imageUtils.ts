/**
 * Image optimization utilities for Unsplash images
 * Ensures we never load full-resolution images on mobile
 */

export interface ImageOptimizationOptions {
  /** Target width in pixels */
  width?: number;
  /** Image quality 1-100 */
  quality?: number;
  /** Output format */
  format?: 'jpg' | 'webp';
  /** Fit mode */
  fit?: 'crop' | 'clamp' | 'clip';
}

// Preset sizes for different use cases
export const IMAGE_SIZES = {
  /** Small thumbnails in lists */
  THUMBNAIL: { width: 400, quality: 70 },
  /** Card images */
  CARD: { width: 600, quality: 75 },
  /** Medium images for galleries */
  MEDIUM: { width: 800, quality: 75 },
  /** Hero/header images */
  HERO: { width: 1080, quality: 80 },
  /** Full screen images */
  FULL: { width: 1200, quality: 80 },
} as const;

/**
 * Optimize an Unsplash image URL for mobile
 * Adds width, quality, and format parameters
 */
export function optimizeUnsplashUrl(
  url: string,
  options: ImageOptimizationOptions = IMAGE_SIZES.CARD
): string {
  if (!url) return url;
  
  // Only optimize Unsplash URLs
  if (!url.includes('images.unsplash.com')) {
    return url;
  }

  const { width = 600, quality = 75, format = 'jpg', fit = 'crop' } = options;

  try {
    const urlObj = new URL(url);
    
    // Set optimization parameters
    urlObj.searchParams.set('w', width.toString());
    urlObj.searchParams.set('q', quality.toString());
    urlObj.searchParams.set('fm', format);
    urlObj.searchParams.set('fit', fit);
    
    // Auto-crop for better mobile display
    urlObj.searchParams.set('auto', 'format,compress');
    
    return urlObj.toString();
  } catch {
    // If URL parsing fails, append parameters manually
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}w=${width}&q=${quality}&fm=${format}&fit=${fit}&auto=format,compress`;
  }
}

/**
 * Get optimized URL for different sizes
 */
export function getOptimizedImageUrl(url: string, size: keyof typeof IMAGE_SIZES): string {
  return optimizeUnsplashUrl(url, IMAGE_SIZES[size]);
}

/**
 * Preload critical images using expo-image
 */
export async function preloadImages(urls: string[]): Promise<void> {
  try {
    const { Image } = await import('expo-image');
    await Image.prefetch(urls);
  } catch (error) {
    console.warn('[ImageUtils] Failed to preload images:', error);
  }
}

/**
 * Generate a simple placeholder color based on the URL
 * Used as a fallback when blur_hash is not available
 */
export function getPlaceholderColor(url: string): string {
  // Default soft colors that work well as placeholders
  const colors = [
    '#E8E6E1', // warm gray
    '#E3E8ED', // cool gray  
    '#F0EBE3', // cream
    '#E8EBE4', // sage
    '#EBE8E3', // sand
  ];
  
  if (!url) return colors[0];
  
  // Simple hash to pick a consistent color for the same URL
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i);
    hash = hash & hash;
  }
  
  return colors[Math.abs(hash) % colors.length];
}
