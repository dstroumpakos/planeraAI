// babel-plugin-remove-dynamic-imports.js
// ========================================
// Safety net: Transforms any remaining dynamic imports with webpackIgnore
// into rejected promises on native platforms.
// This prevents Hermes parse errors during iOS archive.

module.exports = function ({ types: t }) {
  return {
    name: "remove-dynamic-imports",
    visitor: {
      // Handle import() expressions
      CallExpression(path, state) {
        // Only run for native builds
        const platform = state.opts.platform || process.env.BABEL_PLATFORM;
        if (platform !== "ios" && platform !== "android") {
          return;
        }

        // Check if this is a dynamic import: import(...)
        if (path.node.callee.type !== "Import") {
          return;
        }

        // Get the import argument
        const arg = path.node.arguments[0];
        if (!arg) return;

        // Check for webpackIgnore comment or path.join pattern
        const hasWebpackIgnore =
          path.node.leadingComments?.some((c) =>
            c.value.includes("webpackIgnore")
          ) ||
          (arg.type === "CallExpression" &&
            arg.callee?.property?.name === "join");

        if (hasWebpackIgnore) {
          // Replace with Promise.reject
          path.replaceWith(
            t.callExpression(
              t.memberExpression(
                t.identifier("Promise"),
                t.identifier("reject")
              ),
              [
                t.newExpression(t.identifier("Error"), [
                  t.stringLiteral("Dynamic imports disabled on native platform"),
                ]),
              ]
            )
          );
        }
      },
    },
  };
};
