import { useCallback, useState } from "react";

/** Convex errors carry the message the server threw in `data`. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error && typeof error.data === "string") return error.data;
  return error instanceof Error ? error.message : "Something went wrong";
}

/**
 * Runs a user-triggered backend call and tracks what the UI shows for it: whether
 * it is still running, and the message of the last failure. Failures never escape
 * `run`; it resolves to whether the action succeeded instead.
 */
export function useAsyncAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setPending(false);
    }
  }, []);
  return { run, pending, error };
}
