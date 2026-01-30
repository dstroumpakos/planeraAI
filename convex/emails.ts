"use node";

/**
 * Email Service using Gmail API
 * Sends transactional emails from support@planeraai.app
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { makeFunctionReference } from "convex/server";

// Define the booking structure returned by getBookingForEmail
interface BookingForEmail {
  bookingReference: string;
  outboundFlight: {
    airline: string;
    flightNumber: string;
    departure: string;
    arrival: string;
    departureDate: string;
    departureAirport?: string;
    arrivalAirport?: string;
    origin: string;
    destination: string;
    duration?: string;
    cabinClass?: string;
  };
  returnFlight?: {
    airline: string;
    flightNumber: string;
    departure: string;
    arrival: string;
    departureDate: string;
    departureAirport?: string;
    arrivalAirport?: string;
    origin: string;
    destination: string;
    duration?: string;
    cabinClass?: string;
  };
  passengers: Array<{
    givenName: string;
    familyName: string;
    email?: string;
  }>;
  totalAmount: number;
  currency: string;
  policies?: {
    canChange: boolean;
    canRefund: boolean;
    changePolicy: string;
    refundPolicy: string;
  };
  includedBaggage?: Array<{
    passengerName?: string;
    cabinBags?: bigint;
    checkedBags?: bigint;
  }>;
  confirmationEmailSentAt?: number;
}

// Create typed function references to avoid circular dependency issues
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

const sendEmailRef = makeFunctionReference<
  "action",
  { to: string; subject: string; html: string; text?: string },
  { success: boolean; messageId?: string; error?: string }
>("emails:sendEmail");

// Gmail API constants
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * Refresh Gmail access token using refresh token
 */
