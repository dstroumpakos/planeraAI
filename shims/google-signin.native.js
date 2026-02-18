// Shim for @react-native-google-signin/google-signin
// Google Sign-In is not used on iOS - this prevents the native module crash

const GoogleSignin = {
  configure: () => {},
  signIn: () => Promise.reject(new Error("Google Sign-In not available")),
  signOut: () => Promise.resolve(),
  getCurrentUser: () => null,
  hasPlayServices: () => Promise.resolve(false),
  isSignedIn: () => Promise.resolve(false),
  revokeAccess: () => Promise.resolve(),
  getTokens: () => Promise.reject(new Error("Google Sign-In not available")),
};

const statusCodes = {
  SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED",
  IN_PROGRESS: "IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
};

const GoogleSigninButton = () => null;
GoogleSigninButton.Size = { Standard: 0, Wide: 1, Icon: 2 };
GoogleSigninButton.Color = { Auto: 0, Light: 1, Dark: 2 };

module.exports = {
  GoogleSignin,
  GoogleSigninButton,
  statusCodes,
};
