// Empty shim for modules that should not be bundled in React Native
// Used by metro.config.js to replace server-only modules

// CommonJS export
module.exports = {};
module.exports.default = {};

// Also support named exports that might be expected
module.exports.__esModule = true;
