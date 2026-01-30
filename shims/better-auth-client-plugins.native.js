// Native stub for better-auth/client/plugins
// Provides plugin stubs that return compatible structures

function anonymousClient(options) {
  return {
    id: "anonymous",
    name: "anonymous",
    $InferServerPlugin: null,
    getActions: function getActions(fetch, store) {
      return {
        signIn: {
          anonymous: async function anonymous() {
            return { data: null, error: null };
          },
        },
      };
    },
    getAtoms: function getAtoms(fetch) {
      return {};
    },
    pathMethods: {},
    atomListeners: [],
  };
}

// Other common plugins (stubs)
function twoFactorClient(options) {
  return {
    id: "two-factor",
    name: "twoFactor",
    getActions: function() { return {}; },
    getAtoms: function() { return {}; },
  };
}

function passkeyClient(options) {
  return {
    id: "passkey",
    name: "passkey",
    getActions: function() { return {}; },
    getAtoms: function() { return {}; },
  };
}

function magicLinkClient(options) {
  return {
    id: "magic-link",
    name: "magicLink",
    getActions: function() { return {}; },
    getAtoms: function() { return {}; },
  };
}

// CommonJS exports
module.exports = {
  anonymousClient,
  twoFactorClient,
  passkeyClient,
  magicLinkClient,
};
module.exports.anonymousClient = anonymousClient;
module.exports.twoFactorClient = twoFactorClient;
module.exports.passkeyClient = passkeyClient;
module.exports.magicLinkClient = magicLinkClient;
module.exports.default = { anonymousClient, twoFactorClient, passkeyClient, magicLinkClient };
module.exports.__esModule = true;
