import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Single-user access control. Every public function takes the shared secret configured
 * with `npx convex env set SYNC_TOKEN <value>`; there are no accounts. The Android app
 * and the local web app both hold it (`npm run link-android` / `npm run link-web`).
 */
type TokenStatus = "ok" | "invalid" | "notConfigured";

function tokenStatus(token: string): TokenStatus {
  const expected = process.env.SYNC_TOKEN;
  if (!expected) return "notConfigured";
  // Constant-time comparison.
  let diff = token.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= (token.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return diff === 0 ? "ok" : "invalid";
}

/** Throws unless `token` is the deployment's `SYNC_TOKEN`. */
export function requireToken(token: string): void {
  const status = tokenStatus(token);
  if (status === "notConfigured") throw new ConvexError("SYNC_TOKEN is not configured on the deployment");
  if (status === "invalid") throw new ConvexError("Invalid sync token");
}

/** Lets the web app explain a refused token without throwing. */
export const check = query({
  args: { token: v.string() },
  handler: async (_ctx, { token }) => ({ status: tokenStatus(token) }),
});
