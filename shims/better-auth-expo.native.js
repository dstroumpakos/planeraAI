// Native stub for @better-auth/expo/client
// Provides expoClient stub

function expoClient(options) {
  return {
    id: "expo",
    getHeaders: () => ({}),
    $InferServerPlugin: null,
    scheme: options?.scheme,
    storage: options?.storage,
    storagePrefix: options?.storagePrefix,
  };
}

module.exports = {
  expoClient,
};
module.exports.expoClient = expoClient;
module.exports.default = { expoClient };
module.exports.__esModule = true;
