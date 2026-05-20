/**
 * Tiny helper for scheduling Convex error-report emails from any action.
 *
 * Usage inside a Convex action / internalAction:
 *
 *   import { reportError } from "./helpers/reportError";
 *   try {
 *     ...
 *   } catch (err) {
 *     await reportError(ctx, "tripsActions:generateTrip", err, { tripId });
 *     throw err;
 *   }
 *
 * The actual email send is throttled per-(source+message) to once per hour
 * via the `errorReports` table. See convex/errorReporter.ts.
 */

import { internal } from "../_generated/api";

export async function reportError(
  ctx: { scheduler: { runAfter: (ms: number, ref: any, args: any) => Promise<any> } },
  source: string,
  err: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : JSON.stringify(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await ctx.scheduler.runAfter(0, internal.errorReporter.reportError, {
      source,
      message: String(message ?? "Unknown error"),
      stack,
      context,
    });
  } catch {
    // Never let error reporting itself throw.
  }
}
