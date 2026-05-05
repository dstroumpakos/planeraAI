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
 * Test sending the redesigned welcome email as raw HTML (bypasses Postmark template).
 * Use this to preview the new design before uploading the template to the Postmark dashboard.
 */
export const testWelcomeEmailRaw = action({
  args: {
    to: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    const apiToken = process.env.POSTMARK_SERVER_TOKEN;
    if (!apiToken) return { success: false, error: "POSTMARK_SERVER_TOKEN not set" };

    const name = args.name || "there";
    const product_name = "Planera";
    const product_url = "https://planeraai.app";

    const htmlBody = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>Welcome to ${product_name}</title>
<!--[if mso]><style>table,td,div,h1,p{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#FAF9F6;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;font-size:1px;color:#FAF9F6;line-height:1px;">
Your AI travel co-pilot is ready. Plan your first trip in under 60 seconds. ✈️
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:20px;box-shadow:0 4px 24px rgba(26,26,26,0.06);overflow:hidden;">
      <tr><td style="padding:32px 40px 0;">
        <a href="${product_url}" style="text-decoration:none;display:inline-block;"><img src="https://planeraai.app/logo.png" alt="${product_name}" width="140" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;text-decoration:none;" /></a>
      </td></tr>
      <tr><td style="padding:24px 40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8A8A8A;">Welcome aboard ✈</p>
        <h1 style="margin:0 0 12px;font-size:34px;line-height:1.15;font-weight:800;color:#1A1A1A;letter-spacing:-1px;">Hey ${name}, the world just got smaller.</h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#4A4A4A;">You just joined thousands of travelers who plan in minutes — not weeks. Tell ${product_name} where you want to go, and your AI co-pilot will handle the rest: itineraries, flights, hidden gems, the lot.</p>
      </td></tr>
      <tr><td align="center" style="padding:0 40px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center" style="border-radius:999px;background:#FFE500;">
            <a href="${product_url}" style="display:inline-block;padding:16px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#1A1A1A;text-decoration:none;border-radius:999px;letter-spacing:0.2px;">Plan my first trip →</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:8px 40px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0;font-size:13px;color:#8A8A8A;">Takes under 60 seconds. No credit card.</p>
      </td></tr>
      <tr><td style="padding:0 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1A1A1A;">What you can do today</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:14px;margin-bottom:10px;"><tr><td style="padding:18px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="40" style="vertical-align:top;font-size:22px;line-height:1;">🤖</td>
          <td style="vertical-align:top;"><p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1A1A1A;">Generate full itineraries with AI</p><p style="margin:0;font-size:14px;line-height:1.5;color:#4A4A4A;">Day-by-day plans tuned to your style, budget &amp; pace.</p></td>
        </tr></table></td></tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:14px;margin-bottom:10px;"><tr><td style="padding:18px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="40" style="vertical-align:top;font-size:22px;line-height:1;">📍</td>
          <td style="vertical-align:top;"><p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1A1A1A;">Discover hidden gems &amp; local insights</p><p style="margin:0;font-size:14px;line-height:1.5;color:#4A4A4A;">Real recommendations from travelers who’ve been there — not tourist traps.</p></td>
        </tr></table></td></tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:14px;margin-bottom:10px;"><tr><td style="padding:18px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="40" style="vertical-align:top;font-size:22px;line-height:1;">📡</td>
          <td style="vertical-align:top;"><p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1A1A1A;">Catch fare drops while you sleep</p><p style="margin:0;font-size:14px;line-height:1.5;color:#4A4A4A;">Low-fare radar pings you the moment your route gets cheap.</p></td>
        </tr></table></td></tr></table>
      </td></tr>
      <tr><td style="padding:24px 40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFBE0;border-radius:14px;border-left:4px solid #FFE500;"><tr><td style="padding:18px 22px;">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1A1A1A;">⚡ Pro tip</p>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#4A4A4A;">Already dreaming of somewhere? Just type <em>"5 days in Lisbon, mid-budget, food &amp; sunsets"</em> — Planera takes it from there.</p>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:32px 40px;border-top:1px solid #EFEDE7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;">
        <p style="margin:0 0 10px;font-size:13px;color:#4A4A4A;">Hit reply — a real human will read it. Or write us at <a href="mailto:support@planeraai.app" style="color:#1A1A1A;font-weight:600;text-decoration:underline;">support@planeraai.app</a></p>
        <p style="margin:0 0 4px;font-size:13px;color:#1A1A1A;font-weight:600;">${product_name} — travel smarter, plan better.</p>
        <p style="margin:0;font-size:12px;color:#9B9B9B;">You're getting this because you signed up for ${product_name}.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

    const textBody = `Hey ${name}, the world just got smaller.

You just joined thousands of travelers who plan in minutes — not weeks. Tell ${product_name} where you want to go, and your AI co-pilot will handle the rest: itineraries, flights, hidden gems, the lot.

Plan my first trip → ${product_url}

WHAT YOU CAN DO TODAY
- Generate full itineraries with AI — day-by-day plans tuned to your style, budget & pace
- Discover hidden gems & local insights — real recommendations from travelers who've been there
- Catch fare drops while you sleep — low-fare radar pings you the moment your route gets cheap

PRO TIP: Already dreaming of somewhere? Just type "5 days in Lisbon, mid-budget, food & sunsets" — Planera takes it from there.

Need help? Hit reply or write to support@planeraai.app
${product_name} — travel smarter, plan better.`;

    try {
      const response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": apiToken,
        },
        body: JSON.stringify({
          From: SENDER_EMAIL,
          To: args.to,
          Subject: `Welcome to ${product_name}, ${name} ✈`,
          HtmlBody: htmlBody,
          TextBody: textBody,
          MessageStream: MESSAGE_STREAM,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        return { success: false, error: result.Message || `HTTP ${response.status}` };
      }
      return { success: true, messageId: result.MessageID };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Unknown error" };
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

/**
 * Send welcome email to new users using Postmark template
 */
export const sendWelcomeEmail = internalAction({
  args: {
    to: v.string(),
    name: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const apiToken = process.env.POSTMARK_SERVER_TOKEN;

    if (!apiToken) {
      console.error("❌ [POSTMARK] POSTMARK_SERVER_TOKEN not set, skipping welcome email");
      return { success: false, error: "Email service not configured" };
    }

    try {
      console.log(`📧 [POSTMARK] Sending welcome email to ${args.to} using template: welcome`);

      const payload = {
        From: SENDER_EMAIL,
        To: args.to,
        TemplateAlias: "welcome",
        TemplateModel: {
          name: args.name,
          product_name: "Planera",
          product_url: "https://planeraai.app",
        },
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
        console.error(`❌ [POSTMARK] Welcome email failed:`, result);
        return { success: false, error: result.Message || "Failed to send email" };
      }

      console.log(`✅ [POSTMARK] Welcome email sent to ${args.to} - MessageID: ${result.MessageID}`);
      return { success: true, messageId: result.MessageID };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ [POSTMARK] Welcome email error:", errorMessage);
      return { success: false, error: errorMessage };
    }
  },
});

/**
 * Send account deletion confirmation email via Postmark
 */
export const sendAccountDeletionEmail = internalAction({
  args: {
    to: v.string(),
    name: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const apiToken = process.env.POSTMARK_SERVER_TOKEN;

    if (!apiToken) {
      console.error("❌ [POSTMARK] POSTMARK_SERVER_TOKEN not set, skipping deletion email");
      return { success: false, error: "POSTMARK_SERVER_TOKEN not set" };
    }

    try {
      const userName = args.name || "there";
      const year = new Date().getFullYear();
      console.log(`📧 [POSTMARK] Sending account deletion email to ${args.to}`);

      // Brand: cream #FAF9F6, charcoal #1A1A1A, yellow accent #FFE500
      // Bulletproof, mobile-first, table-based layout — Outlook safe.
      const htmlBody = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>Your Planera account has been deleted</title>
<!--[if mso]><style>table,td,div,h1,p{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#FAF9F6;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;font-size:1px;color:#FAF9F6;line-height:1px;">
Your account and all associated data have been permanently removed. The door's still open if you ever come back. ✈️
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:20px;box-shadow:0 4px 24px rgba(26,26,26,0.06);overflow:hidden;">
      <tr><td style="padding:40px 40px 8px;">
        <a href="https://planeraai.app" style="text-decoration:none;display:inline-block;"><img src="https://planeraai.app/logo.png" alt="Planera" width="140" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;text-decoration:none;" /></a>
      </td></tr>
      <tr><td style="padding:24px 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <h1 style="margin:0 0 12px;font-size:26px;line-height:1.25;font-weight:800;color:#1A1A1A;letter-spacing:-0.5px;">Your account has been deleted</h1>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1A1A1A;">Hi ${userName},</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#4A4A4A;">As requested, your Planera account and everything tied to it have been permanently removed from our systems.</p>
      </td></tr>
      <tr><td style="padding:0 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:14px;border-left:4px solid #FFE500;">
          <tr><td style="padding:20px 22px;">
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#1A1A1A;">What we deleted</p>
            <p style="margin:0;font-size:15px;line-height:1.8;color:#1A1A1A;">
              ✓ Your profile &amp; account settings<br/>
              ✓ All saved trips and itineraries<br/>
              ✓ Bookings &amp; traveler profiles<br/>
              ✓ Insights, preferences &amp; activity<br/>
              ✓ Session and authentication data
            </p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:24px 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4A4A4A;">This is permanent — we kept no copies. If you ever want to plan with us again, the door's open and your next trip is one tap away.</p>
      </td></tr>
      <tr><td align="center" style="padding:8px 40px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center" style="border-radius:999px;background:#1A1A1A;">
            <a href="https://planeraai.app" style="display:inline-block;padding:14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;letter-spacing:0.2px;">Come back to Planera</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 40px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#8A8A8A;">Didn't request this? Email us right away at <a href="mailto:support@planeraai.app" style="color:#1A1A1A;font-weight:600;text-decoration:underline;">support@planeraai.app</a> and we'll investigate.</p>
      </td></tr>
      <tr><td style="padding:24px 40px 32px;border-top:1px solid #EFEDE7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;">
        <p style="margin:0 0 6px;font-size:13px;color:#1A1A1A;font-weight:600;">Planera — travel smarter, plan better.</p>
        <p style="margin:0;font-size:12px;color:#9B9B9B;">© ${year} Planera. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

      const textBody = `PLANERA

Your account has been deleted

Hi ${userName},

As requested, your Planera account and everything tied to it have been permanently removed from our systems.

WHAT WE DELETED
- Your profile & account settings
- All saved trips and itineraries
- Bookings & traveler profiles
- Insights, preferences & activity
- Session and authentication data

This is permanent — we kept no copies. If you ever want to plan with us again, the door's open: https://planeraai.app

Didn't request this? Email us right away at support@planeraai.app and we'll investigate.

Planera — travel smarter, plan better.
© ${year} Planera. All rights reserved.`;

      const response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": apiToken,
        },
        body: JSON.stringify({
          From: SENDER_EMAIL,
          To: args.to,
          Subject: "Your Planera account has been deleted ✓",
          HtmlBody: htmlBody,
          TextBody: textBody,
          MessageStream: MESSAGE_STREAM,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error(`❌ [POSTMARK] Account deletion email error (${response.status}):`, result);
        return { success: false, error: result.Message || `HTTP ${response.status}` };
      }

      console.log(`✅ [POSTMARK] Account deletion email sent to ${args.to} - MessageID: ${result.MessageID}`);
      return { success: true };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ [POSTMARK] Account deletion email error:", errorMessage);
      return { success: false, error: errorMessage };
    }
  },
});
