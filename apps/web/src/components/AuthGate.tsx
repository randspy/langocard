import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@backend/_generated/api";
import { Button } from "@/components/ui/button";

/** Shows the sign-in page until the owner is signed in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <Centered><p className="text-muted">Loading…</p></Centered>;
  if (!isAuthenticated) return <SignIn />;
  return <OwnerCheck>{children}</OwnerCheck>;
}

function OwnerCheck({ children }: { children: ReactNode }) {
  const result = useQuery(api.owner.status);
  const { signOut } = useAuthActions();
  if (result === undefined) return <Centered><p className="text-muted">Loading…</p></Centered>;
  if (result.status === "owner") return children;
  const message = result.status === "notConfigured"
    ? "The deployment has no ALLOWED_GITHUB_ID yet. Set it to your numeric GitHub user ID (see apps/web/README.md)."
    : "This GitHub account doesn't have access to this Langocard library.";
  return (
    <Centered>
      <h1 className="font-serif text-2xl">No access</h1>
      <p className="max-w-md text-muted">{message}</p>
      <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
    </Centered>
  );
}

function SignIn() {
  const { signIn } = useAuthActions();
  return (
    <Centered>
      <h1 className="font-serif text-4xl">Langocard</h1>
      <p className="text-muted">Manage your French vocabulary and cards.</p>
      <Button size="lg" onClick={() => void signIn("github")}>Sign in with GitHub</Button>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">{children}</main>;
}
