---
name: convex-backend
description: "Create or modify Convex backend functions (queries, mutations, actions), schema tables, and indexes for the Bloom travel app. Use when: adding new Convex tables, writing authQuery/authMutation wrappers, creating Convex actions for external APIs, updating schema.ts, or working with Convex helpers."
---

# Convex Backend Development

## When to Use
- Adding new tables or indexes to `convex/schema.ts`
- Creating queries, mutations, or actions in `convex/`
- Working with authenticated endpoints (`authQuery`, `authMutation`, `authAction`)
- Integrating external APIs via Convex actions (Duffel, OpenAI, Unsplash, Postmark)
- Adding cron jobs to `convex/crons.ts`

## Architecture

### Auth Pattern
All authenticated endpoints use token-based auth. Queries and mutations accept `token: v.string()` as an explicit argument (HTTP headers are unreliable in React Native). Actions can also read Bearer tokens from headers.

```typescript
// Use authQuery/authMutation/authAction from convex/functions.ts
import { authQuery, authMutation, authAction } from "./functions";

export const myQuery = authQuery({
  args: { /* your args here — token is auto-injected */ },
  handler: async (ctx, args) => {
    // ctx.user is available (userSettings doc)
    const userId = ctx.user.userId;
    // ...
  },
});
```

### Schema Conventions
- Use `v.string()` for userId (not `v.id("users")` — Auth uses string IDs)
- Always add `by_user` index on tables with `userId`
- Use `v.float64()` for numeric fields, `v.optional()` for nullable
- Status fields use `v.union(v.literal("a"), v.literal("b"), ...)`

### File Organization
| File | Purpose |
|------|---------|
| `convex/schema.ts` | All table definitions |
| `convex/functions.ts` | `authQuery`, `authMutation`, `authAction` wrappers |
| `convex/helpers/` | Shared logic (subscription checks, Unsplash, etc.) |
| `convex/flights/` | Duffel API integration layer |
| `convex/_generated/` | Auto-generated types (never edit) |

### Calling from Frontend
```typescript
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

// Query with token
const data = useQuery(api.myFile.myQuery, { token });

// Mutation with token
const doAction = useMutation(api.myFile.myMutation);
await doAction({ token, ...args });
```

## Procedure
1. Define or update the table in `convex/schema.ts` with proper indexes
2. Create the query/mutation/action in the appropriate `convex/*.ts` file
3. Use `authQuery`/`authMutation`/`authAction` for authenticated endpoints
4. For external API calls, use `authAction` (actions can make HTTP requests)
5. Run `npx convex dev` to validate schema and generate types
