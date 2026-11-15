# Optional typed Production answers

Production can still be answered aloud or silently. An empty or whitespace-only field
keeps the existing reveal and self-rating flow. Typed answers are transient and are
neither saved nor synced. The input is limited to 200 characters.

On reveal, compare with the current sentence's answer, not the entry's dictionary
form. Case, surrounding whitespace, canonical Unicode composition and straight vs
curly apostrophes are ignored. Internal whitespace remains significant.

- Exact match suggests Good.
- Missing, extra or wrong accents suggest Hard. `oe` for `œ` and `ae` for `æ` also
  suggest Hard. Accents matter in written French, but this recognizes word recall.
- For noun entries only, the right noun with a different or omitted leading article
  suggests Hard. The existing article parser recognizes un, une, le, la and l'.
  An article error combined with an accent error also suggests Hard.
- Other differences suggest Again. No answer automatically suggests Easy.

Both answers appear on reveal, with differing characters emphasized. A highlighted
rating is preselected. The learner can choose any of the four ratings and must press
Confirm rating to save it. This avoids applying a suggestion without consent.

The comparison lives outside Compose. We chose one comparison value with a category
and character runs over separate grade and diff functions so the UI consumes one
consistent result. No scheduling or persistence rules change.
