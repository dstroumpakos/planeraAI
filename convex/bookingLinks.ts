import { mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Flight item structure for the flights array
const flightItemValidator = v.object({
    from: v.string(),
    to: v.string(),
    departureDateTime: v.string(),
    airline: v.string(),
    flightNumber: v.optional(v.string()),
    arrivalDateTime: v.optional(v.string()),
    duration: v.optional(v.string()),
});

/**
 * Get booking details by token (for public HTTP endpoint)
 * Returns flights[] array for round-trip/multi-segment support
 */
export const getBookingByToken = internalQuery({
    args: { token: v.string() },
    returns: v.union(
        v.object({
            success: v.literal(true),
            booking: v.object({
                status: v.string(),
                // Legacy fields for backward compatibility
                route: v.string(),
                pnr: v.string(),
                // New: Array of all flights
                flights: v.array(flightItemValidator),
                passengers: v.array(v.object({
                    firstName: v.string(),
                    lastName: v.string(),
                })),
                supportEmail: v.string(),
                // Additional booking details
                airline: v.optional(v.string()),
                departureDate: v.optional(v.string()),
                totalAmount: v.optional(v.string()),
            }),
        }),
        v.object({
            success: v.literal(false),
            error: v.string(),
        })
    ),
    handler: async (ctx, args) => {
        // Find the booking link by token
        const bookingLink = await ctx.db
            .query("bookingLinks")
            .withIndex("by_token", (q) => q.eq("token", args.token))
            .unique();

        if (!bookingLink) {
            return { success: false as const, error: "Invalid token" };
        }

        // Check if token has expired
        if (bookingLink.expiresAt < Date.now()) {
            return { success: false as const, error: "Token expired" };
        }

        // Get the actual flight booking
        const flightBooking = await ctx.db.get(bookingLink.bookingId);

        if (!flightBooking) {
            return { success: false as const, error: "Booking not found" };
        }

        // Build flights array from outbound and return flights
        const flights: Array<{
            from: string;
            to: string;
            departureDateTime: string;
            airline: string;
            flightNumber?: string;
            arrivalDateTime?: string;
            duration?: string;
        }> = [];

        // Add outbound flight
        if (flightBooking.outboundFlight) {
            const outbound = flightBooking.outboundFlight;
            flights.push({
                from: outbound.origin,
                to: outbound.destination,
                departureDateTime: outbound.departure || outbound.departureDate,
                airline: outbound.airline,
                flightNumber: outbound.flightNumber || undefined,
                arrivalDateTime: outbound.arrival || undefined,
                duration: outbound.duration || undefined,
            });
        }

        // Add return flight if exists
        if (flightBooking.returnFlight) {
            const returnFlt = flightBooking.returnFlight;
            flights.push({
                from: returnFlt.origin,
                to: returnFlt.destination,
                departureDateTime: returnFlt.departure || returnFlt.departureDate,
                airline: returnFlt.airline,
                flightNumber: returnFlt.flightNumber || undefined,
                arrivalDateTime: returnFlt.arrival || undefined,
                duration: returnFlt.duration || undefined,
            });
        }

        // Format the response
        const route = `${flightBooking.outboundFlight.origin} → ${flightBooking.outboundFlight.destination}`;
        const pnr = flightBooking.bookingReference || flightBooking.duffelOrderId.slice(-6).toUpperCase();

        return {
            success: true as const,
            booking: {
                status: flightBooking.status,
                route,
                pnr,
                flights,
                passengers: flightBooking.passengers.map((p) => ({
                    firstName: p.givenName,
                    lastName: p.familyName,
                })),
                supportEmail: "support@planeraai.app",
                airline: flightBooking.outboundFlight.airline,
                departureDate: flightBooking.outboundFlight.departureDate,
                totalAmount: `${flightBooking.currency} ${flightBooking.totalAmount.toFixed(2)}`,
            },
        };
    },
});

/**
 * Create a booking link.
 *
 * SECURITY: This is now an internal mutation. The legacy public mutation was
 * exploitable: anyone with a Convex deployment URL could call it with any
 * `Id<"flightBookings">` and mint a permanent token that exposed the
 * passenger names, route, PNR, and total price of someone else's booking.
 *
 * The booking flow now invokes this from the verified booking action only,
 * after auth + ownership checks have passed. (See `flightBooking.ts` and
 * `bookingDraft.ts`.)
 */
export const createBookingLink = internalMutation({
    args: {
        bookingId: v.id("flightBookings"),
        expiresInDays: v.optional(v.number()),
    },
    returns: v.object({
        token: v.string(),
        expiresAt: v.float64(),
    }),
    handler: async (ctx, args) => {
        // Generate a secure random token
        const token = generateSecureToken();

        // Default to 30 days expiration
        const expiresInMs = (args.expiresInDays || 30) * 24 * 60 * 60 * 1000;
        const expiresAt = Date.now() + expiresInMs;

        await ctx.db.insert("bookingLinks", {
            token,
            bookingId: args.bookingId,
            expiresAt,
            createdAt: Date.now(),
        });

        return { token, expiresAt };
    },
});

/**
 * Generate a secure random token (192 bits of entropy, base64url-encoded).
 */
function generateSecureToken(): string {
    // V8 runtime exposes WebCrypto via globalThis.crypto
    const bytes = new Uint8Array(24);
    (globalThis as any).crypto.getRandomValues(bytes);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    // base64url
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
