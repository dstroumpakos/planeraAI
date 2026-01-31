import { AuthFunctions, createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { components, internal } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { anonymous } from "better-auth/plugins";

const authFunctions: AuthFunctions = internal.auth;

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth, {
    authFunctions,
    triggers: {},
});

// export the trigger API functions so that triggers work
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

const siteUrl = process.env.SITE_URL!;

export const createAuth = (
    ctx: GenericCtx<DataModel>,
    { optionsOnly } = { optionsOnly: false }
) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const appleClientId = process.env.APPLE_CLIENT_ID;
    const appleClientSecret = process.env.APPLE_CLIENT_SECRET;

    const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};

    if (googleClientId && googleClientSecret) {
        socialProviders.google = {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
        };
    }

    if (appleClientId && appleClientSecret) {
        socialProviders.apple = {
            clientId: appleClientId,
            clientSecret: appleClientSecret,
        };
    }

    return betterAuth({
        socialProviders,
        // disable logging when createAuth is called just to generate options.
        // this is not required, but there's a lot of noise in logs without it.
        logger: {
            disabled: optionsOnly,
        },
        trustedOrigins: [siteUrl, "myapp://"],
        database: authComponent.adapter(ctx),
        // Configure simple, non-verified email/password to get started
        emailAndPassword: {
            enabled: true,
            requireEmailVerification: false,
        },
        plugins: [
            // The Expo and Convex plugins are required
            anonymous(),
            expo(),
            convex(),
            crossDomain({ siteUrl }),
        ],
    });
};
