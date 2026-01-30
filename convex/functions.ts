import { action, mutation, query } from "./_generated/server";
import { ConvexError } from "convex/values";
import {
    customQuery,
    customCtx,
    customMutation,
    customAction,
} from "convex-helpers/server/customFunctions";
import { authComponent } from "./auth";

// Use `authQuery` instead of `query` to add this behavior.
export const authQuery = customQuery(
    query, // The base function we're extending
    // Here we're using a `customCtx` helper because our modification
    // only modifies the `ctx` argument to the function.
    customCtx(async (ctx) => {
        // Look up the logged in user
        let user;
        try {
            user = await authComponent.getAuthUser(ctx);
        } catch {
            user = null;
        }
        if (!user) throw new ConvexError("Authentication required");
        // Pass in a user to use in evaluating rules,
        // which validate data access at access / write time.
        // This new ctx will be applied to the function's.
        // The user is a new field, the db replaces ctx.db
        return { user };
    })
);

export const authMutation = customMutation(
    mutation,
    customCtx(async (ctx) => {
        let user;
        try {
            user = await authComponent.getAuthUser(ctx);
        } catch {
            user = null;
        }
        if (!user) throw new ConvexError("Authentication required");
        return { user };
    })
);

export const authAction = customAction(
    action,
    customCtx(async (ctx) => {
        let user;
        try {
            user = await authComponent.getAuthUser(ctx);
        } catch {
            user = null;
        }
        if (!user) throw new ConvexError("Authentication required");
        return { user };
    })
);
