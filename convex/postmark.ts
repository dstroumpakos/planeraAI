"use node";

/**
 * Postmark Email Service
 * Sends transactional emails using Postmark templates
 */

import { internalAction, action } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { makeFunctionReference } from "convex/server";

// Define the booking structure returned by getBookingForEmail
interface BookingForEmail {
  bookingReference: string;
  outboundFlight: {
    airline: string;
    flightNumber?: string;
    departure?: string;
    arrival?: string;
    departureDate: string;
    departureTime?: string;
    arrivalTime?: string;
    departureAirport?: string;
    arrivalAirport?: string;
    origin: string;
    destination: string;
  };
  returnFlight?: {
    airline: string;
    flightNumber?: string;
    departure?: string;
    arrival?: string;
    departureDate: string;
    departureTime?: string;
    arrivalTime?: string;
    departureAirport?: string;
    arrivalAirport?: string;
    origin: string;
    destination: string;
  };
  passengers: Array<{
    givenName: string;
    familyName: string;
    email?: string;
  }>;
  totalAmount: number;
  currency: string;
  confirmationEmailSentAt?: number;
}

// Create typed function references
const getBookingForEmailRef = makeFunctionReference<
  "query",
  { bookingId: Id<"flightBookings"> },
  BookingForEmail | null
>("emailHelpers:getBookingForEmail");

const markConfirmationEmailSentRef = makeFunctionReference<
  "mutation",
  { bookingId: Id<"flightBookings"> },
  null
>("emailHelpers:markConfirmationEmailSent");

// Function reference for sendTemplateEmail (to avoid circular reference)
const sendTemplateEmailRef = makeFunctionReference<
  "action",
  { to: string; templateAlias: string; templateModel: Record<string, string> },
  { success: boolean; messageId?: string; errorCode?: number; error?: string }
>("postmark:sendTemplateEmail");

// Postmark API constants
const POSTMARK_API_URL = "https://api.postmarkapp.com/email/withTemplate";
const SENDER_EMAIL = "Planera <support@planeraai.app>";
const MESSAGE_STREAM = "outbound";

/**
 * Receipt template model type - uses Record for compatibility
 */
type ReceiptTemplateModel = Record<string, string>;

/**
 * Validate required template model keys
 */
function validateTemplateModel(model: Record<string, string>): string[] {
  const requiredKeys: string[] = [
    "product_url",
    "product_name",
    "pnr",
    "airline",
    "outbound_date",
    "outbound_depart_time",
    "outbound_depart_airport",
    "outbound_stops",
    "outbound_arrive_time",
    "outbound_arrive_airport",
    "outbound_flight_number",
    "passenger_name",
    "total_paid",
    "view_booking_url",
    "company_name",
    "company_address",
    "receipt_id",
    "date",
    "support_url",
  ];

  const missingKeys: string[] = [];
  for (const key of requiredKeys) {
    if (!model[key] || model[key].trim() === "") {
      missingKeys.push(key);
    }
  }
  return missingKeys;
}

/**
 * Format date for display (e.g., "Mon, Jan 15, 2024")
 */
function formatDisplayDate(dateString: string): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

/**
 * Format time from ISO string (e.g., "14:30")
 */
