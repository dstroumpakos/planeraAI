// metro.config.js
// =================================================================================
// FIX FOR iOS EAS BUILD FAILURE - HERMES CANNOT PARSE WEBPACK DYNAMIC IMPORTS
// =================================================================================
// 
// Root Cause:
// better-auth contains server-side migration code with:
//   import(/* webpackIgnore: true */ path.join(migrationFolder, fileName))
// 
// This webpack-style dynamic import syntax is invalid in Hermes/Metro.
// Even though our app only uses client-side better-auth APIs, Metro's bundler
// traverses ALL exports and dependencies, pulling in the problematic server code.
//
// Solution:
// 1. Hard-alias ALL better-auth related modules to native stubs
// 2. Block problematic paths via blockList regex
// 3. Intercept resolution with custom resolveRequest
// 4. Use platform-specific files (.native.ts) to avoid importing better-auth on native
// =================================================================================

const { getDefaultConfig } = require("@expo/metro-config");
const path = require("path");

const defaultConfig = getDefaultConfig(__dirname);

// Enable package exports for proper ESM/CJS resolution
defaultConfig.resolver.unstable_enablePackageExports = true;

// =================================================================================
// SHIM PATHS - Pure CommonJS stubs that replace better-auth on native
// =================================================================================
const SHIMS = {
  // Core better-auth
  "better-auth": path.resolve(__dirname, "shims/better-auth.native.js"),
  "better-auth/react": path.resolve(__dirname, "shims/better-auth-react.native.js"),
  "better-auth/client/plugins": path.resolve(__dirname, "shims/better-auth-client-plugins.native.js"),
  "better-auth/plugins": path.resolve(__dirname, "shims/better-auth-plugins.native.js"),
  "better-auth/client": path.resolve(__dirname, "shims/empty-module.native.js"),
  "better-auth/db": path.resolve(__dirname, "shims/empty-module.native.js"),
  "better-auth/adapters": path.resolve(__dirname, "shims/empty-module.native.js"),
  "better-auth/cli": path.resolve(__dirname, "shims/empty-module.native.js"),
  "better-auth/api": path.resolve(__dirname, "shims/empty-module.native.js"),
  
  // @convex-dev/better-auth
  "@convex-dev/better-auth": path.resolve(__dirname, "shims/empty-module.native.js"),
  "@convex-dev/better-auth/react": path.resolve(__dirname, "shims/convex-better-auth-react.native.js"),
  "@convex-dev/better-auth/client/plugins": path.resolve(__dirname, "shims/convex-better-auth-client-plugins.native.js"),
  "@convex-dev/better-auth/plugins": path.resolve(__dirname, "shims/empty-module.native.js"),
  
  // @better-auth/expo
  "@better-auth/expo": path.resolve(__dirname, "shims/better-auth-expo.native.js"),
  "@better-auth/expo/client": path.resolve(__dirname, "shims/better-auth-expo.native.js"),
};

const EMPTY_SHIM = path.resolve(__dirname, "shims/empty-module.native.js");

// =================================================================================
// BLOCKLIST - Regex patterns to completely exclude from bundling
// All patterns must have NO FLAGS to avoid Metro regex combination errors
// =================================================================================
defaultConfig.resolver.blockList = [
  // Block all better-auth internal files that might contain problematic code
  /node_modules\/better-auth\/dist\/db\/.*/,
  /node_modules\/better-auth\/dist\/cli\/.*/,
  /node_modules\/better-auth\/dist\/adapters\/.*/,
  /node_modules\/better-auth\/dist\/api\/routes\/.*[Mm]igration.*/,
  /node_modules\/better-auth\/.*[Mm]igration.*/,
  /node_modules\/better-auth\/.*internal-adapter.*/,
  // Block test files
  /node_modules\/better-auth\/.*\.(test|spec)\.[jt]sx?$/,
];

// =================================================================================
// EXTRA NODE MODULES - Hard aliases that take precedence
// =================================================================================
// Note: extraNodeModules doesn't support platform-specific aliases directly,
// so we handle this in resolveRequest instead
defaultConfig.resolver.extraNodeModules = {
  ...defaultConfig.resolver.extraNodeModules,
};

// =================================================================================
// CUSTOM RESOLVER - Intercepts and redirects better-auth imports on native
// =================================================================================
const originalResolveRequest = defaultConfig.resolver.resolveRequest;

defaultConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  const isNative = platform === "ios" || platform === "android";
  
  if (isNative) {
    // STRATEGY 1: Exact module name match -> return shim immediately
    if (SHIMS[moduleName]) {
      console.log(`[SHIM] ${moduleName} -> ${path.basename(SHIMS[moduleName])}`);
      return {
        filePath: SHIMS[moduleName],
        type: "sourceFile",
      };
    }
    
    // STRATEGY 2: Any better-auth subpath not explicitly shimmed -> empty shim
    if (moduleName.startsWith("better-auth/")) {
      console.log(`[SHIM] ${moduleName} -> empty-module.native.js`);
      return {
        filePath: EMPTY_SHIM,
        type: "sourceFile",
      };
    }
    
    // STRATEGY 3: Any @convex-dev/better-auth subpath -> empty shim
    if (moduleName.startsWith("@convex-dev/better-auth/")) {
      console.log(`[SHIM] ${moduleName} -> empty-module.native.js`);
      return {
        filePath: EMPTY_SHIM,
        type: "sourceFile",
      };
    }
    
    // STRATEGY 4: Any @better-auth subpath -> empty shim
    if (moduleName.startsWith("@better-auth/")) {
      console.log(`[SHIM] ${moduleName} -> empty-module.native.js`);
      return {
        filePath: EMPTY_SHIM,
        type: "sourceFile",
      };
    }
    
    // STRATEGY 5: Check if module name contains problematic patterns
    const lowerModuleName = moduleName.toLowerCase();
    if (
      lowerModuleName.includes("better-auth") &&
      (lowerModuleName.includes("migration") ||
        lowerModuleName.includes("internal-adapter") ||
        lowerModuleName.includes("/db/") ||
        lowerModuleName.includes("/cli/") ||
        lowerModuleName.includes("/adapters/"))
    ) {
      console.log(`[SHIM] ${moduleName} -> empty-module.native.js (pattern match)`);
      return {
        filePath: EMPTY_SHIM,
        type: "sourceFile",
      };
    }
  }
  
  // Use default resolution
  let resolution;
  try {
    if (originalResolveRequest) {
      resolution = originalResolveRequest(context, moduleName, platform);
    } else {
      resolution = context.resolveRequest(context, moduleName, platform);
    }
  } catch (error) {
    throw error;
  }
  
  // STRATEGY 6: Post-resolution check - if resolved path is in better-auth packages, redirect on native
  if (isNative && resolution && resolution.filePath) {
    const filePath = resolution.filePath;
    const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
    
    // Check if this resolves to any better-auth related package
    if (
      normalizedPath.includes("node_modules/better-auth/") ||
      normalizedPath.includes("node_modules/@convex-dev/better-auth/") ||
      normalizedPath.includes("node_modules/@better-auth/")
    ) {
      // Check for specifically dangerous paths
      if (
        normalizedPath.includes("/db/") ||
        normalizedPath.includes("/cli/") ||
        normalizedPath.includes("/adapters/") ||
        normalizedPath.includes("migration") ||
        normalizedPath.includes("internal-adapter")
      ) {
        console.log(`[SHIM-POST] ${filePath} -> empty-module.native.js`);
        return {
          filePath: EMPTY_SHIM,
          type: "sourceFile",
        };
      }
    }
  }
  
  return resolution;
};

// =================================================================================
// TRANSFORMER OPTIONS - Ensure Hermes compatibility
// =================================================================================
defaultConfig.transformer = {
  ...defaultConfig.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
  // Minifier config to ensure no invalid syntax passes through
  minifierConfig: {
    keep_classnames: true,
    keep_fnames: true,
    mangle: {
      keep_classnames: true,
      keep_fnames: true,
    },
  },
};

// =================================================================================
// SOURCE EXTENSIONS - Prioritize .native.js/.native.ts files
// =================================================================================
defaultConfig.resolver.sourceExts = [
  "native.js",
  "native.jsx", 
  "native.ts",
  "native.tsx",
  ...defaultConfig.resolver.sourceExts.filter(
    (ext) => !ext.startsWith("native.")
  ),
];

// =================================================================================
// FINAL EXPORT
// =================================================================================
module.exports = {
  ...defaultConfig,
  server: {
    ...defaultConfig.server,
    enhanceMiddleware: (middleware) => {
      return (req, res, next) => {
        req.setTimeout(30000);
        res.setTimeout(30000);
        return middleware(req, res, next);
      };
    },
  },
  watcher: {
    ...defaultConfig.watcher,
    unstable_lazySha1: true,
  },
};
