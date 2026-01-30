// Native stub for @convex-dev/better-auth/react
// This replaces the ConvexBetterAuthProvider on native platforms

const React = require("react");
const { ConvexProvider } = require("convex/react");

// Stub provider that just wraps ConvexProvider
function ConvexBetterAuthProvider({ client, authClient, children }) {
  return React.createElement(ConvexProvider, { client }, children);
}

module.exports = {
  ConvexBetterAuthProvider,
};
module.exports.ConvexBetterAuthProvider = ConvexBetterAuthProvider;
module.exports.__esModule = true;