async function getAccessToken(): Promise<string> {
  // Use GMAIL-specific credentials (separate from Google Sign-In OAuth)
  // Falls back to GOOGLE_ prefixed vars for backward compatibility
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Gmail OAuth credentials. Required: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN " +
      "(or legacy: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)"
    );
  }

  const response = await fetch(GMAIL_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Create RFC 2822 formatted email message
 */
function createMimeMessage({
  to,
  from,
  subject,
  html,
  text,
}: {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
}): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const plainText = text || html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

  const message = [
    `From: Planera <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    plainText,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  return message;
}

/**
 * Base64url encode (Gmail API requirement)
 */
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Send email via Gmail API
 */
export const sendEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    text: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const senderEmail = process.env.GOOGLE_SENDER_EMAIL || "support@planeraai.app";
      
      // Get fresh access token
      const accessToken = await getAccessToken();

      // Create MIME message
      const mimeMessage = createMimeMessage({
        to: args.to,
        from: senderEmail,
        subject: args.subject,
        html: args.html,
        text: args.text,
      });

      // Base64url encode
      const encodedMessage = base64UrlEncode(mimeMessage);

      // Send via Gmail API
      const response = await fetch(GMAIL_SEND_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          raw: encodedMessage,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("Gmail API error:", error);
        return {
          success: false,
          error: `Gmail API error: ${response.status} - ${error}`,
        };
      }

      const result = await response.json();
      console.log(`✉️ Email sent successfully to ${args.to}, messageId: ${result.id}`);

      return {
        success: true,
        messageId: result.id,
      };
    } catch (error) {
      console.error("Send email error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error sending email",
      };
    }
  },
});

/**
 * Format date for display in email
 */
function formatEmailDate(dateString: string): string {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
 * Generate flight confirmation email HTML
 */
function generateFlightConfirmationEmail(booking: {
  bookingReference: string;
  passengerName: string;
  outboundFlight: {
    airline: string;
    flightNumber: string;
    departure: string;
    arrival: string;
    departureDate: string;
    departureAirport?: string;
    arrivalAirport?: string;
    origin: string;
    destination: string;
    duration?: string;
    cabinClass?: string;
  };
  returnFlight?: {
    airline: string;
    flightNumber: string;
    departure: string;
    arrival: string;
    departureDate: string;
    departureAirport?: string;
    arrivalAirport?: string;
    origin: string;
    destination: string;
    duration?: string;
    cabinClass?: string;
  };
  passengers: Array<{ givenName: string; familyName: string }>;
  totalAmount: number;
  currency: string;
  policies?: {
    canChange: boolean;
    canRefund: boolean;
    changePolicy: string;
    refundPolicy: string;
  };
  includedBaggage?: Array<{
    passengerName?: string;
    cabinBags?: number;
    checkedBags?: number;
  }>;
}): { html: string; text: string } {
  const airlineName = booking.outboundFlight.airline;
  const isRoundTrip = !!booking.returnFlight;

  // Generate passengers HTML
  const passengersHtml = booking.passengers
    .map(p => `<p>👤 <strong>${p.givenName.toUpperCase()} ${p.familyName.toUpperCase()}</strong></p>`)
    .join("");

  // Return flight card HTML
  const returnFlightHtml = booking.returnFlight
    ? `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;">
        <strong>Return · ${formatEmailDate(booking.returnFlight.departureDate)}</strong>
        <p style="margin:8px 0 0;">
          <strong>${booking.returnFlight.departure} ${booking.returnFlight.origin}</strong> → <strong>${booking.returnFlight.arrival} ${booking.returnFlight.destination}</strong><br/>
          Direct · ${booking.returnFlight.airline} · ${booking.returnFlight.flightNumber}
        </p>
      </div>
    `
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Booking Confirmed</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>

<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0"
style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<!-- Header -->
<tr>
<td style="background:#0b1220;padding:24px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:22px;">✈️ Booking Confirmed</h1>
<p style="margin:6px 0 0;color:#c7d2fe;font-size:14px;">
Your flight has been successfully booked
</p>
</td>
</tr>

<!-- PNR -->
<tr>
<td style="padding:24px;text-align:center;">
<p style="margin:0;color:#6b7280;font-size:13px;">Airline Booking Reference</p>
<h2 style="margin:6px 0;letter-spacing:3px;">${booking.bookingReference}</h2>
<p style="margin:0;color:#9ca3af;">${airlineName}</p>
</td>
</tr>

<!-- Info -->
<tr>
<td style="padding:0 24px 24px;">
<div style="background:#f1f5f9;border-radius:10px;padding:16px;font-size:14px;">
<strong>ℹ️ Check-in Required</strong>
<p style="margin:8px 0 0;color:#475569;">
Check-in is completed on the ${airlineName} website or mobile app using your
booking reference (PNR) and last name.
</p>
</div>
</td>
</tr>

<!-- Itinerary -->
<tr>
<td style="padding:0 24px 24px;">
<h3 style="margin-bottom:12px;">${isRoundTrip ? "Round Trip" : "One Way"} Flight Itinerary</h3>

<div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:12px;">
<strong>Outbound · ${formatEmailDate(booking.outboundFlight.departureDate)}</strong>
<p style="margin:8px 0 0;">
<strong>${booking.outboundFlight.departure} ${booking.outboundFlight.origin}</strong> → <strong>${booking.outboundFlight.arrival} ${booking.outboundFlight.destination}</strong><br/>
Direct · ${booking.outboundFlight.airline} · ${booking.outboundFlight.flightNumber}
</p>
</div>

${returnFlightHtml}

</td>
</tr>

<!-- Passenger -->
<tr>
<td style="padding:0 24px 24px;">
<h3>Passengers</h3>
${passengersHtml}
</td>
</tr>

<!-- Payment -->
<tr>
<td style="padding:0 24px 24px;">
<h3>Total Paid</h3>
<p style="font-size:18px;"><strong>${formatCurrency(booking.totalAmount, booking.currency)}</strong></p>
</td>
</tr>

<!-- CTA -->
<tr>
<td style="padding:0 24px 32px;text-align:center;">
<a href="https://planera.app" style="background:#111827;color:#ffffff;padding:12px 20px;
border-radius:8px;text-decoration:none;display:inline-block;">
View Booking in App
</a>
</td>
</tr>

<!-- Footer -->
<tr>
<td style="border-top:1px solid #e5e7eb;padding:16px 24px;font-size:12px;color:#6b7280;">
Questions about your booking?<br/>
Contact us at <a href="mailto:support@planeraai.app">support@planeraai.app</a><br/><br/>
© ${new Date().getFullYear()} Planera. All rights reserved.
</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>`;

  // Plain text version
  const text = `
BOOKING CONFIRMED

Your flight has been successfully booked.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AIRLINE BOOKING REFERENCE
${booking.bookingReference}
${airlineName}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CHECK-IN REQUIRED
Check-in is completed on the ${airlineName} website or mobile app using your booking reference (PNR) and last name.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${isRoundTrip ? "ROUND TRIP" : "ONE WAY"} FLIGHT ITINERARY

OUTBOUND · ${formatEmailDate(booking.outboundFlight.departureDate)}
${booking.outboundFlight.departure} ${booking.outboundFlight.origin} → ${booking.outboundFlight.arrival} ${booking.outboundFlight.destination}
Direct · ${booking.outboundFlight.airline} · ${booking.outboundFlight.flightNumber}

${booking.returnFlight ? `RETURN · ${formatEmailDate(booking.returnFlight.departureDate)}
${booking.returnFlight.departure} ${booking.returnFlight.origin} → ${booking.returnFlight.arrival} ${booking.returnFlight.destination}
Direct · ${booking.returnFlight.airline} · ${booking.returnFlight.flightNumber}
` : ""}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PASSENGERS
${booking.passengers.map(p => `• ${p.givenName.toUpperCase()} ${p.familyName.toUpperCase()}`).join("\n")}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOTAL PAID: ${formatCurrency(booking.totalAmount, booking.currency)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Questions about your booking?
support@planeraai.app

© ${new Date().getFullYear()} Planera. All rights reserved.
  `.trim();

  return { html, text };
}

/**
 * Send flight booking confirmation email
 * Includes idempotency check - won't send duplicate emails
 */
export const sendFlightConfirmationEmail = internalAction({
  args: {
    bookingId: v.id("flightBookings"),
  },
  returns: v.object({
    success: v.boolean(),
    alreadySent: v.optional(v.boolean()),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    console.log(`📧 [EMAIL] Starting confirmation email for booking: ${args.bookingId}`);
    
    try {
      // Get the booking
      console.log(`📧 [EMAIL] Fetching booking data...`);
      const booking = await ctx.runQuery(getBookingForEmailRef, {
        bookingId: args.bookingId,
      });

      if (!booking) {
        console.error(`📧 [EMAIL] ❌ Booking not found: ${args.bookingId}`);
        return { success: false, error: "Booking not found" };
      }
      
      console.log(`📧 [EMAIL] Booking found - Reference: ${booking.bookingReference}, Passengers: ${booking.passengers?.length || 0}`);

      // Idempotency check - don't send if already sent
      if (booking.confirmationEmailSentAt) {
        console.log(`📧 [EMAIL] ⚠️ Email already sent at ${new Date(booking.confirmationEmailSentAt).toISOString()} - skipping`);
        return { success: true, alreadySent: true };
      }

      // Find the primary passenger email (first passenger with email)
      const primaryPassenger = booking.passengers.find((p: { email?: string }) => p.email);
      if (!primaryPassenger || !primaryPassenger.email) {
        console.error(`📧 [EMAIL] ❌ No passenger email found for booking ${args.bookingId}`);
        return { success: false, error: "No passenger email found" };
      }
      
      console.log(`📧 [EMAIL] Primary passenger: ${primaryPassenger.givenName} ${primaryPassenger.familyName} <${primaryPassenger.email}>`);

      // Generate email content
      console.log(`📧 [EMAIL] Generating email content...`);
      const { html, text } = generateFlightConfirmationEmail({
        bookingReference: booking.bookingReference || "PENDING",
        passengerName: `${primaryPassenger.givenName} ${primaryPassenger.familyName}`,
        outboundFlight: booking.outboundFlight,
        returnFlight: booking.returnFlight,
        passengers: booking.passengers,
        totalAmount: booking.totalAmount,
        currency: booking.currency,
        policies: booking.policies,
        includedBaggage: booking.includedBaggage?.map((b: { passengerName?: string; cabinBags?: bigint; checkedBags?: bigint }) => ({
          passengerName: b.passengerName,
          cabinBags: b.cabinBags !== undefined ? Number(b.cabinBags) : undefined,
          checkedBags: b.checkedBags !== undefined ? Number(b.checkedBags) : undefined,
        })),
      });

      const emailSubject = `Flight Confirmation - ${booking.outboundFlight.origin} to ${booking.outboundFlight.destination} | ${booking.bookingReference || "Planera"}`;
      console.log(`📧 [EMAIL] Sending email with subject: "${emailSubject}"`);
      
      // Send the email
      const result = await ctx.runAction(sendEmailRef, {
        to: primaryPassenger.email,
        subject: emailSubject,
        html,
        text,
      });

      console.log(`📧 [EMAIL] Send result:`, JSON.stringify(result));

      if (result.success) {
        // Mark email as sent (idempotency)
        await ctx.runMutation(markConfirmationEmailSentRef, {
          bookingId: args.bookingId,
        });
        console.log(`📧 [EMAIL] ✅ Confirmation email sent successfully to ${primaryPassenger.email}`);
      } else {
        console.error(`📧 [EMAIL] ❌ Failed to send email: ${result.error}`);
      }

      return result;
    } catch (error) {
      console.error("📧 [EMAIL] ❌ Exception in sendFlightConfirmationEmail:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
