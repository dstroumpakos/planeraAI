// Native stub for @convex-dev/better-auth/client/plugins
// Provides plugin stubs that work on native platforms

function convexClient() {
  return {
    id: "convex",
    getHeaders: () => ({}),
    $InferServerPlugin: null,
  };
}

function crossDomainClient() {
  return {
    id: "crossDomain",
    getHeaders: () => ({}),
    $InferServerPlugin: null,
  };
}

module.exports = {
  convexClient,
  crossDomainClient,
};
module.exports.convexClient = convexClient;
module.exports.crossDomainClient = crossDomainClient;
module.exports.__esModule = true;
