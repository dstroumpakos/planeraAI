import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Register Better Auth routes (REQUIRED - do not remove)
authComponent.registerRoutes(http, createAuth, { cors: true });

// CORS headers for booking endpoint
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

// OPTIONS /booking - CORS preflight
http.route({
    path: "/booking",
    method: "OPTIONS",
    handler: httpAction(async () => {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    }),
});

// GET /booking?token=... - Fetch booking details by token
http.route({
    path: "/booking",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");

        // Check if token is provided
        if (!token) {
            return new Response(
                JSON.stringify({ error: "Missing token parameter" }),
                {
                    status: 400,
                    headers: {
                        "Content-Type": "application/json",
                        ...corsHeaders,
                    },
                }
            );
        }

        // Call the internal query to get booking details
        const result = await ctx.runQuery(internal.bookingLinks.getBookingByToken, { token });

        if (!result.success) {
            return new Response(
                JSON.stringify({ error: result.error }),
                {
                    status: 404,
                    headers: {
                        "Content-Type": "application/json",
                        ...corsHeaders,
                    },
                }
            );
        }

        // Return the booking data
        return new Response(
            JSON.stringify(result.booking),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders,
                },
            }
        );
    }),
});

export default http;
