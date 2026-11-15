# Reading and listening passages

## Experience and time

Offer a separate Reading passage destination in the navigation drawer, available
before or after reviews. Reading and listening on that page count toward the same
15 foreground minutes as deliberate practice. Generation, menus, errors and time
in the background do not count. Finishing a passage is allowed after the target;
there is no timer interrupt. Leaving stops speech and checkpoints time. Passages
are ephemeral and can be regenerated. No passage is an FSRS assessment and no card,
burial, failure counter or exposure count changes. A separate exposure log is deferred.

## Vocabulary contract

A known entry has a Reading card with at least one successful recall (repetitions
alone are insufficient). Select up to 100 known entries and up to three due Reading
entries already studied. At least 20 known entries are required. A due entry is a
preferred inclusion, not a forced review. Include at least one selected due entry
when any are available.

Generate 50–100 French word tokens in plain prose. At least 95% of tokens must
match tokens in known entry headwords or a small explicit French function-word
list. Token matching is case-insensitive, preserves accents, splits apostrophes
and hyphens, and makes no claim to recognise inflected forms. Due words count as
known only if they independently qualify. This conservative surface-token proxy
can reject good French and cannot prove comprehension, grammatical quality or
semantic correctness. It does bound unfamiliar surface vocabulary. Never use the
whole unstudied library as evidence of knowledge.

Use the installed on-device drafting model offline. Check output locally, retry
one failed check, then explain failure and allow another request. Do not silently
relax limits. Cancel generation on leaving. Without the model, explain that the
learner must enable AI on Add an entry, or that the phone is unsupported. Never
download automatically or fall back to a server.

## Reading aids

Tap a token to show all matching installed library meanings, including ambiguous
senses; labels explicitly identify these as library matches. Multiword headwords
match their constituent tokens. Unknown tokens explain that no library meaning
matches. Listen uses the existing offline French synthetic voice, with Stop and
an explanation if unavailable. No comprehension quiz or rating is needed in this
first slice. Learners read for meaning rather than answer another card.

## Implementation slices

1. #32 adds selection, prompt, checks and retry tests, the passage page, library
   lookup, offline TTS and foreground daily-time integration.
2. Later work can persist passages, add a separate exposure log and comprehension
   questions, and evaluate morphology-aware coverage with language-reviewed data.
3. Listening-only and speed-focused activities need their own usability evaluation.
