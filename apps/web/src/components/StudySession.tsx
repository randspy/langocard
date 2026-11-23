import { useCallback, useEffect, useRef, useState } from "react";
import { clozeOf, textOf, answerOf } from "@backend/entryRules";
import { MATCH_LABEL, MATCH_RATING, typedAnswer, type AnswerPart, type TypedAnswer } from "@backend/typedAnswer";
import { Input, Textarea } from "@/components/ui/input";
import { usePracticeClock } from "@/lib/usePracticeClock";
import type { Rating } from "@backend/fsrs";
import { Button } from "@/components/ui/button";
import { GENDER_TAGS } from "@/lib/library";
import type { Fit } from "@backend/fittedSettings";
import { intervals, type AnswerResult, type StudyCard } from "@/lib/study";
import { errorMessage } from "@/lib/useAsyncAction";

const RATINGS: [Rating, string][] = [["AGAIN", "Again"], ["HARD", "Hard"], ["GOOD", "Good"], ["EASY", "Easy"]];

type Props = {
  /** Fetches the card to show next, or null when nothing is due. Called once per card, never subscribed. */
  fetchNext: (pending: string[]) => Promise<StudyCard | null>;
  answer: (card: StudyCard, rating: Rating) => Promise<AnswerResult>;
  clock: () => number;
  tick?: (checkpoint: { day: string; seconds: number }) => Promise<unknown>;
  /** The synced fitted FSRS settings answers are scheduled with; null for the defaults. */
  fit?: Fit | null;
  /** Saves a memory hook for an entry, offered after a card's fourth miss in a row. */
  saveHook?: (entryId: string, text: string) => Promise<unknown>;