function formatTime(isoString: string | undefined): string {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

/**
 * Format currency for display
 */
function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

/**
 * Generate receipt ID from booking reference and timestamp
 */
function generateReceiptId(bookingReference: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  return `RCP-${bookingReference}-${timestamp}`;
}

/**
 * Send email using Postmark template
 */
export const sendTemplateEmail = internalAction({
  args: {
    to: v.string(),
    templateAlias: v.string(),
    templateModel: v.record(v.string(), v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.optional(v.string()),
    errorCode: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const apiToken = process.env.POSTMARK_SERVER_TOKEN;

    if (!apiToken) {
      console.error("❌ [POSTMARK] POSTMARK_SERVER_TOKEN environment variable is not set");
      return {
        success: false,
        error: "POSTMARK_SERVER_TOKEN environment variable is required but not set",
      };
    }

    try {
      console.log(`📧 [POSTMARK] Sending template email to ${args.to} using template: ${args.templateAlias}`);

      const payload = {
        From: SENDER_EMAIL,
        To: args.to,
        TemplateAlias: args.templateAlias,
        TemplateModel: args.templateModel,
        MessageStream: MESSAGE_STREAM,
      };

      console.log(`📧 [POSTMARK] Request payload:`, JSON.stringify(payload, null, 2));

      const response = await fetch(POSTMARK_API_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": apiToken,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error(`❌ [POSTMARK] API error (${response.status}):`, result);
        return {
          success: false,
          errorCode: result.ErrorCode,
          error: result.Message || `HTTP ${response.status}`,
        };
      }

      console.log(`✅ [POSTMARK] Email sent successfully - MessageID: ${result.MessageID}`);
      console.log(`📧 [POSTMARK] Response:`, JSON.stringify(result));

      return {
        success: true,
        messageId: result.MessageID,
      };
    } catch (error) {
      console.error("❌ [POSTMARK] Exception:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error sending email",
      };
    }
  },
});

/**
 * Send flight booking receipt email using Postmark "receipt" template
 */
export const sendBookingReceiptEmail = internalAction({
  args: {
    bookingId: v.id("flightBookings"),
    bookingUrl: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    alreadySent: v.optional(v.boolean()),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
    templateModel: v.optional(v.record(v.string(), v.string())),
    bookingUrl: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    console.log(`📧 [POSTMARK] Starting receipt email for booking: ${args.bookingId}`);
    if (args.bookingUrl) {
      console.log(`📧 [POSTMARK] Using booking URL: ${args.bookingUrl}`);
    }

    try {
      // Get the booking
      console.log(`📧 [POSTMARK] Fetching booking data...`);
      const booking = await ctx.runQuery(getBookingForEmailRef, {
        bookingId: args.bookingId,
      });

      if (!booking) {
        console.error(`📧 [POSTMARK] ❌ Booking not found: ${args.bookingId}`);
        return { success: false, error: "Booking not found" };
      }

      console.log(`📧 [POSTMARK] Booking found - Reference: ${booking.bookingReference}`);

      // Idempotency check
      if (booking.confirmationEmailSentAt) {
        console.log(`📧 [POSTMARK] ⚠️ Email already sent - skipping`);
        return { success: true, alreadySent: true, bookingUrl: args.bookingUrl };
      }

      // Find primary passenger email
      const primaryPassenger = booking.passengers.find((p: { email?: string }) => p.email);
      if (!primaryPassenger?.email) {
        console.error(`📧 [POSTMARK] ❌ No passenger email found`);
        return { success: false, error: "No passenger email found" };
      }

      console.log(`📧 [POSTMARK] Primary passenger: ${primaryPassenger.givenName} ${primaryPassenger.familyName}`);

      // Build the template model
      const isRoundTrip = !!booking.returnFlight;
      const outbound = booking.outboundFlight;
      const returnFlight = booking.returnFlight;

      // Use secure booking URL if provided, otherwise fallback to legacy URL
      const viewBookingUrl = args.bookingUrl || `https://planeraai.app/bookings/${args.bookingId}`;

      const templateModel: ReceiptTemplateModel = {
        // Product info
        product_url: "https://planeraai.app",
        product_name: "Planera",

        // Booking reference
        pnr: booking.bookingReference || "PENDING",
        airline: outbound.airline || "Airline",

        // Outbound flight
        outbound_date: formatDisplayDate(outbound.departureDate),
        outbound_depart_time: outbound.departure || formatTime(outbound.departureTime),
        outbound_depart_airport: outbound.departureAirport || outbound.origin || "",
        outbound_stops: "Direct",
        outbound_arrive_time: outbound.arrival || formatTime(outbound.arrivalTime),
        outbound_arrive_airport: outbound.arrivalAirport || outbound.destination || "",
        outbound_flight_number: outbound.flightNumber || "",

        // Return flight (empty strings if one-way)
        return_date: isRoundTrip && returnFlight ? formatDisplayDate(returnFlight.departureDate) : "",
        return_depart_time: isRoundTrip && returnFlight ? (returnFlight.departure || formatTime(returnFlight.departureTime)) : "",
        return_depart_airport: isRoundTrip && returnFlight ? (returnFlight.departureAirport || returnFlight.origin || "") : "",
        return_stops: isRoundTrip ? "Direct" : "",
        return_arrive_time: isRoundTrip && returnFlight ? (returnFlight.arrival || formatTime(returnFlight.arrivalTime)) : "",
        return_arrive_airport: isRoundTrip && returnFlight ? (returnFlight.arrivalAirport || returnFlight.destination || "") : "",
        return_flight_number: isRoundTrip && returnFlight ? (returnFlight.flightNumber || "") : "",

        // Passenger and payment
        passenger_name: `${primaryPassenger.givenName} ${primaryPassenger.familyName}`.toUpperCase(),
        total_paid: formatCurrency(booking.totalAmount, booking.currency),

        // Action URLs - use secure booking URL
        view_booking_url: viewBookingUrl,
        download_pdf_url: `${viewBookingUrl}&action=pdf`,
        add_to_calendar_url: `${viewBookingUrl}&action=calendar`,

        // Company info
        company_name: "Planera",
        company_address: "support@planeraai.app",

        // Receipt details
        receipt_id: generateReceiptId(booking.bookingReference || "BOOK"),
        date: formatDisplayDate(new Date().toISOString()),

        // Support
        support_url: "mailto:support@planeraai.app",
      };

      // Validate required keys
      const missingKeys = validateTemplateModel(templateModel as unknown as Record<string, string>);
      if (missingKeys.length > 0) {
        console.warn(`📧 [POSTMARK] ⚠️ Missing template keys: ${missingKeys.join(", ")}`);
      }

      console.log(`📧 [POSTMARK] Template model:`, JSON.stringify(templateModel, null, 2));

      // Send via Postmark
      const result = await ctx.runAction(sendTemplateEmailRef, {
        to: primaryPassenger.email,
        templateAlias: "receipt",
        templateModel,
      });

      if (result.success) {
        // Mark as sent for idempotency
        await ctx.runMutation(markConfirmationEmailSentRef, {
          bookingId: args.bookingId,
        });
        console.log(`📧 [POSTMARK] ✅ Receipt email sent to ${primaryPassenger.email}`);
      } else {
        console.error(`📧 [POSTMARK] ❌ Failed: ${result.error}`);
      }

      return {
        ...result,
        templateModel,
        bookingUrl: args.bookingUrl,
      };
    } catch (error) {
      console.error("📧 [POSTMARK] ❌ Exception:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Test sending a receipt email (for development/testing)
 */
export const testReceiptEmail = action({
  args: {
    to: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
    templateModel: v.optional(v.record(v.string(), v.string())),
  }),
  handler: async (ctx, args) => {
    console.log(`🧪 [POSTMARK] Testing receipt email to ${args.to}`);

    // Example test payload
    const templateModel: ReceiptTemplateModel = {
      product_url: "https://planeraai.app",
      product_name: "Planera",
      
      pnr: "ABC123",
      airline: "Duffel Airways",

      outbound_date: "Mon, Jan 27, 2025",
      outbound_depart_time: "08:30",
      outbound_depart_airport: "LHR - London Heathrow",
      outbound_stops: "Direct",
      outbound_arrive_time: "11:45",
      outbound_arrive_airport: "CDG - Paris Charles de Gaulle",
      outbound_flight_number: "DA 1234",

      return_date: "Fri, Jan 31, 2025",
      return_depart_time: "19:00",
      return_depart_airport: "CDG - Paris Charles de Gaulle",
      return_stops: "Direct",
      return_arrive_time: "19:15",
      return_arrive_airport: "LHR - London Heathrow",
      return_flight_number: "DA 5678",

      passenger_name: "JOHN DOE",
      total_paid: "$450.00",

      view_booking_url: "https://planeraai.app/bookings/test",
      download_pdf_url: "https://planeraai.app/bookings/test/pdf",
      add_to_calendar_url: "https://planeraai.app/bookings/test/calendar",

      company_name: "Planera",
      company_address: "support@planeraai.app",

      receipt_id: "RCP-ABC123-TEST",
      date: formatDisplayDate(new Date().toISOString()),

      support_url: "mailto:support@planeraai.app",
    };

    const result = await ctx.runAction(sendTemplateEmailRef, {
      to: args.to,
      templateAlias: "receipt",
      templateModel,
    });

    return {
      ...result,
      templateModel,
    };
  },
});
