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
  const year = new Date().getFullYear();
  const firstName = (booking.passengers[0]?.givenName || "Traveler").split(" ")[0];
  const route = `${booking.outboundFlight.origin} → ${booking.outboundFlight.destination}${isRoundTrip ? " → " + booking.outboundFlight.origin : ""}`;

  // Helper: render a single flight leg as a structured "ticket" row
  const renderLeg = (label: string, leg: NonNullable<typeof booking.outboundFlight>) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:14px;margin-bottom:12px;">
          <tr><td style="padding:18px 22px;">
            <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8A8A8A;">${label} · ${formatEmailDate(leg.departureDate)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="42%" style="vertical-align:top;">
                  <p style="margin:0;font-size:30px;font-weight:800;color:#1A1A1A;letter-spacing:-1px;line-height:1;">${leg.origin}</p>
                  <p style="margin:6px 0 0;font-size:14px;color:#1A1A1A;font-weight:600;">${leg.departure || ""}</p>
                  <p style="margin:2px 0 0;font-size:12px;color:#8A8A8A;">${leg.departureAirport || ""}</p>
                </td>
                <td width="16%" align="center" style="vertical-align:middle;">
                  <p style="margin:0;font-size:18px;color:#FFE500;line-height:1;">✈</p>
                  <p style="margin:6px 0 0;font-size:11px;color:#8A8A8A;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Direct</p>
                </td>
                <td width="42%" align="right" style="vertical-align:top;">
                  <p style="margin:0;font-size:30px;font-weight:800;color:#1A1A1A;letter-spacing:-1px;line-height:1;">${leg.destination}</p>
                  <p style="margin:6px 0 0;font-size:14px;color:#1A1A1A;font-weight:600;">${leg.arrival || ""}</p>
                  <p style="margin:2px 0 0;font-size:12px;color:#8A8A8A;">${leg.arrivalAirport || ""}</p>
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0;padding-top:14px;border-top:1px dashed #E8E6E1;font-size:13px;color:#4A4A4A;">${leg.airline} · Flight <strong style="color:#1A1A1A;">${leg.flightNumber}</strong>${leg.cabinClass ? ` · ${leg.cabinClass}` : ""}</p>
          </td></tr>
        </table>`;

  const passengersList = booking.passengers
    .map(p => `<p style="margin:0 0 6px;font-size:15px;color:#1A1A1A;">✓ <strong>${p.givenName.toUpperCase()} ${p.familyName.toUpperCase()}</strong></p>`)
    .join("");

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>You're booked — ${route}</title>
<!--[if mso]><style>table,td,div,h1,p{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#FAF9F6;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;font-size:1px;color:#FAF9F6;line-height:1px;">
✈️ ${booking.bookingReference} — your seat is locked in. Tap to view your full itinerary anytime.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:20px;box-shadow:0 4px 24px rgba(26,26,26,0.06);overflow:hidden;">

      <!-- Brand header -->
      <tr><td style="padding:32px 40px 0;">
        <a href="https://planeraai.app" style="text-decoration:none;display:inline-block;"><img src="https://planeraai.app/logo.png" alt="Planera" width="140" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;text-decoration:none;" /></a>
      </td></tr>

      <!-- Hero -->
      <tr><td style="padding:24px 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8A8A8A;">Booking confirmed ✈</p>
        <h1 style="margin:0 0 8px;font-size:30px;line-height:1.2;font-weight:800;color:#1A1A1A;letter-spacing:-0.8px;">${firstName}, you're going to ${booking.outboundFlight.destination}.</h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#4A4A4A;">Your seat is locked in. Save this email — it's your proof of booking.</p>
      </td></tr>

      <!-- PNR ticket-stub card -->
      <tr><td style="padding:0 40px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1A1A1A;border-radius:16px;">
          <tr><td style="padding:22px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:top;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#FFE500;">Confirmation</p>
                  <p style="margin:0;font-size:26px;font-weight:800;letter-spacing:4px;color:#FFFFFF;font-family:'SF Mono',Menlo,Consolas,monospace;">${booking.bookingReference}</p>
                  <p style="margin:6px 0 0;font-size:12px;color:#9B9B9B;">${airlineName}</p>
                </td>
                <td align="right" style="vertical-align:top;">
                  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9B9B9B;">Total paid</p>
                  <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">${formatCurrency(booking.totalAmount, booking.currency)}</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Primary CTA -->
      <tr><td align="center" style="padding:0 40px 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center" style="border-radius:999px;background:#FFE500;">
            <a href="https://planeraai.app" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:#1A1A1A;text-decoration:none;border-radius:999px;letter-spacing:0.2px;">View itinerary in Planera</a>
          </td></tr>
        </table>
      </td></tr>

      <!-- Itinerary -->
      <tr><td style="padding:0 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1A1A1A;">${isRoundTrip ? "Round trip" : "One way"} itinerary</p>
        ${renderLeg("Outbound", booking.outboundFlight)}
        ${booking.returnFlight ? renderLeg("Return", booking.returnFlight) : ""}
      </td></tr>

      <!-- Passengers -->
      <tr><td style="padding:16px 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1A1A1A;">Passengers</p>
        ${passengersList}
      </td></tr>

      <!-- Check-in tip -->
      <tr><td style="padding:24px 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFBE0;border-radius:14px;border-left:4px solid #FFE500;">
          <tr><td style="padding:18px 22px;">
            <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1A1A1A;">⏰ Don't forget to check in</p>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#4A4A4A;">Online check-in usually opens 24h before departure. Use confirmation <strong style="color:#1A1A1A;">${booking.bookingReference}</strong> + your last name on the ${airlineName} website or app.</p>
          </td></tr>
        </table>
      </td></tr>

      <!-- Secondary upsell / engagement -->
      <tr><td style="padding:24px 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1A1A1A;">Plan the rest of your trip in seconds</p>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4A4A4A;">Open Planera to build a smart day-by-day itinerary, save can't-miss spots, and share it with whoever's coming with you.</p>
        <a href="https://planeraai.app" style="display:inline-block;font-size:14px;font-weight:700;color:#1A1A1A;text-decoration:underline;">Build my itinerary →</a>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:32px 40px;border-top:1px solid #EFEDE7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;">
        <p style="margin:0 0 8px;font-size:13px;color:#4A4A4A;">Need help? Reply to this email or write to <a href="mailto:support@planeraai.app" style="color:#1A1A1A;font-weight:600;text-decoration:underline;">support@planeraai.app</a></p>
        <p style="margin:0 0 4px;font-size:13px;color:#1A1A1A;font-weight:600;">Planera — travel smarter, plan better.</p>
        <p style="margin:0;font-size:12px;color:#9B9B9B;">© ${year} Planera. All rights reserved.</p>
      </td></tr>

    </table>
  </td></tr>
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

      const emailSubject = `✈ You're booked: ${booking.outboundFlight.origin} → ${booking.outboundFlight.destination} · ${booking.bookingReference || "Planera"}`;
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
