import { Badge } from "@/components/ui/badge";
import { formatDate, type LibraryEntry, type SkillStatus } from "@/lib/library";

type EntryFlagSource = Pick<LibraryEntry, "deleted" | "edited" | "upstreamChanged" | "retired">;

/** A badge for each way the entry departs from plain shipped, studied content. */
export function EntryFlags({ entry, className }: { entry: EntryFlagSource; className?: string }) {
  return (
    <>
      {entry.deleted && <Badge tone="danger" className={className}>Deleted</Badge>}
      {entry.edited && <Badge className={className}>Edited</Badge>}
      {entry.upstreamChanged && <Badge tone="due" className={className}>Upstream changed</Badge>}
      {entry.retired && <Badge className={className}>Retired</Badge>}
    </>
  );
}

/** One skill's study status; `label` names the skill in the tooltip. */
export function SkillBadge({ status, label }: { status: SkillStatus; label: string }) {
  switch (status.kind) {
    case "new": return <Badge tone="new" title={`${label}: new`}>New</Badge>;
    case "due": return <Badge tone="due" title={`${label}: due since ${formatDate(status.due)}`}>Due</Badge>;
    case "scheduled": return <Badge tone="scheduled" title={`${label}: due ${formatDate(status.due)}`}>{formatDate(status.due)}</Badge>;
    case "paused": return <Badge tone="paused" title={`${label}: paused after repeated misses until ${formatDate(status.until)}`}>Paused</Badge>;
    case "suspended": return <Badge tone="suspended" title={`${label}: suspended`}>Suspended</Badge>;
  }
}
