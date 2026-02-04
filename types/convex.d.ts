/**
 * Type augmentation for Convex API
 * These are properly exported from Convex backend but not properly typed by codegen
 */

// The api object from Convex is fully functional at runtime
// These TS errors are due to Convex codegen not recognizing authMutation/authQuery wrappers
// Using 'any' to bypass type checking while maintaining runtime functionality

