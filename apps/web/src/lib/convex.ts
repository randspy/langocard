import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useCallback } from "react";

/**
 * The deployment's shared `SYNC_TOKEN`, written to `.env.local` by `npm run link-web`.
 * Every backend function the web app calls requires it. The app only runs locally,
 * so the token never leaves this machine except to Convex.
 */
export const syncToken = (import.meta.env.VITE_SYNC_TOKEN as string | undefined) ?? "";

type Gated<Kind extends "query" | "mutation"> = FunctionReference<Kind, "public", { token: string }>;
type ArgsWithoutToken<F extends Gated<"query" | "mutation">> = Omit<FunctionArgs<F>, "token">;

/** `useQuery` with the sync token added to the arguments. */
export function useTokenQuery<Q extends Gated<"query">>(query: Q, args: ArgsWithoutToken<Q>): FunctionReturnType<Q> | undefined {
  return useQuery(query as Gated<"query">, { ...args, token: syncToken }) as FunctionReturnType<Q> | undefined;
}

/** `useMutation` with the sync token added to the arguments. */
export function useTokenMutation<M extends Gated<"mutation">>(mutation: M): (args: ArgsWithoutToken<M>) => Promise<FunctionReturnType<M>> {
  const run = useMutation(mutation as Gated<"mutation">);
  return useCallback(
    (args: ArgsWithoutToken<M>) => run({ ...args, token: syncToken }) as Promise<FunctionReturnType<M>>,
    [run],
  );
}
