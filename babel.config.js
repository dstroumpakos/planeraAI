mmodule.exports = function (api) {
  const platform = api.caller((caller) => caller?.platform);
  api.cache.using(() => platform || "default");

  const isNative = platform === "ios" || platform === "android";
  const plugins = [];

  if (isNative) {
    plugins.push(["./babel-plugin-remove-dynamic-imports.js", { platform }]);
  }

  // Must be last (Reanimated v4)
  plugins.push("react-native-worklets/plugin");

  return {
    presets: ["babel-preset-expo"],
    plugins,
  };
};

