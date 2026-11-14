# Several examples per meaning — design

Status: implemented (2026-11-14); see issue #18.

A meaning carries an ordered list of **examples** instead of one. Reading, Listening
and Production rotate through them, so the learner meets the word in different
sentences and remembers the word, not one sentence ("the gap in the café sentence
is *addition*"). Meeting a word in varied contexts gives deeper, more transferable
knowledge (Bolger et al. 2008; Pagán & Nation 2019).

Cards don't change. Keys stay `"<entryId>:<Skill>"`, and the rotation is computed
from review history that already syncs, so example wording and count never affect
scheduling.

Backward compatibility is out of scope. Nothing reads the old `example` field: the
deployment is wiped and reseeded, packs are republished, and old local data and
backups are rejected rather than converted.

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Content shape | `examples: string[]` **replaces** `example` everywhere (Convex, Android, packs, backups, web): 1 to 5 examples, in order, each with exactly one `{answer}`. The first is the **introductory example**: a meaning's first exposure always shows it. There is no second field like `moreExamples`, because that would give the same idea two names and make one example special everywhere. |
| 2 | Answer form | Each example marks its own answer, and it may be an inflected or elided form ("{rend compte}", "{l'intrigue}"). Production already says "use the form that fits the sentence", and the reveal already shows "In this sentence: …" when the answer differs from `word`. There is no check that answers match `word` or each other, because that would need a lemmatiser. |
| 3 | Entry rules | Rule `fields` applies to each example: not blank, at most 2,000 characters. Rule `answer` applies to each example, and its error gives the example's position. A new rule `examples` covers the list: 1 to 5 examples, with no two the same after trimming. Convex (`entryRules.ts`) and Android (`ContentFiles.validateEntry`) share the cases in `content/entry-rules-fixtures.json`. |
| 4 | Sync | The protocol's entry shape changes from `example` to `examples` in push, pull and edit arguments. No new merge rule: `sameContent` compares `examples` element by element and in order, so reordering counts as an edit. Old APKs are unsupported. |
| 5 | Convex data | No migration. Wipe and recreate the deployment, deploy, then seed, as for protocol v2. Progress, personal entries and web edits stored in Convex are discarded. |
| 6 | Published content | Pack format version 2 (and `packVersion` 2) carries `examples`, so a v1 pack fails with "Unsupported pack format". Pack IDs don't change. The current packs were converted as they are (`example` → `examples: [example]`), because the source dumps aren't kept in the repo. `build_corpus.py` already collected every usable example for a sense and kept only the shortest; now it writes up to 5, shortest first, so the next rebuild from the pinned sources adds the extra examples. The packs are published on a new `content-v2` branch, with `catalogue.json` updated (URLs and `sha256`) and the bundled `frequent-pack.json` replaced by the new published file. |
| 7 | `pilot.tsv` | New column order: `id\|word\|english\|definition\|topic\|example\|example…`, with one or more examples after `topic`. The 200 existing rows are rewritten once. The Android parser, `prepare_pack.py` and `seed.mjs` read the new order. |
| 8 | Android local data | The study file becomes `learning-v2.json` (data version 2), so the old `learning-v1.json` is ignored instead of crashing on its `example` fields. The learner starts fresh or restores from sync. |
| 9 | Backups | Backup envelope version 2, with entries carrying `examples`. Version 1 backups are rejected ("Unsupported backup"). |
| 10 | Rotation | A prompt shows `examples[exposures mod n]`, where **exposures** is the number of logged reviews of the meaning's Reading, Listening and Production cards, placement included. It is fixed when the prompt is chosen, so Reveal, *Play again* and *Hear example* use the same sentence. No state is stored: the count comes from the `reviews` log, which syncs and is in backups. |
| 11 | Avoiding the last sentence | This follows from #10: each exposure moves the meaning on to its next example, whatever the skill. When Listening or Production follow a Reading review, they show a different sentence from the one Reading just showed, whenever `n ≥ 2`. Siblings are already buried for the rest of the day, so "next" means the next study day. |
| 12 | Gender card | Gender reviews aren't exposures, because the prompt shows no sentence. The feedback screen shows the example at the meaning's current position. |
| 13 | Anki export | Notes stay one per skill per meaning, so imports don't multiply. The Reading and Production fronts use the introductory example. Every back lists all the examples. |
| 14 | Editing | Web EntryForm: an ordered list editor (add, remove, move up, at most 5), with a live cloze preview and inline errors for each example. Upstream changes shows the lists side by side. Android Add Entry has the same list (add up to 5, remove). On-device AI fill drafts examples next to the learner's own, up to 3, each different from the rest; regenerating replaces only the drafted ones. |
| 15 | Library | The Android library lists every example, each with **Listen**. The web Library search also matches example text. |

## Ubiquitous language

- **Example**: a French sentence that uses the meaning, with exactly one marked
  **answer** in `{braces}`.
- **Examples**: a meaning's ordered list of 1 to 5 examples.
- **Introductory example**: the first example, shown at a meaning's first exposure.
  Authors put the clearest sentence first.
- **Answer**: the marked span of one example, exactly as the sentence uses it. It may be
  an inflected form of `word`.
- **Exposure**: one logged review of a meaning on Reading, Listening or Production,
  placement included. Gender reviews aren't exposures.
- **Shown example**: `examples[exposures mod n]` when the prompt is chosen.

## Data model

```
EntryContent: example: string  →  examples: string[]   // 1..5, each with one {answer}
```

- `convex/entryRules.ts` adds `MAX_EXAMPLES = 5`. `answerOf` and `clozeOf` stay per
  example, and `RuleError` gains an optional `index` for per-example errors.
  `fromAndroidJson` reads `examples`. `CONTENT_FIELDS` swaps `example` for `examples`,
  and `sameContent` compares arrays. `validators.ts` uses `examples: v.array(v.string())`
  for both content and `shipped`.
- Android: a value object `Example(marked)` takes the `answer`, `text` and `cloze`
  logic that `Entry` has today. `Entry.examples: List<Example>` replaces
  `markedExample`. `Prompt` gains `example: Example`, chosen by
  `entry.exampleAt(exposures)`. `LearningModel.exposures(entryId)` counts the meaning's
  entries in the review log when a prompt is chosen. No cache is needed: the log is
  small and is read once per prompt, and pulled or restored reviews count straight away.
- Fixtures: convert every existing case to `examples`, then add cases for two valid
  examples; five examples (limit); six examples; an empty list; duplicate examples
  (after trimming); a second example with no answer; a second example with two answers;
  an inflected answer (valid); and an entry with only `example` (rule `examples`).

## Rollout

1. Push the `content/` packs and `catalogue.json` to a `content-v2` branch, which is
   where the app's `CATALOGUE_URL` now points.
2. Wipe the Convex deployment, `npx convex deploy`, then `npm run seed`.
3. Install the new APK and restart the local web app.

## Slices

Slices 1 to 6 are implemented. Slice 7 is a follow-up.

1. **Shared rules and backend**: `entryRules.ts`, fixtures, validators, schema, `sync`,
   `entries`, `seed`, and Vitest.
2. **Content**: `build_corpus.py` writes `examples`, pack format version 2,
   `prepare_pack.py` and the `pilot.tsv` column order, the converted packs, the
   catalogue and the bundled pack. A rebuild from the pinned sources (which adds the
   extra examples) is still to do.
3. **Android content and sync**: `Example`, `Entry.examples`, every reader and writer
   (packs, `pilot.tsv`, backups v2, sync rows, `learning-v2.json`), `validateEntry`, and
   the Kotlin fixture tests.
4. **Web editing**: EntryForm list editor with per-example preview and errors, Upstream
   changes, and Library search.
5. **Rotation on Android**: exposure counts, `Prompt.example`, the Review screen,
   Gender feedback, the Library list and the Anki export.
6. **Drafting**: Android Add Entry gets *Add example*, and the on-device AI drafts
   another example that keeps the given word and differs from the existing examples.
7. **More examples for the pilot list**: optionally add examples to the 200 hand-written
   pilot entries.

Slices 1 to 5 ship together, because the formats change at the same moment
everywhere.
