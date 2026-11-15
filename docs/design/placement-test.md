# Vocabulary starting-rank check

## Decision

Use an original, unvalidated yes/no frequency-band check, not a CEFR test.
LexTALE-FR measures lexical recognition well, but its aggregate score has no
validated conversion to our frequency ranks. We need a conservative band choice.
The current six-entry per-skill check is retired from onboarding, not retained as
a second step. Ordinary practice assesses each card with FSRS.

## Sources and reuse

The [publisher's LexTALE-FR article](https://reference-global.com/article/10.5334/pb-53-1-23)
(Marc Brysbaert, 2013, DOI 10.5334/pb-53-1-23) states CC BY 4.0.
The [Ghent repository](https://biblio.ugent.be/publication/4373981) labels its PDF
“No license (in copyright)”. Thus “free test” alone is not a reuse permission.
We bundle neither its items nor instructions. Its validation does not transfer
to this test.

Real items are twenty evenly spaced lemmas from each of ranks 1–2500,
2501–7000 and 7001–12000 in `content/ranked-lemmas.json`. Lexique 3.83 by Boris
New, Christophe Pallier and contributors is CC BY-SA 4.0; see
`content/NOTICE.md` for attribution, source and adaptation details. The selected
item asset is another CC BY-SA 4.0 adaptation, with that notice bundled.
Thirty original French-looking nonwords are composed for this project, checked
against the full 20,000-lemma reference, and released under CC BY-SA 4.0.
Absence from that reference is not proof of absence from all French dictionaries.
These items need independent language review and empirical calibration before
claiming a validated estimate. They are not copied from a published test.

## Scoring and behavior

Show 60 real words and 30 nonwords in a fixed interleaved order. Ask whether the
learner knows a meaning, rather than whether the spelling looks French. Explain
that some items are invented and “No” is the right answer when unsure. Budget
about five minutes for 90 short decisions; this is a design estimate, not timed
user evidence. No timer or feedback reveals item validity during the test.

Let F be yes answers to the 30 nonwords. For each 20-word band, adjusted hits
are max(0, hits - 20 * F / 30). A band passes at 16 adjusted hits (80%).
Start at rank 1 unless the first band passes; then 2501. Advance to 7001 only
when both the first and second bands pass. The third band provides diagnostic
feedback but never skips beyond the existing pack preference choices.
All-yes, all-no and random guessing therefore cannot advance the start rank.
This is a conservative product heuristic, not a vocabulary-size measurement.

Persist each answer locally, resume after pause or restart, and expose retake
from the menu. Keep the old rank until the learner confirms the completed
result; offer rank 1, 2501 and 7001 there and on the packs page. A retake clears
only test answers. No answer writes a card, review log, known flag or FSRS state.
The in-progress test is local to this device; only the existing rank preference
syncs. Existing learners can retake without replaying onboarding.
