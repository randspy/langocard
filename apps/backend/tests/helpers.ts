/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import schema from "../convex/schema";

export const modules = import.meta.glob("../convex/**/*.*s");
/** The deployment's `SYNC_TOKEN` in tests. */
export const TOKEN = "test-token";

export function setup() {
  return convexTest(schema, modules);
}
export type T = ReturnType<typeof setup>;

type Gated<Kind extends "query" | "mutation"> = FunctionReference<Kind, "public", { token: string }>;

/** A client that adds `token` to every call, as the web app does. */
export function withToken(t: T, token = TOKEN) {
  return {
    query: <Q extends Gated<"query">>(fn: Q, args: Omit<FunctionArgs<Q>, "token">): Promise<FunctionReturnType<Q>> =>
      t.query(fn as Gated<"query">, { ...args, token }) as Promise<FunctionReturnType<Q>>,
    mutation: <M extends Gated<"mutation">>(fn: M, args: Omit<FunctionArgs<M>, "token">): Promise<FunctionReturnType<M>> =>
      t.mutation(fn as Gated<"mutation">, { ...args, token }) as Promise<FunctionReturnType<M>>,
  };
}

export const shipped = (o: Record<string, unknown> = {}) => ({
  entryId: "frw-1", origin: "bundled", word: "avoir", english: "have", definition: "Posséder.", example: "{Avoir} de la force.",
  topic: "daily", lemma: "avoir", rank: 6 as number | null, sourceUrl: "https://fr.wiktionary.org/wiki/avoir#fr", license: "CC BY-SA 4.0", gender: null as "masculine" | "feminine" | null, ...o,
});
