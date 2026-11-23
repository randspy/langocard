import { PracticeBlock, type StoredBlock } from "@backend/practiceBlock";

const KEY = "langocard.extraBlock";
/** Browser-local grant; malformed JSON has no valid duration to resume. */
export function readExtraBlock(): unknown {
  const text = localStorage.getItem(KEY);
  try { return JSON.parse(text ?? "null"); } catch { return null; }
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

/** Display may be unavailable without blocking the page; actions always use the strict read. */
export function readExtraBlockForDisplay(): unknown {
  try { return readExtraBlock(); } catch { return null; }
}

/** Grant replacement and answer reconciliation share one browser-wide critical section. */
export async function createExtraBlock(create: () => Promise<StoredBlock | null>) {
  if (!navigator.locks) throw new Error("Extra practice is unavailable in this browser.");
  return navigator.locks.request(KEY, async () => {
    const grant = await create();
    if (grant) saveExtraBlock(grant);
    return grant;
  });
}

type AnswerOutcome = { status: "ok" | "stale"; block?: StoredBlock | null };
/** Reserve before sending and reconcile before another tab may replace or spend the grant. */
export async function answerWithExtraBlock<T extends AnswerOutcome>({ day, newMeaning, newGender, loadSeconds, submit }: {
  day: string; newMeaning: boolean; newGender: boolean;
  loadSeconds: () => Promise<number>; submit: (block: StoredBlock | null) => Promise<T>;
}): Promise<T> {
  const answer = async () => {
    const seconds = await loadSeconds();
    const block = PracticeBlock.read(readExtraBlock(), day, seconds);
    if (block.isExtra) {
      if (!navigator.locks) throw new Error("Extra practice is unavailable in this browser.");
      saveExtraBlock(block.introduced(newMeaning, newGender).toJSON());
    }
    const result = await submit(block.toJSON());
    if (block.isExtra) saveExtraBlock(result.status === "ok" && result.block ? result.block : block.toJSON());
    return result;
  };
  return navigator.locks ? navigator.locks.request(KEY, answer) : answer();
}
