import ordinals from "../../../content/study-order.json";

/** Shared shipped order, then a deterministic ID tie for additions across offline devices. */
export function studyOrder(entryId: string): string {
  const rank = Object.prototype.hasOwnProperty.call(ordinals, entryId) ? Reflect.get(ordinals, entryId) : undefined;
  return typeof rank === "number" ? `0:${String(rank).padStart(8, "0")}` : `1:${entryId}`;
}
