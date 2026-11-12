import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * Web app sign-in. Anyone can complete GitHub sign-in, but every web function calls
 * `requireOwner`, which only admits the account in `ALLOWED_GITHUB_ID`. The Android app
 * doesn't use this; it keeps the `SYNC_TOKEN`.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [GitHub],
});
