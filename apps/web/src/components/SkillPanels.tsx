import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@backend/_generated/api";
import type { Skill } from "@backend/skills";
import { SkillBadge } from "@/components/EntryBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SKILL_LABELS, formatDate, skillStatus } from "@/lib/library";
import { useAsyncAction } from "@/lib/useAsyncAction";

export type SkillCard = FunctionReturnType<typeof api.cards.forEntry>[number];

export type CardActions = {
  /** `until: null` suspends indefinitely; `skill` undefined applies to all three skills. */
  suspend: (skill: Skill | undefined, until: number | null) => Promise<void>;
  resume: (skill: Skill | undefined) => Promise<void>;
  reset: (skill: Skill) => Promise<void>;
};

const STATE_LABELS: Record<string, string> = { LEARNING: "Learning", REVIEW: "Review", RELEARNING: "Relearning" };
const RATING_LABELS: Record<string, string> = { AGAIN: "Again", HARD: "Hard", GOOD: "Good", EASY: "Easy" };

export function SkillPanels({ cards, now, actions }: { cards: SkillCard[]; now: number; actions: CardActions }) {
  const { run, error } = useAsyncAction();
  const anySuspended = cards.some((c) => c.suspendedUntil > now);

  return (
    <section className="space-y-4" aria-label="Cards">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl">Cards</h2>
        <div className="flex gap-2">
          {anySuspended
            ? <Button variant="outline" size="sm" onClick={() => void run(() => actions.resume(undefined))}>Resume all</Button>
            : <Button variant="outline" size="sm" onClick={() => void run(() => actions.suspend(undefined, null))}>Suspend all</Button>}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {cards.map((card) => <SkillPanel key={card.skill} card={card} now={now} actions={actions} run={run} />)}
    </section>
  );
}

/** Card actions report failures through the shared `run` so the section shows one error. */
function SkillPanel({ card, now, actions, run }: {
  card: SkillCard; now: number; actions: CardActions; run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const label = SKILL_LABELS[card.skill];
  const status = skillStatus({ due: card.card?.due ?? null, pausedUntil: card.pausedUntil, suspendedUntil: card.suspendedUntil }, now);
  const [untilDate, setUntilDate] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const canReset = card.card !== null || card.failures > 0 || card.pausedUntil > now;
  const id = `suspend-until-${card.skill}`;

  return (
    <article className="space-y-3 rounded-lg border border-line bg-white p-4" aria-label={`${label} card`}>
      <header className="flex items-center gap-3">
        <h3 className="font-medium">{label}</h3>
        <SkillBadge status={status} label={label} />
        {status.kind === "suspended" && (
          <span className="text-xs text-muted">{status.until === null ? "until you resume it" : `until ${formatDate(status.until)}`}</span>
        )}
      </header>

      {card.card ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Stat term="State" value={STATE_LABELS[card.card.state] ?? card.card.state} />
          <Stat term="Due" value={formatDate(card.card.due)} />
          <Stat term="Stability" value={card.card.stability === null ? "—" : `${card.card.stability.toFixed(1)} days`} />
          <Stat term="Difficulty" value={card.card.difficulty === null ? "—" : `${card.card.difficulty.toFixed(1)} / 10`} />
        </dl>
      ) : <p className="text-sm text-muted">Not studied yet{card.reviews.length > 0 ? " since it was reset" : ""}.</p>}
      {card.pausedUntil > now && (
        <p className="text-sm text-muted">Paused until {formatDate(card.pausedUntil)} after repeated misses.</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {status.kind === "suspended" ? (
          <Button size="sm" variant="outline" onClick={() => void run(() => actions.resume(card.skill))}>Resume</Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => void run(() => actions.suspend(card.skill, null))}>Suspend</Button>
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={id} className="text-xs text-muted">or until</Label>
                <Input id={id} type="date" className="h-8 w-40" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} />
              </div>
              <Button size="sm" variant="outline" disabled={!untilDate}
                onClick={() => void run(() => actions.suspend(card.skill, new Date(`${untilDate}T00:00:00`).getTime()))}>
                Suspend until date
              </Button>
            </div>
          </>
        )}
        <div className="ml-auto flex gap-2">
          {confirmReset ? (
            <>
              <Button size="sm" variant="danger" onClick={() => void run(() => actions.reset(card.skill)).then((reset) => reset && setConfirmReset(false))}>Reset {label.toLowerCase()} card</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={!canReset} onClick={() => setConfirmReset(true)}>Reset…</Button>
          )}
        </div>
      </div>
      {confirmReset && <p className="text-xs text-muted">The card starts again as new on your phone. Its review history is kept.</p>}

      {card.reviews.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{card.reviews.length} review{card.reviews.length === 1 ? "" : "s"}</summary>
          <ol className="mt-2 space-y-1">
            {card.reviews.map((r) => (
              <li key={`${r.at}`} className="flex gap-3">
                <span className="w-28 tabular-nums text-muted">{formatDate(r.at)}</span>
                <span>{RATING_LABELS[r.rating]}</span>
                {r.placement && <Badge>Placement</Badge>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}

function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
