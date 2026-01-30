import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";

interface ImageData {
  url: string;
  photographer: string;
  attribution: string;
  photographerUrl?: string;
  downloadLocation?: string;
}

export function useDestinationImage(destination: string | undefined) {
  const getImage = useAction(api.images.getDestinationImage);
  const [image, setImage] = useState<ImageData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!destination) return;

    setLoading(true);
    getImage({ destination })
      .then(setImage)
      .catch((error) => {
        console.error("Error fetching destination image:", error);
        setImage(null);
      })
      .finally(() => setLoading(false));
  }, [destination, getImage]);

  return { image, loading };
}

export function useDestinationImages(destination: string | undefined, count?: number) {
  const getImages = useAction(api.images.getDestinationImages);
  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!destination) return;

    setLoading(true);
    getImages({ destination, count })
      .then(setImages)
      .catch((error) => {
        console.error("Error fetching destination images:", error);
        setImages([]);
      })
      .finally(() => setLoading(false));
  }, [destination, count, getImages]);

  return { images, loading };
}

export function useActivityImage(activity: string | undefined, destination: string | undefined) {
  const getImage = useAction(api.images.getActivityImage);
  const [image, setImage] = useState<ImageData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activity || !destination) return;

    setLoading(true);
    getImage({ activity, destination })
      .then(setImage)
      .catch((error) => {
        console.error("Error fetching activity image:", error);
        setImage(null);
      })
      .finally(() => setLoading(false));
  }, [activity, destination, getImage]);

  return { image, loading };
}

export function useRestaurantImage(cuisine: string | undefined, destination: string | undefined) {
  const getImage = useAction(api.images.getRestaurantImage);
  const [image, setImage] = useState<ImageData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cuisine || !destination) return;

    setLoading(true);
    getImage({ cuisine, destination })
      .then(setImage)
      .catch((error) => {
        console.error("Error fetching restaurant image:", error);
        setImage(null);
      })
      .finally(() => setLoading(false));
  }, [cuisine, destination, getImage]);

  return { image, loading };
}
