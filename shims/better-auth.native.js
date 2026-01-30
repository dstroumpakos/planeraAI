// Native stub for better-auth
// This completely replaces better-auth on iOS/Android to prevent
// webpack-style dynamic imports from reaching Hermes

// Minimal auth client creator that returns a compatible API
function createAuthClient(options) {
  const noopAsync = async () => ({});
  const noopSync = () => ({});
  
  return {
    signIn: {
      email: noopAsync,
      social: noopAsync,
      anonymous: noopAsync,
    },
    signUp: {
      email: noopAsync,
    },
    signOut: noopAsync,
    getSession: noopAsync,
    useSession: () => ({ data: null, isPending: false, error: null }),
    $fetch: noopAsync,
    $store: {
      listen: () => () => {},
      get: () => null,
      set: () => {},
      notify: () => {},
    },
  };
}

// betterAuth server creator (should never run on native, but stub anyway)
function betterAuth(options) {
  return {
    handler: () => new Response("Not available on native", { status: 501 }),
    api: {},
    options,
  };
}

module.exports = {
  createAuthClient,
  betterAuth,
  default: betterAuth,
};
module.exports.__esModule = true;
