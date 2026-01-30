// Native stub for better-auth/react
// Provides createAuthClient that returns a real-looking API structure
// This stub will be used on iOS/Android to prevent webpack dynamic imports

function createAuthClient(options) {
  const noopAsync = async () => ({ data: null, error: null });
  const noopSessionAsync = async () => ({ data: { session: null, user: null }, error: null });
  
  const client = {
    // Sign in methods
    signIn: {
      email: noopAsync,
      social: noopAsync,
      anonymous: noopAsync,
      credentials: noopAsync,
    },
    // Sign up methods
    signUp: {
      email: noopAsync,
    },
    // Session management
    signOut: noopAsync,
    getSession: noopSessionAsync,
    useSession: function useSession() {
      return { data: null, isPending: false, error: null };
    },
    // Fetch wrapper
    $fetch: noopAsync,
    // Internal store
    $store: {
      listen: function listen(callback) { return function unsubscribe() {}; },
      get: function get() { return null; },
      set: function set(value) {},
      notify: function notify() {},
    },
    // For plugin compatibility
    $inferServerPlugin: null,
    $context: options,
  };
  
  return client;
}

// CommonJS exports
module.exports = { createAuthClient };
module.exports.createAuthClient = createAuthClient;
module.exports.default = { createAuthClient };
module.exports.__esModule = true;
