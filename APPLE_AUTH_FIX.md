# Apple Sign-In Authentication Fix

## Error
```
Invalid Apple identity token: unexpected "aud" claim value
```

## Root Cause
The `APPLE_BUNDLE_ID` environment variable is either:
1. Not set at all
2. Set to the wrong value that doesn't match your actual Apple app's bundle ID

## Solution

### Step 1: Find Your Apple Bundle ID
1. Go to [Apple Developer Console](https://developer.apple.com/account)
2. Navigate to **Certificates, Identifiers & Profiles** → **Identifiers**
3. Select your app identifier (usually starts with "com.")
4. Copy the **Bundle ID** exactly as shown

Example: `com.planera.app` or `com.example.tripplanner`

### Step 2: Set Environment Variable

#### For Local Development (.env.local or .env.development)
Create or edit `.env.local` in your project root:
```
APPLE_BUNDLE_ID=com.your.app.bundle.id
```

Replace `com.your.app.bundle.id` with your actual bundle ID from Step 1.

#### For Convex Deployment (convex.json or Convex Dashboard)
Add to your `convex.json`:
```json
{
  "env": {
    "production": {
      "APPLE_BUNDLE_ID": "com.your.app.bundle.id"
    }
  }
}
```

Or set it in the Convex Dashboard:
1. Go to your Convex project dashboard
2. Navigate to Settings → Environment Variables
3. Add: `APPLE_BUNDLE_ID` = `com.your.app.bundle.id`

### Step 3: Verify the Token

The debug logs show the token's `aud` claim:
```
aud: "com.some.value"
```

Make sure this matches your `APPLE_BUNDLE_ID` exactly.

### Step 4: Test

After setting the environment variable:
1. Restart your development server: `npx convex dev`
2. Try Apple sign-in again
3. Check the logs for success

## Common Issues

| Issue | Solution |
|-------|----------|
| `APPLE_BUNDLE_ID environment variable is not set` | Set the env var with your actual bundle ID |
| `unexpected "aud" claim value` | Bundle ID doesn't match - double-check spelling and case |
| Still failing after setting env | Clear cache: `rm -rf node_modules/.convex` then restart |

## Debugging

Enable more detailed logging by checking these debug lines in the error response:
```
[AuthNative] Apple verification config: { hasBundleId: true, bundleId: "..." }
[AuthNative] Apple token decoded (pre-verify): { aud: "com.your.app" }
```

The `aud` value shown must match your `APPLE_BUNDLE_ID` environment variable exactly.

## References
- [Apple SignIn Documentation](https://developer.apple.com/documentation/sign_in_with_apple)
- [Apple Bundle ID Format](https://developer.apple.com/documentation/appkit/nsbundle/1524623-bundleidentifier)
