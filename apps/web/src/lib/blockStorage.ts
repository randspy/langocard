import type { StoredBlock } from "@backend/practiceBlock";

const KEY = "langocard.extraBlock";
/** Browser-local grant; malformed JSON has no valid duration to resume. */
export function readExtraBlock(): unknown {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}
/** A failed write must stop the action rather than silently lose introduction usage on reload. */
export function saveExtraBlock(block: StoredBlock | null) {
  if (block) localStorage.setItem(KEY, JSON.stringify(block)); else localStorage.removeItem(KEY);
}

/** Other tabs share the browser's grant; views refresh when that local state changes. */
export function observeExtraBlock(changed: () => void) {
  const listener = (event: StorageEvent) => { if (event.key === KEY || event.key === null) changed(); };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
