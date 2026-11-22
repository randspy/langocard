import { localDay } from "./study";

/** Foreground elapsed time, split at local midnight; hidden intervals never enter a checkpoint. */
export class PracticeClock {
  private last: { wall: number; monotonic: number; active: boolean } | null = null;
  private milliseconds = new Map<string, number>();
  private elapsed = 0;

  sample(wall: number, monotonic: number, active: boolean) {
    const previous = this.last;
    this.last = { wall, monotonic, active };
    if (!previous?.active) return;
    const duration = Math.max(0, monotonic - previous.monotonic);
    this.elapsed += duration;
    // Anchor monotonic elapsed time at the current wall time. Clock changes don't inflate it.
    let start = wall - duration;
    while (start < wall) {
      const date = new Date(start);
      const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
      const end = Math.min(midnight, wall);
      const day = localDay(start);
      this.milliseconds.set(day, (this.milliseconds.get(day) ?? 0) + end - start);
      start = end;
    }
  }

  get seconds() { return Math.floor(this.elapsed / 1000); }

  checkpoints() {
    return [...this.milliseconds].map(([day, ms]) => ({ day, seconds: Math.floor(ms / 1000) })).filter((x) => x.seconds > 0);
  }

  saved(day: string, seconds: number) {
    this.milliseconds.set(day, (this.milliseconds.get(day) ?? 0) - seconds * 1000);
  }
}
