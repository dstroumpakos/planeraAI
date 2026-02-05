/**
 * Optimized Image Component
 * Uses expo-image for better performance, caching, and transitions
 */

import React, { useMemo } from 'react';
import { StyleSheet, View, StyleProp, ViewStyle, ImageStyle } from 'react-native';
import { Image, ImageContentFit } from 'expo-image';
import { optimizeUnsplashUrl, IMAGE_SIZES, getPlaceholderColor } from '@/lib/imageUtils';

type ImageSizePreset = keyof typeof IMAGE_SIZES;

interface OptimizedImageProps {
  /** Image URL - will be optimized if from Unsplash */
  source: string | null | undefined;
  /** Image size preset or custom options */
  size?: ImageSizePreset | { width: number; quality?: number };
  /** Container style */
  style?: StyleProp<ViewStyle>;
  /** Image-specific styles (borderRadius, etc) */
  imageStyle?: StyleProp<ImageStyle>;
  /** Content fit mode */
  contentFit?: ImageContentFit;
  /** Blur hash for placeholder (from Unsplash API) */
  blurHash?: string | null;
  /** Custom placeholder color */
  placeholderColor?: string;
  /** Transition duration in ms */
  transitionDuration?: number;
  /** Alt text for accessibility */
  alt?: string;
  /** Called when image loads */
  onLoad?: () => void;
  /** Called on error */
  onError?: () => void;
}

/**
 * Optimized image component with:
 * - Automatic Unsplash URL optimization
 * - Disk caching via expo-image
 * - Smooth fade-in transitions
 * - Placeholder support (blur hash or color)
 */
export function OptimizedImage({
  source,
  size = 'CARD',
  style,
  imageStyle,
  contentFit = 'cover',
  blurHash,
  placeholderColor,
  transitionDuration = 300,
  alt,
  onLoad,
  onError,
}: OptimizedImageProps) {
  // Optimize the URL based on size preset
  const optimizedUrl = useMemo(() => {
    if (!source) return null;
    
    if (typeof size === 'string') {
      return optimizeUnsplashUrl(source, IMAGE_SIZES[size]);
    } else {
      return optimizeUnsplashUrl(source, size);
    }
  }, [source, size]);

  // Determine placeholder
  const placeholder = useMemo(() => {
    if (blurHash) {
      return { blurhash: blurHash };
    }
    // Use a solid color placeholder
    const color = placeholderColor || getPlaceholderColor(source || '');
    return { blurhash: undefined };
  }, [blurHash, placeholderColor, source]);

  // Fallback color for background
  const bgColor = placeholderColor || getPlaceholderColor(source || '');

  if (!optimizedUrl) {
    return (
      <View style={[styles.placeholder, { backgroundColor: bgColor }, style]} />
    );
  }

  return (
    <View style={[styles.container, style]}>
      <Image
        source={{ uri: optimizedUrl }}
        style={[styles.image, imageStyle]}
        contentFit={contentFit}
        cachePolicy="disk"
        transition={transitionDuration}
        placeholder={blurHash ? { blurhash: blurHash } : undefined}
        placeholderContentFit="cover"
        accessibilityLabel={alt}
        onLoad={onLoad}
        onError={onError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#E8E6E1',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
  },
});

export default OptimizedImage;
