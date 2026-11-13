# Noun gender — design

Status: implemented (2026-11-13).

Entries record the gender of nouns, and gender becomes something the learner
practises: a fourth skill, **Gender**, with a one-tap *un / une* card that grades
itself. On-device AI drafting fills the gender in too.

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Goal | Practise gender as its own skill (not just display it). |
| 2 | Skill | A new `Gender` skill with its own FSRS card. Production still expects the article: recalling the word with the wrong article is rated **Hard**, not Again, because the Gender card already schedules the article. |
| 3 | Storage | An explicit field `gender: "masculine" \| "feminine" \| null` on entry content. `null` means "not a noun". |
| 4 | Consistency | `word` keeps its article ("une intrigue"). If `gender` is set and `word` starts with a gendered article (`un`, `une`, `le`, `la`), they must agree. Elided or bare words ("l'arbre", "arbre") take either gender; `un`/`une` with `null` is allowed ("un peu"). |
| 5 | Existing data | Gender is filled from the article everywhere: a Convex migration fills each row's content **and** its `shipped` snapshot (so edited entries aren't flagged "upstream changed"); Android fills it when reading entries that predate the field (personal entries, synced rows, backups). |
| 6 | Card ownership | Keys stay `"<entryId>:Gender"`, but only **one meaning per noun** has an eligible Gender card: the noun's first-introduced meaning (lowest FSRS `cardId` among its started cards). Deleting it hands the role to the next meaning, with fresh history. Meanings that already have a Gender card (e.g. from another device) keep it. |
| 7 | The card | Shows the bare noun and the English meaning. Two buttons, **un** and **une**. No reveal step and no self-rating: right → Good, wrong → Again. A feedback screen (✓/✗, the full word, the example) and **Next**. |
| 8 | Introduction | Gender is a sibling skill, introduced last and on a later day than the meaning's first card, through the existing sibling path, capped at **10 new Gender cards a day** (separate from the 5 new meanings; per device). Same-lexeme burying covers it. Placement stays on Reading/Listening/Production. |
| 9 | AI drafting | `Gender` is a `DraftField` (`masculine` / `feminine` / `none`). The article beats the model: if the word starts with `un`/`une`, gender comes from it. A reply whose gender contradicts its own word's article loses its gender, which triggers the usual retry. Add Entry gets a three-way choice: Masculine · Feminine · Not a noun. |
| 10 | Web | EntryForm gets a Gender select under the word, pre-filled from a typed article while untouched. The Library gets a Gender column ("—" for non-nouns), m./f. tags beside words and a **Nouns** filter. The entry page shows no Gender card panel for non-nouns. |
| 11 | Rollout | Lockstep: `gender` is required in push and edit arguments from the start. Deploy the backend, run the migration, then install the APK. Sync protocol stays v2. |
| 12 | Published content | The v1 packs are pinned by `sha256` at the `content-v1` tag, and the bundled `frequent-pack.json` must equal the published file, so neither changes. In the pack format `gender` is optional: absent means "from the article". The same rule covers `pilot.tsv`, whose six-column format is shared with `prepare_pack.py`. `build_corpus.py` writes `gender` for future packs. |
| 13 | Extras | Reveals on the other skills show an m./f. tag. Anki export adds a gender note per noun. Gender cards count toward the daily 15 minutes. |

## Ubiquitous language

- **Gender** — grammatical gender of a noun: `masculine` or `feminine`. An entry with
  no gender is not a noun.
- **Article gender** — the gender a leading `un`/`une`/`le`/`la` in `word` states.
  Elided `l'` states none.
- **Noun** (on a card) — `word` without its leading article: "une intrigue" → "intrigue".
- **Gender owner** — the one meaning of a noun whose Gender card is studied.

## Data model

```
EntryContent += gender: "masculine" | "feminine" | null
```

- `convex/entryRules.ts`: `Gender`, `articleGender(word)`, rule `gender`. Android mirrors
  it in `Gender` and `ContentFiles.validateEntry`; `content/entry-rules-fixtures.json`
  holds the shared cases. Entries in Android's JSON format with no `gender` key take
  the article gender (`fromAndroidJson`, `ContentFiles.readEntries`, `SyncData.rowEntry`).
- Convex `entries` stores `gender` as optional only so rows written before this change
  pass schema validation until `migrations:fillGender` has run; reads treat a missing
  value as the article gender. Arguments always require it. Tighten the schema to
  required once the migration has run on every deployment.

## Rollout

1. `npx convex deploy`, then `npx convex run migrations:fillGender` (repeat until it
   reports 0 updated).
2. `npm run seed` (writes nothing new; the seed already carries gender).
3. Install the new APK. Older APKs fail argument validation until updated.
