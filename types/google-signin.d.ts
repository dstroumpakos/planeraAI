// The real @react-native-google-signin/google-signin package is intentionally
// NOT installed — metro.config.js aliases it to shims/google-signin.native.js.
// This stub keeps tsc happy for the dynamic imports in lib/auth-client.native.ts.
declare module "@react-native-google-signin/google-signin" {
    export const GoogleSignin: any;
    export const statusCodes: any;
}
