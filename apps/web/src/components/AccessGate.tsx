import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@backend/_generated/api";
import { syncToken } from "@/lib/convex";

/** Renders the app only once the deployment accepts this app's sync token. */
export function AccessGate({ children }: { children: ReactNode }) {
  const result = useQuery(api.access.check, { token: syncToken });
  if (result === undefined) return <Centered><p className="text-muted">Loading…</p></Centered>;
  if (result.status === "ok") return children;
  const message = result.status === "notConfigured"
    ? "The deployment has no SYNC_TOKEN yet. Set one (see apps/backend/README.md), then run `npm run link-web` in apps/backend."
    : "This app's sync token doesn't match the deployment. Run `npm run link-web` in apps/backend and restart `npm run dev`.";
  return (
    <Centered>
      <h1 className="font-serif text-2xl">No access</h1>
      <p className="max-w-md text-muted">{message}</p>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">{children}</main>;
}
