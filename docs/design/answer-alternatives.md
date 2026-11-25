# Answer alternatives

Status: agreed (2026-11-22). Rollout: PR 1 (syntax and rules), PR 2 (Android matching),
PR 3 (generator and publish), PR 4 (content).

A Production card asks for the French word that fills a gap, given its English meaning.
Some gaps take more than one right word: *Le train devrait ________ à la gare* accepts
*arriver* and *parvenir*. Until now, any word but the marked one was Different, so a
valid synonym was called wrong and the learner had to override Again by hand.

The card trains recall of its own entry, not of any word that fits. A synonym is valid
French but not the word being trained, so it is recognised, named and rated Hard, and
the target is shown.

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Meaning | A typed alternative is right but is not recall of the target. It suggests Hard, like an accent or article slip, and the reveal names the target. |
| 2 | Storage | Alternatives belong to one example, because whether a word fits depends on the sentence. They live inside the answer marks: `{arriver\|parvenir}`. The first part is the target; the rest are alternatives. Examples stay plain strings, so the backend schema and sync format don't change. |
| 3 | Skills | Production only. Listening asks what was heard, so a synonym there is still Different. |
| 4 | Matching | First match wins: target exact (Good), target with accent slips (Hard), target noun with another article (Hard), an alternative with or without accent slips (`Alternative`, Hard, "✓ Also correct"), anything else (Again). Alternatives get no article rule: an alternative is the whole text that fills the gap. |
| 5 | Reveal | On `Alternative`, the typed answer is compared with the alternative it matched, so only accent slips are marked, and the reveal says which word the card practises. On Different the reveal is unchanged: compared with the target, no alternatives listed. |
| 6 | Rules | A blank target breaks the `answer` rule, checked first. After it, every `\|`-separated part is non-blank after trimming; at most 5 alternatives; no two parts equal ignoring case and accents. Message: "Alternatives must be different, non-empty words (at most 5)", rule code `alternatives`. Examples must differ ignoring alternatives: two examples with the same sentence are one practice prompt. A `\|` outside the braces is ordinary text. Backend `entryErrors` and Android `ContentFiles.validateEntry` mirror each other through `content/entry-rules-fixtures.json`. |
| 7 | Derived forms | `answerOf` (Android `Example.answer`) is the target. `alternativesOf` (`Example.alternatives`) lists the rest. `textOf` and `clozeOf` use the target, so Reading, Listening, speech and the vocabulary list never show `\|`. |
| 8 | Authoring | The same example field. The hint explains `\|`. The on-device drafter does not suggest alternatives. |
| 9 | Web | The entry form preview lists "Also accepted: …" under each answer. Library search matches alternatives. |
| 10 | Upstream merge | For an edited entry, each of the learner's examples whose sentence (ignoring alternatives) matches a shipped example gains the shipped alternatives it lacks, after its own. A rewritten sentence gains nothing. `upstreamChanged` compares content ignoring alternatives, so new alternatives alone never raise it. Alternatives are never removed from an edited entry. Unedited entries take shipped content whole, as before. `sameContent` stays strict. |
| 11 | Example identity | Stuck-word history records an example's marked text. It compares examples ignoring alternatives, so adding alternatives keeps the history. |
| 12 | Generation | `tools/content/generate_alternatives.py` asks local Ollama `gemma4:26b` for candidates, filters them deterministically (target, accent or case variants of it, the same noun with another article, more words than the target plus one, `{`, `}`, `\|`), then asks a second, independent `gemma4:26b` call to judge each candidate in the full sentence. A candidate is accepted only when that call says the new sentence is grammatical, the same meaning, the same register (no neutral word for slang) and as specific (no broader or narrower word), and at most 5 are kept. Records note the checker version (`check`); after the checker changes, `--recheck` re-judges the alternatives an older one accepted. Results go to `content/alternatives.json`, keyed by entry ID and exact example text, with accepted and rejected candidates and the reason. Runs resume by skipping keys already present. |
| 13 | Review | Claude Haiku reviews a seeded sample of 200 examples that have alternatives, split across bands by size: `correct`, `wrong` or `unsure` per alternative. Publish only if `wrong` is at most 5% of the judged alternatives. Otherwise tighten filters or the checker, re-run the checker on stored candidates, and review a new sample. `tools/content/review_alternatives.py` draws the sample and removes the alternatives judged wrong. Alternatives judged `wrong` are removed before publishing. The result goes in `docs/research`. |
| 14 | Publish | `publish_catalogue.py` merges `alternatives.json` into the examples and fails if a key's example text no longer exists. Packs become `langocard-pack` version 3 with `packVersion` 3, Android `PACK_VERSION` becomes 3 and the catalogue moves to the `content-v4` branch. The pack `source`, `status` and `NOTICE.md` say the alternatives are machine-generated and sample-reviewed. |
| 15 | Rollout | One user, so old clients are not supported. Order: backend and web, then Android, then content. |

## Content rollout

After PR 4 merges, and only with operator approval:

1. Push a `content-v4` branch that contains the merged `content/` directory. The app's `CATALOGUE_URL` and every pack URL in the catalogue point there.
2. Run `npm run seed` in `apps/backend` for development, then `npm run seed -- --prod`. Unedited entries take the new examples; edited ones gain the alternatives (decision 10).
3. Install the new APK. Its bundled frequent pack carries the alternatives.

The generation and review record is [`../research/answer-alternatives-review-2026-11-25.md`](../research/answer-alternatives-review-2026-11-25.md).

## Ubiquitous language

- **Target.** The first word or phrase in an example's answer marks: the one the card trains.
- **Alternative.** Another word or phrase inside the same marks that fits the sentence with the same meaning.
- **Matched answer.** The target or alternative the typed answer was compared with on reveal.
