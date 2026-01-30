// Native-specific auth components
// These work without better-auth on iOS/Android

export { 
  Authenticated, 
  Unauthenticated, 
  AuthLoading, 
  useConvexAuth 
} from "./ConvexAuthProvider.native";
