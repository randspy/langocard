import { useMutation, useQuery } from "convex/react";
import { api } from "@backend/_generated/api";
import { UpstreamChanges } from "@/components/UpstreamChanges";

export function UpstreamPage() {
  const changes = useQuery(api.entries.upstreamChanges);
  const resolve = useMutation(api.entries.resolveUpstream);
  return (
    <section className="max-w-5xl space-y-6">
      <h1 className="font-serif text-3xl">Upstream changes</h1>
      {changes === undefined
        ? <p className="text-muted">Loading…</p>
        : <UpstreamChanges changes={changes} onResolve={async (entryId, choice) => { await resolve({ entryId, choice }); }} />}
    </section>
  );
}
