import { query } from "./_generated/server";

/**
 * Public, unauthenticated health check used to verify which Convex
 * deployment the live app client is actually talking to.
 * Returns the deployment's own cloud URL (e.g. canny-bobcat-846 = prod,
 * giddy-sandpiper-781 = dev).
 */
export const whoami = query({
  args: {},
  handler: async () => {
    return {
      deploymentUrl: process.env.CONVEX_CLOUD_URL ?? "unknown",
      time: Date.now(),
    };
  },
});
