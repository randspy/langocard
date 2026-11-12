import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";

/**
 * Whether the signed-in user is the one learner this deployment belongs to: the GitHub
 * account whose numeric user ID is in the `ALLOWED_GITHUB_ID` environment variable.
 */
async function ownerStatus(ctx: QueryCtx | MutationCtx): Promise<"signedOut" | "notAllowed" | "notConfigured" | "owner"> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return "signedOut";
  const allowed = process.env.ALLOWED_GITHUB_ID;
  if (!allowed) return "notConfigured";
  const account = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "github"))
    .unique();
  return account?.providerAccountId === allowed ? "owner" : "notAllowed";
}

/** Guards every web function. Throws unless the caller is the owner. */
export async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<void> {
  const status = await ownerStatus(ctx);
  if (status === "signedOut") throw new ConvexError("Sign in first");
  if (status === "notConfigured") throw new ConvexError("ALLOWED_GITHUB_ID is not configured on the deployment");
  if (status === "notAllowed") throw new ConvexError("This GitHub account isn't allowed");
}

/** Lets the web app explain why access is refused without throwing. */
export const status = query({
  args: {},
  handler: async (ctx) => ({ status: await ownerStatus(ctx) }),
});
